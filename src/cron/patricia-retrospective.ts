/**
 * Patricia Monthly Retrospective - Railway Cron Entry Point
 * Schedule: 0 15 1 * * (9am CST on 1st of each month)
 *
 * Analyzes past outcomes to discover patterns and proposes new playbook rules.
 */
import 'dotenv/config';
import { logJobStart, logJobComplete, logJobFailed } from '../integrations/supabase.js';
import { runMonthlyRetrospective, formatRetrospectiveForSlack } from '../playbook/retrospective.js';
import { postMessage } from '../integrations/slack/client.js';

const BD_CHANNEL = process.env.SLACK_BD_CHANNEL || 'bd-team';

async function main() {
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
    await postMessage(BD_CHANNEL, message);

    if (runId) {
      await logJobComplete(runId, {
        notes: 'Monthly retrospective completed',
        outcomesAnalyzed: results.outcomesAnalyzed,
        chainsAnalyzed: results.chainsAnalyzed,
        rulesProposed: results.rulesProposed.length,
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
