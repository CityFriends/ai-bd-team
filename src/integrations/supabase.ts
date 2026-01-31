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
