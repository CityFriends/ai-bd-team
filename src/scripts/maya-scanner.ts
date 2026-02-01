/**
 * Maya's Automated Opportunity Scanner
 *
 * Daily (6am): Scans SAM.gov with refined filters
 * Weekly (Monday 8am): Summary of the week
 * Immediate: Posts 80+ score opportunities right away
 *
 * Usage:
 *   npm run maya:scan         # Run once now
 *   npm run maya:schedule     # Run on schedule
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { searchOpportunities } from '../integrations/sam-gov.js';
import { getAnthropic } from '../integrations/claude.js';
import { getSupabase } from '../integrations/supabase.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import {
  OPPORTUNITY_FILTERS,
  scoreOpportunity,
  shouldPostOpportunity,
} from '../config/opportunity-filters.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Initialize Maya's Slack app
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

interface ScoredOpportunity {
  opportunity: any;
  score: number;
  reasons: string[];
  redFlags: string[];
  posting: ReturnType<typeof shouldPostOpportunity>;
}

async function scanOpportunities(): Promise<ScoredOpportunity[]> {
  console.log('Scanning SAM.gov with FFTC filters...\n');

  const allOpportunities: ScoredOpportunity[] = [];

  // Search each NAICS code
  for (const naics of OPPORTUNITY_FILTERS.naicsCodes) {
    console.log(`  Searching NAICS ${naics}...`);
    try {
      const results = await searchOpportunities({
        naicsCode: naics,
        postedFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        limit: 20,
      });

      for (const opp of results) {
        const { score, reasons, redFlags } = scoreOpportunity(opp);
        const posting = shouldPostOpportunity(score);

        allOpportunities.push({
          opportunity: opp,
          score,
          reasons,
          redFlags,
          posting,
        });
      }

      console.log(`    Found ${results.length} opportunities`);
    } catch (err) {
      console.log(`    Error searching ${naics}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  // Sort by score descending
  allOpportunities.sort((a, b) => b.score - a.score);

  // Deduplicate by title
  const seen = new Set<string>();
  const unique = allOpportunities.filter(o => {
    const key = o.opportunity.title?.toLowerCase() || '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique;
}

async function generateMayaPost(
  opp: ScoredOpportunity,
  companyContext: string
): Promise<string> {
  const client = getAnthropic();

  const enthusiasm = opp.posting.enthusiasm === 'high' ? 'Very excited' :
                     opp.posting.enthusiasm === 'medium' ? 'Interested' : 'Worth noting';

  const prompt = `You are Maya, the opportunity scout. 27, Spelman grad, Gen-Z energy.

${companyContext}

You found this opportunity and are posting to #bd-team:

OPPORTUNITY:
Title: ${opp.opportunity.title}
Agency: ${opp.opportunity.agency}
NAICS: ${opp.opportunity.naicsCode}
Set-Aside: ${opp.opportunity.setAside || 'Full and Open'}
Posted: ${opp.opportunity.postedDate}
Due: ${opp.opportunity.responseDeadline}
Description: ${opp.opportunity.description?.slice(0, 500) || 'See solicitation'}

FIT SCORE: ${opp.score}/100
WHY IT FITS: ${opp.reasons.join(', ')}
${opp.redFlags.length > 0 ? `CONCERNS: ${opp.redFlags.join(', ')}` : ''}

Your enthusiasm level: ${enthusiasm}

Write a Slack post about this opportunity. Be natural - use your voice ("not gonna lie", "lowkey", etc.).
${opp.posting.urgency === 'immediate' ? 'Tag @David to take a look since this is hot.' : ''}
Reference why it fits FFTC based on our capabilities.
Keep it to 3-4 sentences max.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

async function generateQuietMorning(): Promise<string> {
  return "Quiet morning on SAM. Nothing matching our sweet spot today - either wrong NAICS, too short timeline, or not our kind of work. I'll keep watching.";
}

async function generateWeeklySummary(
  opportunities: ScoredOpportunity[]
): Promise<string> {
  const posted = opportunities.filter(o => o.posting.shouldPost);
  const skipped = opportunities.filter(o => !o.posting.shouldPost);
  const hot = opportunities.filter(o => o.score >= 80);

  return `📊 *Weekly SAM.gov Summary*

Last 7 days:
• ${opportunities.length} opportunities scanned
• ${posted.length} worth watching (60+ score)
• ${hot.length} hot ones (80+ score)
• ${skipped.length} passed on (wrong fit)

${hot.length > 0 ? `\n🔥 *Hot opportunities this week:*\n${hot.slice(0, 3).map(o => `• ${o.opportunity.title} (${o.opportunity.agency}) - Score: ${o.score}`).join('\n')}` : ''}

${posted.length === 0 ? "\nSlow week for our space. I'll keep scanning." : ''}`;
}

async function postToSlack(app: App | null, message: string, threadTs?: string) {
  if (app) {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
      thread_ts: threadTs,
    });
    console.log('Posted to Slack');
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
  }
}

async function runDailyScan() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Maya's Daily Scan - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getMayaApp();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'Maya');

  const opportunities = await scanOpportunities();

  console.log(`\nScanned ${opportunities.length} unique opportunities`);

  // Find opportunities to post
  const toPost = opportunities.filter(o => o.posting.shouldPost);
  const immediate = opportunities.filter(o => o.posting.urgency === 'immediate');

  console.log(`  ${toPost.length} worth posting`);
  console.log(`  ${immediate.length} hot (immediate post)`);

  if (toPost.length === 0) {
    // Quiet morning
    const message = await generateQuietMorning();
    await postToSlack(app, message);
  } else {
    // Post top opportunities
    for (const opp of toPost.slice(0, 3)) {
      const message = await generateMayaPost(opp, companyContext);
      await postToSlack(app, message);

      // Record that we posted this
      const supabase = getSupabase();
      await supabase.from('seen_opportunities').insert({
        notice_id: opp.opportunity.noticeId,
        title: opp.opportunity.title,
        score: opp.score,
        posted_at: new Date().toISOString(),
      }).catch(() => {}); // Ignore if table doesn't exist

      await new Promise(r => setTimeout(r, 2000)); // Delay between posts
    }
  }

  if (app) {
    await app.stop();
  }

  console.log('\nDaily scan complete');
}

async function runWeeklySummary() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Maya's Weekly Summary - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getMayaApp();
  const opportunities = await scanOpportunities();

  const summary = await generateWeeklySummary(opportunities);
  await postToSlack(app, summary);

  if (app) {
    await app.stop();
  }

  console.log('\nWeekly summary complete');
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const weeklyMode = args.includes('--weekly') || args.includes('-w');

  if (weeklyMode) {
    await runWeeklySummary();
    return;
  }

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Maya Opportunity Scanner - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule:');
    console.log('  - Weekdays at 8:00 AM: Scan for new opportunities');
    console.log('  - Monday at 8:30 AM: Weekly summary');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runDailyScan();

    // Weekdays at 8am (Mon-Fri)
    cron.schedule('0 8 * * 1-5', async () => {
      await runDailyScan();
    });

    // Weekly on Monday at 8:30am (after daily scan)
    cron.schedule('30 8 * * 1', async () => {
      await runWeeklySummary();
    });

    console.log('Scheduler running...');

  } else {
    // One-time scan
    await runDailyScan();
  }
}

main().catch(console.error);
