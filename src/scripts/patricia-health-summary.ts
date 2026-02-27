/**
 * Patricia's System Health Summary
 *
 * Daily/weekly summary of system health posted to Slack.
 * Includes: workflow status, memory stats, escalations, issues.
 *
 * Usage:
 *   npm run patricia:health          # Run once now
 *   npm run patricia:health:schedule # Run on daily schedule
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import {
  getDashboardData,
  formatDashboardForSlack,
  type DashboardData,
} from '../dashboard/index.js';
import { getAnthropic } from '../integrations/claude.js';
import { acquireCronLock } from '../integrations/database/cron.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Initialize Patricia's Slack app
async function getPatriciaApp(): Promise<App | null> {
  const botToken = process.env.PATRICIA_BOT_TOKEN;
  const appToken = process.env.PATRICIA_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('Patricia Slack tokens not configured, running in test mode');
    return null;
  }

  const app = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  });

  await app.start();
  return app;
}

// Generate health summary using Claude for natural language
async function generateHealthSummary(data: DashboardData): Promise<string> {
  const client = getAnthropic();

  const rawData = formatDashboardForSlack(data);

  const prompt = `You are Patricia, the project coordinator for Friends From The City's BD team. You're posting a daily system health summary to #bd-team.

YOUR VOICE:
- 38 years old, Latina, Austin native
- 15 years in government contracting
- Organized but warm, keeps the trains running
- Not robotic - you care about the team
- Use casual professional tone

CURRENT SYSTEM STATUS:
${rawData}

HEALTH: ${data.health.status}
${data.health.issues.length > 0 ? `ISSUES: ${data.health.issues.join(', ')}` : 'No issues detected'}

Write a brief system health update for Slack.

SLACK FORMATTING:
- Bold: *text* (single asterisks only)
- Bullets: • for lists

STRUCTURE:
*Daily System Check* (or appropriate emoji based on health)

[One line summary in Patricia's voice - reassuring if healthy, concerned if issues]

*Quick Stats*
• Workflows: [active] active, [breached] past SLA
• Memories: [count] stored, [recent] new in 24h
• Cache: [hitRate] hit rate

${data.health.issues.length > 0 ? `*Heads Up*\n• [List each issue and what it means]` : ''}

${data.escalations.total24h > 0 ? `*Recent Escalations*\n• [Brief summary]` : ''}

[Optional: One line about what needs attention or that everything's running smoothly]

Keep it under 150 words. Be helpful, not alarming.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : formatDashboardForSlack(data);
}

async function postToSlack(app: App | null, message: string): Promise<void> {
  if (app) {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
    });
    console.log('Posted to Slack');
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
  }
}

// Main health summary function
export async function runHealthSummary(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  Patricia's Health Summary - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getPatriciaApp();

  // Gather dashboard data
  console.log('Gathering system health data...');
  const data = await getDashboardData();
  console.log(`  Health: ${data.health.status}`);
  console.log(`  Workflows: ${data.workflows.active} active, ${data.workflows.breached} breached`);
  console.log(`  Memories: ${data.memory.totalMemories} total`);

  // Generate natural language summary
  console.log('Generating summary...');
  const summary = await generateHealthSummary(data);

  // Post to Slack
  await postToSlack(app, summary);

  if (app) {
    await app.stop();
  }

  console.log('\nHealth summary complete');
}

// Cron entry point with distributed lock
export async function cronHealthSummary(): Promise<void> {
  const { acquired } = await acquireCronLock('patricia-health-summary', 10);
  if (!acquired) {
    console.log('[CRON] Patricia health summary: Another instance already running, skipping');
    return;
  }

  await runHealthSummary();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Patricia Health Summary - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule:');
    console.log('  - Weekdays at 9:00 AM CST (15:00 UTC): Daily health check');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runHealthSummary();

    // Weekdays at 9:00am CST (15:00 UTC)
    cron.schedule('0 15 * * 1-5', async () => {
      console.log('\n[CRON] Running health summary...');
      await cronHealthSummary();
    });

    console.log('Scheduler running...');
  } else {
    // One-time run
    await runHealthSummary();
    process.exit(0);
  }
}

main().catch(console.error);
