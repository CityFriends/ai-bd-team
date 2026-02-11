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
import * as fs from 'fs';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { searchOpportunities, getSAMOpportunityURL, extractAgencyAbbreviation } from '../integrations/sam-gov.js';
import { getAnthropic } from '../integrations/claude.js';
import { getSupabase } from '../integrations/supabase.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import { matchForecastToSAM, linkForecastToSAM } from '../integrations/agency-forecasts.js';
import { getRelevantForecasts, formatFCOForAgent, type FCOForecast } from '../integrations/acquisition-gateway.js';
import { bold, bullets, link as slackLink, buildPost, type SlackPost } from '../utils/slack-format.js';
import { buildOpportunityBlocks, type OpportunityBlocks } from '../utils/slack-blocks.js';
import { addOpportunityToNotion, logActivityToNotion, NotionHubIds } from '../integrations/notion-hub.js';
import {
  OPPORTUNITY_FILTERS,
  scoreOpportunity,
  shouldPostOpportunity,
} from '../config/opportunity-filters.js';
import { createOpportunityWorkflow } from '../integrations/supabase.js';
import { queueNotification, flushNotifications, getPendingCount } from '../coordination/notification-batcher.js';
import type { SAMOpportunity } from '../types/index.js';

// Load Notion hub IDs if available
function loadHubIds(): NotionHubIds | null {
  try {
    const data = fs.readFileSync('notion-hub-ids.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Map agency to Notion select value
function mapAgencyForNotion(dept?: string, office?: string): string {
  const abbrev = extractAgencyAbbreviation(dept, office);
  return abbrev || 'Other';
}

// Map set-aside to Notion select value
function mapSetAsideForNotion(setAside?: string): string {
  if (!setAside) return 'Unrestricted';
  const lower = setAside.toLowerCase();
  if (lower.includes('8(a)')) return '8(a)';
  if (lower.includes('wosb') || lower.includes('women')) return 'WOSB';
  if (lower.includes('sdvosb') || lower.includes('service-disabled')) return 'SDVOSB';
  if (lower.includes('hubzone')) return 'HUBZone';
  if (lower.includes('small')) return 'Small Business';
  return 'Unrestricted';
}

// Map opportunity type to Notion select value
function mapTypeForNotion(type?: string): string {
  if (!type) return 'Other';
  const lower = type.toLowerCase();
  if (lower.includes('rfi')) return 'RFI';
  if (lower.includes('source')) return 'Sources Sought';
  if (lower.includes('rfp') || lower.includes('solicitation')) return 'RFP';
  if (lower.includes('task')) return 'Task Order';
  return 'Other';
}

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
        // Only search for actionable opportunities - exclude awards
        types: ['p', 'r', 's', 'o', 'k'], // presolicitation, RFI, sources sought, solicitation, combined
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

        const { score, reasons, redFlags, hardExcluded } = scoreOpportunity(opp);

        // Skip hard-excluded opportunities entirely (COTS, SI, infrastructure)
        if (hardExcluded) {
          console.log(`    [HARD EXCLUDE] ${opp.title?.slice(0, 50)}... - ${redFlags[0]}`);
          continue;
        }

        // Log why low-scoring opportunities are being skipped
        if (score < 60) {
          console.log(`    [LOW SCORE: ${score}] ${opp.title?.slice(0, 50)}... - ${redFlags.join(', ') || 'No core keywords matched'}`);
        }

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

// Professional openers based on score
const OPENERS_BY_SCORE = {
  hot: [ // 90+
    "This one's strong - exactly our wheelhouse.",
    "Found a solid match. HCD focus, good timeline.",
    "Worth prioritizing - this checks all the boxes.",
    "This looks promising. Here's what caught my attention.",
    "Good find today. This aligns well with our capabilities.",
  ],
  interested: [ // 70-89
    "Found something worth looking at.",
    "This could be a fit. Flagging for review.",
    "Interesting opportunity - here are the details.",
    "Spotted this and wanted to share.",
    "Worth a look - matches some of our criteria.",
  ],
  lukewarm: [ // 60-69
    "Flagging this, though it's not a perfect fit.",
    "Marginal match, but wanted to surface it.",
    "This is adjacent to our work - might be worth a look.",
    "Not ideal, but including for awareness.",
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

  const prompt = `You are Maya, the opportunity scout for Friends From The City.

${companyContext}

FFTC'S CORE CAPABILITIES (use this to assess fit):
• Human-centered design (HCD) and service design
• User experience (UX) research and usability testing
• Digital services and custom application development
• Content strategy and plain language
• Accessibility (Section 508) compliance

NOT OUR WORK (don't claim fit for these):
• COTS implementation (Oracle, SAP, Salesforce, etc.)
• System integration and middleware
• IT infrastructure and operations
• Help desk / call center support
• Hardware procurement
• Generic management consulting without HCD/UX component

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

SLACK FORMATTING (use these EXACTLY):
- Bold: *text* (use for headers and key terms)
- Italic: _text_ (use for emphasis)
- Bullets: Start lines with • for lists
- Link on its own line at the end

STRUCTURE YOUR POST LIKE THIS:
1. Opening line (your voice, match enthusiasm)
2. *Opportunity title* (bold)
3. Key details in a clean format:
   • Agency: [name]
   • NAICS: [code]
   • Set-Aside: [type]
   • Due: [date]
4. Why it fits us (1-2 sentences)
${opp.score >= 80 ? '5. Tag <@U0AC0SVD3MH> (David) to research since this is hot' : ''}
6. Link on its own line

REQUIREMENTS:
- Use the formatting above for clean, readable posts
- Professional but personable - you're a BD professional, not a social media influencer
- Be direct: "This is a good fit because..." not "Okay so this is giving..."
- Brief analysis of why it fits FFTC (1-2 sentences max)
- End with the SAM.gov link on its own line`;

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

// Quiet morning messages - professional
const QUIET_MORNING_MESSAGES = [
  "Morning scan complete - nothing matching our criteria today. I'll keep watching.",
  "Scanned SAM this morning. A few opportunities but nothing in our software dev or design space.",
  "Nothing to flag today. The opportunities I saw were either outside our NAICS, hit exclusion keywords (COTS, system integration, infrastructure), or lacked software/design focus.",
  "Quiet day on SAM.gov for our space. Will continue monitoring.",
];

// Track last quiet message to prevent duplicates
let lastQuietMessageDate: string | null = null;

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

async function postToSlack(app: App | null, message: string, threadTs?: string): Promise<string | undefined> {
  if (app) {
    const result = await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
      thread_ts: threadTs,
    });
    console.log('Posted to Slack');
    return result.ts; // Return the message timestamp for threading
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
    return undefined;
  }
}

/**
 * Post opportunity with interactive Block Kit buttons
 * Allows one-click actions: Pursue, Pass, Research, Add to Pipeline
 */
async function postOpportunityWithBlocks(
  app: App | null,
  opp: ScoredOpportunity,
  opener?: string
): Promise<string | undefined> {
  const blockData: OpportunityBlocks = {
    noticeId: opp.opportunity.noticeId,
    title: opp.opportunity.title,
    agency: opp.opportunity.department || opp.opportunity.office,
    naics: opp.opportunity.naicsCode,
    setAside: opp.opportunity.setAsideDescription || opp.opportunity.setAside || 'Full and Open',
    dueDate: opp.opportunity.responseDeadLine,
    score: opp.score,
    reasons: opp.reasons,
    redFlags: opp.redFlags.length > 0 ? opp.redFlags : undefined,
    samUrl: opp.samUrl,
    opener: opener,
  };

  const blocks = buildOpportunityBlocks(blockData);
  const fallbackText = `${opener || 'New opportunity found'}: ${opp.opportunity.title} (Score: ${opp.score}/100) - ${opp.samUrl}`;

  if (app) {
    const result = await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: fallbackText, // Fallback for notifications
      blocks: blocks,
    });
    console.log('Posted opportunity with interactive buttons');
    return result.ts;
  } else {
    console.log('\n--- Would post to Slack (with blocks) ---');
    console.log(`Opener: ${opener}`);
    console.log(`Title: ${opp.opportunity.title}`);
    console.log(`Score: ${opp.score}/100`);
    console.log(`Reasons: ${opp.reasons.join(', ')}`);
    console.log(`Red flags: ${opp.redFlags.join(', ') || 'None'}`);
    console.log(`URL: ${opp.samUrl}`);
    console.log('Buttons: [🚀 Pursue] [⏭️ Pass] [🔍 Research] [📋 Add to Pipeline]');
    console.log('-------------------------------------------\n');
    return undefined;
  }
}

/**
 * Get notice IDs we've already seen or decided to pass on
 */
async function getSeenAndPassedNoticeIds(): Promise<Set<string>> {
  const seen = new Set<string>();
  try {
    const supabase = getSupabase();

    // Get all seen opportunities (already posted)
    const { data: seenData } = await supabase
      .from('seen_opportunities')
      .select('notice_id, decision');

    if (seenData) {
      for (const row of seenData) {
        // Skip if already posted OR if decision is pass/no_go
        seen.add(row.notice_id);
      }
    }

    // Also check opportunity_workflow for passed opportunities
    const { data: workflowData } = await supabase
      .from('opportunity_workflow')
      .select('notice_id, decision')
      .in('decision', ['pass', 'no_go', 'passed']);

    if (workflowData) {
      for (const row of workflowData) {
        seen.add(row.notice_id);
      }
    }

    console.log(`[DEDUP] Found ${seen.size} already-seen or passed opportunities`);
  } catch (err) {
    console.warn('[DEDUP] Could not check seen opportunities:', err);
  }
  return seen;
}

export async function runDailyScan() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Maya's Daily Scan - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getMayaApp();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'Maya');

  // Get opportunities we've already posted or passed on
  const seenNoticeIds = await getSeenAndPassedNoticeIds();

  const opportunities = await scanOpportunities();

  console.log(`\nScanned ${opportunities.length} unique opportunities`);

  // Find opportunities to post
  const toPost = opportunities.filter(o => o.posting.shouldPost);
  const immediate = opportunities.filter(o => o.posting.urgency === 'immediate');

  console.log(`  ${toPost.length} worth posting`);
  console.log(`  ${immediate.length} hot (immediate post)`);

  // Filter to only opportunities with valid SAM URLs and score >= 60
  let validToPost = toPost.filter(o => o.samUrl && o.opportunity.noticeId && o.score >= 60);

  // CRITICAL: Filter out already-seen or passed opportunities
  const beforeDedup = validToPost.length;
  validToPost = validToPost.filter(o => {
    if (seenNoticeIds.has(o.opportunity.noticeId)) {
      console.log(`[SKIP DUPLICATE] Already posted or passed: ${o.opportunity.title?.slice(0, 50)}...`);
      return false;
    }
    return true;
  });

  if (beforeDedup !== validToPost.length) {
    console.log(`[DEDUP] Filtered out ${beforeDedup - validToPost.length} already-seen opportunities`);
  }

  console.log(`\nValidation: ${validToPost.length} of ${toPost.length} opportunities have valid SAM.gov data`);

  if (validToPost.length === 0) {
    // Quiet morning - but only post once per day to avoid duplicates
    const today = new Date().toISOString().split('T')[0];
    if (lastQuietMessageDate !== today) {
      const message = await generateQuietMorning();
      await postToSlack(app, message);
      lastQuietMessageDate = today;
    } else {
      console.log('[SKIP] Already posted quiet message today, skipping duplicate');
    }
  } else {
    // Post top opportunities (max 3) with interactive buttons
    for (const opp of validToPost.slice(0, 3)) {
      // Generate opener for the block post
      const opener = getRandomOpener(opp.score);
      let forecastNote = '';

      // Check if this matches a forecast we previously flagged
      const agencyAbbrev = extractAgencyAbbreviation(opp.opportunity.department, opp.opportunity.office);
      if (agencyAbbrev) {
        try {
          const match = await matchForecastToSAM(opp.opportunity.title, agencyAbbrev);
          if (match.matched && match.forecastId) {
            forecastNote = `\n\n📅 *Heads up* - this matches a forecast I flagged earlier: "${match.forecastTitle}". It's live now!`;
            await linkForecastToSAM(match.forecastId, opp.samUrl);
            console.log(`[FORECAST] Matched to forecast: ${match.forecastTitle}`);
          }
        } catch (err) {
          console.warn('[FORECAST] Match check failed:', err);
        }
      }

      // Post with interactive Block Kit buttons
      const fullOpener = forecastNote ? `${opener}${forecastNote}` : opener;
      const messageTs = await postOpportunityWithBlocks(app, opp, fullOpener);

      // Queue notification for batching/tracking (parallel to Block Kit post)
      // This enables quiet hours, digests, and notification preferences
      const priority = opp.score >= 80 ? 'high' : opp.score >= 70 ? 'medium' : 'low';
      await queueNotification({
        type: 'opportunity',
        priority: priority as 'high' | 'medium' | 'low',
        title: opp.opportunity.title,
        message: `${fullOpener}\n\nScore: ${opp.score}/100\n${opp.samUrl}`,
        metadata: {
          agency: extractAgencyAbbreviation(opp.opportunity.department, opp.opportunity.office) || undefined,
          noticeId: opp.opportunity.noticeId,
          score: opp.score,
          dueDate: opp.opportunity.responseDeadLine,
        },
      });

      // Record that we posted this
      let notionPageId: string | undefined;
      try {
        const supabase = getSupabase();

        // Also sync to Notion if hub is configured
        const hubIds = loadHubIds();
        if (hubIds) {
          try {
            notionPageId = await addOpportunityToNotion(hubIds.opportunitiesDbId, {
              name: opp.opportunity.title,
              status: 'New',
              fitScore: opp.score,
              strategicFit: opp.score >= 70 && opp.reasons.some(r => r.toLowerCase().includes('strategic')),
              agency: mapAgencyForNotion(opp.opportunity.department, opp.opportunity.office),
              subAgency: opp.opportunity.office,
              dueDate: opp.opportunity.responseDeadLine?.split('T')[0],
              postedDate: opp.opportunity.postedDate,
              naics: opp.opportunity.naicsCode,
              setAside: mapSetAsideForNotion(opp.opportunity.setAsideDescription),
              type: mapTypeForNotion(opp.opportunity.type),
              samLink: opp.samUrl,
              mayasTake: `Score: ${opp.score}/100. ${opp.reasons.join(', ')}${opp.redFlags.length > 0 ? ` Concerns: ${opp.redFlags.join(', ')}` : ''}`,
            });

            // Log activity
            await logActivityToNotion(hubIds.activityLogDbId, {
              agent: 'Maya',
              actionType: 'Found Opportunity',
              summary: `Found: ${opp.opportunity.title?.slice(0, 100)} (Score: ${opp.score})`,
              opportunityId: notionPageId,
            });

            console.log(`[NOTION] Synced to Notion: ${notionPageId}`);
          } catch (notionErr) {
            console.warn('[NOTION] Sync failed:', notionErr);
          }
        }

        // Record in seen_opportunities
        const agencyAbbrev = extractAgencyAbbreviation(opp.opportunity.department, opp.opportunity.office);
        await supabase.from('seen_opportunities').insert({
          notice_id: opp.opportunity.noticeId,
          title: opp.opportunity.title,
          sam_url: opp.samUrl,
          score: opp.score,
          posted_at: new Date().toISOString(),
          notion_page_id: notionPageId,
          thread_ts: messageTs, // For David to reply in thread
          agency: agencyAbbrev,
        });

        // CREATE WORKFLOW for high-score opportunities (70+)
        // This triggers the autonomous agent pipeline
        if (opp.score >= 70) {
          console.log(`[WORKFLOW] Creating workflow for ${opp.opportunity.noticeId} (score: ${opp.score})`);

          const workflow = await createOpportunityWorkflow({
            notice_id: opp.opportunity.noticeId,
            title: opp.opportunity.title,
            sam_url: opp.samUrl,
            agency: agencyAbbrev || opp.opportunity.department,
            score: opp.score,
            stage: 'found',
            agent_responsible: 'maya',
            channel_id: CHANNEL_ID,
            thread_ts: messageTs,
            // Set auto-action for 30 minutes from now (David will research)
            auto_action_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            awaiting_input_from: 'auto',
            red_flags: opp.redFlags,
          });

          if (workflow) {
            console.log(`[WORKFLOW] Created workflow ${workflow.id} - David will auto-research in 30 min`);
          }
        }
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

export async function runWeeklySummary() {
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
    console.log('\nSchedule (CST):');
    console.log('  - Weekdays at 8:00 AM CST: Scan for new opportunities');
    console.log('  - Monday at 8:30 AM CST: Weekly summary');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runDailyScan();

    // Weekdays at 8am CST (14:00 UTC)
    cron.schedule('0 14 * * 1-5', async () => {
      await runDailyScan();
    });

    // Weekly on Monday at 8:30am CST (14:30 UTC)
    cron.schedule('30 14 * * 1', async () => {
      await runWeeklySummary();
    });

    // Flush pending notifications every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      const pending = getPendingCount();
      if (pending > 0) {
        console.log(`[BATCHER] Flushing ${pending} pending notifications...`);
        const mayaApp = await getMayaApp();
        const sent = await flushNotifications(mayaApp || undefined);
        console.log(`[BATCHER] Sent ${sent} notifications`);
        if (mayaApp) await mayaApp.stop();
      }
    });

    console.log('Scheduler running...');

  } else {
    // One-time scan
    await runDailyScan();
  }
}

main().catch(console.error);
