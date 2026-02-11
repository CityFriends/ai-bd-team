import { getSupabase } from './client.js';
import type { AgentQueueItem, AgentName, QueueStatus } from '../../types/index.js';

// ============================================
// AGENT QUEUE OPERATIONS
// ============================================

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
