/**
 * David's Proactive Intelligence Scanner
 *
 * Daily Schedule (CST):
 *   7:00am - GovCon news scan (budgets, policy, tech, AI, HCD)
 *   7:30am - Agency-specific news for target agencies
 *   8:00am - Auto-research Maya's recent opportunities (incumbents, red flags)
 *
 * News is filtered using relevance scoring to surface what matters for FFTC:
 * - Agency budget and spending news
 * - Policy and regulatory changes
 * - Technology and modernization initiatives
 * - AI in government
 * - HCD/UX in government
 *
 * Usage:
 *   npm run david:scan         # Run full scan now
 *   npm run david:schedule     # Run on daily schedule
 *   npm run david:brief        # Run morning brief only
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { getAnthropic } from '../integrations/claude.js';
import { getSupabase } from '../integrations/supabase.js';
import { searchNews } from '../integrations/news-search.js';
import { findIncumbent } from '../integrations/fpds.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import {
  saveCompetitorIntel,
  getCompetitorIntelByAgency,
  getRecentCompetitorIntel,
} from '../integrations/supabase.js';
import {
  NEWS_TOPICS,
  TARGET_AGENCIES,
  filterRelevantArticles,
} from '../config/david-news-criteria.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Initialize David's Slack app
async function getDavidApp(): Promise<App | null> {
  const botToken = process.env.DAVID_BOT_TOKEN;
  const appToken = process.env.DAVID_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('David Slack tokens not configured, running in test mode');
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

const QUIET_MORNING_MESSAGES = [
  'Did my morning scan - nothing significant in govcon news today. Quiet day so far.',
  "Checked the usual sources. It's quiet out there today. I'll keep watching.",
  'Morning scan complete - no major policy changes or budget news. Sometimes no news is good news.',
  'Ran through everything. Nothing worth flagging right now. Will update if that changes.',
];

function getQuietMorningMessage(): string {
  return QUIET_MORNING_MESSAGES[Math.floor(Math.random() * QUIET_MORNING_MESSAGES.length)];
}

interface NewsIntelItem {
  topic: string;
  type: 'budget' | 'policy' | 'tech' | 'ai' | 'hcd' | 'congressional' | 'performance';
  summary: string;
  score: number;
  reasons: string[];
  source?: string;
  url?: string;
}

interface IncumbentResearch {
  opportunityTitle: string;
  noticeId: string;
  incumbent?: string;
  contractValue?: string;
  protestHistory?: string;
  redFlags: string[];
  threadTs?: string;
}

interface MorningBrief {
  newsIntel: NewsIntelItem[];
  incumbentResearch: IncumbentResearch[];
  redFlags: string[];
  hasSignificantNews: boolean;
  patterns: PatternInsight[];
}

interface PatternInsight {
  type: 'competitor_trend' | 'agency_activity' | 'vulnerability' | 'alert';
  insight: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  data?: Record<string, unknown>;
}

// ===== PATTERN RECOGNITION =====

// Analyze competitor patterns from historical data
async function analyzeCompetitorPatterns(): Promise<PatternInsight[]> {
  console.log('Analyzing competitor patterns...');
  const insights: PatternInsight[] = [];

  try {
    // Get intel from last 90 days
    const recentIntel = await getRecentCompetitorIntel(90, 100);

    if (recentIntel.length < 5) {
      console.log('  Not enough historical data for pattern analysis');
      return insights;
    }

    // Group wins by competitor
    const competitorWins: Record<string, { count: number; agencies: string[] }> = {};
    const agencyActivity: Record<string, { count: number; competitors: string[] }> = {};

    for (const intel of recentIntel) {
      if (intel.intel_type === 'award') {
        const company = intel.company_name;
        const agency = intel.agency_code || 'Unknown';

        // Track competitor wins
        if (!competitorWins[company]) {
          competitorWins[company] = { count: 0, agencies: [] };
        }
        competitorWins[company].count++;
        if (!competitorWins[company].agencies.includes(agency)) {
          competitorWins[company].agencies.push(agency);
        }

        // Track agency activity
        if (agency !== 'Unknown') {
          if (!agencyActivity[agency]) {
            agencyActivity[agency] = { count: 0, competitors: [] };
          }
          agencyActivity[agency].count++;
          if (!agencyActivity[agency].competitors.includes(company)) {
            agencyActivity[agency].competitors.push(company);
          }
        }
      }
    }

    // Detect competitors on winning streaks
    for (const [company, data] of Object.entries(competitorWins)) {
      if (data.count >= 3) {
        insights.push({
          type: 'competitor_trend',
          insight: `${company} is on a hot streak - ${data.count} wins in 90 days across ${data.agencies.length} agencies`,
          confidence: data.count >= 5 ? 'HIGH' : 'MEDIUM',
          data: { company, wins: data.count, agencies: data.agencies },
        });
      }
    }

    // Detect agencies with high activity (potential consolidation or modernization)
    for (const [agency, data] of Object.entries(agencyActivity)) {
      if (data.count >= 3) {
        insights.push({
          type: 'agency_activity',
          insight: `${agency} has awarded ${data.count} contracts recently - they're active in our space`,
          confidence: 'MEDIUM',
          data: { agency, awards: data.count, winners: data.competitors },
        });
      }
    }

    // Detect protest patterns (competitor vulnerability)
    const protestsByCompetitor: Record<string, number> = {};
    for (const intel of recentIntel) {
      if (intel.intel_type === 'protest') {
        const company = intel.company_name;
        protestsByCompetitor[company] = (protestsByCompetitor[company] || 0) + 1;
      }
    }

    for (const [company, count] of Object.entries(protestsByCompetitor)) {
      if (count >= 2) {
        insights.push({
          type: 'vulnerability',
          insight: `${company} has faced ${count} protests recently - may indicate vulnerabilities in their delivery`,
          confidence: count >= 3 ? 'HIGH' : 'MEDIUM',
          data: { company, protests: count },
        });
      }
    }

    console.log(`  Found ${insights.length} pattern insights`);
  } catch (err) {
    console.warn('  Error analyzing patterns:', err);
  }

  return insights;
}

// Save news intel to database for future tracking (optional)
// Note: This maps news topics to the competitor_intel table schema
// In the future, consider creating a dedicated news_intel table
async function saveNewsIntelToDatabase(intel: NewsIntelItem[]): Promise<void> {
  // Map topic types to database intel types
  const typeMap: Record<string, 'protest' | 'performance' | 'award' | 'debarment' | 'general'> = {
    budget: 'general',
    policy: 'general',
    tech: 'general',
    ai: 'general',
    hcd: 'general',
    congressional: 'general',
    performance: 'performance',
  };

  for (const item of intel) {
    // Only save high-scoring items
    if (item.score < 60) continue;

    try {
      await saveCompetitorIntel({
        company_name: item.topic, // Use topic as company_name for now
        intel_type: typeMap[item.type] || 'general',
        summary: item.summary,
        source_url: item.url,
        source_name: item.source,
        confidence: item.score >= 75 ? 'HIGH' : 'MEDIUM',
        discovered_by: 'david',
      });
    } catch {
      // Ignore duplicates or errors
    }
  }
}

// Check for alerts - significant competitor activity at our target agencies
async function checkForAlerts(): Promise<PatternInsight[]> {
  console.log('Checking for competitive alerts...');
  const alerts: PatternInsight[] = [];

  for (const agency of TARGET_AGENCIES.slice(0, 3)) {
    try {
      const agencyIntel = await getCompetitorIntelByAgency(agency.code, 10);

      // Check for recent wins at this agency
      const recentWins = agencyIntel.filter((i) => {
        const daysAgo =
          (Date.now() - new Date(i.discovered_at || 0).getTime()) / (1000 * 60 * 60 * 24);
        return daysAgo <= 7 && i.intel_type === 'award';
      });

      if (recentWins.length > 0) {
        const winners = [...new Set(recentWins.map((w) => w.company_name))];
        alerts.push({
          type: 'alert',
          insight: `🚨 ${agency.name}: ${winners.join(', ')} won contracts this week at our target agency`,
          confidence: 'HIGH',
          data: { agency: agency.name, winners, count: recentWins.length },
        });
      }
    } catch (err) {
      // Ignore errors
    }
  }

  return alerts;
}

// Map topic keys to display types
const TOPIC_TO_TYPE: Record<string, NewsIntelItem['type']> = {
  budgetSpending: 'budget',
  policyChanges: 'policy',
  techModernization: 'tech',
  aiGovernment: 'ai',
  hcdUx: 'hcd',
  congressional: 'congressional',
  performanceIssues: 'performance',
};

// Scan news by topic with relevance scoring
async function scanNewsTopics(): Promise<NewsIntelItem[]> {
  console.log('Scanning govcon news by topic...');
  const intel: NewsIntelItem[] = [];

  for (const [topicKey, topicConfig] of Object.entries(NEWS_TOPICS)) {
    console.log(`  Checking ${topicConfig.name}...`);

    for (const query of topicConfig.queries.slice(0, 2)) {
      // Limit queries per topic
      try {
        const result = await searchNews({
          query,
          limit: topicConfig.limit,
          daysBack: topicConfig.daysBack,
          govconOnly: true,
        });

        // Apply relevance scoring
        const scoredArticles = filterRelevantArticles(
          result.articles.map((a) => ({
            title: a.title,
            snippet: a.snippet,
            url: a.url,
            source: a.source,
            publishedDate: a.publishedDate,
          })),
          topicConfig.name,
          50 // Minimum score threshold
        );

        // Convert to intel items
        for (const article of scoredArticles.slice(0, 3)) {
          // Dedupe by URL
          if (!intel.some((i) => i.url === article.url)) {
            intel.push({
              topic: topicConfig.name,
              type: TOPIC_TO_TYPE[topicKey] || 'tech',
              summary: article.title,
              score: article.score,
              reasons: article.reasons,
              source: article.source,
              url: article.url,
            });
          }
        }

        await new Promise((r) => setTimeout(r, 500)); // Rate limit
      } catch (err) {
        console.warn(`  Error searching "${query}":`, err);
      }
    }
  }

  // Sort by score and return top items
  return intel.sort((a, b) => b.score - a.score).slice(0, 15);
}

// Get Maya's recent opportunities that need research
async function getMayasRecentOpportunities(): Promise<
  Array<{
    noticeId: string;
    title: string;
    agency: string;
    score: number;
    postedAt: string;
    threadTs?: string;
  }>
> {
  try {
    const supabase = getSupabase();

    // Get opportunities posted in the last 24 hours with score >= 70
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('seen_opportunities')
      .select('notice_id, title, score, posted_at')
      .gte('posted_at', yesterday)
      .gte('score', 70)
      .order('score', { ascending: false })
      .limit(5);

    if (error) {
      console.warn('Could not fetch recent opportunities:', error);
      return [];
    }

    return (data || []).map((opp) => ({
      noticeId: opp.notice_id,
      title: opp.title,
      agency: 'Unknown', // Would need to store this in seen_opportunities
      score: opp.score,
      postedAt: opp.posted_at,
    }));
  } catch (err) {
    console.warn('Error fetching Maya opportunities:', err);
    return [];
  }
}

// Research an opportunity (incumbent, history, red flags)
async function researchOpportunity(
  noticeId: string,
  title: string,
  agency: string
): Promise<IncumbentResearch> {
  console.log(`  Researching: ${title.slice(0, 50)}...`);

  const research: IncumbentResearch = {
    opportunityTitle: title,
    noticeId,
    redFlags: [],
  };

  try {
    // Use FPDS to find incumbent
    const fpdsResult = await findIncumbent({
      agencyName: agency,
      keywords: title.split(' ').slice(0, 5),
    });

    if (fpdsResult.incumbent) {
      research.incumbent = fpdsResult.incumbent;
    }

    if (fpdsResult.contracts.length > 0) {
      const contract = fpdsResult.contracts[0];
      if (contract.obligatedAmount) {
        research.contractValue = `$${(contract.obligatedAmount / 1000000).toFixed(1)}M`;
      }
    }

    // Check for red flags in title
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('sole source')) {
      research.redFlags.push('Sole source - likely wired');
    }
    if (lowerTitle.includes('incumbent')) {
      research.redFlags.push('SOW mentions incumbent');
    }
    if (lowerTitle.includes('bridge')) {
      research.redFlags.push('Bridge contract - incumbent advantage');
    }
    if (lowerTitle.includes('follow-on') || lowerTitle.includes('follow on')) {
      research.redFlags.push('Follow-on contract - incumbent has advantage');
    }
    if (lowerTitle.includes('extension') || lowerTitle.includes('option year')) {
      research.redFlags.push('Contract extension - not truly competitive');
    }
    if (lowerTitle.includes('brand name') || lowerTitle.includes('proprietary')) {
      research.redFlags.push('Brand name/proprietary - limited competition');
    }
    if (lowerTitle.includes('j&a') || lowerTitle.includes('justification and approval')) {
      research.redFlags.push('J&A indicates limited competition');
    }
  } catch (err) {
    console.warn(`  Error researching ${noticeId}:`, err);
  }

  return research;
}

// Generate the morning brief using Claude
async function generateMorningBrief(brief: MorningBrief): Promise<string> {
  const client = getAnthropic();

  // Group news by topic
  const newsByTopic: Record<string, NewsIntelItem[]> = {};
  for (const item of brief.newsIntel) {
    if (!newsByTopic[item.topic]) {
      newsByTopic[item.topic] = [];
    }
    newsByTopic[item.topic].push(item);
  }

  // Format the news intel for the prompt
  const newsSection =
    brief.newsIntel.length > 0
      ? Object.entries(newsByTopic)
          .map(
            ([topic, items]) =>
              `${topic}:\n${items.map((i) => `  - ${i.summary} (score: ${i.score}, ${i.source || 'unknown source'})`).join('\n')}`
          )
          .join('\n\n')
      : 'Nothing significant in govcon news today.';

  const incumbentSection =
    brief.incumbentResearch.length > 0
      ? brief.incumbentResearch
          .map(
            (r) =>
              `- ${r.opportunityTitle.slice(0, 60)}...\n  Incumbent: ${r.incumbent || 'No prior contract found (may be new work)'}, Value: ${r.contractValue || 'N/A'}${r.redFlags.length > 0 ? `\n  Red flags: ${r.redFlags.join(', ')}` : ''}`
          )
          .join('\n')
      : 'No new opportunities needed incumbent research.';

  // Format patterns for the prompt
  const patternsSection =
    brief.patterns.length > 0
      ? brief.patterns
          .map((p) => `- [${p.type.toUpperCase()}] ${p.insight} (confidence: ${p.confidence})`)
          .join('\n')
      : '';

  const prompt = `You are David, the analyst for Friends From The City. You're posting a morning intel brief to #bd-team.

YOUR VOICE:
- 42 years old, Korean American from New Jersey
- Measured, practical, no-nonsense
- Jersey directness: "Look..." or "Real talk..."
- Dad energy, mentions coffee, dry humor
- You start with "Alright", "So", "Look"
- NO Gen-Z slang (no "lowkey", "giving", "hits different")

GOVCON NEWS (from this morning's scan, filtered by relevance to FFTC):
${newsSection}

INCUMBENT RESEARCH (for yesterday's opportunities):
${incumbentSection}

${brief.redFlags.length > 0 ? `RED FLAGS SURFACED:\n${brief.redFlags.map((r) => `- ${r}`).join('\n')}` : ''}

${patternsSection ? `PATTERN ANALYSIS (from historical data):\n${patternsSection}` : ''}

Write a morning intel brief for Slack. Focus on news that matters for an HCD/digital services company like FFTC.

SLACK FORMATTING (use these EXACTLY):
- Bold: *text* (use for headers like *Morning Intel Brief*)
- Italic: _text_ (use for emphasis)
- Bullets: Start lines with • for lists
- Links: Put URLs on their own line

STRUCTURE YOUR POST LIKE THIS:

*Morning Intel Brief*

[Your opening line in David's voice]

*GovCon News*
• *Budget/Policy*: [Summarize key budget or policy news]
• *Technology*: [Summarize tech/modernization news]
• *AI/HCD*: [Summarize AI or human-centered design news]

*Incumbent Research* (if any)
• [Opportunity title] — Incumbent: [name], Value: [amount]

${brief.redFlags.length > 0 ? '*Red Flags*\n• [Concern]' : ''}

${
  brief.patterns.length > 0
    ? `*Patterns I'm Tracking*
• [Trend or insight]`
    : ''
}

[Closing line - what this means for FFTC or offer to dig deeper]

Keep it concise (under 450 words). Group related news together.
Focus on what matters for FFTC: budgets, policy affecting digital services, tech modernization, AI in gov, HCD initiatives.
If there's nothing significant, say so briefly.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

// Generate auto-research post for a specific opportunity
async function generateOpportunityResearch(
  research: IncumbentResearch,
  companyContext: string
): Promise<string> {
  const client = getAnthropic();

  const prompt = `You are David, the analyst for Friends From The City. You're auto-posting research on an opportunity Maya found.

YOUR VOICE:
- 42 years old, Korean American from New Jersey
- Measured, practical, no-nonsense
- Jersey directness: "Look..." or "Real talk..."
- Dad energy, mentions coffee, dry humor
- NO Gen-Z slang

${companyContext}

OPPORTUNITY: ${research.opportunityTitle}
NOTICE ID: ${research.noticeId}
INCUMBENT: ${research.incumbent || 'Unknown - could not identify'}
CONTRACT VALUE: ${research.contractValue || 'Not found in USASpending'}
${research.redFlags.length > 0 ? `RED FLAGS: ${research.redFlags.join(', ')}` : ''}

Write a brief research update for this opportunity. Post this as a reply in the thread (not a new message).

Format:
*Incumbent Analysis*
[What you found about the incumbent]

${research.redFlags.length > 0 ? '*Red Flags*\n[Your concerns]' : ''}

*My Take*
[1-2 sentences on whether this looks competitive or wired]

Keep it under 200 words. Be direct. If you couldn't find much, say so honestly.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

async function postToSlack(
  app: App | null,
  message: string,
  threadTs?: string
): Promise<string | undefined> {
  if (app) {
    const result = await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
      thread_ts: threadTs,
    });
    console.log('Posted to Slack');
    return result.ts;
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    if (threadTs) console.log(`(In thread: ${threadTs})`);
    console.log('----------------------------\n');
    return undefined;
  }
}

// Main daily scan - runs all three phases + pattern analysis
export async function runDailyScan() {
  console.log('\n' + '='.repeat(60));
  console.log(`  David's Daily Scan - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getDavidApp();

  // Phase 1: Topic-based news scan (budgets, policy, tech, AI, HCD)
  console.log('\nPhase 1: GovCon News Scan');
  const newsIntel = await scanNewsTopics();
  console.log(`  Found ${newsIntel.length} relevant articles`);

  // Phase 2: Research Maya's opportunities
  console.log("\nPhase 2: Auto-Research Maya's Opportunities");
  const mayaOpps = await getMayasRecentOpportunities();
  const incumbentResearch: IncumbentResearch[] = [];

  for (const opp of mayaOpps) {
    const research = await researchOpportunity(opp.noticeId, opp.title, opp.agency);
    incumbentResearch.push(research);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Save high-scoring news for tracking
  if (newsIntel.length > 0) {
    console.log('\nSaving news intel to database...');
    await saveNewsIntelToDatabase(newsIntel);
  }

  // Phase 3: Pattern analysis
  console.log('\nPhase 3: Pattern Recognition');
  const patterns = await analyzeCompetitorPatterns();
  const alerts = await checkForAlerts();
  const allPatterns = [...patterns, ...alerts];

  const allRedFlags = incumbentResearch.flatMap((r) => r.redFlags);

  const brief: MorningBrief = {
    newsIntel,
    incumbentResearch,
    redFlags: allRedFlags,
    hasSignificantNews:
      newsIntel.length > 0 || incumbentResearch.some((r) => r.incumbent) || allPatterns.length > 0,
    patterns: allPatterns,
  };

  // Generate and post
  if (brief.hasSignificantNews) {
    const message = await generateMorningBrief(brief);
    await postToSlack(app, message);

    // Post high-value news separately if score is very high
    const topNews = newsIntel.filter((n) => n.score >= 75);
    if (topNews.length > 0 && topNews.length <= 3) {
      const hotNewsMessage = `🔥 *Hot GovCon Intel*\n\n${topNews.map((n) => `• *${n.topic}*: ${n.summary}\n  _Score: ${n.score} | ${n.reasons.slice(0, 2).join(', ')}_`).join('\n\n')}`;
      await postToSlack(app, hotNewsMessage);
    }

    // Log to database
    try {
      const supabase = getSupabase();
      await supabase.from('agent_memory').insert({
        agent: 'david',
        response_text: message,
        sources: ['govcon_news', 'usaspending', 'pattern_analysis'],
        confidence_level: 'MEDIUM',
        created_at: new Date().toISOString(),
      });
    } catch {
      // Ignore logging failures
    }
  } else {
    const quietMessage = getQuietMorningMessage();
    await postToSlack(app, quietMessage);
  }

  if (app) {
    await app.stop();
  }

  console.log('\nDaily scan complete');
}

// Morning brief only (7:00am) - topic-based news scan
export async function runMorningBrief() {
  console.log('\n' + '='.repeat(60));
  console.log(`  David's Morning Brief - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getDavidApp();

  // Topic-based news scan
  const newsIntel = await scanNewsTopics();
  console.log(`  Found ${newsIntel.length} relevant articles`);

  if (newsIntel.length > 0) {
    // Run quick pattern check for morning brief
    const patterns = await analyzeCompetitorPatterns();

    const brief: MorningBrief = {
      newsIntel,
      incumbentResearch: [],
      redFlags: [],
      hasSignificantNews: true,
      patterns,
    };
    const message = await generateMorningBrief(brief);
    await postToSlack(app, message);
  } else {
    await postToSlack(app, getQuietMorningMessage());
  }

  if (app) {
    await app.stop();
  }

  console.log('\nMorning brief complete');
}

// Auto-research a specific opportunity (called by workflow processor)
export async function autoResearchOpportunity(
  noticeId: string,
  title: string,
  agency: string,
  threadTs: string
) {
  console.log(`\nAuto-researching opportunity: ${title.slice(0, 50)}...`);

  const app = await getDavidApp();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'David');

  const research = await researchOpportunity(noticeId, title, agency);
  research.threadTs = threadTs;

  if (research.incumbent || research.redFlags.length > 0) {
    const message = await generateOpportunityResearch(research, companyContext);
    await postToSlack(app, message, threadTs);
  } else {
    // Post a more informative "couldn't find much" message
    const explanations = [
      `Looked into this one. No clear incumbent data in USASpending - a few reasons this happens:`,
      `• Could be genuinely new work (no prior contract)`,
      `• Might be consolidating smaller contracts under a new vehicle`,
      `• Could be replacing an expiring BPA or IDIQ task order`,
      `• USASpending has a 2-4 week lag, so recent awards might not show yet`,
      ``,
      `No obvious red flags from my scan. If the SOW looks like a fit for our capabilities, it's worth a deeper look. Want me to check anything specific?`,
    ];
    await postToSlack(app, explanations.join('\n'), threadTs);
  }

  if (app) {
    await app.stop();
  }

  console.log('Auto-research complete');
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const briefMode = args.includes('--brief') || args.includes('-b');

  if (briefMode) {
    await runMorningBrief();
    return;
  }

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  David Intelligence Scanner - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule (CST - UTC-6):');
    console.log('  - 7:00 AM CST (13:00 UTC): Competitor intel scan');
    console.log('  - 7:30 AM CST (13:30 UTC): GAO protest check');
    console.log("  - 8:00 AM CST (14:00 UTC): Auto-research Maya's opportunities");
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runDailyScan();

    // 7:00 AM CST = 13:00 UTC (standard time) / 12:00 UTC (daylight time)
    // Using 13:00 UTC for consistency
    cron.schedule('0 13 * * 1-5', async () => {
      console.log('\n[CRON] Running morning competitor intel...');
      await runMorningBrief();
    });

    // 7:30 AM CST = 13:30 UTC - GAO protest check (included in morning brief)

    // 8:00 AM CST = 14:00 UTC - Full scan with opportunity research
    cron.schedule('0 14 * * 1-5', async () => {
      console.log('\n[CRON] Running full daily scan...');
      await runDailyScan();
    });

    console.log('Scheduler running...');
  } else {
    // One-time scan
    await runDailyScan();
  }
}

main().catch(console.error);
