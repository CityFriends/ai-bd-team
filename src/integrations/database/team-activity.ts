import { getSupabase } from './client.js';

// ============================================
// TEAM ACTIVITY LOG FUNCTIONS
// ============================================

export interface TeamActivity {
  id?: string;
  thread_ts?: string; // Slack thread timestamp
  notice_id?: string; // SAM.gov notice ID
  channel_id?: string;
  agent: string;
  activity_type: // Note: DB column is activity_type, not action_type
    | 'research'
    | 'analysis'
    | 'recommendation'
    | 'question'
    | 'partner_search'
    | 'strategy'
    | 'alert';
  summary: string; // 1-2 sentence summary of contribution
  key_facts?: string[]; // Specific facts/data points provided
  recommendations?: string[]; // Any recommendations made
  sentiment?: 'positive' | 'negative' | 'neutral' | 'cautious';
  created_at?: string;
}

// Legacy alias for backwards compatibility
export type { TeamActivity as TeamActivityWithActionType };

/**
 * Log an agent's contribution to a thread
 * This enables other agents to see what's already been covered
 */
export async function logTeamActivity(
  activity: Omit<TeamActivity, 'id' | 'created_at'>
): Promise<TeamActivity | null> {
  try {
    // Build insert data with all columns
    const insertData: Record<string, unknown> = {
      thread_ts: activity.thread_ts,
      notice_id: activity.notice_id,
      channel_id: activity.channel_id,
      agent: activity.agent,
      activity_type: activity.activity_type || 'question', // DB column is activity_type
      summary: activity.summary,
      key_facts: activity.key_facts,
      recommendations: activity.recommendations,
      sentiment: activity.sentiment,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await getSupabase()
      .from('team_activity_log')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.warn('Could not log team activity:', error.message);
      return null;
    }

    console.log(`${activity.agent}: Logged team activity (${activity.activity_type || 'general'})`);
    return data as TeamActivity;
  } catch (err) {
    console.warn('Could not log team activity:', err);
    return null;
  }
}

/**
 * Get recent team activity for a thread
 * Returns what other agents have already contributed
 */
export async function getThreadActivity(
  threadTs: string,
  limit: number = 10
): Promise<TeamActivity[]> {
  try {
    const { data, error } = await getSupabase()
      .from('team_activity_log')
      .select('*')
      .eq('thread_ts', threadTs)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.warn('Could not fetch thread activity:', error.message);
      return [];
    }
    return (data || []) as TeamActivity[];
  } catch (err) {
    console.warn('Could not fetch thread activity:', err);
    return [];
  }
}

/**
 * Get recent team activity for an opportunity by notice ID
 */
export async function getOpportunityActivity(
  noticeId: string,
  limit: number = 10
): Promise<TeamActivity[]> {
  try {
    const { data, error } = await getSupabase()
      .from('team_activity_log')
      .select('*')
      .eq('notice_id', noticeId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.warn('Could not fetch opportunity activity:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Could not fetch opportunity activity:', err);
    return [];
  }
}

/**
 * Helper to format time ago
 */
function getTimeAgo(dateStr?: string): string {
  if (!dateStr) return 'recently';

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

/**
 * Format team activity as context for agent prompts
 * Shows what teammates have already contributed so agents don't repeat
 */
export function formatTeamActivityForAgent(
  activities: TeamActivity[],
  currentAgent: string
): string {
  if (!activities || activities.length === 0) {
    return '';
  }

  // Filter out current agent's own contributions
  const othersActivities = activities.filter(
    (a) => a.agent.toLowerCase() !== currentAgent.toLowerCase()
  );

  if (othersActivities.length === 0) {
    return '';
  }

  const lines: string[] = ['=== WHAT YOUR TEAMMATES HAVE ALREADY COVERED ==='];
  lines.push('DO NOT repeat what they already said. Add NEW value or stay quiet.\n');

  for (const activity of othersActivities) {
    const timeAgo = getTimeAgo(activity.created_at);
    const agentUpper = activity.agent.toUpperCase();

    lines.push(`${agentUpper} (${timeAgo}): ${activity.summary}`);

    if (activity.key_facts && activity.key_facts.length > 0) {
      lines.push(`  Key facts: ${activity.key_facts.slice(0, 3).join('; ')}`);
    }

    if (activity.recommendations && activity.recommendations.length > 0) {
      lines.push(`  Recommended: ${activity.recommendations[0]}`);
    }

    lines.push('');
  }

  lines.push('=== END TEAM CONTEXT ===\n');
  return lines.join('\n');
}

/**
 * Check if an agent has already contributed to a thread
 */
export async function hasAgentContributed(threadTs: string, agent: string): Promise<boolean> {
  try {
    const { count, error } = await getSupabase()
      .from('team_activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('thread_ts', threadTs)
      .ilike('agent', agent);

    if (error) return false;
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Get summary of what's been covered on an opportunity
 * Useful for preventing duplicate coverage
 */
export async function getActivitySummary(noticeId: string): Promise<{
  agents: string[];
  actionsCovered: string[];
  hasResearch: boolean;
  hasPartnerSearch: boolean;
  hasStrategy: boolean;
}> {
  try {
    const activities = await getOpportunityActivity(noticeId, 50);

    const agents = [...new Set(activities.map((a) => a.agent))];
    const actionsCovered = [...new Set(activities.map((a) => a.activity_type))];

    return {
      agents,
      actionsCovered,
      hasResearch: actionsCovered.includes('research') || actionsCovered.includes('analysis'),
      hasPartnerSearch: actionsCovered.includes('partner_search'),
      hasStrategy: actionsCovered.includes('strategy') || actionsCovered.includes('recommendation'),
    };
  } catch {
    return {
      agents: [],
      actionsCovered: [],
      hasResearch: false,
      hasPartnerSearch: false,
      hasStrategy: false,
    };
  }
}

/**
 * Get team activity summary for agent context (for workflow processor)
 * Returns formatted string of what teammates have already contributed
 */
export async function getTeamActivitySummary(threadTs: string): Promise<string> {
  const activities = await getThreadActivity(threadTs, 20);
  if (activities.length === 0) {
    return '';
  }

  const lines: string[] = ['=== TEAM ACTIVITY ON THIS OPPORTUNITY ==='];

  for (const activity of activities) {
    const timeAgo = getTimeAgo(activity.created_at);
    lines.push(`${activity.agent.toUpperCase()} (${timeAgo}): ${activity.summary}`);
    if (activity.key_facts && activity.key_facts.length > 0) {
      lines.push(`  Key facts: ${activity.key_facts.slice(0, 3).join('; ')}`);
    }
  }

  return lines.join('\n');
}
