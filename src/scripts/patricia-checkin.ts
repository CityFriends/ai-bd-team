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
import { getSupabase } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Slack IDs for tagging the humans
const LAPEDRA_ID = 'U01SC2TNYKU';
const TAMARA_ID = 'U01RXBVUA0P';

// Agent Slack IDs for tagging in standups
const MAYA_ID = 'U0AC3RA4JVB';
const DAVID_ID = 'U0AC0SVD3MH';
const ROSA_ID = 'U0ACASZ36BW';
const JAMES_ID = 'U0AC582GXBQ';

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
      const matchedAgent = agentNames.find(a => username.includes(a));

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

  // Check for opportunities we've seen but not actioned
  const { data: seenOpps } = await supabase
    .from('seen_opportunities')
    .select('*')
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

async function generateMorningCheckin(pending: PendingItem[], recentActivity: RecentActivity[]): Promise<string> {
  const client = getAnthropic();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'Patricia');

  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const isMonday = dayOfWeek === 'Monday';

  const prompt = `You are Patricia, the PM. You're 31, from PG County, Howard grad, very online, organized. You're doing your morning check-in with the team.

${companyContext}

Today is ${dayOfWeek}.
${isMonday ? 'It\'s Monday, so do a quick week-ahead preview.' : ''}

PENDING ITEMS (from database):
${pending.length > 0
  ? pending.map(p => `- [${p.urgency.toUpperCase()}] ${p.type}: "${p.title}" (${p.daysOld} days old) ${p.context || ''}`).join('\n')
  : 'Nothing pending in the tracker.'}

RECENT CHANNEL ACTIVITY (last 24 hours):
${recentActivity.length > 0
  ? recentActivity.map(a => `- ${a.agent}: "${a.message.slice(0, 150)}..."`).join('\n')
  : 'No agent messages in the last 24 hours.'}

TEAM ROLES:
- Maya: Scans SAM.gov for opportunities
- David: Researches agencies, incumbents, risks
- Rosa: Partner outreach and teaming
- James: Strategy and go/no-go decisions

Write a morning standup message for #bd-team. Be conversational - you're a millennial PM, organized but chill. Include:
1. Quick vibe check (acknowledge the day)
2. Summarize pending items/opportunities if any
3. Tag each team member for their update:
   - <@${MAYA_ID}> (Maya) - any new opportunities?
   - <@${DAVID_ID}> (David) - any research updates?
   - <@${ROSA_ID}> (Rosa) - any partner conversations?
   - <@${JAMES_ID}> (James) - any strategy decisions needed?
4. Tag <@${LAPEDRA_ID}> and <@${TAMARA_ID}> for priorities/blockers
5. ${isMonday ? 'Quick preview of the week' : 'Any deadlines coming up'}

Use emoji naturally - you love them. Ask each person for a quick update.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
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

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

async function generateDecisionRequest(
  topic: string,
  context: string,
  options: string[]
): Promise<string> {
  const client = getAnthropic();

  const prompt = `You are Patricia, the PM. You need a decision from Lapedra (the CEO).

TOPIC: ${topic}
CONTEXT: ${context}
OPTIONS:
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Write a clear decision request for @Lapedra. Format it so she can respond with just a number or quick reply. Keep it professional but warm. Include:
1. Quick summary of what we need
2. The options clearly numbered
3. Any deadline or urgency
4. Offer to provide more context if needed`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
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

export async function runMorningCheckin() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Patricia's Daily Standup - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getPatriciaApp();

  // Gather data
  const pending = await getPendingItems();
  const recentActivity = await getRecentChannelActivity(app);

  console.log(`Found ${pending.length} pending items`);
  console.log(`Found ${recentActivity.length} recent agent messages`);

  const message = await generateMorningCheckin(pending, recentActivity);
  await postToSlack(app, message);

  if (app) {
    await app.stop();
  }

  console.log('\nDaily standup complete');
}

export async function runNudgeCheck() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Patricia's Nudge Check - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getPatriciaApp();
  const pending = await getPendingItems();

  // Only nudge for high-urgency items older than 3 days
  const needsNudge = pending.filter(p => p.urgency === 'high' && p.daysOld >= 3);

  if (needsNudge.length === 0) {
    console.log('No items need nudging right now');
  } else {
    console.log(`${needsNudge.length} items need attention`);
    for (const item of needsNudge.slice(0, 2)) {
      const message = await generateNudge(item);
      await postToSlack(app, message);
      await new Promise(r => setTimeout(r, 2000));
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

main().catch(console.error);
