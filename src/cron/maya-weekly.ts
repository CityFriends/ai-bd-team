/**
 * Maya Weekly Summary - Railway Cron Entry Point
 * Schedule: 30 14 * * 1 (8:30am CST Monday)
 */
import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/supabase.js';
import { runWeeklySummary } from '../scripts/maya-scanner.js';

async function main() {
  // Acquire distributed lock to prevent duplicate runs across replicas
  const { acquired } = await acquireCronLock('maya-weekly-summary', 15);
  if (!acquired) {
    console.log('[CRON] Maya weekly summary: Another instance already running, exiting');
    process.exit(0);
  }

  const runId = await logJobStart('maya-weekly-summary');

  try {
    console.log(`[CRON] Maya weekly summary starting at ${new Date().toISOString()}`);
    await runWeeklySummary();

    if (runId) {
      await logJobComplete(runId, { notes: 'Weekly summary completed successfully' });
    }

    console.log('[CRON] Maya weekly summary completed');
    process.exit(0);
  } catch (err) {
    console.error('[CRON] Maya weekly summary failed:', err);

    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }

    process.exit(1);
  }
}

main();
