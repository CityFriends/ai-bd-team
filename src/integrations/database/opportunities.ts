import { getSupabase } from './client.js';
import type { Opportunity, OpportunityStatus, Decision } from '../../types/index.js';

// ============================================
// OPPORTUNITY CRUD OPERATIONS
// ============================================

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
  const { data, error } = await getSupabase().from('opportunities').select().eq('id', id).single();

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

export async function updateOpportunity(
  id: string,
  updates: Partial<Opportunity>
): Promise<Opportunity> {
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

export async function setOpportunityDecision(id: string, decision: Decision): Promise<Opportunity> {
  return updateOpportunity(id, {
    decision,
    decision_date: new Date().toISOString(),
    status: decision === 'go' ? 'pursuing' : decision === 'no_go' ? 'passed' : 'researching',
  });
}

/**
 * Get opportunities with upcoming deadlines
 */
export async function getUpcomingDeadlines(daysAhead: number = 14): Promise<Opportunity[]> {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .in('status', ['new', 'researching', 'pursuing'])
    .not('due_date', 'is', null)
    .gte('due_date', now.toISOString().split('T')[0])
    .lte('due_date', future.toISOString().split('T')[0])
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get opportunities with no recent activity
 */
export async function getStaleOpportunities(daysSinceActivity: number = 7): Promise<Opportunity[]> {
  const threshold = new Date(Date.now() - daysSinceActivity * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .in('status', ['new', 'researching', 'pursuing'])
    .lt('updated_at', threshold)
    .order('updated_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get pipeline summary counts
 */
export async function getPipelineSummary(): Promise<{
  byStatus: Record<string, number>;
  total: number;
  withDeadlines: number;
}> {
  const { data, error } = await getSupabase().from('opportunities').select('status, due_date');

  if (error) throw error;

  const byStatus: Record<string, number> = {};
  let withDeadlines = 0;

  for (const opp of data || []) {
    byStatus[opp.status] = (byStatus[opp.status] || 0) + 1;
    if (opp.due_date) withDeadlines++;
  }

  return {
    byStatus,
    total: data?.length || 0,
    withDeadlines,
  };
}
