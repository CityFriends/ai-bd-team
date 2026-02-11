import { getSupabase } from './client.js';

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
    await getSupabase()
      .from('competitor_intel')
      .insert({
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
