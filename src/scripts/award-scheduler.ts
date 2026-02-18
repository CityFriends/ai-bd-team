// Award Scheduler - Runs award check twice a week (Monday & Thursday at 9am)
// Run with: npm run award-scheduler

import 'dotenv/config';
import cron from 'node-cron';
import { WebClient } from '@slack/web-api';
import {
  checkForNewAwards,
  formatAwardsForSlack,
  getAwardsSummary,
} from '../integrations/award-monitor.js';

async function runAwardCheck() {
  console.log(`[${new Date().toISOString()}] Running scheduled award check...`);

  try {
    const newAwards = await checkForNewAwards();

    if (newAwards.length === 0) {
      console.log('No new awards found.');
      return;
    }

    const summary = getAwardsSummary(newAwards);
    const formatted = formatAwardsForSlack(newAwards, 15);

    console.log(
      `Found ${summary.totalCount} new awards totaling $${(summary.totalValue / 1000000).toFixed(1)}M`
    );

    // Post to Slack via Maya
    const mayaToken = process.env.MAYA_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (mayaToken && channelId) {
      const slack = new WebClient(mayaToken);

      const totalValue = `$${(summary.totalValue / 1000000).toFixed(1)}M`;
      const intro =
        newAwards.length === 1
          ? `yo heads up, just spotted a new award drop`
          : `okay so ${newAwards.length} new awards just dropped, ${totalValue} total`;

      const message = `${intro} 👀\n\n${formatted}\n\n_pulled fresh from FPDS_`;

      await slack.chat.postMessage({
        channel: channelId,
        text: message,
        unfurl_links: false,
      });
      console.log('Posted to Slack!');
    }
  } catch (err) {
    console.error('Award check failed:', err);
  }
}

// Schedule: Monday and Thursday at 9:00 AM Eastern
// Cron format: minute hour day-of-month month day-of-week
// 0 9 * * 1,4 = 9:00 AM on Monday (1) and Thursday (4)
const schedule = '0 9 * * 1,4';

console.log('Award Scheduler started');
console.log(`Schedule: ${schedule} (Monday & Thursday at 9am)`);
console.log('Press Ctrl+C to stop\n');

// Run immediately on start (for testing)
if (process.argv.includes('--now')) {
  console.log('Running immediately (--now flag)...\n');
  runAwardCheck();
}

// Schedule future runs
cron.schedule(schedule, runAwardCheck, {
  timezone: 'America/New_York',
});

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nScheduler stopped');
  process.exit(0);
});
