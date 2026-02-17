/**
 * David News Digest - Railway Cron Entry Point
 * Schedule: 0 16 * * 1,3,5 (10am CST Mon/Wed/Fri)
 */
import 'dotenv/config';
import { logJobStart, logJobComplete, logJobFailed } from '../integrations/supabase.js';
import { runNewsDigest } from '../scripts/david-news-digest.js';

async function main() {
  const runId = await logJobStart('david-news-digest');

  try {
    console.log(`[CRON] David news digest starting at ${new Date().toISOString()}`);
    await runNewsDigest();

    if (runId) {
      await logJobComplete(runId, { notes: 'News digest completed successfully' });
    }

    console.log('[CRON] David news digest completed');
    process.exit(0);
  } catch (err) {
    console.error('[CRON] David news digest failed:', err);

    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }

    process.exit(1);
  }
}

main();
