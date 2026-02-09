/**
 * James's Daily Strategic Digest
 *
 * Every morning (8:30am), James posts a strategic brief summarizing:
 * - Pipeline status (hot, active, watching)
 * - Strategic observations and patterns
 * - Decisions needed from leadership
 * - Recommendations with confidence levels
 *
 * Usage:
 *   npm run james:digest      # Run once now
 *   npm run james:schedule    # Run on daily schedule
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { getAnthropic } from '../integrations/claude.js';
import { getSupabase } from '../integrations/supabase.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import { bold, bullets, buildPost } from '../utils/slack-format.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Initialize James's Slack app
async function getJamesApp(): Promise<App | null> {
  const botToken = process.env.JAMES_BOT_TOKEN;
  const appToken = process.env.JAMES_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('James Slack tokens not configured, running in test mode');
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

interface PipelineOpportunity {
  id: string;
  notice_id: string;
  title: string;
  agency?: string;
  score: number;
  stage: string;
  due_date?: string;
  days_until_due?: number;
  agent_responsible?: string;
  james_recommendation?: string;
  red_flags?: string[];
  created_at: string;
}

interface PipelineStatus {
  hot: PipelineOpportunity[];      // Due within 7 days
  active: PipelineOpportunity[];   // In active pursuit
  watching: PipelineOpportunity[]; // In backlog/monitoring
  needsDecision: PipelineOpportunity[]; // Awaiting leadership input
  stale: PipelineOpportunity[];    // No activity in 7+ days
}

// Get current pipeline status from database
async function getPipelineStatus(): Promise<PipelineStatus> {
  const supabase = getSupabase();
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const status: PipelineStatus = {
    hot: [],
    active: [],
    watching: [],
    needsDecision: [],
    stale: [],
  };

  try {
    // Get from opportunity_workflow if it exists
    const { data: workflows, error: wfError } = await supabase
      .from('opportunity_workflow')
      .select('*')
      .order('created_at', { ascending: false });

    if (!wfError && workflows && workflows.length > 0) {
      for (const opp of workflows) {
        const dueDate = opp.due_date ? new Date(opp.due_date) : null;
        const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
        const lastUpdated = new Date(opp.updated_at || opp.created_at);
        const isStale = (now.getTime() - lastUpdated.getTime()) > 7 * 24 * 60 * 60 * 1000;

        const opportunity: PipelineOpportunity = {
          id: opp.id,
          notice_id: opp.notice_id,
          title: opp.title,
          agency: opp.agency,
          score: opp.score || 0,
          stage: opp.stage,
          due_date: opp.due_date,
          days_until_due: daysUntilDue ?? undefined,
          agent_responsible: opp.agent_responsible,
          james_recommendation: opp.james_recommendation,
          red_flags: opp.red_flags,
          created_at: opp.created_at,
        };

        // Categorize
        if (opp.awaiting_input_from === 'lapedra' || opp.awaiting_input_from === 'human') {
          status.needsDecision.push(opportunity);
        }

        if (daysUntilDue !== null && daysUntilDue <= 7 && daysUntilDue > 0) {
          status.hot.push(opportunity);
        } else if (['researching', 'partner_search', 'strategy', 'pursuing'].includes(opp.stage)) {
          status.active.push(opportunity);
        } else if (['found', 'watching'].includes(opp.stage)) {
          status.watching.push(opportunity);
        }

        if (isStale && !['passed', 'won', 'lost'].includes(opp.stage)) {
          status.stale.push(opportunity);
        }
      }
    }

    // Fallback: get from seen_opportunities if workflow table doesn't exist
    if (status.hot.length === 0 && status.active.length === 0) {
      const { data: seen } = await supabase
        .from('seen_opportunities')
        .select('*')
        .gte('score', 60)
        .order('posted_at', { ascending: false })
        .limit(20);

      if (seen) {
        for (const opp of seen) {
          const opportunity: PipelineOpportunity = {
            id: opp.id || opp.notice_id,
            notice_id: opp.notice_id,
            title: opp.title,
            agency: opp.agency,
            score: opp.score || 0,
            stage: 'watching',
            created_at: opp.posted_at,
          };

          if (opp.score >= 80) {
            status.active.push(opportunity);
          } else {
            status.watching.push(opportunity);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error fetching pipeline status:', err);
  }

  return status;
}

// Get recent wins/losses for learning context
async function getRecentOutcomes(): Promise<{ wins: number; losses: number; patterns: string[] }> {
  const supabase = getSupabase();
  const patterns: string[] = [];

  try {
    const { data: outcomes } = await supabase
      .from('decision_outcomes')
      .select('*')
      .gte('decided_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

    if (outcomes && outcomes.length > 0) {
      const wins = outcomes.filter(o => o.outcome === 'won').length;
      const losses = outcomes.filter(o => o.outcome === 'lost').length;

      // Analyze patterns
      const goRecs = outcomes.filter(o => o.james_recommendation === 'GO');
      const goWins = goRecs.filter(o => o.outcome === 'won').length;
      if (goRecs.length >= 3) {
        const winRate = Math.round((goWins / goRecs.length) * 100);
        patterns.push(`GO recommendations: ${winRate}% win rate (${goWins}/${goRecs.length})`);
      }

      const passRecs = outcomes.filter(o => o.james_recommendation === 'PASS');
      const passCorrect = passRecs.filter(o => o.outcome === 'lost' || o.outcome === 'cancelled').length;
      if (passRecs.length >= 2) {
        patterns.push(`PASS recommendations: ${passCorrect}/${passRecs.length} were correct calls`);
      }

      return { wins, losses, patterns };
    }
  } catch {
    // Table may not exist
  }

  return { wins: 0, losses: 0, patterns: [] };
}

// Get strategic observations (patterns from recent opportunities)
async function getStrategicObservations(): Promise<string[]> {
  const supabase = getSupabase();
  const observations: string[] = [];

  try {
    // Look at recent opportunities by agency
    const { data: recent } = await supabase
      .from('seen_opportunities')
      .select('agency, title, score, posted_at')
      .gte('posted_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .gte('score', 60);

    if (recent && recent.length > 0) {
      // Count by agency
      const agencyCounts: Record<string, number> = {};
      for (const opp of recent) {
        const agency = opp.agency || 'Unknown';
        agencyCounts[agency] = (agencyCounts[agency] || 0) + 1;
      }

      // Find agencies with multiple opportunities
      for (const [agency, count] of Object.entries(agencyCounts)) {
        if (count >= 3 && agency !== 'Unknown') {
          observations.push(`${agency} has released ${count} relevant opportunities in the last 30 days - they're active in our space`);
        }
      }

      // Look for patterns in titles
      const hcdCount = recent.filter(o =>
        o.title?.toLowerCase().includes('design') ||
        o.title?.toLowerCase().includes('user') ||
        o.title?.toLowerCase().includes('experience')
      ).length;

      if (hcdCount >= 3) {
        observations.push(`${hcdCount} HCD/UX-focused opportunities in the last month - the market is active`);
      }
    }

    // Check for competitor wins at target agencies
    const { data: competitorIntel } = await supabase
      .from('competitor_intel')
      .select('*')
      .eq('intel_type', 'award')
      .gte('discovered_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5);

    if (competitorIntel && competitorIntel.length > 0) {
      for (const intel of competitorIntel.slice(0, 2)) {
        observations.push(`${intel.company_name} recently won work${intel.agency_code ? ` at ${intel.agency_code}` : ''} - worth watching their positioning`);
      }
    }
  } catch {
    // Tables may not exist
  }

  // Add some standing observations if we have nothing
  if (observations.length === 0) {
    observations.push('No major patterns detected this week - steady state');
  }

  return observations.slice(0, 4);
}

// Generate the strategic digest using Claude
async function generateStrategicDigest(
  pipeline: PipelineStatus,
  outcomes: { wins: number; losses: number; patterns: string[] },
  observations: string[],
  companyContext: string
): Promise<string> {
  const client = getAnthropic();

  // Format pipeline for prompt
  const hotSection = pipeline.hot.length > 0
    ? pipeline.hot.map(o => `- ${o.title.slice(0, 50)}... (${o.agency || 'Unknown'}) - Due in ${o.days_until_due} days`).join('\n')
    : 'None due this week';

  const activeSection = pipeline.active.length > 0
    ? pipeline.active.map(o => `- ${o.title.slice(0, 50)}... - Stage: ${o.stage}, Owner: ${o.agent_responsible || 'unassigned'}`).join('\n')
    : 'No active pursuits';

  const decisionsSection = pipeline.needsDecision.length > 0
    ? pipeline.needsDecision.map(o => `- ${o.title.slice(0, 50)}... - ${o.james_recommendation || 'Needs review'}`).join('\n')
    : 'No pending decisions';

  const staleSection = pipeline.stale.length > 0
    ? `${pipeline.stale.length} opportunities have gone stale (no activity in 7+ days)`
    : '';

  const prompt = `You are James, the strategist for Friends From The City. You're posting your morning strategic digest to #bd-team.

YOUR VOICE:
- 52 years old, Black, Chicago South Side roots
- Northwestern MBA, 15 years at big integrators
- Executive presence but not stuffy
- "Alright, let me tell you how I see this"
- Direct, strategic, sees the big picture
- Confident without being cocky

${companyContext}

CURRENT PIPELINE STATUS:

HOT (Due within 7 days):
${hotSection}

ACTIVE PURSUITS:
${activeSection}

DECISIONS NEEDED FROM LEADERSHIP:
${decisionsSection}

${staleSection}

WATCHING: ${pipeline.watching.length} opportunities in backlog

WIN/LOSS DATA (last 90 days):
- Wins: ${outcomes.wins}
- Losses: ${outcomes.losses}
${outcomes.patterns.length > 0 ? outcomes.patterns.map(p => `- ${p}`).join('\n') : ''}

STRATEGIC OBSERVATIONS:
${observations.map(o => `- ${o}`).join('\n')}

Write a morning strategic digest for Slack.

SLACK FORMATTING (use these EXACTLY):
- Bold: *text* (use for headers)
- Bullets: Start lines with • for lists

STRUCTURE YOUR POST LIKE THIS:

*Morning Strategic Brief*

[One line opener in James's voice]

*Pipeline Status*
• 🔥 [X] hot (due this week)
• 📋 [X] in active pursuit
• 👀 [X] watching

*What I'm Thinking About*
• [Strategic observation 1]
• [Strategic observation 2]

*Decisions Needed*
${pipeline.needsDecision.length > 0 ? '• [Opportunity] - [Your recommendation with reasoning]' : "• No pending decisions - we're clear"}

${pipeline.stale.length > 0 ? '*Heads Up*\n• [Stale opportunities that need attention]' : ''}

[Closing thought - what the team should focus on today]

Keep it under 350 words. Be strategic, not operational. This is the 30,000-foot view.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
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

// Main digest function
export async function runStrategicDigest() {
  console.log('\n' + '='.repeat(60));
  console.log(`  James's Strategic Digest - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getJamesApp();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'James');

  // Gather data
  console.log('Gathering pipeline status...');
  const pipeline = await getPipelineStatus();
  console.log(`  Hot: ${pipeline.hot.length}, Active: ${pipeline.active.length}, Watching: ${pipeline.watching.length}`);

  console.log('Analyzing outcomes...');
  const outcomes = await getRecentOutcomes();
  console.log(`  Wins: ${outcomes.wins}, Losses: ${outcomes.losses}`);

  console.log('Identifying strategic observations...');
  const observations = await getStrategicObservations();
  console.log(`  Found ${observations.length} observations`);

  // Generate and post
  const digest = await generateStrategicDigest(pipeline, outcomes, observations, companyContext);
  await postToSlack(app, digest);

  // Log to database
  try {
    const supabase = getSupabase();
    await supabase.from('agent_memory').insert({
      agent: 'james',
      response_text: digest,
      sources: ['pipeline', 'outcomes', 'observations'],
      confidence_level: 'HIGH',
      created_at: new Date().toISOString(),
    });
  } catch {
    // Ignore logging failures
  }

  if (app) {
    await app.stop();
  }

  console.log('\nStrategic digest complete');
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  James Strategic Digest - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule:');
    console.log('  - Weekdays at 8:30 AM CST (14:30 UTC): Strategic digest');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runStrategicDigest();

    // Weekdays at 8:30am CST (14:30 UTC)
    cron.schedule('30 14 * * 1-5', async () => {
      console.log('\n[CRON] Running strategic digest...');
      await runStrategicDigest();
    });

    console.log('Scheduler running...');
  } else {
    // One-time run
    await runStrategicDigest();
  }
}

main().catch(console.error);
