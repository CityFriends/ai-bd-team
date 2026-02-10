import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Opportunity,
  Agency,
  Company,
  Outreach,
  ConversationThread,
  AgentQueueItem,
  AgentName,
  OpportunityStatus,
  Decision,
  QueueStatus,
} from '../types/index.js';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY');
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

// ============================================
// USER PROFILE FUNCTIONS
// ============================================

export interface UserProfile {
  id?: string;
  slack_user_id: string;
  user_name: string;
  display_name?: string;
  role?: string;
  background?: string;
  // Personalization preferences
  communication_style?: 'concise' | 'detailed' | 'balanced';
  topics_of_interest?: string[]; // e.g., ['VA', 'HCD', 'WOSB']
  agencies_focus?: string[]; // Agencies they care about most
  // Decision patterns (learned over time)
  decision_style?: 'cautious' | 'aggressive' | 'balanced';
  typical_concerns?: string[]; // What they usually ask about
  // Notification preferences
  notify_hot_opps?: boolean; // Notify for 80+ score opps
  notify_competitor_alerts?: boolean;
  quiet_hours_start?: string; // e.g., "18:00"
  quiet_hours_end?: string; // e.g., "08:00"
  timezone?: string; // e.g., "America/Chicago"
  // Interaction tracking
  total_interactions?: number;
  last_interaction_at?: string;
  favorite_agent?: string; // Which agent they interact with most
  // Agent notes
  agent_notes?: string; // Free-form notes from agents
  created_at?: string;
  updated_at?: string;
}

export interface UserInteraction {
  id?: string;
  slack_user_id: string;
  agent: string;
  interaction_type: 'question' | 'decision' | 'feedback' | 'command';
  topic?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  created_at?: string;
}

/**
 * Get user profile by Slack user ID
 * Returns the user's name and role so agents can address them properly
 */
export async function getUserProfile(slackUserId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .select('*')
      .eq('slack_user_id', slackUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Could not fetch user profile:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Could not fetch user profile:', err);
    return null;
  }
}

/**
 * Upsert a user profile
 */
export async function upsertUserProfile(profile: Partial<UserProfile>): Promise<UserProfile | null> {
  try {
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .upsert({
        ...profile,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'slack_user_id' })
      .select()
      .single();

    if (error) {
      console.error('Could not upsert user profile:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Could not upsert user profile:', err);
    return null;
  }
}

/**
 * Track a user interaction for learning preferences
 */
export async function trackUserInteraction(interaction: Omit<UserInteraction, 'id' | 'created_at'>): Promise<void> {
  try {
    // Log the interaction
    await getSupabase()
      .from('user_interactions')
      .insert({
        ...interaction,
        created_at: new Date().toISOString(),
      });

    // Update the user's interaction count and last interaction time
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('total_interactions, favorite_agent')
      .eq('slack_user_id', interaction.slack_user_id)
      .single();

    if (profile) {
      // Increment interaction count
      await getSupabase()
        .from('user_profiles')
        .update({
          total_interactions: (profile.total_interactions || 0) + 1,
          last_interaction_at: new Date().toISOString(),
        })
        .eq('slack_user_id', interaction.slack_user_id);
    }
  } catch (err) {
    // Silently fail - don't block on tracking
  }
}

/**
 * Get user's recent interaction topics to understand their interests
 */
export async function getUserTopics(slackUserId: string, limit: number = 20): Promise<string[]> {
  try {
    const { data, error } = await getSupabase()
      .from('user_interactions')
      .select('topic')
      .eq('slack_user_id', slackUserId)
      .not('topic', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // Count topic frequency
    const topicCounts: Record<string, number> = {};
    for (const row of data) {
      if (row.topic) {
        topicCounts[row.topic] = (topicCounts[row.topic] || 0) + 1;
      }
    }

    // Return topics sorted by frequency
    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);
  } catch {
    return [];
  }
}

/**
 * Format user profile for agent context
 * Gives agents info to personalize their responses
 */
export function formatUserProfileForAgent(profile: UserProfile | null): string {
  if (!profile) {
    return ''; // No profile data available
  }

  const lines: string[] = ['=== USER CONTEXT ==='];

  // Basic info
  lines.push(`User: ${profile.display_name || profile.user_name}`);
  if (profile.role) {
    lines.push(`Role: ${profile.role}`);
  }

  // Communication preferences
  if (profile.communication_style) {
    const styleGuide: Record<string, string> = {
      concise: 'Prefers brief, to-the-point responses',
      detailed: 'Prefers thorough explanations with context',
      balanced: 'Standard communication style',
    };
    lines.push(`Style: ${styleGuide[profile.communication_style]}`);
  }

  // Topics of interest
  if (profile.topics_of_interest && profile.topics_of_interest.length > 0) {
    lines.push(`Interests: ${profile.topics_of_interest.join(', ')}`);
  }

  // Agency focus
  if (profile.agencies_focus && profile.agencies_focus.length > 0) {
    lines.push(`Agency focus: ${profile.agencies_focus.join(', ')}`);
  }

  // Decision style
  if (profile.decision_style) {
    const decisionGuide: Record<string, string> = {
      cautious: 'Tends to want more research before deciding',
      aggressive: 'Prefers to move quickly on opportunities',
      balanced: 'Balanced approach to decisions',
    };
    lines.push(`Decision style: ${decisionGuide[profile.decision_style]}`);
  }

  // Typical concerns
  if (profile.typical_concerns && profile.typical_concerns.length > 0) {
    lines.push(`Usually asks about: ${profile.typical_concerns.join(', ')}`);
  }

  // Agent notes
  if (profile.agent_notes) {
    lines.push(`Notes: ${profile.agent_notes}`);
  }

  // Background
  if (profile.background) {
    lines.push(`Background: ${profile.background}`);
  }

  if (lines.length === 1) {
    return ''; // Only header, no actual data
  }

  lines.push('=== END USER CONTEXT ===\n');
  return lines.join('\n');
}

/**
 * Update user preferences based on observed behavior
 * Call this periodically to learn from interactions
 */
export async function learnUserPreferences(slackUserId: string): Promise<void> {
  try {
    // Get recent interactions
    const { data: interactions } = await getSupabase()
      .from('user_interactions')
      .select('topic, agent, interaction_type')
      .eq('slack_user_id', slackUserId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!interactions || interactions.length < 5) {
      return; // Not enough data to learn from
    }

    // Determine favorite agent
    const agentCounts: Record<string, number> = {};
    for (const i of interactions) {
      if (i.agent) {
        agentCounts[i.agent] = (agentCounts[i.agent] || 0) + 1;
      }
    }
    const favoriteAgent = Object.entries(agentCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Determine topics of interest from interactions
    const topicCounts: Record<string, number> = {};
    for (const i of interactions) {
      if (i.topic) {
        topicCounts[i.topic] = (topicCounts[i.topic] || 0) + 1;
      }
    }
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    // Update profile with learned preferences
    await getSupabase()
      .from('user_profiles')
      .update({
        favorite_agent: favoriteAgent,
        topics_of_interest: topTopics.length > 0 ? topTopics : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('slack_user_id', slackUserId);

  } catch (err) {
    console.warn('Could not learn user preferences:', err);
  }
}

// ============================================
// TEAM ACTIVITY LOG FUNCTIONS
// ============================================

export interface TeamActivity {
  id?: string;
  thread_ts?: string; // Slack thread timestamp
  notice_id?: string; // SAM.gov notice ID
  channel_id?: string;
  agent: string;
  action_type: 'research' | 'analysis' | 'recommendation' | 'question' | 'partner_search' | 'strategy' | 'alert';
  summary: string; // 1-2 sentence summary of contribution
  key_facts?: string[]; // Specific facts/data points provided
  recommendations?: string[]; // Any recommendations made
  sentiment?: 'positive' | 'negative' | 'neutral' | 'cautious';
  created_at?: string;
}

/**
 * Log an agent's contribution to a thread
 * This enables other agents to see what's already been covered
 */
export async function logTeamActivity(activity: Omit<TeamActivity, 'id' | 'created_at'>): Promise<TeamActivity | null> {
  try {
    const { data, error } = await getSupabase()
      .from('team_activity_log')
      .insert({
        ...activity,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.warn('Could not log team activity:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Could not log team activity:', err);
    return null;
  }
}

/**
 * Get recent team activity for a thread
 * Returns what other agents have already contributed
 */
export async function getThreadActivity(threadTs: string, limit: number = 10): Promise<TeamActivity[]> {
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
    return data || [];
  } catch (err) {
    console.warn('Could not fetch thread activity:', err);
    return [];
  }
}

/**
 * Get recent team activity for an opportunity by notice ID
 */
export async function getOpportunityActivity(noticeId: string, limit: number = 10): Promise<TeamActivity[]> {
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
 * Format team activity as context for agent prompts
 * Shows what teammates have already contributed so agents don't repeat
 */
export function formatTeamActivityForAgent(activities: TeamActivity[], currentAgent: string): string {
  if (!activities || activities.length === 0) {
    return '';
  }

  // Filter out current agent's own contributions
  const othersActivities = activities.filter(a => a.agent.toLowerCase() !== currentAgent.toLowerCase());

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

    const agents = [...new Set(activities.map(a => a.agent))];
    const actionsCovered = [...new Set(activities.map(a => a.action_type))];

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

// Opportunity operations
export async function createOpportunity(opportunity: Partial<Opportunity>): Promise<Opportunity> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .insert(opportunity)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getOpportunityBySamId(samId: string): Promise<Opportunity | null> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .eq('sam_id', samId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateOpportunity(id: string, updates: Partial<Opportunity>): Promise<Opportunity> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOpportunitiesByStatus(status: OpportunityStatus): Promise<Opportunity[]> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getActiveOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .in('status', ['new', 'researching', 'pursuing'])
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function setOpportunityDecision(
  id: string,
  decision: Decision
): Promise<Opportunity> {
  return updateOpportunity(id, {
    decision,
    decision_date: new Date().toISOString(),
    status: decision === 'go' ? 'pursuing' : decision === 'no_go' ? 'passed' : 'researching',
  });
}

// Agency operations
export async function getAgency(abbreviation: string): Promise<Agency | null> {
  const { data, error } = await getSupabase()
    .from('agencies')
    .select()
    .eq('abbreviation', abbreviation)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function upsertAgency(agency: Partial<Agency>): Promise<Agency> {
  const { data, error } = await getSupabase()
    .from('agencies')
    .upsert(agency, { onConflict: 'abbreviation' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Company operations
export async function createCompany(company: Partial<Company>): Promise<Company> {
  const { data, error } = await getSupabase()
    .from('companies')
    .insert(company)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getCompany(id: string): Promise<Company | null> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function searchCompaniesByCapabilities(keywords: string[]): Promise<Company[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .or(keywords.map(k => `capabilities.ilike.%${k}%`).join(','));

  if (error) throw error;
  return data || [];
}

export async function searchCompaniesByNaics(naicsCodes: string[]): Promise<Company[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .overlaps('naics_codes', naicsCodes);

  if (error) throw error;
  return data || [];
}

export async function updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
  const { data, error } = await getSupabase()
    .from('companies')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Outreach operations
export async function createOutreach(outreach: Partial<Outreach>): Promise<Outreach> {
  const { data, error } = await getSupabase()
    .from('outreach')
    .insert(outreach)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateOutreach(id: string, updates: Partial<Outreach>): Promise<Outreach> {
  const { data, error } = await getSupabase()
    .from('outreach')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOutreachByOpportunity(opportunityId: string): Promise<Outreach[]> {
  const { data, error } = await getSupabase()
    .from('outreach')
    .select()
    .eq('opportunity_id', opportunityId);

  if (error) throw error;
  return data || [];
}

// Conversation thread operations
export async function createThread(thread: Partial<ConversationThread>): Promise<ConversationThread> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .insert(thread)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getThreadBySlackTs(threadTs: string): Promise<ConversationThread | null> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .select()
    .eq('slack_thread_ts', threadTs)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateThread(id: string, updates: Partial<ConversationThread>): Promise<ConversationThread> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Agent queue operations
export async function queueAgentTask(
  agent: AgentName,
  action: string,
  scheduledFor: Date,
  payload: Record<string, unknown> = {},
  opportunityId?: string,
  threadTs?: string
): Promise<AgentQueueItem> {
  const { data, error } = await getSupabase()
    .from('agent_queue')
    .insert({
      agent,
      action,
      scheduled_for: scheduledFor.toISOString(),
      payload,
      opportunity_id: opportunityId,
      thread_ts: threadTs,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPendingTasks(): Promise<AgentQueueItem[]> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from('agent_queue')
    .select()
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function updateTaskStatus(
  id: string,
  status: QueueStatus,
  result?: unknown
): Promise<AgentQueueItem> {
  const updates: Partial<AgentQueueItem> = { status };

  if (status === 'running') {
    updates.started_at = new Date().toISOString();
  } else if (status === 'completed' || status === 'failed') {
    updates.completed_at = new Date().toISOString();
    if (result !== undefined) {
      updates.result = result;
    }
  }

  const { data, error } = await getSupabase()
    .from('agent_queue')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function cancelTask(id: string): Promise<AgentQueueItem> {
  return updateTaskStatus(id, 'cancelled');
}

// Agent memory operations - for logging sources and confidence
export interface AgentMemoryEntry {
  agent: string;
  message_ts: string;
  thread_ts?: string;
  response_text: string;
  sources: string[];
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export async function logAgentMemory(entry: AgentMemoryEntry): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from('agent_memory')
      .insert({
        ...entry,
        created_at: new Date().toISOString(),
      });

    if (error) {
      // Table might not exist yet, log but don't throw
      console.warn('Could not log to agent_memory:', error.message);
    }
  } catch (err) {
    console.warn('Could not log to agent_memory:', err);
  }
}

export async function getAgentMemory(
  agent: string,
  limit: number = 20
): Promise<AgentMemoryEntry[]> {
  const { data, error } = await getSupabase()
    .from('agent_memory')
    .select()
    .eq('agent', agent)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Could not read agent_memory:', error.message);
    return [];
  }
  return data || [];
}

// Message coordination - prevent multiple agents responding to same message
export interface MessageClaim {
  message_ts: string;
  thread_ts?: string;
  agent: string;
  claimed_at: string;
  responded: boolean;
}

export async function claimMessage(
  messageTs: string,
  agent: string,
  threadTs?: string
): Promise<boolean> {
  try {
    // Try to insert a claim - will fail if message already claimed
    const { error } = await getSupabase()
      .from('message_claims')
      .insert({
        message_ts: messageTs,
        thread_ts: threadTs,
        agent,
        claimed_at: new Date().toISOString(),
        responded: false,
      });

    if (error) {
      // Unique constraint violation = already claimed
      if (error.code === '23505') {
        return false;
      }
      // Table might not exist - allow response
      console.warn('Could not claim message:', error.message);
      return true;
    }
    return true;
  } catch (err) {
    console.warn('Could not claim message:', err);
    return true; // Allow response if claiming fails
  }
}

export async function getMessageClaim(messageTs: string): Promise<MessageClaim | null> {
  try {
    const { data, error } = await getSupabase()
      .from('message_claims')
      .select()
      .eq('message_ts', messageTs)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function markMessageResponded(messageTs: string, agent: string): Promise<void> {
  try {
    await getSupabase()
      .from('message_claims')
      .update({ responded: true })
      .eq('message_ts', messageTs)
      .eq('agent', agent);
  } catch (err) {
    console.warn('Could not mark message responded:', err);
  }
}

// Get recent responses in a thread (to check if another agent just responded)
export async function getRecentThreadResponses(
  threadTs: string,
  withinSeconds: number = 30
): Promise<AgentMemoryEntry[]> {
  const since = new Date(Date.now() - withinSeconds * 1000).toISOString();

  try {
    const { data, error } = await getSupabase()
      .from('agent_memory')
      .select()
      .eq('thread_ts', threadTs)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ============================================
// CONVERSATIONAL MEMORY FUNCTIONS
// ============================================

// User context (personal info about Lapedra/Tamara)
export interface UserContext {
  id?: string;
  user_name: string;
  context_type: 'personal' | 'preference' | 'pattern' | 'family' | 'mood';
  content: string;
  mentioned_by?: string;
  still_relevant?: boolean;
}

export async function saveUserContext(context: UserContext): Promise<void> {
  try {
    await getSupabase().from('user_context').insert({
      ...context,
      mentioned_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not save user context:', err);
  }
}

export async function getUserContext(userName: string, limit: number = 10): Promise<UserContext[]> {
  try {
    const { data, error } = await getSupabase()
      .from('user_context')
      .select()
      .eq('user_name', userName)
      .eq('still_relevant', true)
      .order('mentioned_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Conversation memory (key moments)
export interface ConversationMemory {
  id?: string;
  memory_type: 'milestone' | 'decision' | 'joke' | 'frustration' | 'win' | 'loss';
  summary: string;
  full_context?: string;
  participants?: string[];
  importance?: number;
}

export async function saveConversationMemory(memory: ConversationMemory): Promise<void> {
  try {
    await getSupabase().from('conversation_memory').insert({
      ...memory,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not save conversation memory:', err);
  }
}

export async function getConversationMemories(limit: number = 10): Promise<ConversationMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('conversation_memory')
      .select()
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Inside jokes
export interface InsideJoke {
  id?: string;
  reference: string;
  full_context: string;
  origin_story?: string;
  times_used?: number;
}

export async function saveInsideJoke(joke: InsideJoke): Promise<void> {
  try {
    await getSupabase().from('inside_jokes').insert({
      ...joke,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not save inside joke:', err);
  }
}

export async function getInsideJokes(limit: number = 5): Promise<InsideJoke[]> {
  try {
    const { data, error } = await getSupabase()
      .from('inside_jokes')
      .select()
      .order('times_used', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function incrementJokeUsage(reference: string): Promise<void> {
  try {
    const { data } = await getSupabase()
      .from('inside_jokes')
      .select('times_used')
      .eq('reference', reference)
      .single();

    if (data) {
      await getSupabase()
        .from('inside_jokes')
        .update({ times_used: (data.times_used || 0) + 1, last_used: new Date().toISOString() })
        .eq('reference', reference);
    }
  } catch {
    // ignore
  }
}

// Decision patterns
export interface DecisionPattern {
  decision: 'go' | 'no_go' | 'passed';
  reasoning?: string;
  agency?: string;
  opportunity_type?: string;
  key_factors?: string[];
}

export async function saveDecisionPattern(pattern: DecisionPattern): Promise<void> {
  try {
    await getSupabase().from('decision_patterns').insert({
      ...pattern,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not save decision pattern:', err);
  }
}

export async function getDecisionPatterns(limit: number = 10): Promise<DecisionPattern[]> {
  try {
    const { data, error } = await getSupabase()
      .from('decision_patterns')
      .select()
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get all context for conversation (combines everything)
export async function getConversationalContext(): Promise<{
  userContext: UserContext[];
  memories: ConversationMemory[];
  insideJokes: InsideJoke[];
  decisionPatterns: DecisionPattern[];
}> {
  const [userContext, memories, insideJokes, decisionPatterns] = await Promise.all([
    getUserContext('lapedra', 5),
    getConversationMemories(5),
    getInsideJokes(3),
    getDecisionPatterns(5),
  ]);

  return { userContext, memories, insideJokes, decisionPatterns };
}

// ============================================
// COMPETITOR INTEL FUNCTIONS
// ============================================

export interface CompetitorIntel {
  id?: string;
  company_name: string;
  agency_code?: string;
  intel_type: 'protest' | 'performance' | 'award' | 'debarment' | 'general';
  summary: string;
  source_url?: string;
  source_name?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  discovered_by?: string;
  still_relevant?: boolean;
  discovered_at?: string;
}

// Save competitor intel
export async function saveCompetitorIntel(intel: CompetitorIntel): Promise<void> {
  try {
    await getSupabase().from('competitor_intel').insert({
      ...intel,
      discovered_at: new Date().toISOString(),
      still_relevant: true,
    });
    console.log(`Saved competitor intel: ${intel.company_name} - ${intel.intel_type}`);
  } catch (err) {
    console.warn('Could not save competitor intel:', err);
  }
}

// Get intel for a specific company
export async function getCompetitorIntel(
  companyName: string,
  limit: number = 10
): Promise<CompetitorIntel[]> {
  try {
    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select()
      .ilike('company_name', `%${companyName}%`)
      .eq('still_relevant', true)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get intel for companies at a specific agency
export async function getCompetitorIntelByAgency(
  agencyCode: string,
  limit: number = 20
): Promise<CompetitorIntel[]> {
  try {
    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select()
      .eq('agency_code', agencyCode)
      .eq('still_relevant', true)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Check if we already have recent intel on a company
export async function hasRecentIntel(companyName: string, daysBack: number = 7): Promise<boolean> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select('id')
      .ilike('company_name', `%${companyName}%`)
      .gte('discovered_at', since)
      .limit(1);

    if (error) return false;
    return (data || []).length > 0;
  } catch {
    return false;
  }
}

// Mark intel as no longer relevant
export async function markIntelStale(intelId: string): Promise<void> {
  try {
    await getSupabase()
      .from('competitor_intel')
      .update({ still_relevant: false })
      .eq('id', intelId);
  } catch (err) {
    console.warn('Could not mark intel stale:', err);
  }
}

// Get recent intel across all competitors (for proactive monitoring)
export async function getRecentCompetitorIntel(
  daysBack: number = 7,
  limit: number = 20
): Promise<CompetitorIntel[]> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select()
      .gte('discovered_at', since)
      .eq('still_relevant', true)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ============================================
// System Feedback
// ============================================

export interface SystemFeedback {
  id?: string;
  date?: string;
  agent: string;
  feedback_type: 'bug' | 'wrong_answer' | 'great_catch' | 'suggestion' | 'annoying' | 'missing_info';
  what_happened: string;
  what_should_happen?: string;
  severity?: 'minor' | 'medium' | 'major';
  resolved?: boolean;
  resolution?: string;
  slack_ts?: string;
  created_at?: string;
}

export async function logFeedback(feedback: Omit<SystemFeedback, 'id' | 'created_at'>): Promise<SystemFeedback | null> {
  try {
    const { data, error } = await getSupabase()
      .from('system_feedback')
      .insert({
        ...feedback,
        date: new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to log feedback:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Feedback logging error:', err);
    return null;
  }
}

export async function getUnresolvedFeedback(): Promise<SystemFeedback[]> {
  try {
    const { data, error } = await getSupabase()
      .from('system_feedback')
      .select()
      .eq('resolved', false)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function getFeedbackSummary(daysBack: number = 7): Promise<{
  total: number;
  byType: Record<string, number>;
  byAgent: Record<string, number>;
  unresolved: number;
}> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data, error } = await getSupabase()
      .from('system_feedback')
      .select()
      .gte('date', since);

    if (error || !data) {
      return { total: 0, byType: {}, byAgent: {}, unresolved: 0 };
    }

    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let unresolved = 0;

    for (const fb of data) {
      byType[fb.feedback_type] = (byType[fb.feedback_type] || 0) + 1;
      if (fb.agent) {
        byAgent[fb.agent] = (byAgent[fb.agent] || 0) + 1;
      }
      if (!fb.resolved) unresolved++;
    }

    return { total: data.length, byType, byAgent, unresolved };
  } catch {
    return { total: 0, byType: {}, byAgent: {}, unresolved: 0 };
  }
}

export async function resolveFeedback(id: string, resolution: string): Promise<boolean> {
  try {
    const { error } = await getSupabase()
      .from('system_feedback')
      .update({ resolved: true, resolution })
      .eq('id', id);

    return !error;
  } catch {
    return false;
  }
}

// ============================================
// PERSISTENT THREAD PARTICIPATION
// ============================================

export interface ThreadParticipation {
  id?: string;
  agent: string;
  thread_ts: string;
  channel_id?: string;
  first_response_at?: string;
  last_response_at?: string;
  response_count?: number;
}

/**
 * Record that an agent participated in a thread
 */
export async function recordThreadParticipation(
  agent: string,
  threadTs: string,
  channelId?: string
): Promise<void> {
  try {
    // Try to upsert - increment count if exists, create if not
    const { data: existing } = await getSupabase()
      .from('agent_thread_participation')
      .select('id, response_count')
      .eq('agent', agent)
      .eq('thread_ts', threadTs)
      .single();

    if (existing) {
      // Update existing participation
      await getSupabase()
        .from('agent_thread_participation')
        .update({
          last_response_at: new Date().toISOString(),
          response_count: (existing.response_count || 1) + 1,
        })
        .eq('id', existing.id);
    } else {
      // Create new participation record
      await getSupabase()
        .from('agent_thread_participation')
        .insert({
          agent,
          thread_ts: threadTs,
          channel_id: channelId,
          first_response_at: new Date().toISOString(),
          last_response_at: new Date().toISOString(),
          response_count: 1,
        });
    }
  } catch (err) {
    console.warn('Could not record thread participation:', err);
  }
}

/**
 * Get threads an agent has participated in recently
 */
export async function getAgentThreads(
  agent: string,
  options: { hours?: number; limit?: number } = {}
): Promise<ThreadParticipation[]> {
  const { hours = 72, limit = 100 } = options;

  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('agent_thread_participation')
      .select('*')
      .eq('agent', agent)
      .gte('last_response_at', since)
      .order('last_response_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('Could not get agent threads:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Could not get agent threads:', err);
    return [];
  }
}

/**
 * Check if an agent has participated in a specific thread
 */
export async function hasParticipatedInThread(
  agent: string,
  threadTs: string
): Promise<boolean> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_thread_participation')
      .select('id')
      .eq('agent', agent)
      .eq('thread_ts', threadTs)
      .single();

    return !error && !!data;
  } catch {
    return false;
  }
}

// ============================================
// AGENT HANDOFFS
// ============================================

export interface AgentHandoff {
  id?: string;
  from_agent: string;
  to_agent: string;
  thread_ts: string;
  context_summary: string;
  user_intent?: string;
  relevant_facts?: string[];
  open_questions?: string[];
  recommended_action?: string;
  acknowledged?: boolean;
  acknowledged_at?: string;
  created_at?: string;
}

/**
 * Create a handoff from one agent to another
 */
export async function createHandoff(handoff: Omit<AgentHandoff, 'id' | 'created_at'>): Promise<AgentHandoff | null> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_handoffs')
      .insert({
        ...handoff,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Could not create handoff:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not create handoff:', err);
    return null;
  }
}

/**
 * Get pending handoffs for an agent
 */
export async function getPendingHandoffs(
  toAgent: string,
  threadTs?: string
): Promise<AgentHandoff[]> {
  try {
    let query = getSupabase()
      .from('agent_handoffs')
      .select('*')
      .eq('to_agent', toAgent)
      .eq('acknowledged', false)
      .order('created_at', { ascending: false });

    if (threadTs) {
      query = query.eq('thread_ts', threadTs);
    }

    const { data, error } = await query.limit(10);

    if (error) {
      console.warn('Could not get pending handoffs:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Could not get pending handoffs:', err);
    return [];
  }
}

/**
 * Acknowledge a handoff
 */
export async function acknowledgeHandoff(handoffId: string): Promise<void> {
  try {
    await getSupabase()
      .from('agent_handoffs')
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', handoffId);
  } catch (err) {
    console.warn('Could not acknowledge handoff:', err);
  }
}

// ============================================
// AGENT FEEDBACK TRACKING
// ============================================

export interface AgentFeedback {
  id?: string;
  agent: string;
  message_ts: string;
  thread_ts?: string;
  feedback_type: 'reaction_positive' | 'reaction_negative' | 'rephrased_question' | 'follow_up';
  reaction_emoji?: string;
  original_response?: string;
  user_follow_up?: string;
  similarity_score?: number;
  created_at?: string;
}

/**
 * Record feedback on an agent response
 */
export async function recordAgentFeedback(feedback: Omit<AgentFeedback, 'id' | 'created_at'>): Promise<void> {
  try {
    await getSupabase()
      .from('agent_feedback')
      .upsert({
        ...feedback,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'message_ts,feedback_type,reaction_emoji',
        ignoreDuplicates: true,
      });
  } catch (err) {
    console.warn('Could not record agent feedback:', err);
  }
}

/**
 * Get feedback statistics for an agent
 */
export async function getAgentFeedbackStats(
  agent: string,
  daysBack: number = 7
): Promise<{
  positiveReactions: number;
  negativeReactions: number;
  rephrasedQuestions: number;
  followUps: number;
}> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('agent_feedback')
      .select('feedback_type')
      .eq('agent', agent)
      .gte('created_at', since);

    if (error || !data) {
      return { positiveReactions: 0, negativeReactions: 0, rephrasedQuestions: 0, followUps: 0 };
    }

    const stats = {
      positiveReactions: 0,
      negativeReactions: 0,
      rephrasedQuestions: 0,
      followUps: 0,
    };

    for (const fb of data) {
      if (fb.feedback_type === 'reaction_positive') stats.positiveReactions++;
      else if (fb.feedback_type === 'reaction_negative') stats.negativeReactions++;
      else if (fb.feedback_type === 'rephrased_question') stats.rephrasedQuestions++;
      else if (fb.feedback_type === 'follow_up') stats.followUps++;
    }

    return stats;
  } catch {
    return { positiveReactions: 0, negativeReactions: 0, rephrasedQuestions: 0, followUps: 0 };
  }
}

// ============================================
// EXTRACTED FACTS
// ============================================

export interface ExtractedFact {
  id?: string;
  fact_type: 'preference' | 'decision' | 'context' | 'pattern';
  subject?: string;
  content: string;
  source_thread_ts?: string;
  source_message_ts?: string;
  extracted_by: string;
  confidence?: number;
  embedding?: string;
  verified?: boolean;
  still_relevant?: boolean;
  expires_at?: string;
  created_at?: string;
}

/**
 * Save an extracted fact with optional embedding
 */
export async function saveExtractedFact(
  fact: Omit<ExtractedFact, 'id' | 'created_at'>,
  embedding?: number[]
): Promise<ExtractedFact | null> {
  try {
    const insertData: any = {
      ...fact,
      created_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    const { data, error } = await getSupabase()
      .from('extracted_facts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Could not save extracted fact:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not save extracted fact:', err);
    return null;
  }
}

/**
 * Get extracted facts by type and subject
 */
export async function getExtractedFacts(
  options: { factType?: string; subject?: string; limit?: number } = {}
): Promise<ExtractedFact[]> {
  const { factType, subject, limit = 20 } = options;

  try {
    let query = getSupabase()
      .from('extracted_facts')
      .select('*')
      .eq('still_relevant', true)
      .order('created_at', { ascending: false });

    if (factType) {
      query = query.eq('fact_type', factType);
    }
    if (subject) {
      query = query.eq('subject', subject);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      console.warn('Could not get extracted facts:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Could not get extracted facts:', err);
    return [];
  }
}

// ============================================
// THREAD SUMMARIES
// ============================================

export interface ThreadSummary {
  id?: string;
  thread_ts: string;
  channel_id?: string;
  summary: string;
  message_count: number;
  summarized_up_to_ts?: string;
  participants?: string[];
  key_topics?: string[];
  embedding?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Save or update a thread summary
 */
export async function saveThreadSummary(
  summary: Omit<ThreadSummary, 'id' | 'created_at' | 'updated_at'>,
  embedding?: number[]
): Promise<ThreadSummary | null> {
  try {
    const upsertData: any = {
      ...summary,
      updated_at: new Date().toISOString(),
    };

    if (embedding) {
      upsertData.embedding = `[${embedding.join(',')}]`;
    }

    const { data, error } = await getSupabase()
      .from('thread_summaries')
      .upsert(upsertData, {
        onConflict: 'thread_ts',
      })
      .select()
      .single();

    if (error) {
      console.error('Could not save thread summary:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not save thread summary:', err);
    return null;
  }
}

/**
 * Get a thread summary by thread timestamp
 */
export async function getThreadSummary(threadTs: string): Promise<ThreadSummary | null> {
  try {
    const { data, error } = await getSupabase()
      .from('thread_summaries')
      .select('*')
      .eq('thread_ts', threadTs)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// ============================================
// SAVE WITH EMBEDDINGS (Enhanced versions)
// ============================================

/**
 * Save user context with embedding for semantic search
 */
export async function saveUserContextWithEmbedding(
  context: UserContext,
  embedding?: number[]
): Promise<void> {
  try {
    const insertData: any = {
      ...context,
      mentioned_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    await getSupabase().from('user_context').insert(insertData);
  } catch (err) {
    console.warn('Could not save user context:', err);
  }
}

/**
 * Save conversation memory with embedding for semantic search
 */
export async function saveConversationMemoryWithEmbedding(
  memory: ConversationMemory,
  embedding?: number[]
): Promise<void> {
  try {
    const insertData: any = {
      ...memory,
      created_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    await getSupabase().from('conversation_memory').insert(insertData);
  } catch (err) {
    console.warn('Could not save conversation memory:', err);
  }
}

/**
 * Save decision pattern with embedding for semantic search
 */
export async function saveDecisionPatternWithEmbedding(
  pattern: DecisionPattern,
  embedding?: number[]
): Promise<void> {
  try {
    const insertData: any = {
      ...pattern,
      created_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    await getSupabase().from('decision_patterns').insert(insertData);
  } catch (err) {
    console.warn('Could not save decision pattern:', err);
  }
}

// ============================================
// OPPORTUNITY WORKFLOW FUNCTIONS
// ============================================

export type WorkflowStage =
  | 'found'
  | 'researching'
  | 'partner_search'
  | 'strategy'
  | 'decision'
  | 'pursuing'
  | 'passed';

export interface OpportunityWorkflow {
  id?: string;
  notice_id: string;
  title: string;
  sam_url?: string;
  agency?: string;
  score?: number;
  stage: WorkflowStage;
  agent_responsible?: string;
  auto_action_at?: string;
  awaiting_input_from?: 'lapedra' | 'tamara' | 'auto' | null;
  channel_id?: string;
  thread_ts?: string;
  incumbent?: string;
  incumbent_contract_value?: string;
  red_flags?: string[];
  teaming_recommended?: boolean;
  teaming_partners?: string[];
  james_recommendation?: 'GO' | 'PASS' | 'NEEDS_DISCUSSION';
  decision?: 'go' | 'pass' | 'hold';
  decision_by?: string;
  decision_at?: string;
  decision_notes?: string;
  created_at?: string;
  updated_at?: string;
  stage_entered_at?: string;
}

/**
 * Create a new opportunity workflow entry
 */
export async function createOpportunityWorkflow(
  workflow: Omit<OpportunityWorkflow, 'id' | 'created_at' | 'updated_at' | 'stage_entered_at'>
): Promise<OpportunityWorkflow | null> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .insert({
        ...workflow,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stage_entered_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Could not create workflow:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not create workflow:', err);
    return null;
  }
}

/**
 * Get workflow by notice ID
 */
export async function getWorkflowByNoticeId(noticeId: string): Promise<OpportunityWorkflow | null> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .eq('notice_id', noticeId)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Update workflow (stage transition or data update)
 */
export async function updateOpportunityWorkflow(
  noticeId: string,
  updates: Partial<OpportunityWorkflow>
): Promise<OpportunityWorkflow | null> {
  try {
    const updateData: any = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    // If stage is changing, update stage_entered_at
    if (updates.stage) {
      updateData.stage_entered_at = new Date().toISOString();
    }

    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .update(updateData)
      .eq('notice_id', noticeId)
      .select()
      .single();

    if (error) {
      console.error('Could not update workflow:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not update workflow:', err);
    return null;
  }
}

/**
 * Get workflows that need automatic action (auto_action_at has passed)
 */
export async function getWorkflowsNeedingAction(): Promise<OpportunityWorkflow[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .lte('auto_action_at', now)
      .not('stage', 'in', '("pursuing","passed","decision")')
      .order('auto_action_at', { ascending: true });

    if (error) {
      console.warn('Could not get workflows needing action:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Could not get workflows needing action:', err);
    return [];
  }
}

/**
 * Get workflows by stage
 */
export async function getWorkflowsByStage(stage: WorkflowStage): Promise<OpportunityWorkflow[]> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .eq('stage', stage)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Get workflows awaiting human input
 */
export async function getWorkflowsAwaitingHuman(): Promise<OpportunityWorkflow[]> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .not('awaiting_input_from', 'is', null)
      .neq('awaiting_input_from', 'auto')
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Record stage transition history
 */
export async function recordStageTransition(
  workflowId: string,
  fromStage: WorkflowStage | null,
  toStage: WorkflowStage,
  triggeredBy: string,
  reason?: string
): Promise<void> {
  try {
    await getSupabase()
      .from('workflow_stage_history')
      .insert({
        workflow_id: workflowId,
        from_stage: fromStage,
        to_stage: toStage,
        triggered_by: triggeredBy,
        trigger_reason: reason,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not record stage transition:', err);
  }
}

// ============================================
// DECISION OUTCOME TRACKING
// ============================================

export interface DecisionOutcome {
  id?: string;
  notice_id?: string;
  opportunity_title?: string;
  workflow_id?: string;
  james_recommendation?: 'GO' | 'PASS' | 'NEEDS_DISCUSSION';
  david_red_flags?: string[];
  rosa_teaming_suggested?: boolean;
  human_decision?: 'go' | 'pass';
  decision_by?: string;
  outcome?: 'won' | 'lost' | 'no_bid' | 'withdrawn';
  outcome_notes?: string;
  recommended_at?: string;
  decided_at?: string;
  outcome_recorded_at?: string;
  created_at?: string;
}

/**
 * Record a decision outcome for learning
 */
export async function recordDecisionOutcome(outcome: Omit<DecisionOutcome, 'id' | 'created_at'>): Promise<void> {
  try {
    await getSupabase()
      .from('decision_outcomes')
      .insert({
        ...outcome,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not record decision outcome:', err);
  }
}

/**
 * Get accuracy stats for agent recommendations
 */
export async function getRecommendationAccuracy(): Promise<{
  goRecommendations: { total: number; won: number; lost: number };
  passRecommendations: { total: number; correct: number };
}> {
  try {
    const { data, error } = await getSupabase()
      .from('decision_outcomes')
      .select('james_recommendation, human_decision, outcome')
      .not('outcome', 'is', null);

    if (error || !data) {
      return {
        goRecommendations: { total: 0, won: 0, lost: 0 },
        passRecommendations: { total: 0, correct: 0 },
      };
    }

    const stats = {
      goRecommendations: { total: 0, won: 0, lost: 0 },
      passRecommendations: { total: 0, correct: 0 },
    };

    for (const record of data) {
      if (record.james_recommendation === 'GO' && record.human_decision === 'go') {
        stats.goRecommendations.total++;
        if (record.outcome === 'won') stats.goRecommendations.won++;
        if (record.outcome === 'lost') stats.goRecommendations.lost++;
      }

      if (record.james_recommendation === 'PASS') {
        stats.passRecommendations.total++;
        if (record.human_decision === 'pass') {
          stats.passRecommendations.correct++;
        }
      }
    }

    return stats;
  } catch {
    return {
      goRecommendations: { total: 0, won: 0, lost: 0 },
      passRecommendations: { total: 0, correct: 0 },
    };
  }
}

// ============================================
// RELATIONSHIP MEMORY (Rosa)
// ============================================

export interface PartnerCompany {
  id?: string;
  company_name: string;
  duns_number?: string;
  cage_code?: string;
  // Certifications
  certifications: string[]; // '8a', 'WOSB', 'SDVOSB', 'HUBZone', 'SB'
  naics_codes?: string[];
  // Capabilities
  capabilities: string[];
  past_performance_agencies?: string[]; // Agencies they've worked with
  // Relationship status
  relationship_status: 'prospect' | 'contacted' | 'active_partner' | 'past_partner' | 'do_not_use';
  relationship_notes?: string;
  // Metadata
  last_teamed_date?: string;
  teaming_history_count?: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  // Source
  added_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TeamingInteraction {
  id?: string;
  partner_id?: string;
  partner_name: string;
  opportunity_id?: string;
  opportunity_title?: string;
  // Interaction details
  interaction_type: 'teaming_discussion' | 'proposal_submitted' | 'won_together' | 'lost_together' | 'declined' | 'general';
  outcome?: 'positive' | 'negative' | 'neutral' | 'pending';
  notes?: string;
  // Metadata
  interaction_date: string;
  logged_by?: string;
  created_at?: string;
}

// Save or update a partner company
export async function savePartnerCompany(partner: Omit<PartnerCompany, 'id' | 'created_at'>): Promise<PartnerCompany | null> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .upsert({
        ...partner,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_name' })
      .select()
      .single();

    if (error) {
      console.error('Failed to save partner:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Partner save error:', err);
    return null;
  }
}

// Get partner by name
export async function getPartnerByName(companyName: string): Promise<PartnerCompany | null> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .ilike('company_name', `%${companyName}%`)
      .limit(1)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// Search partners by certification
export async function searchPartnersByCertification(certification: string): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .contains('certifications', [certification])
      .neq('relationship_status', 'do_not_use')
      .order('teaming_history_count', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Search partners by capability
export async function searchPartnersByCapability(capability: string): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .or(`capabilities.cs.{${capability}},capabilities.cs.{${capability.toLowerCase()}}`)
      .neq('relationship_status', 'do_not_use')
      .order('teaming_history_count', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Search partners by agency experience
export async function searchPartnersByAgency(agencyCode: string): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .contains('past_performance_agencies', [agencyCode])
      .neq('relationship_status', 'do_not_use')
      .order('teaming_history_count', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get all active partners
export async function getActivePartners(): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .in('relationship_status', ['active_partner', 'past_partner', 'contacted'])
      .order('last_teamed_date', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Log a teaming interaction
export async function logTeamingInteraction(interaction: Omit<TeamingInteraction, 'id' | 'created_at'>): Promise<TeamingInteraction | null> {
  try {
    const { data, error } = await getSupabase()
      .from('teaming_interactions')
      .insert({
        ...interaction,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to log teaming interaction:', error);
      return null;
    }

    // Update partner's teaming history count
    if (interaction.partner_id) {
      await getSupabase()
        .from('partner_companies')
        .update({
          teaming_history_count: getSupabase().rpc('increment_field', { field_name: 'teaming_history_count', row_id: interaction.partner_id }),
          last_teamed_date: interaction.interaction_date,
        })
        .eq('id', interaction.partner_id);
    }

    return data;
  } catch (err) {
    console.error('Teaming interaction error:', err);
    return null;
  }
}

// Get teaming history for a partner
export async function getTeamingHistory(partnerName: string, limit: number = 10): Promise<TeamingInteraction[]> {
  try {
    const { data, error } = await getSupabase()
      .from('teaming_interactions')
      .select()
      .ilike('partner_name', `%${partnerName}%`)
      .order('interaction_date', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get partners we've worked with on similar opportunities
export async function getPartnersForOpportunity(params: {
  agencyCode?: string;
  certificationNeeded?: string;
  capabilitiesNeeded?: string[];
}): Promise<PartnerCompany[]> {
  try {
    let query = getSupabase()
      .from('partner_companies')
      .select()
      .neq('relationship_status', 'do_not_use');

    // Filter by agency experience if provided
    if (params.agencyCode) {
      query = query.contains('past_performance_agencies', [params.agencyCode]);
    }

    // Filter by certification if needed
    if (params.certificationNeeded) {
      query = query.contains('certifications', [params.certificationNeeded]);
    }

    const { data, error } = await query
      .order('teaming_history_count', { ascending: false, nullsFirst: false })
      .limit(10);

    if (error) return [];

    // If capabilities needed, filter further
    let results = data || [];
    if (params.capabilitiesNeeded && params.capabilitiesNeeded.length > 0) {
      results = results.filter(p =>
        params.capabilitiesNeeded!.some(cap =>
          p.capabilities?.some((c: string) => c.toLowerCase().includes(cap.toLowerCase()))
        )
      );
    }

    return results;
  } catch {
    return [];
  }
}

// ============================================
// CRON JOB RUN LOGGING
// ============================================

export interface CronJobRun {
  id?: string;
  job_name: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  error_message?: string;
  items_processed?: number;
  notes?: string;
}

/**
 * Log the start of a cron job run
 */
export async function logJobStart(jobName: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from('cron_job_runs')
      .insert({
        job_name: jobName,
        started_at: new Date().toISOString(),
        status: 'running',
      })
      .select('id')
      .single();

    if (error) {
      console.warn('Could not log job start:', error.message);
      return null;
    }

    console.log(`[JOB] Started: ${jobName} (run_id: ${data.id})`);
    return data.id;
  } catch (err) {
    console.warn('Could not log job start:', err);
    return null;
  }
}

/**
 * Log the completion of a cron job run
 */
export async function logJobComplete(
  runId: string,
  options: { itemsProcessed?: number; notes?: string } = {}
): Promise<void> {
  try {
    const { data: run } = await getSupabase()
      .from('cron_job_runs')
      .select('started_at, job_name')
      .eq('id', runId)
      .single();

    const startedAt = run?.started_at ? new Date(run.started_at) : new Date();
    const durationMs = Date.now() - startedAt.getTime();

    await getSupabase()
      .from('cron_job_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        items_processed: options.itemsProcessed,
        notes: options.notes,
      })
      .eq('id', runId);

    console.log(`[JOB] Completed: ${run?.job_name} in ${durationMs}ms`);
  } catch (err) {
    console.warn('Could not log job completion:', err);
  }
}

/**
 * Log a failed cron job run
 */
export async function logJobFailed(runId: string, errorMessage: string): Promise<void> {
  try {
    const { data: run } = await getSupabase()
      .from('cron_job_runs')
      .select('started_at, job_name')
      .eq('id', runId)
      .single();

    const startedAt = run?.started_at ? new Date(run.started_at) : new Date();
    const durationMs = Date.now() - startedAt.getTime();

    await getSupabase()
      .from('cron_job_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_message: errorMessage,
      })
      .eq('id', runId);

    console.error(`[JOB] Failed: ${run?.job_name} - ${errorMessage}`);
  } catch (err) {
    console.warn('Could not log job failure:', err);
  }
}

/**
 * Get recent job runs for monitoring
 */
export async function getRecentJobRuns(
  options: { jobName?: string; limit?: number; hoursBack?: number } = {}
): Promise<CronJobRun[]> {
  const { jobName, limit = 50, hoursBack = 24 } = options;

  try {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    let query = getSupabase()
      .from('cron_job_runs')
      .select('*')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (jobName) {
      query = query.eq('job_name', jobName);
    }

    const { data, error } = await query;

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Get job run statistics
 */
export async function getJobStats(daysBack: number = 7): Promise<{
  byJob: Record<string, { runs: number; failures: number; avgDuration: number }>;
  totalRuns: number;
  totalFailures: number;
}> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('cron_job_runs')
      .select('job_name, status, duration_ms')
      .gte('started_at', since);

    if (error || !data) {
      return { byJob: {}, totalRuns: 0, totalFailures: 0 };
    }

    const byJob: Record<string, { runs: number; failures: number; totalDuration: number }> = {};
    let totalRuns = 0;
    let totalFailures = 0;

    for (const run of data) {
      totalRuns++;
      if (run.status === 'failed') totalFailures++;

      if (!byJob[run.job_name]) {
        byJob[run.job_name] = { runs: 0, failures: 0, totalDuration: 0 };
      }
      byJob[run.job_name].runs++;
      if (run.status === 'failed') byJob[run.job_name].failures++;
      if (run.duration_ms) byJob[run.job_name].totalDuration += run.duration_ms;
    }

    // Calculate averages
    const result: Record<string, { runs: number; failures: number; avgDuration: number }> = {};
    for (const [job, stats] of Object.entries(byJob)) {
      result[job] = {
        runs: stats.runs,
        failures: stats.failures,
        avgDuration: stats.runs > 0 ? Math.round(stats.totalDuration / stats.runs) : 0,
      };
    }

    return { byJob: result, totalRuns, totalFailures };
  } catch {
    return { byJob: {}, totalRuns: 0, totalFailures: 0 };
  }
}

// Format partner data for Rosa's context
export function formatPartnerForContext(partner: PartnerCompany): string {
  const lines: string[] = [
    `*${partner.company_name}*`,
    `Status: ${partner.relationship_status.replace('_', ' ')}`,
  ];

  if (partner.certifications?.length > 0) {
    lines.push(`Certs: ${partner.certifications.join(', ')}`);
  }
  if (partner.capabilities?.length > 0) {
    lines.push(`Capabilities: ${partner.capabilities.slice(0, 5).join(', ')}`);
  }
  if (partner.past_performance_agencies && partner.past_performance_agencies.length > 0) {
    lines.push(`Agency experience: ${partner.past_performance_agencies.join(', ')}`);
  }
  if (partner.teaming_history_count && partner.teaming_history_count > 0) {
    lines.push(`Teamed ${partner.teaming_history_count} times${partner.last_teamed_date ? `, last: ${partner.last_teamed_date.split('T')[0]}` : ''}`);
  }
  if (partner.relationship_notes) {
    lines.push(`Notes: ${partner.relationship_notes}`);
  }
  if (partner.contact_name) {
    lines.push(`Contact: ${partner.contact_name}${partner.contact_email ? ` (${partner.contact_email})` : ''}`);
  }

  return lines.join('\n');
}
