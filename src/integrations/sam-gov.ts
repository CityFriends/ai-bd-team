import type { SAMOpportunity, SAMSearchResponse } from '../types/index.js';

const SAM_OPPORTUNITIES_URL = 'https://api.sam.gov/opportunities/v2/search';

function getApiKey(): string {
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    throw new Error('Missing SAM_API_KEY');
  }
  return apiKey;
}

// Format date as MM/DD/YYYY for SAM.gov API
function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Our target NAICS codes
const TARGET_NAICS = ['541511', '541512', '541519'];

export interface SearchOptions {
  postedFrom?: Date;
  postedTo?: Date;
  naicsCodes?: string[];
  types?: ('p' | 'r' | 's' | 'o' | 'k')[]; // presolicitation, RFI, sources sought, other, combined
  limit?: number;
  offset?: number;
}

// Generate SAM.gov opportunity URL from notice ID
export function getSAMOpportunityURL(noticeId: string): string {
  return `https://sam.gov/opp/${noticeId}/view`;
}

// Validate that an opportunity has required fields and is real
export function validateOpportunity(opp: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!opp.noticeId) {
    errors.push('Missing noticeId');
  }
  if (!opp.title) {
    errors.push('Missing title');
  }
  if (!opp.postedDate) {
    errors.push('Missing postedDate');
  }

  return { valid: errors.length === 0, errors };
}

// Search for opportunities
export async function searchOpportunities(options: SearchOptions = {}): Promise<SAMSearchResponse> {
  const apiKey = getApiKey();

  // Default to last 7 days if no dates provided
  const to = options.postedTo || new Date();
  const from = options.postedFrom || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    api_key: apiKey,
    postedFrom: formatDate(from),
    postedTo: formatDate(to),
    limit: String(options.limit || 100),
    offset: String(options.offset || 0),
  });

  // Add NAICS codes (SAM.gov v2 API uses 'ncode' parameter)
  const naics = options.naicsCodes || TARGET_NAICS;
  params.append('ncode', naics.join(','));

  // Add types if specified
  if (options.types && options.types.length > 0) {
    params.append('ptype', options.types.join(','));
  }

  const url = `${SAM_OPPORTUNITIES_URL}?${params.toString()}`;

  console.log(
    `[SAM.gov] Querying: naics=${naics.join(',')}, from=${formatDate(from)}, to=${formatDate(to)}`
  );

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[SAM.gov] API error: ${response.status}`);
    throw new Error(`SAM.gov API error: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as SAMSearchResponse;

  // Log raw results for debugging
  console.log(`[SAM.gov] Raw response: ${data.totalRecords || 0} total records`);

  // Validate and filter opportunities - only return real ones
  const validOpportunities = (data.opportunitiesData || []).filter((opp) => {
    const { valid, errors } = validateOpportunity(opp);
    if (!valid) {
      console.warn(`[SAM.gov] Invalid opportunity skipped: ${errors.join(', ')}`);
    }
    return valid;
  });

  // Add generated URL if uiLink is missing
  const enrichedOpportunities = validOpportunities.map((opp) => ({
    ...opp,
    uiLink: opp.uiLink || getSAMOpportunityURL(opp.noticeId),
  }));

  console.log(`[SAM.gov] Returning ${enrichedOpportunities.length} validated opportunities`);

  return {
    totalRecords: data.totalRecords || 0,
    limit: data.limit || 100,
    offset: data.offset || 0,
    opportunitiesData: enrichedOpportunities,
  };
}

// Get opportunities posted in the last 24 hours (for daily scan)
export async function getDailyOpportunities(): Promise<SAMOpportunity[]> {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const today = new Date();

  const result = await searchOpportunities({
    postedFrom: yesterday,
    postedTo: today,
  });

  return result.opportunitiesData;
}

// Get a single opportunity by notice ID
export async function getOpportunityByNoticeId(noticeId: string): Promise<SAMOpportunity | null> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    api_key: apiKey,
    noticeId: noticeId,
  });

  const url = `${SAM_OPPORTUNITIES_URL}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const text = await response.text();
    throw new Error(`SAM.gov API error: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as SAMSearchResponse;

  if (data.opportunitiesData && data.opportunitiesData.length > 0) {
    return data.opportunitiesData[0];
  }

  return null;
}

// Search for Sources Sought and RFIs (lower barrier opportunities)
export async function getPreSolicitationOpportunities(
  options: Omit<SearchOptions, 'types'> = {}
): Promise<SAMOpportunity[]> {
  const result = await searchOpportunities({
    ...options,
    types: ['r', 's', 'p'], // RFI, Sources Sought, Presolicitation
  });

  return result.opportunitiesData;
}

// Map SAM.gov opportunity type to our type
export function mapOpportunityType(samType: string): string {
  const typeMap: Record<string, string> = {
    p: 'Presolicitation',
    r: 'RFI',
    s: 'Sources Sought',
    o: 'Other',
    k: 'Combined Synopsis/Solicitation',
  };

  return typeMap[samType.toLowerCase()] || samType;
}

// Extract agency abbreviation from department/office
export function extractAgencyAbbreviation(department?: string, office?: string): string | null {
  const text = `${department || ''} ${office || ''}`.toUpperCase();

  const agencies: Record<string, string[]> = {
    VA: ['VETERANS AFFAIRS', 'VA ', 'DVA'],
    HHS: ['HEALTH AND HUMAN SERVICES', 'HHS'],
    DOL: ['DEPARTMENT OF LABOR', 'DOL'],
    STATE: ['STATE DEPARTMENT', 'DEPARTMENT OF STATE', 'DOS'],
    ED: ['DEPARTMENT OF EDUCATION', 'ED '],
    SBA: ['SMALL BUSINESS ADMINISTRATION', 'SBA'],
    GSA: ['GENERAL SERVICES ADMINISTRATION', 'GSA'],
    DOD: ['DEPARTMENT OF DEFENSE', 'DOD', 'ARMY', 'NAVY', 'AIR FORCE'],
    DHS: ['HOMELAND SECURITY', 'DHS'],
    DOJ: ['JUSTICE', 'DOJ'],
    DOT: ['TRANSPORTATION', 'DOT'],
    USDA: ['AGRICULTURE', 'USDA'],
    DOE: ['ENERGY', 'DOE'],
    HUD: ['HOUSING AND URBAN DEVELOPMENT', 'HUD'],
    DOI: ['INTERIOR', 'DOI'],
    TREASURY: ['TREASURY'],
    EPA: ['ENVIRONMENTAL PROTECTION', 'EPA'],
    NASA: ['NASA'],
    SSA: ['SOCIAL SECURITY', 'SSA'],
    OPM: ['PERSONNEL MANAGEMENT', 'OPM'],
  };

  for (const [abbrev, keywords] of Object.entries(agencies)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      return abbrev;
    }
  }

  return null;
}
