/**
 * Patricia Nudge Check - Railway Cron Entry Point
 * Schedule: 0 20 * * 1-5 (2pm CST Mon-Fri)
 */
import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/supabase.js';
import { runNudgeCheck } from '../scripts/patricia-checkin.js';

async function main() {
  // Acquire distributed lock to prevent duplicate runs across replicas
  const { acquired } = await acquireCronLock('patricia-nudge', 10);
  if (!acquired) {
    console.log('[CRON] Patricia nudge: Another instance already running, exiting');
    process.exit(0);
  }

  const runId = await logJobStart('patricia-nudge');

  try {
    console.log(`[CRON] Patricia nudge check starting at ${new Date().toISOString()}`);
    await runNudgeCheck();

    if (runId) {
      await logJobComplete(runId, { notes: 'Nudge check completed successfully' });
    }

    console.log('[CRON] Patricia nudge check completed');
    process.exit(0);
  } catch (err) {
    console.error('[CRON] Patricia nudge check failed:', err);

    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }

    process.exit(1);
  }
}

main();
