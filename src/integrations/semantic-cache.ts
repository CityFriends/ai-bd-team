// Semantic Response Caching
// Caches query results by meaning, not exact words
// Significantly reduces API costs and latency for repeated query patterns

import {
  findSimilarCachedQuery,
  storeCachedQuery,
  cleanupExpiredCache,
} from './semantic-search.js';
import { getSupabase } from './supabase.js';

export interface CacheOptions {
  cacheType: string; // 'research', 'response', 'analysis', etc.
  ttlHours?: number; // Time to live in hours (default 24)
  similarityThreshold?: number; // Min similarity to consider a cache hit (default 0.92)
}

export interface CacheResult<T> {
  data: T;
  cached: boolean;
  cacheHit?: {
    originalQuery: string;
    similarity: number;
  };
}

/**
 * Get cached result or fetch new data
 * This is the main entry point for semantic caching
 */
export async function getCachedOrFetch<T>(
  query: string,
  fetcher: () => Promise<T>,
  options: CacheOptions
): Promise<CacheResult<T>> {
  const { cacheType, ttlHours = 24, similarityThreshold = 0.92 } = options;

  try {
    // Check for semantically similar cached query
    const cached = await findSimilarCachedQuery(query, cacheType, similarityThreshold);

    if (cached) {
      console.log(
        `Semantic cache HIT: "${query.slice(0, 50)}..." matched "${cached.query.slice(0, 50)}..." (similarity: ${cached.similarity.toFixed(3)})`
      );
      // Record hit to persistent stats
      await recordCacheStatToDB(cacheType, true, cached.similarity);
      return {
        data: cached.result as T,
        cached: true,
        cacheHit: {
          originalQuery: cached.query,
          similarity: cached.similarity,
        },
      };
    }

    console.log(`Semantic cache MISS: "${query.slice(0, 50)}..."`);
    // Record miss to persistent stats
    await recordCacheStatToDB(cacheType, false);

    // No cache hit - fetch new data
    const result = await fetcher();

    // Store in cache for future use
    try {
      await storeCachedQuery(query, result, cacheType, ttlHours);
    } catch (err) {
      console.warn('Could not store in semantic cache:', err);
    }

    return {
      data: result,
      cached: false,
    };
  } catch (err) {
    // On error, just fetch without caching
    console.warn('Semantic cache error, fetching directly:', err);
    const result = await fetcher();
    return {
      data: result,
      cached: false,
    };
  }
}

/**
 * Research cache - for USASpending, SAM.gov, news queries
 * Higher TTL (48 hours) since research data doesn't change often
 */
export async function getCachedResearch<T>(
  query: string,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  return getCachedOrFetch(query, fetcher, {
    cacheType: 'research',
    ttlHours: 48,
    similarityThreshold: 0.9, // Lower threshold for research (more lenient matching)
  });
}

/**
 * Analysis cache - for opportunity analysis, risk assessment
 * Medium TTL (24 hours) and higher similarity threshold
 */
export async function getCachedAnalysis<T>(
  query: string,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  return getCachedOrFetch(query, fetcher, {
    cacheType: 'analysis',
    ttlHours: 24,
    similarityThreshold: 0.92,
  });
}

/**
 * Response cache - for full agent responses
 * Lower TTL (6 hours) to keep responses fresh
 */
export async function getCachedResponse<T>(
  query: string,
  fetcher: () => Promise<T>
): Promise<CacheResult<T>> {
  return getCachedOrFetch(query, fetcher, {
    cacheType: 'response',
    ttlHours: 6,
    similarityThreshold: 0.95, // Higher threshold for responses (exact match wanted)
  });
}

/**
 * Invalidate cache entries matching a cache type
 * Use when data is known to have changed
 */
export async function invalidateCache(cacheType: string): Promise<number> {
  try {
    const { data, error } = await getSupabase()
      .from('semantic_cache')
      .delete()
      .eq('cache_type', cacheType)
      .select('id');

    if (error) {
      console.error(`Cache invalidation failed for type ${cacheType}:`, error);
      return 0;
    }

    const deletedCount = data?.length || 0;
    console.log(`Cache invalidation: removed ${deletedCount} entries for type: ${cacheType}`);
    return deletedCount;
  } catch (err) {
    console.error(`Cache invalidation failed for type ${cacheType}:`, err);
    return 0;
  }
}

/**
 * Clean up expired cache entries
 * Should be run periodically (e.g., daily cron job)
 */
export async function performCacheCleanup(): Promise<number> {
  const deletedCount = await cleanupExpiredCache();
  console.log(`Semantic cache cleanup: removed ${deletedCount} expired entries`);
  return deletedCount;
}

/**
 * Calculate potential cost savings from cache
 * Useful for monitoring and reporting
 */
export interface CacheStats {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  estimatedSavings: string; // In approximate API cost savings
  byCacheType?: Record<string, { hits: number; misses: number; hitRate: number }>;
}

/**
 * Record cache stat to database using RPC function
 * Falls back to no-op if RPC not available yet
 */
async function recordCacheStatToDB(
  cacheType: string,
  isHit: boolean,
  similarity?: number
): Promise<void> {
  try {
    const { error } = await getSupabase().rpc('record_cache_stat', {
      p_cache_type: cacheType,
      p_is_hit: isHit,
      p_similarity: similarity || null,
    });

    if (error) {
      // RPC might not exist yet - that's OK, silently ignore
      // This enables graceful degradation before migration runs
      if (!error.message.includes('does not exist')) {
        console.warn('[CacheStats] Failed to record stat:', error.message);
      }
    }
  } catch (err) {
    // Silently ignore - stats are non-critical
  }
}

/**
 * Get cache stats from database
 * Returns aggregated stats for the last 24 hours by default
 */
export async function getCacheStats(hoursBack: number = 24): Promise<CacheStats> {
  try {
    const { data, error } = await getSupabase().rpc('get_cache_stats', {
      p_hours_back: hoursBack,
      p_cache_type: null,
    });

    if (error || !data || data.length === 0) {
      // Return empty stats if RPC not available or no data
      return {
        totalQueries: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        estimatedSavings: '$0.00',
      };
    }

    // Aggregate across all cache types
    let totalHits = 0;
    let totalMisses = 0;
    const byCacheType: Record<string, { hits: number; misses: number; hitRate: number }> = {};

    for (const row of data) {
      totalHits += Number(row.total_hits) || 0;
      totalMisses += Number(row.total_misses) || 0;
      byCacheType[row.cache_type] = {
        hits: Number(row.total_hits) || 0,
        misses: Number(row.total_misses) || 0,
        hitRate: Number(row.hit_rate) || 0,
      };
    }

    const totalQueries = totalHits + totalMisses;
    const hitRate = totalQueries > 0 ? totalHits / totalQueries : 0;
    // Rough estimate: each Claude API call costs ~$0.003 for a typical request
    const estimatedSavings = `$${(totalHits * 0.003).toFixed(2)}`;

    return {
      totalQueries,
      cacheHits: totalHits,
      cacheMisses: totalMisses,
      hitRate,
      estimatedSavings,
      byCacheType,
    };
  } catch (err) {
    console.warn('[CacheStats] Failed to get stats:', err);
    return {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hitRate: 0,
      estimatedSavings: '$0.00',
    };
  }
}

// Legacy in-memory functions kept for backwards compatibility
// New code should rely on getCacheStats() which reads from DB

let inMemoryStats = {
  totalQueries: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

/** @deprecated Use database-backed stats. This is kept for backwards compatibility. */
export function recordCacheHit(): void {
  inMemoryStats.totalQueries++;
  inMemoryStats.cacheHits++;
}

/** @deprecated Use database-backed stats. This is kept for backwards compatibility. */
export function recordCacheMiss(): void {
  inMemoryStats.totalQueries++;
  inMemoryStats.cacheMisses++;
}

/** @deprecated Use database-backed stats. This is kept for backwards compatibility. */
export function resetCacheStats(): void {
  inMemoryStats = {
    totalQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
}
