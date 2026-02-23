/**
 * Patricia Morning Standup - Railway Cron Entry Point
 * Schedule: 0 17 * * 1-5 (11am CST Mon-Fri)
 */
import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/supabase.js';
import { runMorningCheckin } from '../scripts/patricia-checkin.js';

async function main() {
  // Acquire distributed lock to prevent duplicate runs across replicas
  const { acquired } = await acquireCronLock('patricia-standup', 10); // 10 min window
  if (!acquired) {
    console.log('[CRON] Patricia standup: Another instance already running, exiting');
    process.exit(0);
  }

  const runId = await logJobStart('patricia-standup');

  try {
    console.log(`[CRON] Patricia standup starting at ${new Date().toISOString()}`);
    await runMorningCheckin();

    if (runId) {
      await logJobComplete(runId, { notes: 'Morning standup completed successfully' });
    }

    console.log('[CRON] Patricia standup completed');
    process.exit(0);
  } catch (err) {
    console.error('[CRON] Patricia standup failed:', err);

    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }

    process.exit(1);
  }
}

main();
