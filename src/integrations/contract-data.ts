// Contract Data Integration (replaces FPDS)
// Uses USASpending.gov API for awarded contract data
// FPDS is being deprecated - all data moving to SAM.gov/USASpending

import { getSupabase } from './supabase.js';

const USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';

// Agency code to full name mapping for USASpending API
// USASpending expects full agency names, not codes
const AGENCY_CODE_TO_NAME: Record<string, string> = {
  '036': 'Department of Veterans Affairs',
  '075': 'Department of Health and Human Services',
  '012': 'Department of Labor',
  '097': 'Department of Defense',
  '070': 'Department of Homeland Security',
  '047': 'General Services Administration',
  '015': 'Department of Justice',
  '091': 'Department of Education',
  '019': 'Department of State',
  '073': 'Small Business Administration',
  '068': 'Environmental Protection Agency',
  '080': 'National Aeronautics and Space Administration',
  '028': 'Social Security Administration',
  '069': 'Department of Transportation',
  '089': 'Department of Energy',
  '020': 'Department of the Treasury',
  '024': 'Office of Personnel Management',
};

// Keep interface compatible with old FPDS interface for easy migration
export interface ContractAward {
  contractId: string;
  vendorName: string;
  vendorUei?: string;
  agencyName: string;
  agencyCode?: string;
  contractDescription: string;
  obligatedAmount: number;
  baseAndAllOptionsValue?: number;
  signedDate: string;
  completionDate?: string;
  naicsCode?: string;
  pscCode?: string;
  setAsideType?: string;
  contractType?: string;
}

// Alias for backwards compatibility
export type FPDSContract = ContractAward;

export interface ContractSearchResult {
  contracts: ContractAward[];
  totalCount: number;
  query: string;
  cachedAt?: string;
}

// Alias for backwards compatibility
export type FPDSSearchResult = ContractSearchResult;

// Search for contracts using USASpending API
export async function searchContracts(params: {
  keyword?: string;
  agencyCode?: string;
  vendorName?: string;
  naicsCode?: string;
  limit?: number;
}): Promise<ContractSearchResult> {
  const { keyword, agencyCode, vendorName, naicsCode, limit = 20 } = params;

  const queryKey = JSON.stringify(params);

  // Check cache first
  const cached = await getCachedResult(queryKey);
  if (cached) {
    console.log('ContractData: Using cached result');
    return cached;
  }

  try {
    // Build USASpending API request
    const filters: Record<string, unknown> = {
      award_type_codes: ['A', 'B', 'C', 'D'], // Contract types
      time_period: [
        {
          start_date: getDateNYearsAgo(3),
          end_date: new Date().toISOString().split('T')[0],
        },
      ],
    };

    if (agencyCode) {
      // USASpending expects full agency name for toptier_name filter
      const agencyName = AGENCY_CODE_TO_NAME[agencyCode] || agencyCode;
      filters.agencies = [
        {
          type: 'awarding',
          tier: 'toptier',
          toptier_name: agencyName,
        },
      ];
    }

    if (vendorName) {
      filters.recipient_search_text = vendorName;
    }

    if (naicsCode) {
      filters.naics_codes = [naicsCode];
    }

    if (keyword) {
      filters.keywords = [keyword];
    }

    const requestBody = {
      filters,
      fields: [
        'Award ID',
        'Recipient Name',
        'Recipient UEI',
        'Awarding Agency',
        'Awarding Sub Agency',
        'Award Amount',
        'Total Outlays',
        'Description',
        'Start Date',
        'End Date',
        'NAICS Code',
        'PSC Code',
        'Contract Award Type',
        'Type of Set Aside',
      ],
      limit,
      page: 1,
      sort: 'Award Amount',
      order: 'desc',
    };

    console.log(`ContractData: Searching USASpending for "${keyword || vendorName || agencyCode}"`);

    const response = await fetch(`${USASPENDING_BASE_URL}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BD-Team-Research-Bot/1.0',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Record<string, unknown>[];
      page_metadata?: { total?: number };
    };
    const contracts = parseUSASpendingResults(data.results || []);

    // Debug logging when searches return empty
    if (contracts.length === 0) {
      const agencyName = agencyCode ? AGENCY_CODE_TO_NAME[agencyCode] || agencyCode : 'none';
      console.log(
        `[ContractData] No results for: agency=${agencyName}, keyword=${keyword || 'none'}, vendor=${vendorName || 'none'}`
      );
    }

    const result: ContractSearchResult = {
      contracts,
      totalCount: data.page_metadata?.total || contracts.length,
      query: queryKey,
      cachedAt: new Date().toISOString(),
    };

    await cacheResult(queryKey, result);
    return result;
  } catch (error) {
    console.error('ContractData search error:', error);
    return {
      contracts: [],
      totalCount: 0,
      query: queryKey,
    };
  }
}

// Backwards compatible alias
export const searchFPDS = searchContracts;

// Search by contract number
export async function searchByContractNumber(
  contractNumber: string
): Promise<ContractSearchResult> {
  const queryKey = `contract:${contractNumber}`;

  const cached = await getCachedResult(queryKey);
  if (cached) {
    console.log('ContractData: Using cached result for contract number');
    return cached;
  }

  try {
    const requestBody = {
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'],
        award_ids: [contractNumber],
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Recipient UEI',
        'Awarding Agency',
        'Awarding Sub Agency',
        'Award Amount',
        'Description',
        'Start Date',
        'End Date',
        'NAICS Code',
        'PSC Code',
        'Contract Award Type',
      ],
      limit: 10,
      page: 1,
    };

    console.log(`ContractData: Searching for contract "${contractNumber}"`);

    const response = await fetch(`${USASPENDING_BASE_URL}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Record<string, unknown>[];
      page_metadata?: { total?: number };
    };
    const contracts = parseUSASpendingResults(data.results || []);

    const result: ContractSearchResult = {
      contracts,
      totalCount: contracts.length,
      query: queryKey,
      cachedAt: new Date().toISOString(),
    };

    await cacheResult(queryKey, result);
    return result;
  } catch (error) {
    console.error('ContractData contract search error:', error);
    return { contracts: [], totalCount: 0, query: queryKey };
  }
}

// Find incumbent for an agency/contract area
export async function findIncumbent(params: {
  agencyCode?: string;
  agencyName?: string;
  keywords?: string[];
  naicsCode?: string;
}): Promise<{
  incumbent: string | null;
  contractValue: number | null;
  contractYears: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  source: string;
  contracts: ContractAward[];
}> {
  const { agencyCode, agencyName, keywords = [], naicsCode } = params;

  const result = await searchContracts({
    keyword: keywords.join(' '),
    agencyCode: agencyCode || agencyName,
    naicsCode,
    limit: 10,
  });

  if (result.contracts.length === 0) {
    return {
      incumbent: null,
      contractValue: null,
      contractYears: null,
      confidence: 'LOW',
      source: 'USASpending (no results found)',
      contracts: [],
    };
  }

  // Find the most likely incumbent (highest value recent contract)
  const sortedByValue = [...result.contracts].sort(
    (a, b) => (b.obligatedAmount || 0) - (a.obligatedAmount || 0)
  );

  const topContract = sortedByValue[0];

  // Calculate contract duration
  let years: number | null = null;
  if (topContract.signedDate && topContract.completionDate) {
    const start = new Date(topContract.signedDate);
    const end = new Date(topContract.completionDate);
    years = Math.round((end.getTime() - start.getTime()) / (365 * 24 * 60 * 60 * 1000));
  }

  // Determine confidence based on match quality
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  if (agencyCode && result.contracts.length >= 3) {
    confidence = 'HIGH';
  } else if (result.contracts.length === 1) {
    confidence = 'LOW';
  }

  return {
    incumbent: topContract.vendorName,
    contractValue: topContract.obligatedAmount,
    contractYears: years,
    confidence,
    source: `USASpending (${result.contracts.length} contracts found)`,
    contracts: result.contracts.slice(0, 5),
  };
}

// Get vendor's contract history
export async function getVendorHistory(vendorName: string): Promise<{
  totalContracts: number;
  totalValue: number;
  agencies: string[];
  recentContracts: ContractAward[];
}> {
  const result = await searchContracts({
    vendorName,
    limit: 50,
  });

  const agencies = [...new Set(result.contracts.map((c) => c.agencyName))];
  const totalValue = result.contracts.reduce((sum, c) => sum + (c.obligatedAmount || 0), 0);

  return {
    totalContracts: result.contracts.length,
    totalValue,
    agencies,
    recentContracts: result.contracts.slice(0, 5),
  };
}

// Parse USASpending API results into our contract format
function parseUSASpendingResults(results: Record<string, unknown>[]): ContractAward[] {
  return results.map((r: Record<string, unknown>) => ({
    contractId: (r['Award ID'] as string) || 'unknown',
    vendorName: (r['Recipient Name'] as string) || 'Unknown Vendor',
    vendorUei: r['Recipient UEI'] as string | undefined,
    agencyName:
      (r['Awarding Agency'] as string) || (r['Awarding Sub Agency'] as string) || 'Unknown Agency',
    agencyCode: undefined,
    contractDescription: (r['Description'] as string) || '',
    obligatedAmount: (r['Award Amount'] as number) || 0,
    signedDate: (r['Start Date'] as string) || '',
    completionDate: r['End Date'] as string | undefined,
    naicsCode: r['NAICS Code'] as string | undefined,
    pscCode: r['PSC Code'] as string | undefined,
    contractType: r['Contract Award Type'] as string | undefined,
    setAsideType: r['Type of Set Aside'] as string | undefined,
  }));
}

// Format contract data for agent response
export function formatContractDataForAgent(contracts: ContractAward[]): string {
  if (contracts.length === 0) {
    return 'No contract data found in USASpending.';
  }

  const lines = contracts.slice(0, 3).map((c) => {
    const value = c.obligatedAmount
      ? `$${(c.obligatedAmount / 1000000).toFixed(1)}M`
      : 'unknown value';
    return `- ${c.vendorName}: ${value} with ${c.agencyName}`;
  });

  return `USASpending shows:\n${lines.join('\n')}`;
}

// Backwards compatible alias
export const formatFPDSForAgent = formatContractDataForAgent;

// Helper: Get date N years ago
function getDateNYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().split('T')[0];
}

// Cache helpers
async function getCachedResult(query: string): Promise<ContractSearchResult | null> {
  try {
    const supabase = getSupabase();
    const cacheKey = `contracts:${query}`;

    const { data } = await supabase
      .from('research_cache')
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (data) {
      // Check if cache is fresh (less than 24 hours)
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return data.data as ContractSearchResult;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheResult(query: string, result: ContractSearchResult): Promise<void> {
  try {
    const supabase = getSupabase();
    const cacheKey = `contracts:${query}`;

    await supabase.from('research_cache').upsert(
      {
        cache_key: cacheKey,
        source: 'usaspending',
        data: result,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );
  } catch (error) {
    console.warn('Failed to cache contract result:', error);
  }
}
