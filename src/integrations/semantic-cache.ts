// Semantic Response Caching
// Caches query results by meaning, not exact words
// Significantly reduces API costs and latency for repeated query patterns

import { findSimilarCachedQuery, storeCachedQuery, cleanupExpiredCache } from './semantic-search.js';

export interface CacheOptions {
  cacheType: string;           // 'research', 'response', 'analysis', etc.
  ttlHours?: number;           // Time to live in hours (default 24)
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
  const {
    cacheType,
    ttlHours = 24,
    similarityThreshold = 0.92,
  } = options;

  try {
    // Check for semantically similar cached query
    const cached = await findSimilarCachedQuery(query, cacheType, similarityThreshold);

    if (cached) {
      console.log(`Semantic cache HIT: "${query.slice(0, 50)}..." matched "${cached.query.slice(0, 50)}..." (similarity: ${cached.similarity.toFixed(3)})`);
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
    similarityThreshold: 0.90, // Lower threshold for research (more lenient matching)
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
 * Invalidate cache entries matching a pattern
 * Use when data is known to have changed
 */
export async function invalidateCache(cacheType: string): Promise<void> {
  // Currently just relies on TTL expiration
  // Could be enhanced to actively delete matching entries
  console.log(`Cache invalidation requested for type: ${cacheType}`);
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
}

// Simple in-memory stats tracking (could be persisted to DB)
let stats = {
  totalQueries: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

export function recordCacheHit(): void {
  stats.totalQueries++;
  stats.cacheHits++;
}

export function recordCacheMiss(): void {
  stats.totalQueries++;
  stats.cacheMisses++;
}

export function getCacheStats(): CacheStats {
  const hitRate = stats.totalQueries > 0 ? stats.cacheHits / stats.totalQueries : 0;
  // Rough estimate: each Claude API call costs ~$0.003 for a typical request
  const estimatedSavings = `$${(stats.cacheHits * 0.003).toFixed(2)}`;

  return {
    ...stats,
    hitRate,
    estimatedSavings,
  };
}

export function resetCacheStats(): void {
  stats = {
    totalQueries: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
}
