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

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  error: string | null;
}

export interface RetrievedChunk {
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
    console.error('[HR Retrieval] Token creation failed:', err instanceof Error ? err.message : err);
    return { chunks: [], error: 'Token creation failed' };
  }

  // 2. Query via least-privilege reader pool
  const sanitized = sanitizeQuery(queryText);
  try {
    const result = await readerPool.query(
      'SELECT * FROM hr_retrieve_knowledge($1, $2, $3, $4)',
      [token, sanitized, 30, 5]
    );

    // 3. Build citations with block-level deep links
    const chunks: RetrievedChunk[] = (result.rows || []).map((row) => ({
      contentText: row.content_text as string,
      headingPath: (row.heading_path as string[]) || [],
      citation: buildCitation(row),
    }));

    return { chunks, error: null };
  } catch (err) {
    // Fail closed — no fallback to a less-secure path
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[HR Retrieval] Reader pool query error (returning empty):', msg);
    return { chunks: [], error: msg };
  }
}

function buildCitation(row: Record<string, unknown>): Citation {
  const pageUrl = (row.page_url as string) ||
    `https://notion.so/${(row.notion_page_id as string || '').replace(/-/g, '')}`;
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
