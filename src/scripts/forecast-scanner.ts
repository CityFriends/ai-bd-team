/**
 * Agency Forecast Scanner
 *
 * Scans federal agency procurement forecast pages weekly.
 * Runs Sunday night so Maya has fresh data for Monday morning.
 *
 * Usage:
 *   npm run forecast:scan        # Run once now
 *   npm run forecast:schedule    # Run on weekly schedule
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import {
  runForecastScan,
  getUpcomingForecasts,
  AGENCY_FORECAST_SOURCES,
} from '../integrations/agency-forecasts.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Initialize Maya's Slack app for posting
async function getMayaApp(): Promise<App | null> {
  const botToken = process.env.MAYA_BOT_TOKEN;
  const appToken = process.env.MAYA_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('Maya Slack tokens not configured, running in test mode');
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

async function postToSlack(app: App | null, message: string) {
  if (app) {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
      unfurl_links: false,
    });
    console.log('Posted to Slack');
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
  }
}

// Generate Maya's forecast briefing
async function generateForecastBriefing(): Promise<string> {
  const forecasts = await getUpcomingForecasts(60);

  if (forecasts.length === 0) {
    return `📅 *Forecast Update*

Scanned ${AGENCY_FORECAST_SOURCES.length} agency forecast pages this week. Nothing jumped out as a strong fit right now - either outside our NAICS codes or missing the HCD/UX angle we look for.

I'll keep scanning. Sometimes agencies are slow to update their forecasts.`;
  }

  // Group by relevance
  const high = forecasts.filter((f) => (f.relevance_score || 0) >= 80);
  const medium = forecasts.filter(
    (f) => (f.relevance_score || 0) >= 60 && (f.relevance_score || 0) < 80
  );

  let message = `📅 *Forecast Update - Here's what's coming down the pike:*\n`;

  if (high.length > 0) {
    message += `\n*High relevance:*\n`;
    for (const f of high.slice(0, 3)) {
      const date = f.estimated_release || 'TBD';
      const value = f.estimated_value || 'TBD';
      message += `• *${f.title.slice(0, 60)}${f.title.length > 60 ? '...' : ''}* (${f.agency})\n`;
      message += `  Est. ${date}, ${value}\n`;
    }
  }

  if (medium.length > 0) {
    message += `\n*Worth watching:*\n`;
    for (const f of medium.slice(0, 3)) {
      const date = f.estimated_release || 'TBD';
      const value = f.estimated_value || 'TBD';
      message += `• ${f.title.slice(0, 60)}${f.title.length > 60 ? '...' : ''} (${f.agency})\n`;
      message += `  Est. ${date}, ${value}\n`;
    }
  }

  message += `\nI'll keep an eye on these and flag when they hit SAM.gov.`;

  return message;
}

async function runScanAndBrief() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Agency Forecast Scan - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  // Run the scan
  const results = await runForecastScan();

  console.log('\nScan Results:');
  console.log(`  Total found: ${results.total}`);
  console.log(`  Saved: ${results.saved}`);
  console.log('  By agency:');
  for (const [agency, count] of Object.entries(results.byAgency)) {
    if (count > 0) {
      console.log(`    ${agency}: ${count}`);
    }
  }
}

async function runMondayBrief() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Maya's Monday Forecast Brief - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getMayaApp();
  const message = await generateForecastBriefing();

  await postToSlack(app, message);

  if (app) {
    await app.stop();
  }

  console.log('\nForecast brief posted');
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const briefMode = args.includes('--brief') || args.includes('-b');

  if (briefMode) {
    await runMondayBrief();
    return;
  }

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Agency Forecast Scanner - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule:');
    console.log('  - Sunday at 10:00 PM: Full forecast scan');
    console.log('  - Monday at 8:15 AM: Forecast brief to Slack');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runScanAndBrief();

    // Sunday at 10pm
    cron.schedule('0 22 * * 0', async () => {
      await runScanAndBrief();
    });

    // Monday at 8:15am (after Maya's daily scan at 8am)
    cron.schedule('15 8 * * 1', async () => {
      await runMondayBrief();
    });

    console.log('Scheduler running...');
  } else {
    // One-time scan
    await runScanAndBrief();
  }
}

main().catch(console.error);
