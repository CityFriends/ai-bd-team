import { getSupabase } from './client.js';

// ============================================
// SYSTEM FEEDBACK
// ============================================

export interface SystemFeedback {
  id?: string;
  date?: string;
  agent: string;
  feedback_type:
    | 'bug'
    | 'wrong_answer'
    | 'great_catch'
    | 'suggestion'
    | 'annoying'
    | 'missing_info';
  what_happened: string;
  what_should_happen?: string;
  severity?: 'minor' | 'medium' | 'major';
  resolved?: boolean;
  resolution?: string;
  slack_ts?: string;
  created_at?: string;
}

export async function logFeedback(
  feedback: Omit<SystemFeedback, 'id' | 'created_at'>
): Promise<SystemFeedback | null> {
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

    const { data, error } = await getSupabase().from('system_feedback').select().gte('date', since);

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
export async function recordAgentFeedback(
  feedback: Omit<AgentFeedback, 'id' | 'created_at'>
): Promise<void> {
  try {
    await getSupabase()
      .from('agent_feedback')
      .upsert(
        {
          ...feedback,
          created_at: new Date().toISOString(),
        },
        {
          onConflict: 'message_ts,feedback_type,reaction_emoji',
          ignoreDuplicates: true,
        }
      );
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
