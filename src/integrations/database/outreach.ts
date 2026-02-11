import { getSupabase } from './client.js';
import type { Outreach } from '../../types/index.js';

// ============================================
// OUTREACH OPERATIONS
// ============================================

export async function createOutreach(outreach: Partial<Outreach>): Promise<Outreach> {
  const { data, error } = await getSupabase().from('outreach').insert(outreach).select().single();

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
