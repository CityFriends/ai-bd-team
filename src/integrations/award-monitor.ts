// Award Monitor - Polls FPDS for new contract awards and tracks what we've seen
// Used by Maya to proactively report new awards (like OrangeSlices does)

import { getSupabase } from './supabase.js';
import { searchFPDS, type FPDSContract } from './fpds.js';

// Agencies to monitor for new awards
const MONITORED_AGENCIES: { code: string; name: string; abbrev: string }[] = [
  { code: '036', name: 'Department of Veterans Affairs', abbrev: 'VA' },
  { code: '075', name: 'Department of Health and Human Services', abbrev: 'HHS' },
  { code: '012', name: 'Department of Labor', abbrev: 'DOL' },
  { code: '070', name: 'Department of Homeland Security', abbrev: 'DHS' },
  { code: '047', name: 'General Services Administration', abbrev: 'GSA' },
];

// Minimum contract value to report (filter out small purchases)
const MIN_AWARD_VALUE = 50000; // $50K - lowered to catch more awards

export interface NewAward {
  contractId: string;
  vendorName: string;
  agencyName: string;
  agencyAbbrev: string;
  obligatedAmount: number;
  contractDescription: string;
  signedDate: string;
  contractType?: string;
}

// Check for new awards across monitored agencies
export async function checkForNewAwards(): Promise<NewAward[]> {
  const allNewAwards: NewAward[] = [];

  for (const agency of MONITORED_AGENCIES) {
    try {
      const newAwards = await checkAgencyAwards(agency.code, agency.name, agency.abbrev);
      allNewAwards.push(...newAwards);
    } catch (err) {
      console.warn(`Award monitor: Failed to check ${agency.abbrev}:`, err);
    }
  }

  // Sort by value (highest first)
  allNewAwards.sort((a, b) => b.obligatedAmount - a.obligatedAmount);

  return allNewAwards;
}

// Check a specific agency for new awards
export async function checkAgencyAwards(
  agencyCode: string,
  agencyName: string,
  agencyAbbrev: string
): Promise<NewAward[]> {
  console.log(`Award monitor: Checking ${agencyAbbrev} for new awards...`);

  // Fetch recent awards from FPDS
  // Use agency name as keyword since agency code alone returns empty
  const result = await searchFPDS({
    keyword: agencyName,
    limit: 30,
  });

  if (result.contracts.length === 0) {
    return [];
  }

  // Filter to significant awards from real vendors (not government agencies)
  const govAgencyPatterns = [
    /department of/i,           // Any "department of" (federal, state, local)
    /^u\.?s\.? /i,              // U.S. anything
    /^united states/i,          // United States
    /^state of/i,               // State of X
    /^city of/i,                // City of X
    /^county of/i,              // County of X
    /\bstate\b.*\b(department|agency|commission|board)\b/i,  // State agencies
    /\b(health and human services|labor|education|transportation)\b.*\b(department|agency)\b/i,
    /^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i,  // State names at start
    /\buniversity\b/i,          // Universities
    /\bcollege\b/i,             // Colleges
    /\bgovernment\b/i,          // Government entities
    /\bpublic\s+(school|health|safety)\b/i,  // Public entities
    /^health and human services$/i,         // Bare HHS name
    /^(labor|education|transportation|agriculture|interior|commerce|treasury|justice|defense|energy|housing)$/i,  // Bare agency names
  ];

  const significantAwards = result.contracts.filter(c => {
    // Must meet minimum value
    if (c.obligatedAmount < MIN_AWARD_VALUE) return false;

    // Filter out government agencies as "vendors" (bad data)
    const isGovAgency = govAgencyPatterns.some(p => p.test(c.vendorName));
    if (isGovAgency) return false;

    return true;
  });

  if (significantAwards.length === 0) {
    return [];
  }

  // Check which ones we've already seen
  const seenIds = await getSeenAwardIds(significantAwards.map(c => c.contractId));

  // Filter to new awards only
  const newAwards = significantAwards.filter(c => !seenIds.has(c.contractId));

  if (newAwards.length === 0) {
    return [];
  }

  // Mark these as seen
  await markAwardsSeen(newAwards.map(c => ({
    contractId: c.contractId,
    vendorName: c.vendorName,
    agencyCode,
    amount: c.obligatedAmount,
  })));

  // Convert to NewAward format
  return newAwards.map(c => ({
    contractId: c.contractId,
    vendorName: c.vendorName,
    agencyName,
    agencyAbbrev,
    obligatedAmount: c.obligatedAmount,
    contractDescription: c.contractDescription,
    signedDate: c.signedDate,
    contractType: c.contractType,
  }));
}

// Get IDs of awards we've already seen
async function getSeenAwardIds(contractIds: string[]): Promise<Set<string>> {
  try {
    const supabase = getSupabase();

    const { data } = await supabase
      .from('seen_awards')
      .select('contract_id')
      .in('contract_id', contractIds);

    return new Set((data || []).map(d => d.contract_id));
  } catch {
    // Table might not exist yet
    return new Set();
  }
}

// Mark awards as seen so we don't report them again
async function markAwardsSeen(awards: {
  contractId: string;
  vendorName: string;
  agencyCode: string;
  amount: number;
}[]): Promise<void> {
  try {
    const supabase = getSupabase();

    const records = awards.map(a => ({
      contract_id: a.contractId,
      vendor_name: a.vendorName,
      agency_code: a.agencyCode,
      amount: a.amount,
      seen_at: new Date().toISOString(),
    }));

    await supabase
      .from('seen_awards')
      .upsert(records, { onConflict: 'contract_id' });
  } catch (err) {
    console.warn('Award monitor: Failed to mark awards as seen:', err);
  }
}

// Format awards for Maya to post
export function formatAwardsForSlack(awards: NewAward[], maxToShow: number = 10): string {
  if (awards.length === 0) {
    return '';
  }

  const lines = awards.slice(0, maxToShow).map(a => {
    const value = a.obligatedAmount >= 1000000
      ? `$${(a.obligatedAmount / 1000000).toFixed(1)}M`
      : `$${(a.obligatedAmount / 1000).toFixed(0)}K`;
    const type = a.contractType && a.contractType !== 'Unknown' ? ` (${a.contractType})` : '';
    return `• *${a.vendorName}* - ${value} from ${a.agencyAbbrev}${type}`;
  });

  if (awards.length > maxToShow) {
    lines.push(`_...and ${awards.length - maxToShow} more_`);
  }

  return lines.join('\n');
}

// Get summary stats for awards
export function getAwardsSummary(awards: NewAward[]): {
  totalCount: number;
  totalValue: number;
  topVendor: string | null;
  topAgency: string | null;
} {
  if (awards.length === 0) {
    return { totalCount: 0, totalValue: 0, topVendor: null, topAgency: null };
  }

  const totalValue = awards.reduce((sum, a) => sum + a.obligatedAmount, 0);

  // Count by vendor
  const vendorCounts = new Map<string, number>();
  awards.forEach(a => {
    vendorCounts.set(a.vendorName, (vendorCounts.get(a.vendorName) || 0) + 1);
  });
  const topVendor = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Count by agency
  const agencyCounts = new Map<string, number>();
  awards.forEach(a => {
    agencyCounts.set(a.agencyAbbrev, (agencyCounts.get(a.agencyAbbrev) || 0) + 1);
  });
  const topAgency = [...agencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    totalCount: awards.length,
    totalValue,
    topVendor,
    topAgency,
  };
}
