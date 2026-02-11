import { getSupabase } from './client.js';
import type { Agency } from '../../types/index.js';

// ============================================
// AGENCY OPERATIONS
// ============================================

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
