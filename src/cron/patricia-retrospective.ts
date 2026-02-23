/**
 * Patricia Monthly Retrospective - Railway Cron Entry Point
 * Schedule: 0 15 1 * * (9am CST on 1st of each month)
 *
 * Analyzes past outcomes to discover patterns and proposes new playbook rules.
 */
import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/supabase.js';
import { runMonthlyRetrospective, formatRetrospectiveForSlack } from '../playbook/retrospective.js';
import { postAsAgent } from '../integrations/slack.js';

async function main() {
  // Acquire distributed lock to prevent duplicate runs across replicas
  const { acquired } = await acquireCronLock('patricia-retrospective', 30); // 30 min for monthly job
  if (!acquired) {
    console.log('[CRON] Patricia retrospective: Another instance already running, exiting');
    process.exit(0);
  }

  const runId = await logJobStart('patricia-retrospective');

  try {
    console.log(`[CRON] Patricia monthly retrospective starting at ${new Date().toISOString()}`);

    // Run the retrospective analysis
    const results = await runMonthlyRetrospective();

    if (!results) {
      console.log('[CRON] Retrospective returned no results');
      if (runId) {
        await logJobComplete(runId, { notes: 'Retrospective completed but no results' });
      }
      process.exit(0);
    }

    // Format and post results to Slack
    const message = formatRetrospectiveForSlack(results);
    await postAsAgent('pm', message); // pm = Patricia

    if (runId) {
      await logJobComplete(runId, {
        notes: `Monthly retrospective completed: ${results.outcomesAnalyzed} outcomes, ${results.chainsAnalyzed} chains, ${results.rulesProposed.length} rules proposed`,
      });
    }

    console.log(
      `[CRON] Patricia retrospective completed. Proposed ${results.rulesProposed.length} new rules.`
    );
    process.exit(0);
  } catch (err) {
    console.error('[CRON] Patricia retrospective failed:', err);

    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }

    process.exit(1);
  }
}

main();
