/**
 * Tool Result Caching
 *
 * Caches tool results to reduce API calls and improve response times.
 * Uses semantic similarity to match similar queries to cached results.
 */

import { getSupabase } from '../integrations/supabase.js';

// Cache TTLs by tool category (in hours)
const CACHE_TTL: Record<string, number> = {
  // News data changes frequently
  search_news: 2,
  get_agency_news: 2,
  search_competitor_news: 4,

  // Spending data is relatively stable
  get_agency_spending: 24,
  get_agency_trend: 48,
  search_contractor_spending: 24,

  // Contract data is stable
  search_contracts: 12,
  find_incumbent: 24,
  get_vendor_history: 24,

  // SAM.gov opportunities change daily
  search_sam_opportunities: 4,
  get_opportunity_details: 12,

  // FAR doesn't change
  get_far_section: 168, // 1 week
  search_far: 168,
  get_far_part: 168,

  // SAM entity data is stable
  verify_entity: 72,
  get_entity_details: 72,

  // GitHub analysis
  analyze_github_repo: 24,

  // Default for unknown tools
  default: 6,
};

/**
 * Generate a deterministic hash for tool parameters
 */
function hashParams(toolName: string, params: Record<string, unknown>): string {
  // Sort keys for consistent hashing
  const sortedParams = Object.keys(params)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = params[key];
        return acc;
      },
      {} as Record<string, unknown>
    );

  const str = `${toolName}:${JSON.stringify(sortedParams)}`;

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `${toolName}:${Math.abs(hash).toString(36)}`;
}

/**
 * Check if a cached result exists for the given tool call
 */
export async function getCachedToolResult(
  toolName: string,
  params: Record<string, unknown>
): Promise<{ data: unknown; sourceCitation: string } | null> {
  try {
    const queryHash = hashParams(toolName, params);

    const { data, error } = await getSupabase()
      .from('tool_cache')
      .select('*')
      .eq('query_hash', queryHash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) {
      return null;
    }

    // Update hit count
    await getSupabase()
      .from('tool_cache')
      .update({
        hit_count: (data.hit_count || 0) + 1,
        last_hit_at: new Date().toISOString(),
      })
      .eq('id', data.id);

    console.log(`[ToolCache] HIT: ${toolName} (hash: ${queryHash})`);

    return {
      data: data.result,
      sourceCitation: `${data.source_citation} (cached)`,
    };
  } catch {
    // Cache miss or error - just return null, don't fail
    return null;
  }
}

/**
 * Get stale cached result (even if expired) for fallback when API fails
 */
export async function getStaleCachedResult(
  toolName: string,
  params: Record<string, unknown>
): Promise<{ data: unknown; sourceCitation: string; age: string } | null> {
  try {
    const queryHash = hashParams(toolName, params);

    // Get even expired entries
    const { data, error } = await getSupabase()
      .from('tool_cache')
      .select('*')
      .eq('query_hash', queryHash)
      .single();

    if (error || !data) {
      return null;
    }

    // Calculate age
    const createdAt = new Date(data.created_at);
    const ageMs = Date.now() - createdAt.getTime();
    const ageHours = Math.round(ageMs / (60 * 60 * 1000));
    const ageStr = ageHours < 24 ? `${ageHours}h` : `${Math.round(ageHours / 24)}d`;

    console.log(`[ToolCache] STALE FALLBACK: ${toolName} (age: ${ageStr})`);

    return {
      data: data.result,
      sourceCitation: `${data.source_citation} (cached ${ageStr} ago - API unavailable)`,
      age: ageStr,
    };
  } catch {
    return null;
  }
}

/**
 * Store a tool result in the cache
 */
export async function cacheToolResult(
  toolName: string,
  params: Record<string, unknown>,
  result: unknown,
  sourceCitation: string
): Promise<void> {
  try {
    const queryHash = hashParams(toolName, params);
    const ttlHours = CACHE_TTL[toolName] || CACHE_TTL.default;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    // Upsert the cache entry
    await getSupabase().from('tool_cache').upsert(
      {
        tool_name: toolName,
        query_hash: queryHash,
        params,
        result,
        source_citation: sourceCitation,
        expires_at: expiresAt,
        hit_count: 0,
      },
      {
        onConflict: 'query_hash',
      }
    );

    console.log(`[ToolCache] STORE: ${toolName} (TTL: ${ttlHours}h, hash: ${queryHash})`);
  } catch (err) {
    // Don't fail if caching fails
    console.warn(`[ToolCache] Failed to store: ${toolName}`, err);
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupToolCache(): Promise<number> {
  try {
    const { data, error } = await getSupabase()
      .from('tool_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.warn('[ToolCache] Cleanup failed:', error);
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(`[ToolCache] Cleaned up ${count} expired entries`);
    }
    return count;
  } catch (err) {
    console.warn('[ToolCache] Cleanup error:', err);
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getToolCacheStats(): Promise<{
  totalEntries: number;
  totalHits: number;
  byTool: Record<string, { entries: number; hits: number }>;
}> {
  try {
    const { data, error } = await getSupabase()
      .from('tool_cache')
      .select('tool_name, hit_count')
      .gt('expires_at', new Date().toISOString());

    if (error || !data) {
      return { totalEntries: 0, totalHits: 0, byTool: {} };
    }

    const byTool: Record<string, { entries: number; hits: number }> = {};
    let totalHits = 0;

    for (const entry of data) {
      if (!byTool[entry.tool_name]) {
        byTool[entry.tool_name] = { entries: 0, hits: 0 };
      }
      byTool[entry.tool_name].entries++;
      byTool[entry.tool_name].hits += entry.hit_count || 0;
      totalHits += entry.hit_count || 0;
    }

    return {
      totalEntries: data.length,
      totalHits,
      byTool,
    };
  } catch (err) {
    return { totalEntries: 0, totalHits: 0, byTool: {} };
  }
}
