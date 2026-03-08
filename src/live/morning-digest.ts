/**
 * Morning Digest
 *
 * Queues messages received outside working hours and sends a summary
 * at 9am ET so the team can catch up on what happened overnight/weekend.
 */

import type { LiveAgentName } from './types.js';

/**
 * Queued message for digest
 */
interface QueuedMessage {
  timestamp: Date;
  channelId: string;
  threadTs?: string;
  messageTs: string;
  userId?: string;
  userName?: string;
  text: string;
  mentionedAgents: LiveAgentName[];
  isUrgent: boolean;
}

// In-memory queue (would be database in production)
const messageQueue: QueuedMessage[] = [];

// Track if digest has been sent today
let lastDigestDate: string | null = null;

/**
 * Queue a message for the morning digest
 */
export function queueForDigest(message: {
  channelId: string;
  threadTs?: string;
  messageTs: string;
  userId?: string;
  userName?: string;
  text: string;
  mentionedAgents: LiveAgentName[];
}): void {
  // Check for urgency markers
  const lowerText = message.text.toLowerCase();
  const isUrgent =
    lowerText.includes('@urgent') ||
    lowerText.includes('urgent:') ||
    lowerText.includes('🚨') ||
    lowerText.includes('asap') ||
    lowerText.includes('emergency');

  messageQueue.push({
    timestamp: new Date(),
    channelId: message.channelId,
    threadTs: message.threadTs,
    messageTs: message.messageTs,
    userId: message.userId,
    userName: message.userName,
    text: message.text,
    mentionedAgents: message.mentionedAgents,
    isUrgent,
  });

  console.log(
    `[MorningDigest] Queued message from ${message.userName || 'unknown'} (${isUrgent ? 'URGENT' : 'normal'})`
  );
}

/**
 * Get all queued messages
 */
export function getQueuedMessages(): QueuedMessage[] {
  return [...messageQueue];
}

/**
 * Clear the queue after digest is sent
 */
export function clearQueue(): void {
  messageQueue.length = 0;
}

/**
 * Check if digest should be sent
 * Returns true at 9am ET on weekdays if there are queued messages
 */
export function shouldSendDigest(): boolean {
  const now = new Date();

  // Get current time in Eastern
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = eastern.getHours();
  const day = eastern.getDay();
  const dateStr = eastern.toDateString();

  // Only on weekdays
  if (day === 0 || day === 6) return false;

  // Only at 9am (give a 5-minute window)
  if (hour !== 9) return false;
  const minutes = eastern.getMinutes();
  if (minutes > 5) return false;

  // Don't send twice on the same day
  if (lastDigestDate === dateStr) return false;

  // Must have messages to report
  if (messageQueue.length === 0) return false;

  return true;
}

/**
 * Mark digest as sent for today
 */
export function markDigestSent(): void {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  lastDigestDate = eastern.toDateString();
}

/**
 * Format the digest for Slack
 */
export function formatDigest(): string {
  const messages = getQueuedMessages();

  if (messages.length === 0) {
    return '☀️ *Good morning!* No messages came in overnight.';
  }

  const urgent = messages.filter((m) => m.isUrgent);
  const normal = messages.filter((m) => !m.isUrgent);

  let digest = `☀️ *Morning Digest*\n`;
  digest += `_${messages.length} message${messages.length > 1 ? 's' : ''} came in while the team was offline_\n\n`;

  // Urgent messages first
  if (urgent.length > 0) {
    digest += `🚨 *Urgent (${urgent.length}):*\n`;
    for (const msg of urgent) {
      const preview = msg.text.slice(0, 100) + (msg.text.length > 100 ? '...' : '');
      const who = msg.userName || 'Someone';
      const when = formatRelativeTime(msg.timestamp);
      digest += `• ${who} (${when}): "${preview}"\n`;
    }
    digest += '\n';
  }

  // Normal messages grouped by who was mentioned
  if (normal.length > 0) {
    // Group by mentioned agents
    const byAgent: Record<string, QueuedMessage[]> = {};
    const general: QueuedMessage[] = [];

    for (const msg of normal) {
      if (msg.mentionedAgents.length > 0) {
        for (const agent of msg.mentionedAgents) {
          if (!byAgent[agent]) byAgent[agent] = [];
          byAgent[agent].push(msg);
        }
      } else {
        general.push(msg);
      }
    }

    // List by agent
    for (const [agent, agentMsgs] of Object.entries(byAgent)) {
      const displayName = agent.charAt(0).toUpperCase() + agent.slice(1);
      digest += `📬 *For ${displayName} (${agentMsgs.length}):*\n`;
      for (const msg of agentMsgs.slice(0, 3)) {
        const preview = msg.text.slice(0, 80) + (msg.text.length > 80 ? '...' : '');
        const who = msg.userName || 'Someone';
        digest += `• ${who}: "${preview}"\n`;
      }
      if (agentMsgs.length > 3) {
        digest += `  _...and ${agentMsgs.length - 3} more_\n`;
      }
    }

    // General messages
    if (general.length > 0) {
      digest += `\n📝 *General (${general.length}):*\n`;
      for (const msg of general.slice(0, 3)) {
        const preview = msg.text.slice(0, 80) + (msg.text.length > 80 ? '...' : '');
        const who = msg.userName || 'Someone';
        digest += `• ${who}: "${preview}"\n`;
      }
      if (general.length > 3) {
        digest += `  _...and ${general.length - 3} more_\n`;
      }
    }
  }

  digest += '\n_Reply to the relevant threads to catch up!_';

  return digest;
}

/**
 * Format relative time (e.g., "2h ago", "yesterday")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `${diffMins}m ago`;
  }

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return 'yesterday';
  }

  return `${diffDays} days ago`;
}

/**
 * Start the digest scheduler
 * Checks every minute if it's time to send the digest
 */
export function startDigestScheduler(
  sendCallback: (message: string) => Promise<void>
): ReturnType<typeof setInterval> {
  const checkInterval = setInterval(async () => {
    if (shouldSendDigest()) {
      try {
        const digest = formatDigest();
        await sendCallback(digest);
        markDigestSent();
        clearQueue();
        console.log('[MorningDigest] Sent morning digest');
      } catch (err) {
        console.error('[MorningDigest] Failed to send digest:', err);
      }
    }
  }, 60 * 1000); // Check every minute

  console.log('[MorningDigest] Digest scheduler started');
  return checkInterval;
}

/**
 * Stop the digest scheduler
 */
export function stopDigestScheduler(intervalId: ReturnType<typeof setInterval>): void {
  clearInterval(intervalId);
  console.log('[MorningDigest] Digest scheduler stopped');
}
