import { getSupabase } from './client.js';

// ============================================
// DISTRIBUTED LOCK FOR CRON JOBS
// Prevents duplicate runs when Railway has multiple replicas
// ============================================

/**
 * Acquire a distributed lock for a cron job.
 * Returns true if lock acquired, false if another instance already has it.
 *
 * Uses a time-window based lock key to prevent duplicate runs within a window.
 * Default window is 5 minutes - jobs won't run twice within that window.
 */
export async function acquireCronLock(
  jobName: string,
  windowMinutes: number = 5
): Promise<{ acquired: boolean; lockId?: string }> {
  try {
    // Create a lock key based on job name and time window
    // e.g., "patricia-standup:2026-02-23T16:00" (rounded to 5-min window)
    const now = new Date();
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const lockKey = `${jobName}:${windowStart.toISOString()}`;

    // Try to insert the lock - will fail if duplicate
    const { data, error } = await getSupabase()
      .from('cron_locks')
      .insert({
        lock_key: lockKey,
        job_name: jobName,
        acquired_at: now.toISOString(),
        expires_at: new Date(now.getTime() + windowMs).toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // Check if it's a duplicate key error
      if (error.code === '23505') {
        console.log(`[LOCK] ${jobName}: Another instance already running (lock: ${lockKey})`);
        return { acquired: false };
      }
      // Other error - log but allow job to proceed (fail open)
      console.warn(`[LOCK] ${jobName}: Lock error (proceeding anyway):`, error.message);
      return { acquired: true };
    }

    console.log(`[LOCK] ${jobName}: Lock acquired (${lockKey})`);
    return { acquired: true, lockId: data.id };
  } catch (err) {
    // On any error, fail open - allow job to run
    console.warn(`[LOCK] ${jobName}: Lock system error (proceeding anyway):`, err);
    return { acquired: true };
  }
}

/**
 * Release a cron lock (optional - locks auto-expire)
 */
export async function releaseCronLock(lockId: string): Promise<void> {
  try {
    await getSupabase().from('cron_locks').delete().eq('id', lockId);
  } catch {
    // Ignore release errors
  }
}

/**
 * Clean up expired locks (run periodically)
 */
export async function cleanupExpiredLocks(): Promise<number> {
  try {
    const { data } = await getSupabase()
      .from('cron_locks')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    return data?.length || 0;
  } catch {
    return 0;
  }
}

// ============================================
// CRON JOB RUN LOGGING
// ============================================

export interface CronJobRun {
  id?: string;
  job_name: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  error_message?: string;
  items_processed?: number;
  notes?: string;
}

/**
 * Log the start of a cron job run
 */
export async function logJobStart(jobName: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from('cron_job_runs')
      .insert({
        job_name: jobName,
        started_at: new Date().toISOString(),
        status: 'running',
      })
      .select('id')
      .single();

    if (error) {
      console.warn('Could not log job start:', error.message);
      return null;
    }

    console.log(`[JOB] Started: ${jobName} (run_id: ${data.id})`);
    return data.id;
  } catch (err) {
    console.warn('Could not log job start:', err);
    return null;
  }
}

/**
 * Log the completion of a cron job run
 */
export async function logJobComplete(
  runId: string,
  options: { itemsProcessed?: number; notes?: string } = {}
): Promise<void> {
  try {
    const { data: run } = await getSupabase()
      .from('cron_job_runs')
      .select('started_at, job_name')
      .eq('id', runId)
      .single();

    const startedAt = run?.started_at ? new Date(run.started_at) : new Date();
    const durationMs = Date.now() - startedAt.getTime();

    await getSupabase()
      .from('cron_job_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        items_processed: options.itemsProcessed,
        notes: options.notes,
      })
      .eq('id', runId);

    console.log(`[JOB] Completed: ${run?.job_name} in ${durationMs}ms`);
  } catch (err) {
    console.warn('Could not log job completion:', err);
  }
}

/**
 * Log a failed cron job run
 */
export async function logJobFailed(runId: string, errorMessage: string): Promise<void> {
  try {
    const { data: run } = await getSupabase()
      .from('cron_job_runs')
      .select('started_at, job_name')
      .eq('id', runId)
      .single();

    const startedAt = run?.started_at ? new Date(run.started_at) : new Date();
    const durationMs = Date.now() - startedAt.getTime();

    await getSupabase()
      .from('cron_job_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_message: errorMessage,
      })
      .eq('id', runId);

    console.error(`[JOB] Failed: ${run?.job_name} - ${errorMessage}`);
  } catch (err) {
    console.warn('Could not log job failure:', err);
  }
}

/**
 * Get recent job runs for monitoring
 */
export async function getRecentJobRuns(
  options: { jobName?: string; limit?: number; hoursBack?: number } = {}
): Promise<CronJobRun[]> {
  const { jobName, limit = 50, hoursBack = 24 } = options;

  try {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    let query = getSupabase()
      .from('cron_job_runs')
      .select('*')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (jobName) {
      query = query.eq('job_name', jobName);
    }

    const { data, error } = await query;

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Get job run statistics
 */
export async function getJobStats(daysBack: number = 7): Promise<{
  byJob: Record<string, { runs: number; failures: number; avgDuration: number }>;
  totalRuns: number;
  totalFailures: number;
}> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('cron_job_runs')
      .select('job_name, status, duration_ms')
      .gte('started_at', since);

    if (error || !data) {
      return { byJob: {}, totalRuns: 0, totalFailures: 0 };
    }

    const byJob: Record<string, { runs: number; failures: number; totalDuration: number }> = {};
    let totalRuns = 0;
    let totalFailures = 0;

    for (const run of data) {
      totalRuns++;
      if (run.status === 'failed') totalFailures++;

      if (!byJob[run.job_name]) {
        byJob[run.job_name] = { runs: 0, failures: 0, totalDuration: 0 };
      }
      byJob[run.job_name].runs++;
      if (run.status === 'failed') byJob[run.job_name].failures++;
      if (run.duration_ms) byJob[run.job_name].totalDuration += run.duration_ms;
    }

    // Calculate averages
    const result: Record<string, { runs: number; failures: number; avgDuration: number }> = {};
    for (const [job, stats] of Object.entries(byJob)) {
      result[job] = {
        runs: stats.runs,
        failures: stats.failures,
        avgDuration: stats.runs > 0 ? Math.round(stats.totalDuration / stats.runs) : 0,
      };
    }

    return { byJob: result, totalRuns, totalFailures };
  } catch {
    return { byJob: {}, totalRuns: 0, totalFailures: 0 };
  }
}
