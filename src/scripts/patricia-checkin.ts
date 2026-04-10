/**
 * Patricia's Team Management System
 *
 * Morning (11am CST): Daily standup with the team
 * Throughout day: Nudges for pending items
 * As needed: Decision requests for Lapedra
 *
 * Usage:
 *   npm run patricia:checkin     # Morning check-in
 *   npm run patricia:nudge       # Check for pending items
 *   npm run patricia:schedule    # Run on schedule
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { getSupabase, getExtractedFacts } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';

// Notion API for pipeline visibility
const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const PIPELINE_DATABASE_ID = '1bb07a7951ff80fe9e6dfd1284f99a48';

interface PipelineItem {
  name: string;
  stage: string;
  dueDate?: string;
}

// Get active opportunities from Notion pipeline
async function getActivePipeline(): Promise<PipelineItem[]> {
  if (!NOTION_API_KEY) return [];

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${PIPELINE_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            and: [
              {
                property: 'Stage',
                status: {
                  does_not_equal: 'Pass',
                },
              },
              {
                property: 'Stage',
                status: {
                  does_not_equal: 'No Bid',
                },
              },
            ],
          },
          sorts: [{ property: 'Date Added', direction: 'descending' }],
        }),
      }
    );

    if (!response.ok) {
      console.warn('Could not fetch Notion pipeline:', response.status);
      return [];
    }

    const data = (await response.json()) as { results?: any[] };
    const items: PipelineItem[] = [];

    for (const page of data.results || []) {
      const props = page.properties;
      const name = props.Name?.title?.[0]?.plain_text || 'Untitled';
      const stage = props.Stage?.status?.name || 'Unknown';
      const dueDate = props['Due Date']?.date?.start || undefined;

      items.push({ name, stage, dueDate });
    }

    return items;
  } catch (err) {
    console.warn('Error fetching pipeline:', err);
    return [];
  }
}

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Slack IDs for tagging the humans
const LAPEDRA_ID = 'U01SC2TNYKU';

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

interface PendingItem {
  type: 'opportunity' | 'decision' | 'follow_up' | 'deadline';
  title: string;
  daysOld: number;
  urgency: 'high' | 'medium' | 'low';
  context?: string;
}

interface RecentActivity {
  agent: string;
  message: string;
  timestamp: string;
}

// Scan recent Slack channel messages to see what agents have posted
async function getRecentChannelActivity(app: App | null): Promise<RecentActivity[]> {
  if (!app) return [];

  const activities: RecentActivity[] = [];
  const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

  try {
    const result = await app.client.conversations.history({
      channel: CHANNEL_ID,
      oldest: oneDayAgo.toString(),
      limit: 30,
    });

    // Agent bot IDs (we'll match by username in the message)
    const agentNames = ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'];

    for (const msg of result.messages || []) {
      // Check if it's from one of our agents (bot messages)
      const username = (msg as any).username?.toLowerCase() || '';
      const matchedAgent = agentNames.find((a) => username.includes(a));

      if (matchedAgent && msg.text) {
        activities.push({
          agent: matchedAgent,
          message: msg.text.slice(0, 200),
          timestamp: msg.ts || '',
        });
      }
    }
  } catch (err) {
    console.warn('Could not fetch channel history:', err);
  }

  return activities;
}

async function getPendingItems(): Promise<PendingItem[]> {
  const supabase = getSupabase();
  const pending: PendingItem[] = [];

  // Check for opportunities we've seen but not yet decided on
  // Filter out any that have a decision (pass, no-bid, pursuing, etc.)
  const { data: seenOpps } = await supabase
    .from('seen_opportunities')
    .select('*')
    .is('decision', null) // Only show opportunities without a decision
    .order('posted_at', { ascending: false })
    .limit(10);

  if (seenOpps) {
    for (const opp of seenOpps) {
      const daysAgo = Math.floor(
        (Date.now() - new Date(opp.posted_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysAgo >= 2 && daysAgo <= 7) {
        pending.push({
          type: 'opportunity',
          title: opp.title,
          daysOld: daysAgo,
          urgency: opp.score >= 80 ? 'high' : opp.score >= 60 ? 'medium' : 'low',
          context: `Score: ${opp.score}/100`,
        });
      }
    }
  }

  // Check for any conversation memories flagged as needing follow-up
  const { data: memories } = await supabase
    .from('conversation_memory')
    .select('*')
    .eq('needs_followup', true)
    .order('created_at', { ascending: false })
    .limit(5);

  if (memories) {
    for (const mem of memories) {
      const daysAgo = Math.floor(
        (Date.now() - new Date(mem.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      pending.push({
        type: 'follow_up',
        title: mem.key_point || mem.topic,
        daysOld: daysAgo,
        urgency: daysAgo > 5 ? 'high' : 'medium',
      });
    }
  }

  return pending;
}

// Get recent team facts from memory (things Patricia should remember)
async function getRecentTeamFacts(): Promise<string[]> {
  try {
    // Get facts from last 7 days that are still relevant
    const facts = await getExtractedFacts({ limit: 20 });

    // Filter to recent facts (within 7 days) and format them
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentFacts = facts
      .filter((f) => f.created_at && new Date(f.created_at).getTime() > oneWeekAgo)
      .map((f) => f.content);

    return recentFacts;
  } catch (err) {
    console.warn('Could not load team facts:', err);
    return [];
  }
}

async function generateMorningCheckin(
  pending: PendingItem[],
  recentActivity: RecentActivity[],
  teamFacts: string[],
  pipeline: PipelineItem[]
): Promise<string> {
  const client = getAnthropic();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'Patricia');

  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const isMonday = dayOfWeek === 'Monday';

  const prompt = `You are Patricia, the PM. You're 31, from PG County, Howard grad, very online, organized. You're doing your morning check-in with the team.

${companyContext}

Today is ${dayOfWeek}.
${isMonday ? "It's Monday, so do a quick week-ahead preview." : ''}

ACTIVE PIPELINE (from Notion - this is what we're ACTUALLY working on):
${
  pipeline.length > 0
    ? pipeline
        .map((p) => `- "${p.name}" [${p.stage}]${p.dueDate ? ` - Due: ${p.dueDate}` : ''}`)
        .join('\n')
    : 'No active opportunities in the pipeline.'
}

THINGS YOU REMEMBER (from recent conversations):
${teamFacts.length > 0 ? teamFacts.map((f) => `- ${f}`).join('\n') : 'No recent notes.'}

NEW OPPORTUNITIES TO REVIEW (not yet decided):
${
  pending.length > 0
    ? pending
        .map(
          (p) =>
            `- [${p.urgency.toUpperCase()}] ${p.type}: "${p.title}" (${p.daysOld} days old) ${p.context || ''}`
        )
        .join('\n')
    : 'No new opportunities needing review.'
}

RECENT CHANNEL ACTIVITY (last 24 hours):
${
  recentActivity.length > 0
    ? recentActivity.map((a) => `- ${a.agent}: "${a.message.slice(0, 150)}..."`).join('\n')
    : 'No agent messages in the last 24 hours.'
}

Write a morning standup message for #bd-team. Be conversational - you're a millennial PM, organized but chill. Include:
1. Start with "hey team" (this triggers the agents to chime in with updates)
2. Quick vibe check (acknowledge the day)
3. Summarize pending items/opportunities if any
4. Ask the team for updates - "what's everyone working on?" or "any updates to share?"
5. Tag <@${LAPEDRA_ID}> for any priorities or blockers
6. ${isMonday ? 'Quick preview of the week' : 'Any deadlines coming up'}

IMPORTANT: Start your message with "hey team" - this is how you signal to the agents that they should share their updates.

Do NOT @mention specific agent names (Maya, David, etc.) - just say "hey team" and they'll respond if they have something to share. Only tag Lapedra by name.

Use emoji naturally - you love them. Keep it to ONE message.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

async function generateNudge(item: PendingItem): Promise<string> {
  const client = getAnthropic();

  const prompt = `You are Patricia, the PM. You need to nudge the team about a pending item.

PENDING ITEM:
Type: ${item.type}
Title: ${item.title}
Days old: ${item.daysOld}
Urgency: ${item.urgency}
${item.context ? `Context: ${item.context}` : ''}

Write a gentle nudge (2-3 sentences max). Be friendly but clear that this needs attention. Tag the relevant person:
- Opportunities: @David (to research) or @James (for go/no-go)
- Follow-ups: @Lapedra or whoever was involved
- Deadlines: the whole team`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

// generateDecisionRequest is available for future use when Patricia
// needs to escalate decisions to Lapedra with structured options
// Currently not active but kept for when decision escalation is implemented

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

export async function runMorningCheckin() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Patricia's Daily Standup - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getPatriciaApp();

  // Gather data in parallel
  const [pending, recentActivity, teamFacts, pipeline] = await Promise.all([
    getPendingItems(),
    getRecentChannelActivity(app),
    getRecentTeamFacts(),
    getActivePipeline(),
  ]);

  console.log(`Found ${pending.length} pending items`);
  console.log(`Found ${recentActivity.length} recent agent messages`);
  console.log(`Found ${teamFacts.length} team facts from memory`);
  console.log(`Found ${pipeline.length} active pipeline items`);

  const message = await generateMorningCheckin(pending, recentActivity, teamFacts, pipeline);
  await postToSlack(app, message);

  if (app) {
    await app.stop();
  }

  console.log('\nDaily standup complete');
}

// Track when items were last nudged to prevent repeated nudges
const NUDGE_COOLDOWN_HOURS = 48;

async function getLastNudgeTime(itemTitle: string): Promise<Date | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('agent_memory')
    .select('created_at')
    .eq('agent', 'patricia')
    .eq('memory_type', 'observation')
    .ilike('content', `%[nudge] ${itemTitle.slice(0, 50)}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    return new Date(data[0].created_at);
  }
  return null;
}

async function recordNudge(itemTitle: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('agent_memory').insert({
    agent: 'patricia',
    memory_type: 'observation',
    content: `[nudge] ${itemTitle.slice(0, 100)} - nudged team`,
    importance: 3,
    tags: ['nudge-tracking'],
  });
}

export async function runNudgeCheck() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Patricia's Nudge Check - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getPatriciaApp();
  const pending = await getPendingItems();

  // Only nudge for high-urgency items older than 3 days
  const needsNudge = pending.filter((p) => p.urgency === 'high' && p.daysOld >= 3);

  if (needsNudge.length === 0) {
    console.log('No items need nudging right now');
  } else {
    console.log(`${needsNudge.length} items need attention`);
    let nudgesSent = 0;
    for (const item of needsNudge) {
      if (nudgesSent >= 1) break; // Max 1 nudge per run

      // Check cooldown — don't re-nudge the same item within 48 hours
      const lastNudge = await getLastNudgeTime(item.title);
      if (lastNudge) {
        const hoursSinceNudge = (Date.now() - lastNudge.getTime()) / (1000 * 60 * 60);
        if (hoursSinceNudge < NUDGE_COOLDOWN_HOURS) {
          console.log(
            `Skipping "${item.title}" — nudged ${Math.round(hoursSinceNudge)}h ago (cooldown: ${NUDGE_COOLDOWN_HOURS}h)`
          );
          continue;
        }
      }

      const message = await generateNudge(item);
      await postToSlack(app, message);
      await recordNudge(item.title);
      nudgesSent++;
    }
    if (nudgesSent === 0) {
      console.log('All items recently nudged, skipping');
    }
  }

  if (app) {
    await app.stop();
  }

  console.log('\nNudge check complete');
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const nudgeMode = args.includes('--nudge') || args.includes('-n');

  if (nudgeMode) {
    await runNudgeCheck();
    return;
  }

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Patricia Team Management - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule (CST):');
    console.log('  - Weekdays at 11:00 AM CST: Daily standup');
    console.log('  - Weekdays at 2:00 PM CST: Nudge check for pending items');
    console.log('  - Press Ctrl+C to stop\n');

    // Run standup immediately on start
    await runMorningCheckin();

    // Daily standup at 11am CST (weekdays)
    cron.schedule('0 11 * * 1-5', async () => {
      await runMorningCheckin();
    });

    // Afternoon nudge check at 2pm CST (20:00 UTC)
    cron.schedule('0 20 * * 1-5', async () => {
      await runNudgeCheck();
    });

    console.log('Scheduler running...');
  } else {
    // One-time check-in
    await runMorningCheckin();
  }
}

// Only run main() when executed directly, not when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
