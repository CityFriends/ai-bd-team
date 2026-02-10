/**
 * Maya Daily Scan - Railway Cron Entry Point
 * Schedule: 0 14 * * 1-5 (8am CST Mon-Fri)
 */
import 'dotenv/config';
import { logJobStart, logJobComplete, logJobFailed } from '../integrations/supabase.js';
import { runDailyScan } from '../scripts/maya-scanner.js';

async function main() {
  const runId = await logJobStart('maya-daily-scan');

  try {
    console.log(`[CRON] Maya daily scan starting at ${new Date().toISOString()}`);
    await runDailyScan();

    if (runId) {
      await logJobComplete(runId, { notes: 'Daily scan completed successfully' });
    }

    console.log('[CRON] Maya daily scan completed');
    process.exit(0);
  } catch (err) {
    console.error('[CRON] Maya daily scan failed:', err);

    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }

    process.exit(1);
  }
}

main();
