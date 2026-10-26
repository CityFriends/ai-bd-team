/**
 * Knowledge Retrieval — Database-Enforced Authorization
 *
 * All retrieval flows through the hr_retrieve_knowledge RPC, which
 * enforces authorization via SQL JOINs at the database level:
 *
 * 1. access_classification matches the requester's role
 * 2. sync_status = 'synced' (excludes revoked/excluded)
 * 3. last_verified_at within freshness window
 * 4. conn.is_active = true (connection healthy)
 * 5. ar.is_active = true (root still approved)
 * 6. hr_knowledge_sources approval (when source record exists)
 * 7. is_authoritative constraint (handbook_pdf only)
 *
 * No less-secure fallback path exists. If the RPC is unavailable,
 * retrieval fails closed (returns empty results with error).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HRAuthProvider } from '../auth/hr-auth.js';

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
 * Authorization is checked at both the application layer (role) and
 * the database layer (RPC JOINs). No less-secure fallback exists.
 */
export async function retrieveForUser(
  db: SupabaseClient,
  queryText: string,
  slackUserId: string,
  auth: HRAuthProvider
): Promise<RetrievalResult> {
  // 1. Application-layer authorization — fail closed
  const isKnown = await auth.isKnownEmployee(slackUserId);
  if (!isKnown) {
    return { chunks: [], error: 'Not authorized' };
  }

  const context = auth.authorize(slackUserId);
  const allowedClassifications = context.isAuthorizedAdmin
    ? ['employee_safe', 'hr_restricted']
    : ['employee_safe'];

  // 2. Database-layer retrieval via RPC
  //    The RPC enforces all JOINs and filters in a single SQL query.
  const sanitized = sanitizeQuery(queryText);
  const { data, error } = await db.rpc('hr_retrieve_knowledge', {
    p_allowed_classifications: allowedClassifications,
    p_query: sanitized,
    p_freshness_minutes: 30,
    p_limit: 5,
  });

  if (error) {
    // Fail closed — no fallback to a less-secure path
    console.error('[HR Retrieval] RPC error (returning empty):', error.message);
    return { chunks: [], error: error.message };
  }

  // 3. Build citations with block-level deep links
  const chunks: RetrievedChunk[] = (data || []).map((row: Record<string, unknown>) => ({
    contentText: row.content_text as string,
    headingPath: (row.heading_path as string[]) || [],
    citation: buildCitation(row),
  }));

  return { chunks, error: null };
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
