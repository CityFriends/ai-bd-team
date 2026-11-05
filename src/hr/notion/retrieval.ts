/**
 * Knowledge Retrieval — Signed Identity, Least-Privilege
 *
 * All retrieval flows through the hr_retrieve_knowledge RPC via the
 * hr_reader PostgreSQL role. The function verifies a signed HMAC
 * identity token inside a SECURITY DEFINER function.
 *
 * Authorization is enforced at two layers:
 * 1. Application: creates a signed token binding Slack identity
 * 2. Database: SECURITY DEFINER RPC verifies token, resolves employee,
 *    checks grants/supervision, enforces scope/classification
 *
 * No less-secure fallback path exists. If the reader pool is unavailable,
 * retrieval fails closed (returns empty results with error).
 */

import type { HRReaderPool } from '../database/hr-client.js';
import { createIdentityToken } from '../auth/identity-token.js';
import { extractSearchTermsWithSource, type SearchTerm } from '../llm/keyword-extractor.js';

/**
 * Retrieval is gated on HR_AI_ENABLED=true. This prevents knowledge
 * retrieval RPCs from executing when credentials are present but AI
 * features are not explicitly activated. Checked at the retrieval
 * boundary — cannot be bypassed by callers.
 */
function isRetrievalEnabled(): boolean {
  return process.env.HR_AI_ENABLED?.toLowerCase() === 'true';
}

/** Maximum retrieval freshness window: 30 days. */
const FRESHNESS_MAX = 43200;
const FRESHNESS_DEFAULT = 30;

/**
 * Parse and validate HR_RETRIEVAL_FRESHNESS_MINUTES.
 * Shared logic — identical rules at startup (loadHREnv) and runtime.
 * Returns the validated value or throws for invalid explicit settings.
 */
export function parseRetrievalFreshness(raw: string | undefined): number {
  if (raw === undefined || raw === '') return FRESHNESS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > FRESHNESS_MAX) {
    throw new Error(
      `HR_RETRIEVAL_FRESHNESS_MINUTES must be a positive integer up to ${FRESHNESS_MAX}. Got: ${raw}`
    );
  }
  return parsed;
}

/**
 * Retrieval freshness window in minutes. Read at call time so env-var
 * changes take effect without restart (consistent with isRetrievalEnabled).
 *
 * Uses the same strict validation as loadHREnv. An invalid explicit
 * setting throws rather than silently falling back to 30 minutes.
 */
function getRetrievalFreshnessMinutes(): number {
  return parseRetrievalFreshness(process.env.HR_RETRIEVAL_FRESHNESS_MINUTES);
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  error: string | null;
}

export interface RetrievedChunk {
  chunkId: string;
  contentText: string;
  headingPath: string[];
  citation: Citation;
}

export interface Citation {
  title: string;
  heading: string;
  url: string;
  verifiedAt: string | null;
}

/** Maximum candidates requested from the RPC per search term. */
const CANDIDATES_PER_TERM = 20;

/** Maximum final chunks returned after scoring. */
const MAX_RESULT_CHUNKS = 10;

/**
 * Retrieve knowledge chunks for a Slack user's query.
 * Creates a signed identity token and sends it through the
 * least-privilege reader pool to the SECURITY DEFINER RPC.
 *
 * Extracts keywords from natural-language questions, runs
 * multiple ILIKE queries, scores candidates by relevance,
 * and returns the top-ranked results.
 */
export async function retrieveForUser(
  readerPool: HRReaderPool,
  signingSecret: string,
  queryText: string,
  slackUserId: string
): Promise<RetrievalResult> {
  // 0. Gate: retrieval requires HR_AI_ENABLED=true
  if (!isRetrievalEnabled()) {
    return { chunks: [], error: null };
  }

  // 1. Extract search keywords from the natural-language question
  const searchTerms = extractSearchTermsWithSource(queryText);
  if (searchTerms.length === 0) {
    return { chunks: [], error: null };
  }

  // 2. Collect all candidates across all terms (no early exit)
  const candidates = new Map<string, ScoredCandidate>();
  const freshness = getRetrievalFreshnessMinutes();

  for (const term of searchTerms) {
    // Each query gets a fresh signed token (30s lifetime)
    let token: string;
    try {
      token = createIdentityToken(slackUserId, signingSecret);
    } catch (err) {
      console.error(
        '[HR Retrieval] Token creation failed:',
        err instanceof Error ? err.message : err
      );
      return { chunks: [], error: 'Token creation failed' };
    }

    const sanitized = sanitizeQuery(term.text);
    try {
      const result = await readerPool.query(
        'SELECT * FROM hr_retrieve_knowledge_v2($1, $2, $3, $4)',
        [token, sanitized, freshness, CANDIDATES_PER_TERM]
      );

      for (const row of result.rows || []) {
        const rawChunkId = row.chunk_id;
        if (typeof rawChunkId !== 'string' || !isValidUUID(rawChunkId)) {
          return { chunks: [], error: 'Invalid chunk identifier in retrieval result' };
        }

        const existing = candidates.get(rawChunkId);
        if (existing) {
          // Accumulate match signals for scoring
          existing.matchedTerms.push(term);
        } else {
          candidates.set(rawChunkId, {
            chunk: {
              chunkId: rawChunkId,
              contentText: row.content_text as string,
              headingPath: (row.heading_path as string[]) || [],
              citation: buildCitation(row),
            },
            title: (row.title as string) || '',
            matchedTerms: [term],
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[HR Retrieval] Reader pool query error (returning empty):', msg);
      return { chunks: [], error: msg };
    }
  }

  // 3. Score, rank, and select top candidates
  const scored = Array.from(candidates.values()).map((c) => ({
    ...c,
    score: scoreCandidate(c, searchTerms),
  }));

  scored.sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId));

  return {
    chunks: scored.slice(0, MAX_RESULT_CHUNKS).map((c) => c.chunk),
    error: null,
  };
}

// ── Relevance Scoring ──────────────────────────────────────

interface ScoredCandidate {
  chunk: RetrievedChunk;
  title: string;
  matchedTerms: SearchTerm[];
}

/**
 * Deterministic relevance score for a retrieved chunk candidate.
 *
 * Scoring signals (applied once per distinct match type):
 *   +100  Title/heading contains an exact multi-word phrase from the query
 *    +60  Chunk matched a multi-word phrase term
 *    +40  Chunk matched a recognized synonym term
 *    +15  Each additional distinct term match beyond the first
 *     +5  Chunk matched a generic single-word term
 *
 * Scoring is separate from authorization. A high score does not
 * bypass content-hash approval or freshness checks.
 */
function scoreCandidate(
  candidate: ScoredCandidate,
  _allTerms: readonly SearchTerm[]
): number {
  let score = 0;
  const countedSources = new Set<string>();
  const titleLower = candidate.title.toLowerCase();
  const headingLower = candidate.chunk.headingPath.join(' ').toLowerCase();

  for (const term of candidate.matchedTerms) {
    // Avoid counting the same source type more than once per term text
    const key = `${term.source}:${term.text}`;
    if (countedSources.has(key)) continue;
    countedSources.add(key);

    // Title/heading match bonus (only for phrases)
    if (term.source === 'phrase') {
      if (titleLower.includes(term.text) || headingLower.includes(term.text)) {
        score += 100;
      } else {
        score += 60;
      }
    } else if (term.source === 'synonym') {
      score += 40;
    } else {
      // keyword (standalone word)
      score += 5;
    }
  }

  // Bonus for multiple distinct term matches
  const distinctTerms = countedSources.size;
  if (distinctTerms > 1) {
    score += (distinctTerms - 1) * 15;
  }

  return score;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

function buildCitation(row: Record<string, unknown>): Citation {
  const pageUrl =
    (row.page_url as string) ||
    `https://notion.so/${((row.notion_page_id as string) || '').replace(/-/g, '')}`;
  const blockId = row.first_block_id as string | null;
  const url = blockId ? `${pageUrl}#${blockId.replace(/-/g, '')}` : pageUrl;

  return {
    title: (row.title as string) || 'Untitled',
    heading: ((row.heading_path as string[]) || []).join(' > '),
    url,
    verifiedAt: (row.last_verified_at as string) || null,
  };
}

function sanitizeQuery(q: string): string {
  // Escape SQL LIKE special characters including backslash
  return q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').slice(0, 200);
}
