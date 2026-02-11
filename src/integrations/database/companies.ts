import { getSupabase } from './client.js';
import type { Company } from '../../types/index.js';

// ============================================
// COMPANY OPERATIONS
// ============================================

export async function createCompany(company: Partial<Company>): Promise<Company> {
  const { data, error } = await getSupabase().from('companies').insert(company).select().single();

  if (error) throw error;
  return data;
}

export async function getCompany(id: string): Promise<Company | null> {
  const { data, error } = await getSupabase().from('companies').select().eq('id', id).single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function searchCompaniesByCapabilities(keywords: string[]): Promise<Company[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .or(keywords.map((k) => `capabilities.ilike.%${k}%`).join(','));

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
