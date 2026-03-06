/**
 * Cache Cleanup Cron
 *
 * Periodically cleans up expired cache entries from:
 * - semantic_cache (semantic query cache)
 * - tool_cache (API tool results)
 *
 * Schedule: Daily (recommended to run during off-hours)
 */
import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/database/cron.js';
import { performCacheCleanup, getCacheStats } from '../integrations/semantic-cache.js';
import { cleanupToolCache } from '../tools/cache.js';

// ============================================================
// Cleanup Functions
// ============================================================

interface CleanupResult {
  semanticCacheDeleted: number;
  toolCacheDeleted: number;
  cacheStats: {
    totalQueries: number;
    hitRate: number;
    estimatedSavings: string;
  };
}

async function runCleanup(): Promise<CleanupResult> {
  console.log('[CacheCleanup] Starting cache cleanup...');

  // Clean up semantic cache
  const semanticCacheDeleted = await performCacheCleanup();
  console.log(`[CacheCleanup] Removed ${semanticCacheDeleted} expired semantic cache entries`);

  // Clean up tool cache
  const toolCacheDeleted = await cleanupToolCache();
  console.log(`[CacheCleanup] Removed ${toolCacheDeleted} expired tool cache entries`);

  // Get current stats for reporting
  const stats = await getCacheStats(24);
  console.log(
    `[CacheCleanup] Last 24h stats: ${stats.totalQueries} queries, ${(stats.hitRate * 100).toFixed(1)}% hit rate, ${stats.estimatedSavings} saved`
  );

  return {
    semanticCacheDeleted,
    toolCacheDeleted,
    cacheStats: {
      totalQueries: stats.totalQueries,
      hitRate: stats.hitRate,
      estimatedSavings: stats.estimatedSavings,
    },
  };
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronCacheCleanup(): Promise<void> {
  // Acquire distributed lock to prevent duplicate runs across replicas
  const { acquired } = await acquireCronLock('cache-cleanup', 30);
  if (!acquired) {
    console.log('[CacheCleanup] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('cache-cleanup');

  try {
    const result = await runCleanup();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: result.semanticCacheDeleted + result.toolCacheDeleted,
        notes: `Cleaned ${result.semanticCacheDeleted} semantic + ${result.toolCacheDeleted} tool cache entries. Hit rate: ${(result.cacheStats.hitRate * 100).toFixed(1)}%`,
      });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

// ============================================================
// Direct Execution
// ============================================================

async function main() {
  console.log('[CacheCleanup] Starting manual cache cleanup run...');

  try {
    await cronCacheCleanup();
    console.log('[CacheCleanup] Done');
    process.exit(0);
  } catch (err) {
    console.error('[CacheCleanup] Failed:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('cache-cleanup')) {
  main();
}
