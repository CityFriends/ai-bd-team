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

/**
 * Retrieve knowledge chunks for a Slack user's query.
 * Creates a signed identity token and sends it through the
 * least-privilege reader pool to the SECURITY DEFINER RPC.
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

  // 1. Create signed identity token (30s lifetime)
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

  // 2. Query via least-privilege reader pool (v2 returns chunk_id)
  const sanitized = sanitizeQuery(queryText);
  try {
    const result = await readerPool.query(
      'SELECT * FROM hr_retrieve_knowledge_v2($1, $2, $3, $4)',
      [token, sanitized, getRetrievalFreshnessMinutes(), 5]
    );

    // 3. Validate chunk IDs and build citations with block-level deep links
    const chunks: RetrievedChunk[] = [];
    for (const row of result.rows || []) {
      const rawChunkId = row.chunk_id;
      if (typeof rawChunkId !== 'string' || !isValidUUID(rawChunkId)) {
        // Fail closed: chunk without a valid UUID is not returnable
        return { chunks: [], error: 'Invalid chunk identifier in retrieval result' };
      }
      chunks.push({
        chunkId: rawChunkId,
        contentText: row.content_text as string,
        headingPath: (row.heading_path as string[]) || [],
        citation: buildCitation(row),
      });
    }

    return { chunks, error: null };
  } catch (err) {
    // Fail closed — no fallback to a less-secure path
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[HR Retrieval] Reader pool query error (returning empty):', msg);
    return { chunks: [], error: msg };
  }
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
