/**
 * Sync Scheduler — Dormant Timer Foundation
 *
 * Provides a controlled periodic sync timer that:
 * - Respects the HR_NOTION_SYNC_ENABLED kill switch
 * - Acquires a database lease before running
 * - Does NOT start automatically in this phase
 * - Can be activated in a future milestone
 *
 * The scheduler is created in stopped state and must be
 * explicitly started with start(). It stops when stop()
 * is called or the kill switch is disabled.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isNotionSyncEnabled } from '../config/hr-controls.js';
import { acquireSyncLease, releaseSyncLease, type SyncLease } from './sync-lease.js';

export const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

export interface SyncSchedulerConfig {
  db: SupabaseClient;
  intervalMs?: number;
  /** Called when the lease is acquired and sync should run. */
  onSync: (lease: SyncLease) => Promise<void>;
  /** Called on error (no sensitive data). */
  onError?: (error: string) => void;
}

export interface SyncScheduler {
  /** Start the periodic timer. No-op if already running. */
  start(): void;
  /** Stop the periodic timer. Safe to call multiple times. */
  stop(): void;
  /** Whether the timer is currently active. */
  isRunning(): boolean;
}

/**
 * Create a sync scheduler in stopped state.
 *
 * IMPORTANT: This scheduler does NOT start automatically.
 * Call scheduler.start() only when explicitly authorized.
 * In C8X-105B, the scheduler is created but never started.
 */
export function createSyncScheduler(config: SyncSchedulerConfig): SyncScheduler {
  const { db, intervalMs = DEFAULT_SYNC_INTERVAL_MS, onSync, onError } = config;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let consecutiveFailures = 0;

  async function tick(): Promise<void> {
    // Kill switch check on every tick
    if (!isNotionSyncEnabled()) {
      return;
    }

    // Try to acquire the lease
    let lease: SyncLease | null = null;
    try {
      lease = await acquireSyncLease(db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(`Lease acquisition failed: ${msg}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        onError?.(`${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping scheduler`);
        stop();
      }
      return;
    }

    if (!lease) {
      // Another worker holds the lease — skip this tick
      return;
    }

    try {
      await onSync(lease);
      consecutiveFailures = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(`Sync failed: ${msg}`);
      consecutiveFailures++;
    } finally {
      try {
        await releaseSyncLease(db, lease);
      } catch {
        // Lease will expire naturally
      }
    }
  }

  function start(): void {
    if (timer) return; // already running
    running = true;
    consecutiveFailures = 0;
    // First tick after a short delay (not immediately on start)
    timer = setInterval(() => {
      tick().catch(() => {}); // errors handled in tick()
    }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    running = false;
  }

  return {
    start,
    stop,
    isRunning: () => running,
  };
}
