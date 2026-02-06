/**
 * Patricia's Team Management System
 *
 * Morning (10am CST): Daily standup with the team
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

async function generateMorningCheckin(pending: PendingItem[]): Promise<string> {
  const client = getAnthropic();
  const companyData = await loadCompanyContext();
  const companyContext = formatCompanyContextForPrompt(companyData, 'Patricia');

  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const isMonday = dayOfWeek === 'Monday';

  const prompt = `You are Patricia, the PM. You're 31, from PG County, Howard grad, very online, organized. You're doing your morning check-in with the team.

${companyContext}

Today is ${dayOfWeek}.
${isMonday ? 'It\'s Monday, so do a quick week-ahead preview.' : ''}

PENDING ITEMS:
${pending.length > 0
  ? pending.map(p => `- [${p.urgency.toUpperCase()}] ${p.type}: ${p.title} (${p.daysOld} days) ${p.context || ''}`).join('\n')
  : 'Nothing pending - clean slate!'}

TEAM STATUS:
- Maya: Scanning SAM.gov daily
- David: Available for research
- Rosa: Available for partner outreach
- James: Available for strategy calls

Write a morning standup message for #bd-team. Be conversational - you're a millennial PM, organized but chill. Keep it to 4-6 sentences max. Include:
1. Quick vibe check (acknowledge the day)
2. Any hot items needing attention
3. What the team should focus on today
4. ${isMonday ? 'Quick preview of the week' : 'Any deadlines coming up'}
5. Tag <@${LAPEDRA_ID}> and <@${TAMARA_ID}> at the end
6. Ask if there's anything blocking them or priorities to discuss

Use emoji naturally - you love them. End with a question for the team.`;

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

async function runMorningCheckin() {
  console.log('\n' + '='.repeat(60));
  console.log(`  Patricia's Daily Standup - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getPatriciaApp();
  const pending = await getPendingItems();

  console.log(`Found ${pending.length} pending items`);

  const message = await generateMorningCheckin(pending);
  await postToSlack(app, message);

  if (app) {
    await app.stop();
  }

  console.log('\nDaily standup complete');
}

async function runNudgeCheck() {
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
    console.log('  - Weekdays at 10:00 AM CST: Daily standup');
    console.log('  - Weekdays at 2:00 PM CST: Nudge check for pending items');
    console.log('  - Press Ctrl+C to stop\n');

    // Run standup immediately on start
    await runMorningCheckin();

    // Daily standup at 10am CST (16:00 UTC)
    cron.schedule('0 16 * * 1-5', async () => {
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
