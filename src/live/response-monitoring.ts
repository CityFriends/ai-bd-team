/**
 * Response Monitoring
 *
 * Tracks response gate decisions for analysis and debugging.
 * Stores metrics about why agents responded or stayed quiet.
 */

import type { LiveAgentName } from './types.js';

/**
 * Types of gate blocks
 */
export type GateBlockReason =
  | 'working_hours'
  | 'domain_mismatch'
  | 'better_agent_match'
  | 'other_agent_mentioned'
  | 'thread_ownership'
  | 'topic_already_covered'
  | 'one_voice_synthesis';

/**
 * Response decision record
 */
export interface ResponseDecision {
  timestamp: Date;
  agentName: LiveAgentName;
  channelId: string;
  threadTs?: string;
  messageTs: string;
  decision: 'responded' | 'blocked';
  blockReason?: GateBlockReason;
  details?: string;
  messagePreview?: string; // First 100 chars
}

/**
 * Aggregated stats for an agent
 */
export interface AgentStats {
  agentName: LiveAgentName;
  period: 'hour' | 'day' | 'week';
  totalMessages: number;
  responded: number;
  blocked: number;
  blocksByReason: Record<GateBlockReason, number>;
}

// In-memory storage (would be database in production)
const responseDecisions: ResponseDecision[] = [];
const MAX_STORED_DECISIONS = 10000;

/**
 * Record a response decision
 */
export function recordResponseDecision(
  agentName: LiveAgentName,
  channelId: string,
  messageTs: string,
  decision: 'responded' | 'blocked',
  options?: {
    threadTs?: string;
    blockReason?: GateBlockReason;
    details?: string;
    messageText?: string;
  }
): void {
  const record: ResponseDecision = {
    timestamp: new Date(),
    agentName,
    channelId,
    messageTs,
    decision,
    threadTs: options?.threadTs,
    blockReason: options?.blockReason,
    details: options?.details,
    messagePreview: options?.messageText?.slice(0, 100),
  };

  responseDecisions.push(record);

  // Trim old decisions if we exceed max
  if (responseDecisions.length > MAX_STORED_DECISIONS) {
    responseDecisions.splice(0, responseDecisions.length - MAX_STORED_DECISIONS);
  }

  // Log for debugging
  if (decision === 'blocked') {
    console.log(
      `[Monitor] ${agentName} blocked: ${options?.blockReason} - ${options?.details || ''}`
    );
  }
}

/**
 * Get stats for a specific agent
 */
export function getAgentStats(
  agentName: LiveAgentName,
  period: 'hour' | 'day' | 'week' = 'day'
): AgentStats {
  const now = new Date();
  let cutoff: Date;

  switch (period) {
    case 'hour':
      cutoff = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case 'day':
      cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
  }

  const relevantDecisions = responseDecisions.filter(
    (d) => d.agentName === agentName && d.timestamp >= cutoff
  );

  const blocksByReason: Record<GateBlockReason, number> = {
    working_hours: 0,
    domain_mismatch: 0,
    better_agent_match: 0,
    other_agent_mentioned: 0,
    thread_ownership: 0,
    topic_already_covered: 0,
    one_voice_synthesis: 0,
  };

  let responded = 0;
  let blocked = 0;

  for (const decision of relevantDecisions) {
    if (decision.decision === 'responded') {
      responded++;
    } else {
      blocked++;
      if (decision.blockReason) {
        blocksByReason[decision.blockReason]++;
      }
    }
  }

  return {
    agentName,
    period,
    totalMessages: relevantDecisions.length,
    responded,
    blocked,
    blocksByReason,
  };
}

/**
 * Get stats for all agents
 */
export function getAllAgentStats(period: 'hour' | 'day' | 'week' = 'day'): AgentStats[] {
  const agents: LiveAgentName[] = ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'];

  return agents.map((agent) => getAgentStats(agent, period));
}

/**
 * Get recent blocked decisions for debugging
 */
export function getRecentBlocks(limit: number = 20, agentName?: LiveAgentName): ResponseDecision[] {
  let filtered = responseDecisions.filter((d) => d.decision === 'blocked');

  if (agentName) {
    filtered = filtered.filter((d) => d.agentName === agentName);
  }

  return filtered.slice(-limit);
}

/**
 * Get response rate (percentage of messages agent responded to)
 */
export function getResponseRate(
  agentName: LiveAgentName,
  period: 'hour' | 'day' | 'week' = 'day'
): number {
  const stats = getAgentStats(agentName, period);

  if (stats.totalMessages === 0) {
    return 0;
  }

  return (stats.responded / stats.totalMessages) * 100;
}

/**
 * Format stats as a summary string
 */
export function formatStatsReport(period: 'hour' | 'day' | 'week' = 'day'): string {
  const allStats = getAllAgentStats(period);
  const periodLabel = period === 'hour' ? 'past hour' : period === 'day' ? 'past 24h' : 'past week';

  const lines = [`*Response Gate Stats (${periodLabel})*\n`];

  for (const stats of allStats) {
    const rate =
      stats.totalMessages > 0 ? ((stats.responded / stats.totalMessages) * 100).toFixed(1) : '0';

    lines.push(`*${stats.agentName}*: ${stats.responded}/${stats.totalMessages} (${rate}%)`);

    if (stats.blocked > 0) {
      const reasons = Object.entries(stats.blocksByReason)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(', ');
      lines.push(`  _Blocked:_ ${reasons}`);
    }
  }

  return lines.join('\n');
}

/**
 * Clear old decisions (for memory management)
 */
export function clearOldDecisions(olderThanDays: number = 7): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const initialLength = responseDecisions.length;

  // Filter in place
  let i = 0;
  while (i < responseDecisions.length) {
    if (responseDecisions[i].timestamp < cutoff) {
      responseDecisions.splice(i, 1);
    } else {
      i++;
    }
  }

  return initialLength - responseDecisions.length;
}
