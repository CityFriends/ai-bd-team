/**
 * Thread Ownership
 *
 * Tracks which agent "owns" a thread and drives it to resolution.
 * Other agents can participate when tagged or consulted, but the
 * owner is responsible for:
 * - Synthesizing input from other agents
 * - Making decisions or recommendations
 * - Closing the thread when resolved
 *
 * This prevents the "everyone piles on" pattern.
 */

import type { LiveAgentName } from './types.js';

// Thread state
export type ThreadState = 'active' | 'waiting' | 'paused' | 'closed' | 'stale';

export interface ThreadOwnership {
  threadTs: string;
  owner: LiveAgentName;
  state: ThreadState;
  claimedAt: Date;
  lastActivity: Date;
  consultedAgents: LiveAgentName[];
  messageCount: number;
  closedReason?: string;
}

// In-memory store for thread ownership
// TODO: Persist to database for cross-instance consistency
const threadOwners: Map<string, ThreadOwnership> = new Map();

// Stale threshold: 48 hours without activity
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// High message count warning threshold
const HIGH_MESSAGE_COUNT = 50;

/**
 * Check if a thread has an owner
 */
export function getThreadOwner(threadTs: string): ThreadOwnership | null {
  const ownership = threadOwners.get(threadTs);

  if (!ownership) {
    return null;
  }

  // Check if thread has gone stale
  const now = new Date();
  const timeSinceActivity = now.getTime() - ownership.lastActivity.getTime();

  if (timeSinceActivity > STALE_THRESHOLD_MS && ownership.state === 'active') {
    // Mark as stale
    ownership.state = 'stale';
    threadOwners.set(threadTs, ownership);
  }

  return ownership;
}

/**
 * Claim ownership of a thread
 *
 * Only succeeds if:
 * - Thread has no owner, OR
 * - Thread is stale and being reclaimed
 *
 * @param threadTs - The thread timestamp
 * @param agentName - The agent claiming ownership
 * @returns Success status and message
 */
export function claimThreadOwnership(
  threadTs: string,
  agentName: LiveAgentName
): {
  success: boolean;
  message: string;
  existingOwner?: LiveAgentName;
} {
  const existing = getThreadOwner(threadTs);

  // No existing owner - claim it
  if (!existing) {
    threadOwners.set(threadTs, {
      threadTs,
      owner: agentName,
      state: 'active',
      claimedAt: new Date(),
      lastActivity: new Date(),
      consultedAgents: [],
      messageCount: 1,
    });

    return {
      success: true,
      message: `Thread claimed by ${agentName}`,
    };
  }

  // Already owned by this agent
  if (existing.owner === agentName) {
    return {
      success: true,
      message: `Thread already owned by ${agentName}`,
    };
  }

  // Thread is stale - can be reclaimed
  if (existing.state === 'stale') {
    threadOwners.set(threadTs, {
      ...existing,
      owner: agentName,
      state: 'active',
      claimedAt: new Date(),
      lastActivity: new Date(),
    });

    return {
      success: true,
      message: `Stale thread reclaimed by ${agentName} (was ${existing.owner})`,
    };
  }

  // Thread is closed - can be reopened
  if (existing.state === 'closed') {
    threadOwners.set(threadTs, {
      ...existing,
      owner: agentName,
      state: 'active',
      claimedAt: new Date(),
      lastActivity: new Date(),
      closedReason: undefined,
    });

    return {
      success: true,
      message: `Closed thread reopened by ${agentName}`,
    };
  }

  // Thread is actively owned by someone else
  return {
    success: false,
    message: `Thread is owned by ${existing.owner}`,
    existingOwner: existing.owner,
  };
}

/**
 * Record activity in a thread
 */
export function recordThreadActivity(threadTs: string, agentName: LiveAgentName): void {
  const existing = threadOwners.get(threadTs);

  if (existing) {
    existing.lastActivity = new Date();
    existing.messageCount++;

    // Add to consulted agents if not owner
    if (agentName !== existing.owner && !existing.consultedAgents.includes(agentName)) {
      existing.consultedAgents.push(agentName);
    }

    threadOwners.set(threadTs, existing);
  }
}

/**
 * Close a thread
 */
export function closeThread(threadTs: string, agentName: LiveAgentName, reason: string): boolean {
  const existing = threadOwners.get(threadTs);

  if (!existing) {
    return false;
  }

  // Only owner can close
  if (existing.owner !== agentName) {
    return false;
  }

  existing.state = 'closed';
  existing.closedReason = reason;
  existing.lastActivity = new Date();
  threadOwners.set(threadTs, existing);

  return true;
}

/**
 * Check if an agent should respond based on ownership
 *
 * Rules:
 * - Owner always responds
 * - Consulted agents (tagged) can respond
 * - Others should stay quiet unless directly tagged
 *
 * @param threadTs - Thread timestamp
 * @param agentName - Agent checking if they should respond
 * @param wasTagged - Whether this agent was directly @mentioned
 * @returns Gate decision
 */
export function checkOwnershipGate(
  threadTs: string,
  agentName: LiveAgentName,
  wasTagged: boolean
): {
  shouldRespond: boolean;
  reason: string;
  isOwner: boolean;
  owner?: LiveAgentName;
  warning?: string;
} {
  const ownership = getThreadOwner(threadTs);

  // No ownership yet - anyone can respond and potentially claim
  if (!ownership) {
    return {
      shouldRespond: true,
      reason: 'No owner - can respond and claim ownership',
      isOwner: false,
    };
  }

  // Thread is closed
  if (ownership.state === 'closed') {
    if (wasTagged) {
      return {
        shouldRespond: true,
        reason: 'Thread is closed but agent was tagged - reopening',
        isOwner: false,
        owner: ownership.owner,
      };
    }
    return {
      shouldRespond: false,
      reason: `Thread closed by ${ownership.owner}: ${ownership.closedReason || 'No reason given'}`,
      isOwner: false,
      owner: ownership.owner,
    };
  }

  // Agent is the owner
  if (ownership.owner === agentName) {
    let warning: string | undefined;

    // Warn about high message count
    if (ownership.messageCount >= HIGH_MESSAGE_COUNT) {
      warning = `High message count (${ownership.messageCount}). Consider synthesizing and closing.`;
    }

    return {
      shouldRespond: true,
      reason: 'Thread owner',
      isOwner: true,
      owner: ownership.owner,
      warning,
    };
  }

  // Agent was directly tagged - they can respond
  if (wasTagged) {
    return {
      shouldRespond: true,
      reason: `Tagged by owner or team member`,
      isOwner: false,
      owner: ownership.owner,
    };
  }

  // Agent was previously consulted - they can follow up
  if (ownership.consultedAgents.includes(agentName)) {
    return {
      shouldRespond: true,
      reason: 'Previously consulted in this thread',
      isOwner: false,
      owner: ownership.owner,
    };
  }

  // Thread is stale - anyone can respond and reclaim
  if (ownership.state === 'stale') {
    return {
      shouldRespond: true,
      reason: 'Thread is stale - can respond and reclaim',
      isOwner: false,
      owner: ownership.owner,
    };
  }

  // Not owner, not tagged, not consulted - stay quiet
  return {
    shouldRespond: false,
    reason: `Thread owned by ${ownership.owner} - let them drive`,
    isOwner: false,
    owner: ownership.owner,
  };
}

/**
 * Detect ownership claim patterns in text
 *
 * Looks for phrases like:
 * - "I'll own this"
 * - "I'm owning this"
 * - "Let me take this"
 * - "I've got this"
 * - "Taking point on this"
 */
export function detectOwnershipClaim(text: string): boolean {
  const lowerText = text.toLowerCase();

  const claimPatterns = [
    "i'll own this",
    "i'm owning this",
    'i will own this',
    'let me take this',
    'let me own this',
    "i've got this",
    'i got this',
    'taking point on this',
    'taking the lead',
    "i'll lead this",
    'i will lead this',
    "i'll drive this",
    'i will drive this',
    'owning this thread',
    'claiming this',
  ];

  return claimPatterns.some((pattern) => lowerText.includes(pattern));
}

/**
 * Detect thread close patterns in text
 *
 * Looks for phrases like:
 * - "Thread closed"
 * - "Closing this out"
 * - "Resolved"
 * - "Moving on"
 */
export function detectThreadClose(text: string): { isClose: boolean; reason?: string } {
  const lowerText = text.toLowerCase();

  const closePatterns = [
    { pattern: 'thread closed', reason: 'Thread closed' },
    { pattern: 'closing this out', reason: 'Closed out' },
    { pattern: 'closing this thread', reason: 'Thread closed' },
    { pattern: 'resolved', reason: 'Resolved' },
    { pattern: 'decision made', reason: 'Decision made' },
    { pattern: 'moving to', reason: 'Moving to next phase' },
    { pattern: 'moving on', reason: 'Moving on' },
    { pattern: 'all set', reason: 'Complete' },
    { pattern: 'done here', reason: 'Complete' },
    { pattern: "that's a wrap", reason: 'Complete' },
  ];

  for (const { pattern, reason } of closePatterns) {
    if (lowerText.includes(pattern)) {
      return { isClose: true, reason };
    }
  }

  return { isClose: false };
}

/**
 * Get all active threads for an agent
 */
export function getAgentOwnedThreads(agentName: LiveAgentName): ThreadOwnership[] {
  const owned: ThreadOwnership[] = [];

  for (const [, ownership] of threadOwners) {
    if (ownership.owner === agentName && ownership.state !== 'closed') {
      owned.push(ownership);
    }
  }

  return owned;
}

/**
 * Get stale threads that need attention
 */
export function getStaleThreads(): ThreadOwnership[] {
  const stale: ThreadOwnership[] = [];

  for (const [, ownership] of threadOwners) {
    if (ownership.state === 'stale') {
      stale.push(ownership);
    }
  }

  return stale;
}

/**
 * Clean up old closed threads (older than 7 days)
 */
export function cleanupOldThreads(): number {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let cleaned = 0;

  for (const [threadTs, ownership] of threadOwners) {
    if (ownership.state === 'closed' && ownership.lastActivity < sevenDaysAgo) {
      threadOwners.delete(threadTs);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get thread stats for monitoring
 */
export function getThreadStats(): {
  total: number;
  active: number;
  waiting: number;
  stale: number;
  closed: number;
  highMessageCount: number;
} {
  let active = 0;
  let waiting = 0;
  let stale = 0;
  let closed = 0;
  let highMessageCount = 0;

  for (const [, ownership] of threadOwners) {
    switch (ownership.state) {
      case 'active':
        active++;
        break;
      case 'waiting':
        waiting++;
        break;
      case 'stale':
        stale++;
        break;
      case 'closed':
        closed++;
        break;
    }

    if (ownership.messageCount >= HIGH_MESSAGE_COUNT) {
      highMessageCount++;
    }
  }

  return {
    total: threadOwners.size,
    active,
    waiting,
    stale,
    closed,
    highMessageCount,
  };
}
