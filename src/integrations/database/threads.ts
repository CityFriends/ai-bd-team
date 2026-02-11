import { getSupabase } from './client.js';
import type { ConversationThread } from '../../types/index.js';

// ============================================
// CONVERSATION THREAD OPERATIONS
// ============================================

export async function createThread(
  thread: Partial<ConversationThread>
): Promise<ConversationThread> {
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

export async function updateThread(
  id: string,
  updates: Partial<ConversationThread>
): Promise<ConversationThread> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
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
    const upsertData: Record<string, unknown> = {
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
