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
import { searchOpportunities, getSAMOpportunityURL } from '../integrations/sam-gov.js';
import { getAnthropic } from '../integrations/claude.js';
import { getSupabase } from '../integrations/supabase.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import {
  OPPORTUNITY_FILTERS,
  scoreOpportunity,
  shouldPostOpportunity,
} from '../config/opportunity-filters.js';
import type { SAMOpportunity } from '../types/index.js';

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
  opportunity: SAMOpportunity;
  score: number;
  reasons: string[];
  redFlags: string[];
  posting: ReturnType<typeof shouldPostOpportunity>;
  samUrl: string; // Real SAM.gov URL - REQUIRED
}

async function scanOpportunities(): Promise<ScoredOpportunity[]> {
  console.log('Scanning SAM.gov with FFTC filters...\n');

  const allOpportunities: ScoredOpportunity[] = [];

  // Search each NAICS code
  for (const naics of OPPORTUNITY_FILTERS.naicsCodes) {
    console.log(`  Searching NAICS ${naics}...`);
    try {
      const response = await searchOpportunities({
        naicsCodes: [naics],
        postedFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        limit: 20,
      });
      const results = response.opportunitiesData || [];

      // Log raw API results for debugging
      for (const opp of results) {
        console.log(`    [RAW] Notice ${opp.noticeId}: "${opp.title?.slice(0, 50)}..."`);
      }

      for (const opp of results) {
        // CRITICAL: Only process opportunities with valid notice IDs
        if (!opp.noticeId) {
          console.warn(`    [SKIP] Opportunity missing noticeId: ${opp.title}`);
          continue;
        }

        const { score, reasons, redFlags } = scoreOpportunity(opp);
        const posting = shouldPostOpportunity(score);

        // Generate real SAM.gov URL
        const samUrl = opp.uiLink || getSAMOpportunityURL(opp.noticeId);

        allOpportunities.push({
          opportunity: opp,
          score,
          reasons,
          redFlags,
          posting,
          samUrl,
        });
      }

      console.log(`    Found ${results.length} opportunities`);
    } catch (err) {
      console.log(`    Error searching ${naics}:`, err);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  // Sort by score descending
  allOpportunities.sort((a, b) => b.score - a.score);

  // Deduplicate by noticeId (not title - title can be similar)
  const seen = new Set<string>();
  const unique = allOpportunities.filter(o => {
    const key = o.opportunity.noticeId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\n  Validated: ${unique.length} unique opportunities with real SAM.gov IDs`);

  return unique;
}

// Randomized openers based on score for personality variation
const OPENERS_BY_SCORE = {
  hot: [ // 90+
    "Okay wait, this one is actually good.",
    "👀 Y'all. Look at this.",
    "Not gonna lie, I'm lowkey excited about this one.",
    "Aight so hear me out on this one.",
    "This is giving exactly what we need.",
  ],
  interested: [ // 70-89
    "Found something worth looking at.",
    "This one caught my eye.",
    "Might be something here.",
    "Hmm, this could work.",
    "Interesting one from SAM today.",
  ],
  lukewarm: [ // 60-69
    "Flagging this, but not super hyped.",
    "Worth mentioning but not urgent.",
    "This exists. Take a look if you want.",
    "Eh, it's something.",
    "Not the best fit but posting anyway.",
  ],
};

function getRandomOpener(score: number): string {
  const category = score >= 90 ? 'hot' : score >= 70 ? 'interested' : 'lukewarm';
  const openers = OPENERS_BY_SCORE[category];
  return openers[Math.floor(Math.random() * openers.length)];
}

async function generateMayaPost(
  opp: ScoredOpportunity,
  companyContext: string
): Promise<string> {
  // CRITICAL: Refuse to post if we don't have a real SAM.gov URL
  if (!opp.samUrl || !opp.opportunity.noticeId) {
    console.error(`[HALLUCINATION BLOCKED] Cannot post - missing SAM.gov URL or noticeId`);
    return '';
  }

  const client = getAnthropic();

  // Enthusiasm varies by score
  const enthusiasm = opp.score >= 90 ? 'Genuinely excited - this is a hot one' :
                     opp.score >= 70 ? 'Interested - worth a look' :
                     opp.score >= 60 ? 'Lukewarm - flagging but not hyped' : 'Minimal';

  // Don't post if score is below 60
  if (opp.score < 60) {
    console.log(`[SKIP] Score ${opp.score} too low to post: ${opp.opportunity.title}`);
    return '';
  }

  const randomOpener = getRandomOpener(opp.score);

  const prompt = `You are Maya, the opportunity scout. 27, Spelman grad, Gen-Z energy.

${companyContext}

You found this REAL opportunity from SAM.gov and are posting to #bd-team.

CRITICAL RULES:
1. You MUST include the EXACT SAM.gov link provided below - do NOT make up links
2. Use the EXACT notice ID and title - do NOT invent or modify them
3. Only state facts from the data below - do NOT add details not provided

VERIFIED OPPORTUNITY DATA (from SAM.gov API):
- Notice ID: ${opp.opportunity.noticeId}
- Title: ${opp.opportunity.title}
- Agency: ${opp.opportunity.department || 'Unknown'} / ${opp.opportunity.office || ''}
- NAICS: ${opp.opportunity.naicsCode || 'Not specified'}
- Set-Aside: ${opp.opportunity.setAsideDescription || opp.opportunity.setAside || 'Full and Open'}
- Posted: ${opp.opportunity.postedDate}
- Due: ${opp.opportunity.responseDeadLine || 'Check solicitation'}
- Type: ${opp.opportunity.type || 'Unknown'}
- SAM.gov Link: ${opp.samUrl}

FIT ANALYSIS:
- Score: ${opp.score}/100
- Why it fits: ${opp.reasons.join(', ') || 'General match'}
${opp.redFlags.length > 0 ? `- Concerns: ${opp.redFlags.join(', ')}` : ''}

Your enthusiasm level: ${enthusiasm}
Suggested opener (vary from this): "${randomOpener}"

Write a Slack post about this opportunity.

REQUIREMENTS:
- Start with your own variation of the opener energy (match the enthusiasm level)
- Include the SAM.gov link: ${opp.samUrl}
- Mention why it fits FFTC based on our capabilities
${opp.score >= 80 ? '- Tag <@U0AC0SVD3MH> (David) to research since this is hot' : ''}
- Keep it to 3-4 sentences max
- Your voice: "not gonna lie", "lowkey", "this is giving", "wait", "aight"
- End with the link on its own line`;

  console.log(`[GENERATING] Maya post for ${opp.opportunity.noticeId} (score: ${opp.score})`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  let post = textBlock?.type === 'text' ? textBlock.text : '';

  // VALIDATION: Make sure the post includes the real SAM.gov link
  if (post && !post.includes(opp.samUrl) && !post.includes('sam.gov/opp/')) {
    console.warn(`[VALIDATION] Post missing SAM.gov link, appending...`);
    post = `${post}\n\n${opp.samUrl}`;
  }

  // Log what we're about to post
  console.log(`[POST PREVIEW] Notice ${opp.opportunity.noticeId}:`);
  console.log(post);
  console.log(`[/POST PREVIEW]`);

  return post;
}

// Varied quiet morning messages
const QUIET_MORNING_MESSAGES = [
  "Quiet morning on SAM. Nothing matching our sweet spot today - either wrong NAICS, too short timeline, or not our kind of work. I'll keep watching.",
  "Scanned SAM this morning - nothing jumped out. The opps I saw were either wired for someone else or outside our lane. More tomorrow.",
  "Nothing hot this morning. I looked, trust me. Everything was either full and open (and huge) or had red flags. Tomorrow's another day.",
  "Slow news day on SAM.gov. Found a few things but nothing that made sense for FFTC. I'll keep scanning.",
  "Did my morning scan - nada. Well, there were opps, just not OUR opps. The right one will come through.",
];

async function generateQuietMorning(): Promise<string> {
  return QUIET_MORNING_MESSAGES[Math.floor(Math.random() * QUIET_MORNING_MESSAGES.length)];
}

async function generateWeeklySummary(
  opportunities: ScoredOpportunity[]
): Promise<string> {
  const posted = opportunities.filter(o => o.posting.shouldPost && o.score >= 60);
  const skipped = opportunities.filter(o => !o.posting.shouldPost || o.score < 60);
  const hot = opportunities.filter(o => o.score >= 80);

  let summary = `📊 *Weekly SAM.gov Summary*

Last 7 days:
• ${opportunities.length} opportunities scanned
• ${posted.length} worth watching (60+ score)
• ${hot.length} hot ones (80+ score)
• ${skipped.length} passed on (wrong fit)`;

  if (hot.length > 0) {
    summary += `\n\n🔥 *Hot opportunities this week:*`;
    for (const o of hot.slice(0, 3)) {
      const agency = o.opportunity.department || o.opportunity.office || 'Agency unknown';
      // Include real notice ID and URL
      summary += `\n• ${o.opportunity.title}`;
      summary += `\n  Agency: ${agency} | Score: ${o.score}`;
      summary += `\n  ${o.samUrl}`;
    }
  }

  if (posted.length === 0) {
    summary += "\n\nSlow week for our space. I'll keep scanning.";
  }

  return summary;
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

  // Filter to only opportunities with valid SAM URLs and score >= 60
  const validToPost = toPost.filter(o => o.samUrl && o.opportunity.noticeId && o.score >= 60);

  console.log(`\nValidation: ${validToPost.length} of ${toPost.length} opportunities have valid SAM.gov data`);

  if (validToPost.length === 0) {
    // Quiet morning
    const message = await generateQuietMorning();
    await postToSlack(app, message);
  } else {
    // Post top opportunities (max 3)
    for (const opp of validToPost.slice(0, 3)) {
      const message = await generateMayaPost(opp, companyContext);

      // CRITICAL: Don't post empty messages (validation failed)
      if (!message || message.trim().length === 0) {
        console.warn(`[SKIP POST] Empty message generated for ${opp.opportunity.noticeId}`);
        continue;
      }

      // Final validation - must contain SAM.gov link
      if (!message.includes('sam.gov/opp/') && !message.includes(opp.samUrl)) {
        console.error(`[BLOCK POST] Message doesn't contain SAM.gov link - possible hallucination`);
        continue;
      }

      await postToSlack(app, message);

      // Record that we posted this
      try {
        const supabase = getSupabase();
        await supabase.from('seen_opportunities').insert({
          notice_id: opp.opportunity.noticeId,
          title: opp.opportunity.title,
          sam_url: opp.samUrl,
          score: opp.score,
          posted_at: new Date().toISOString(),
        });
      } catch {
        // Ignore if table doesn't exist
      }

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
