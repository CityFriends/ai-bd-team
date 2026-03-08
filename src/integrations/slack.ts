import { App, LogLevel } from '@slack/bolt';
import type { AgentName } from '../types/index.js';

// Type for Slack messages
interface SlackMessage {
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

let app: App | null = null;

export function getSlackApp(): App {
  if (!app) {
    const token = process.env.SLACK_BOT_TOKEN;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const appToken = process.env.SLACK_APP_TOKEN;

    if (!token || !signingSecret || !appToken) {
      throw new Error('Missing SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, or SLACK_APP_TOKEN');
    }

    app = new App({
      token,
      signingSecret,
      socketMode: true,
      appToken,
      logLevel: LogLevel.INFO,
    });
  }
  return app;
}

export function getChannelId(): string {
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!channelId) {
    throw new Error('Missing SLACK_CHANNEL_ID');
  }
  return channelId;
}

// Agent display info with profile pictures
// Using DiceBear avatars for consistent, professional-looking profiles
const AGENT_INFO: Record<
  AgentName,
  {
    username: string;
    icon_url: string;
    displayName: string;
  }
> = {
  scout: {
    username: 'Maya',
    displayName: 'Scout',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/Maya.jpeg',
  },
  analyst: {
    username: 'David',
    displayName: 'Analyst',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/David.jpeg',
  },
  connector: {
    username: 'Rosa',
    displayName: 'Connector',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/Rosa.jpeg',
  },
  strategist: {
    username: 'James',
    displayName: 'Strategist',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/James.jpeg',
  },
  pm: {
    username: 'Patricia',
    displayName: 'PM',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/Patricia.jpeg',
  },
  engineer: {
    username: 'Marcus',
    displayName: 'Engineer',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/Marcus.jpeg',
  },
  writer: {
    username: 'Jodie',
    displayName: 'Writer',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/Jodie.jpeg',
  },
};

// Post a message as an agent with custom username and profile picture
export async function postAsAgent(
  agent: AgentName,
  text: string,
  threadTs?: string
): Promise<{ ts: string; channel: string }> {
  const { username, icon_url } = AGENT_INFO[agent];
  const app = getSlackApp();
  const channel = getChannelId();

  const result = await app.client.chat.postMessage({
    channel,
    text,
    username,
    icon_url,
    thread_ts: threadTs,
    unfurl_links: false,
    unfurl_media: false,
  });

  if (!result.ts) {
    throw new Error('Failed to post message - no timestamp returned');
  }

  return { ts: result.ts, channel };
}

// Post a message that mentions other agents
export async function postWithMentions(
  agent: AgentName,
  text: string,
  mentions: AgentName[],
  threadTs?: string
): Promise<{ ts: string; channel: string }> {
  // In Slack, we'll use @mentions. Since these are bot personas,
  // we'll format them as bold text for now
  let formattedText = text;
  for (const mention of mentions) {
    const { displayName } = AGENT_INFO[mention];
    // Replace @AgentName with formatted version
    formattedText = formattedText.replace(new RegExp(`@${displayName}`, 'gi'), `*@${displayName}*`);
  }

  return postAsAgent(agent, formattedText, threadTs);
}

// Reply to a thread
export async function replyInThread(
  agent: AgentName,
  text: string,
  threadTs: string
): Promise<{ ts: string; channel: string }> {
  return postAsAgent(agent, text, threadTs);
}

// Post a decision request (mentions Lapedra)
export async function postDecisionRequest(
  agent: AgentName,
  text: string,
  threadTs?: string
): Promise<{ ts: string; channel: string }> {
  // Format with @channel or user mention for visibility
  const formattedText = `@Lapedra - ${text}`;
  return postAsAgent(agent, formattedText, threadTs);
}

// Add a reaction to a message
export async function addReaction(
  emoji: string,
  messageTs: string,
  channel?: string
): Promise<void> {
  const app = getSlackApp();
  await app.client.reactions.add({
    channel: channel || getChannelId(),
    timestamp: messageTs,
    name: emoji,
  });
}

// Get messages from a thread
export async function getThreadMessages(
  threadTs: string,
  channel?: string
): Promise<Array<{ user?: string; text?: string; ts: string }>> {
  const app = getSlackApp();
  const result = await app.client.conversations.replies({
    channel: channel || getChannelId(),
    ts: threadTs,
  });

  return (result.messages || []).map((msg: SlackMessage) => ({
    user: msg.user,
    text: msg.text,
    ts: msg.ts || '',
  }));
}

// Get recent messages from channel
export async function getRecentMessages(
  limit: number = 20,
  channel?: string
): Promise<Array<{ user?: string; text?: string; ts: string; thread_ts?: string }>> {
  const app = getSlackApp();
  const result = await app.client.conversations.history({
    channel: channel || getChannelId(),
    limit,
  });

  return (result.messages || []).map((msg: SlackMessage) => ({
    user: msg.user,
    text: msg.text,
    ts: msg.ts || '',
    thread_ts: msg.thread_ts,
  }));
}

// Start the Slack app
export async function startSlackApp(): Promise<void> {
  const app = getSlackApp();
  await app.start();
  console.log('Slack app started');
}

// Stop the Slack app
export async function stopSlackApp(): Promise<void> {
  if (app) {
    await app.stop();
    console.log('Slack app stopped');
  }
}
