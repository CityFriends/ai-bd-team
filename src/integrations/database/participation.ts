import { getSupabase } from './client.js';

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
      await getSupabase().from('agent_thread_participation').insert({
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
export async function hasParticipatedInThread(agent: string, threadTs: string): Promise<boolean> {
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

/**
 * Get the response count for an agent in a specific thread
 * Used to enforce per-thread response limits
 */
export async function getAgentThreadResponseCount(
  agent: string,
  threadTs: string
): Promise<number> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_thread_participation')
      .select('response_count')
      .eq('agent', agent)
      .eq('thread_ts', threadTs)
      .single();

    if (error || !data) {
      return 0;
    }

    return data.response_count || 0;
  } catch {
    return 0;
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
export async function createHandoff(
  handoff: Omit<AgentHandoff, 'id' | 'created_at'>
): Promise<AgentHandoff | null> {
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
