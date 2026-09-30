/**
 * Company Profile Repository
 *
 * Production source of truth for organizational data.
 * Reads from Supabase tables (company_profile, past_performance,
 * teaming_partners). Maya-specific code does NOT own this data.
 *
 * Tables used (existing — no new tables needed):
 *   company_profile — single row with arrays for capabilities, certs, etc.
 *   past_performance — structured records with agency, role, capabilities
 *   teaming_partners — relationship records with confidence/provenance
 */

// ============================================================
// Shared Domain Types (not Maya-specific)
// ============================================================

export interface CompanyProfileData {
  companyName: string;
  capabilities: string[];
  differentiators: string[];
  certifications: string[];
  setAsides: string[];
  naicsCodes: string[];
  contractVehicles: string[];
  agencyExperience: string[];
  idealOpportunity: string | null;
  noBidCriteria: string[];
  teamSize: number | null;
  location: string | null;
  cageCode: string | null;
  uei: string | null;
}

export interface PastPerformanceRecord {
  id: string;
  contractName: string;
  agency: string;
  subAgency: string | null;
  contractVehicle: string | null;
  ourRole: string | null;
  primeContractor: string | null;
  description: string | null;
  keyAccomplishments: string[];
  relevantNaics: string[];
  tags: string[];
  contractValue: number | null;
  popStart: string | null;
  popEnd: string | null;
}

export interface TeamingPartnerRecord {
  companyName: string;
  capabilities: string[];
  certifications: string[];
  setAsides: string[];
  pastWorkTogether: string[];
  relationshipStatus: string | null;
  relationshipNotes: string | null;
}

export interface PursuitPreferences {
  contractSizeMin: number;
  contractSizeMax: number;
  contractSizeSweetMin: number;
  contractSizeSweetMax: number;
  primeSubStrategy: string;
  supportedClearance: string[];
  excludedClearance: string[];
  /** Agencies where FFTC has organizational experience/context. NOT an override trigger. */
  agencyExperience: string[];
  excludedWorkTypes: string[];
  lowFitWorkTypes: string[];
}

// ============================================================
// Repository Interface
// ============================================================

export interface CompanyProfileRepository {
  getCompanyProfile(): Promise<CompanyProfileData>;
  getPastPerformance(): Promise<PastPerformanceRecord[]>;
  getTeamingPartners(): Promise<TeamingPartnerRecord[]>;
  getPursuitPreferences(): Promise<PursuitPreferences>;
}

// ============================================================
// Supabase Implementation
// ============================================================

export class SupabaseCompanyProfileRepository implements CompanyProfileRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private supabase: any) {}

  async getCompanyProfile(): Promise<CompanyProfileData> {
    const { data, error } = await this.supabase
      .from('company_profile')
      .select('*')
      .limit(1)
      .single();

    if (error || !data) {
      throw new Error(`Failed to load company profile: ${error?.message || 'no data'}`);
    }

    return {
      companyName: data.company_name,
      capabilities: data.capabilities || [],
      differentiators: data.differentiators || [],
      certifications: data.certifications || [],
      setAsides: data.set_asides || [],
      naicsCodes: data.naics_codes || [],
      contractVehicles: data.contract_vehicles || [],
      agencyExperience: data.agency_experience || [],
      idealOpportunity: data.ideal_opportunity || null,
      noBidCriteria: data.no_bid_criteria || [],
      teamSize: data.team_size || null,
      location: data.location || null,
      cageCode: data.cage_code || null,
      uei: data.uei || null,
    };
  }

  async getPastPerformance(): Promise<PastPerformanceRecord[]> {
    const { data, error } = await this.supabase
      .from('past_performance')
      .select('*')
      .order('pop_end', { ascending: false });

    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      contractName: row.contract_name as string,
      agency: row.agency as string,
      subAgency: (row.sub_agency as string) || null,
      contractVehicle: (row.contract_vehicle as string) || null,
      ourRole: (row.our_role as string) || null,
      primeContractor: (row.prime_contractor as string) || null,
      description: (row.description as string) || null,
      keyAccomplishments: (row.key_accomplishments as string[]) || [],
      relevantNaics: (row.relevant_naics as string[]) || [],
      tags: (row.tags as string[]) || [],
      contractValue: row.contract_value ? Number(row.contract_value) : null,
      popStart: (row.pop_start as string) || null,
      popEnd: (row.pop_end as string) || null,
    }));
  }

  async getTeamingPartners(): Promise<TeamingPartnerRecord[]> {
    const { data, error } = await this.supabase
      .from('teaming_partners')
      .select('*')
      .eq('relationship_status', 'Active');

    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      companyName: row.company_name as string,
      capabilities: (row.capabilities as string[]) || [],
      certifications: (row.certifications as string[]) || [],
      setAsides: (row.set_asides as string[]) || [],
      pastWorkTogether: (row.past_work_together as string[]) || [],
      relationshipStatus: (row.relationship_status as string) || null,
      relationshipNotes: (row.relationship_notes as string) || null,
    }));
  }

  async getPursuitPreferences(): Promise<PursuitPreferences> {
    // Pursuit preferences are currently structured constants.
    // When these need to be configurable per-deployment, add a
    // pursuit_preferences table. For now, return the approved values.
    return DEFAULT_PURSUIT_PREFERENCES;
  }
}

// ============================================================
// Default Pursuit Preferences (approved FFTC values)
// ============================================================

export const DEFAULT_PURSUIT_PREFERENCES: PursuitPreferences = {
  contractSizeMin: 200_000,
  contractSizeMax: 30_000_000,
  contractSizeSweetMin: 500_000,
  contractSizeSweetMax: 10_000_000,
  primeSubStrategy: 'Priority: prime. Also: meaningful sub roles. Penalize: commodity staffing.',
  supportedClearance: ['public trust'],
  excludedClearance: ['facility clearance', 'Secret', 'Top Secret', 'TS/SCI'],
  agencyExperience: ['VA', 'CMS', 'IRS', 'Department of State', 'FEMA', 'DHS', 'Smithsonian'],
  excludedWorkTypes: ['classified work', 'staff augmentation'],
  lowFitWorkTypes: ['data engineering', 'analytics-heavy work', 'BI/data lake/ETL-heavy work'],
};

// ============================================================
// Cached Repository (refreshes periodically)
// ============================================================

let cachedProfile: CompanyProfileData | null = null;
let cachedPP: PastPerformanceRecord[] | null = null;
let cachedPartners: TeamingPartnerRecord[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export class CachedCompanyProfileRepository implements CompanyProfileRepository {
  constructor(private inner: CompanyProfileRepository) {}

  private isFresh(): boolean {
    return cachedProfile !== null && Date.now() - cacheTimestamp < CACHE_TTL;
  }

  async getCompanyProfile(): Promise<CompanyProfileData> {
    if (!this.isFresh() || !cachedProfile) {
      cachedProfile = await this.inner.getCompanyProfile();
      cacheTimestamp = Date.now();
    }
    return cachedProfile;
  }

  async getPastPerformance(): Promise<PastPerformanceRecord[]> {
    if (!this.isFresh() || !cachedPP) {
      cachedPP = await this.inner.getPastPerformance();
      cacheTimestamp = Date.now();
    }
    return cachedPP;
  }

  async getTeamingPartners(): Promise<TeamingPartnerRecord[]> {
    if (!this.isFresh() || !cachedPartners) {
      cachedPartners = await this.inner.getTeamingPartners();
      cacheTimestamp = Date.now();
    }
    return cachedPartners;
  }

  async getPursuitPreferences(): Promise<PursuitPreferences> {
    return this.inner.getPursuitPreferences();
  }
}

/** Reset cache — for testing */
export function _resetRepositoryCache(): void {
  cachedProfile = null;
  cachedPP = null;
  cachedPartners = null;
  cacheTimestamp = 0;
}
