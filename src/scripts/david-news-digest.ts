/**
 * David's Daily News Digest
 *
 * Scans government news sources and delivers a morning briefing.
 * Also includes CMS forecast updates when available.
 *
 * Schedule: Monday, Wednesday, Friday at 10:00 AM CST (16:00 UTC)
 *
 * Usage:
 *   npm run david:news           # Run once now
 *   npm run david:news:schedule  # Run on schedule
 */

import 'dotenv/config';
import { App } from '@slack/bolt';
import { getNewRelevantNews, formatNewsDigest } from '../integrations/gov-news.js';
import { scanCMSForecast, scoreCMSOpportunity } from '../integrations/cms-forecast.js';
import { getAnthropic } from '../integrations/claude.js';
import { postTeamReactions, getDavidFollowUp } from '../integrations/team-reactions.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

/**
 * Initialize David's Slack app
 */
async function getDavidApp(): Promise<App | null> {
  const botToken = process.env.DAVID_BOT_TOKEN;
  const appToken = process.env.DAVID_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('[David] Slack tokens not configured, running in test mode');
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

/**
 * Post message to Slack and return thread timestamp
 */
async function postToSlack(app: App | null, message: string): Promise<string | null> {
  if (app) {
    const result = await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
      unfurl_links: false,
    });
    console.log('[David] Posted to Slack');
    return result.ts || null;
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
    return null;
  }
}

/**
 * Initialize apps for team reactions (Maya, Marcus, Patricia)
 */
async function getTeamApps(): Promise<Map<string, App>> {
  const apps = new Map<string, App>();

  const agentConfigs = [
    { name: 'maya', botToken: process.env.MAYA_BOT_TOKEN, appToken: process.env.MAYA_APP_TOKEN },
    {
      name: 'marcus',
      botToken: process.env.MARCUS_BOT_TOKEN,
      appToken: process.env.MARCUS_APP_TOKEN,
    },
    {
      name: 'patricia',
      botToken: process.env.PATRICIA_BOT_TOKEN,
      appToken: process.env.PATRICIA_APP_TOKEN,
    },
  ];

  for (const config of agentConfigs) {
    if (config.botToken && config.appToken) {
      try {
        const app = new App({
          token: config.botToken,
          appToken: config.appToken,
          socketMode: true,
        });
        await app.start();
        apps.set(config.name, app);
        console.log(`[TeamReactions] ${config.name} app initialized`);
      } catch (err) {
        console.warn(`[TeamReactions] Failed to initialize ${config.name}:`, err);
      }
    }
  }

  return apps;
}

/**
 * Generate David's commentary on the news
 */
async function generateDavidCommentary(newsDigest: string, cmsUpdate: string): Promise<string> {
  const client = getAnthropic();

  const prompt = `You are David, the senior research analyst for Friends From The City's BD team.

Your background: 42 years old, Korean American, grew up in Jersey, Rutgers grad, lives in Fairfax now. You have 15+ years in federal contracting research. You're direct, have a dry sense of humor, and give it to people straight. Think "dad energy" - pragmatic, experienced, occasionally makes terrible puns.

Your voice:
- Direct and no-nonsense: "Here's the thing..."
- Dry humor: "Because apparently the government decided to actually modernize something"
- Jersey directness: "Look, I'm not gonna sugarcoat this..."
- Occasional dad jokes/puns (sparingly)
- References your experience: "Seen this before back in..."

You're delivering the morning news digest to your team (Lapedra the CEO, and the rest of the BD team).

Today's news:
${newsDigest}

${cmsUpdate ? `CMS Forecast Update:\n${cmsUpdate}` : ''}

Write a brief morning briefing (2-3 paragraphs max). Include:
1. A greeting appropriate for the day
2. Quick summary of what's worth paying attention to
3. Any strategic implications for FFTC (a small HCD/design-focused 8(a) firm)
4. Optional: one dry observation or dad joke if something warrants it

Keep it conversational and useful. Don't list every news item - highlight what matters.

SLACK FORMATTING:
- Bold: *text*
- Italic: _text_
- Links are already formatted, don't change them`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

/**
 * Run the daily news digest
 */
export async function runNewsDigest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  David's News Digest - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getDavidApp();

  // Get relevant news
  console.log('[David] Scanning news sources...');
  const news = await getNewRelevantNews(50, 12);

  // Format basic digest
  const newsDigest = formatNewsDigest(news);

  // Check CMS forecast (weekly or when updated)
  let cmsUpdate = '';
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 1) {
    // Monday - check CMS forecast
    console.log('[David] Checking CMS forecast (Monday scan)...');
    try {
      const cmsOpps = await scanCMSForecast();
      if (cmsOpps.length > 0) {
        const relevant = cmsOpps
          .map((opp) => ({ opp, ...scoreCMSOpportunity(opp) }))
          .filter(({ score }) => score >= 60)
          .slice(0, 5);

        if (relevant.length > 0) {
          cmsUpdate = `Found ${relevant.length} relevant CMS forecast opportunities:\n`;
          for (const { opp } of relevant) {
            cmsUpdate += `• ${opp.title}${opp.estimatedRelease ? ` (Est: ${opp.estimatedRelease})` : ''}\n`;
          }
        }
      }
    } catch (err) {
      console.warn('[David] CMS forecast scan failed:', err);
    }
  }

  // Generate David's commentary
  console.log('[David] Generating commentary...');
  const commentary = await generateDavidCommentary(newsDigest, cmsUpdate);

  // Build final message
  let finalMessage = commentary;

  // Add the news links section
  if (news.length > 0) {
    finalMessage += '\n\n' + newsDigest;
  }

  // Post to Slack
  const threadTs = await postToSlack(app, finalMessage);

  // Trigger team reactions (other agents respond naturally)
  if (threadTs && app) {
    console.log('[David] Checking for team reactions...');
    try {
      const teamApps = await getTeamApps();
      if (teamApps.size > 0) {
        const postedReactions = await postTeamReactions(
          teamApps,
          CHANNEL_ID,
          threadTs,
          finalMessage
        );

        // David responds to wrap up the conversation
        if (postedReactions.length > 0) {
          console.log('[David] Generating follow-up response...');
          await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));

          const followUp = await getDavidFollowUp(finalMessage, postedReactions);
          if (followUp) {
            await app.client.chat.postMessage({
              channel: CHANNEL_ID,
              thread_ts: threadTs,
              text: followUp,
            });
            console.log('[David] Posted follow-up to thread');
          }
        }

        // Clean up team apps
        for (const [_name, teamApp] of teamApps) {
          await teamApp.stop();
        }
      }
    } catch (err) {
      console.warn('[David] Team reactions failed:', err);
    }
  }

  if (app) {
    await app.stop();
  }

  console.log('\n[David] News digest complete');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');

  if (scheduleMode) {
    // NOTE: --schedule mode is DEPRECATED
    // Scheduling is now handled by Railway external cron to prevent duplicate posts
    // See: src/cron/david-news.ts
    console.log('='.repeat(60));
    console.log('  WARNING: --schedule mode is deprecated');
    console.log('  David scheduling is now handled by Railway cron');
    console.log('  Running a single digest instead...');
    console.log('='.repeat(60));
    await runNewsDigest();
  } else {
    // One-time run
    await runNewsDigest();
  }
}

main().catch(console.error);
