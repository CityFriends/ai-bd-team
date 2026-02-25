// Check for new contract awards and report them
// Run manually or via cron: npx tsx src/scripts/check-awards.ts

import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import {
  checkForNewAwards,
  formatAwardsForSlack,
  getAwardsSummary,
} from '../integrations/award-monitor.js';

async function main() {
  console.log('Checking for new contract awards...\n');

  const newAwards = await checkForNewAwards();

  if (newAwards.length === 0) {
    console.log('No new awards found.');
    return;
  }

  const summary = getAwardsSummary(newAwards);
  const formatted = formatAwardsForSlack(newAwards, 15); // Show up to 15 awards

  console.log(
    `Found ${summary.totalCount} new awards totaling $${(summary.totalValue / 1000000).toFixed(1)}M\n`
  );
  console.log(formatted);

  // Also log all awards to console for visibility
  if (newAwards.length > 15) {
    console.log('\n--- All awards ---');
    newAwards.forEach((a) => {
      const value = `$${(a.obligatedAmount / 1000000).toFixed(2)}M`;
      console.log(`${a.vendorName}: ${value} (${a.agencyAbbrev})`);
    });
  }

  // Post to Slack if Maya's token is available
  const mayaToken = process.env.MAYA_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (mayaToken && channelId) {
    const slack = new WebClient(mayaToken);

    // Maya's voice for award announcements
    const totalValue = `$${(summary.totalValue / 1000000).toFixed(1)}M`;
    const intro =
      newAwards.length === 1
        ? `yo heads up, just spotted a new award drop`
        : `okay so ${newAwards.length} new awards just dropped, ${totalValue} total`;

    const message = `${intro} 👀\n\n${formatted}\n\n_pulled from USASpending_`;

    try {
      await slack.chat.postMessage({
        channel: channelId,
        text: message,
        unfurl_links: false,
      });
      console.log('\nPosted to Slack!');
    } catch (err) {
      console.error('Failed to post to Slack:', err);
    }
  } else {
    console.log('\nSlack posting skipped (no MAYA_BOT_TOKEN or SLACK_CHANNEL_ID)');
  }
}

main().catch(console.error);
