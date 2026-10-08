/**
 * Denise — Regulatory Source Cache
 *
 * Reusable authoritative regulatory source cache.
 * Freshness by citation/version/hash — NOT fixed TTL.
 *
 * Cached interpretation is never authority.
 * When freshness matters, revalidate the source.
 *
 * Zero LLM calls. Zero provider imports.
 */

import { createHash } from 'crypto';
import type { SupabaseClient, CacheFreshnessStatus } from './types.js';

export interface CacheLookupResult {
  found: boolean;
  fresh: boolean;
  entry?: {
    id: string;
    authority: string;
    citation: string;
    version: string | null;
    content_hash: string;
    cached_text: string;
    freshness_status: CacheFreshnessStatus;
    last_validated_at: string;
  };
  reason: string;
}

/**
 * Look up a regulatory source in the cache.
 * Returns the cached entry if CURRENT, or indicates revalidation needed.
 */
export async function lookupCache(
  supabase: SupabaseClient,
  authority: string,
  citation: string,
  version?: string
): Promise<CacheLookupResult> {
  let query = supabase
    .from('regulatory_source_cache')
    .select('*')
    .eq('authority', authority)
    .eq('citation', citation);

  if (version) {
    query = query.eq('version', version);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return { found: false, fresh: false, reason: 'No cached entry found' };
  }

  if (data.freshness_status === 'CURRENT') {
    return {
      found: true,
      fresh: true,
      entry: data,
      reason: 'Cache entry is CURRENT',
    };
  }

  return {
    found: true,
    fresh: false,
    entry: data,
    reason: `Cache entry requires revalidation: ${data.freshness_status}`,
  };
}

/**
 * Store or update a regulatory source in the cache.
 * Uses content hash to detect actual changes.
 */
export async function cacheSource(
  supabase: SupabaseClient,
  params: {
    authority: string;
    citation: string;
    version?: string;
    effectiveDate?: string;
    sourceUrl?: string;
    text: string;
  }
): Promise<string> {
  const contentHash = createHash('sha256').update(params.text).digest('hex');

  const { data, error } = await supabase
    .from('regulatory_source_cache')
    .upsert(
      {
        authority: params.authority,
        citation: params.citation,
        version: params.version || null,
        effective_date: params.effectiveDate || null,
        source_url: params.sourceUrl || null,
        content_hash: contentHash,
        cached_text: params.text,
        freshness_status: 'CURRENT',
        last_validated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'authority,citation,version' }
    )
    .select('id')
    .single();

  if (error) throw new Error(`Failed to cache regulatory source: ${error.message}`);
  return data.id;
}

/**
 * Check if a cache entry needs revalidation by comparing content hashes.
 * If the hash changed, mark the entry as REVALIDATION_REQUIRED.
 */
export async function checkFreshness(
  supabase: SupabaseClient,
  authority: string,
  citation: string,
  currentHash: string
): Promise<{ fresh: boolean; reason: string }> {
  const result = await lookupCache(supabase, authority, citation);

  if (!result.found || !result.entry) {
    return { fresh: false, reason: 'No cached entry exists' };
  }

  if (result.entry.content_hash === currentHash) {
    return { fresh: true, reason: 'Content hash matches — cache is fresh' };
  }

  // Mark as needing revalidation
  await supabase
    .from('regulatory_source_cache')
    .update({
      freshness_status: 'REVALIDATION_REQUIRED',
      superseding_hash: currentHash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.entry.id);

  return {
    fresh: false,
    reason: `Content hash changed: cached=${result.entry.content_hash.slice(0, 8)} current=${currentHash.slice(0, 8)}`,
  };
}

/**
 * Mark a cache entry as superseded by a new version.
 */
export async function markSuperseded(
  supabase: SupabaseClient,
  cacheId: string,
  supersedingVersion: string
): Promise<void> {
  await supabase
    .from('regulatory_source_cache')
    .update({
      freshness_status: 'SUPERSEDED',
      superseding_version: supersedingVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', cacheId);
}
