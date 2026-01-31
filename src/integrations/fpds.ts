// FPDS (Federal Procurement Data System) Integration
// Used by David to research incumbents and contract history

import { getSupabase } from './supabase.js';

const FPDS_BASE_URL = 'https://www.fpds.gov/ezsearch/fpdsportal';

export interface FPDSContract {
  contractId: string;
  vendorName: string;
  vendorDuns?: string;
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

export interface FPDSSearchResult {
  contracts: FPDSContract[];
  totalCount: number;
  query: string;
  cachedAt?: string;
}

// Search FPDS for contracts by keyword, agency, or vendor
export async function searchFPDS(params: {
  keyword?: string;
  agencyCode?: string;
  vendorName?: string;
  naicsCode?: string;
  limit?: number;
}): Promise<FPDSSearchResult> {
  const { keyword, agencyCode, vendorName, naicsCode, limit = 20 } = params;

  // Build search query
  const queryParts: string[] = [];
  if (keyword) queryParts.push(keyword);
  if (agencyCode) queryParts.push(`CONTRACTING_AGENCY_CODE:"${agencyCode}"`);
  if (vendorName) queryParts.push(`VENDOR_FULL_NAME:"${vendorName}"`);
  if (naicsCode) queryParts.push(`PRINCIPAL_NAICS_CODE:"${naicsCode}"`);

  const query = queryParts.join(' AND ');

  // Check cache first
  const cached = await getCachedFPDSResult(query);
  if (cached) {
    console.log('FPDS: Using cached result');
    return cached;
  }

  try {
    // FPDS uses Atom/XML feed - we'll fetch and parse
    const url = new URL(FPDS_BASE_URL);
    url.searchParams.set('s', 'FPDS.GOV');
    url.searchParams.set('indexName', 'awardfull');
    url.searchParams.set('templateName', '1.5.3');
    url.searchParams.set('q', query);
    url.searchParams.set('rss', '1'); // Get RSS/Atom feed

    console.log(`FPDS: Searching for "${query}"`);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/atom+xml, application/xml, text/xml',
        'User-Agent': 'BD-Team-Research-Bot/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`FPDS API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const contracts = parseFPDSAtomFeed(xmlText, limit);

    const result: FPDSSearchResult = {
      contracts,
      totalCount: contracts.length,
      query,
      cachedAt: new Date().toISOString(),
    };

    // Cache the result
    await cacheFPDSResult(query, result);

    return result;
  } catch (error) {
    console.error('FPDS search error:', error);
    return {
      contracts: [],
      totalCount: 0,
      query,
    };
  }
}

// Search for incumbent on a specific contract/agency
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
  contracts: FPDSContract[];
}> {
  const { agencyCode, agencyName, keywords = [], naicsCode } = params;

  // Build search query
  let searchKeyword = keywords.join(' ');
  if (agencyName && !agencyCode) {
    searchKeyword = `${agencyName} ${searchKeyword}`;
  }

  const result = await searchFPDS({
    keyword: searchKeyword,
    agencyCode,
    naicsCode,
    limit: 10,
  });

  if (result.contracts.length === 0) {
    return {
      incumbent: null,
      contractValue: null,
      contractYears: null,
      confidence: 'LOW',
      source: 'FPDS (no results found)',
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
    source: `FPDS (${result.contracts.length} contracts found)`,
    contracts: result.contracts.slice(0, 5),
  };
}

// Get vendor's contract history
export async function getVendorHistory(vendorName: string): Promise<{
  totalContracts: number;
  totalValue: number;
  agencies: string[];
  recentContracts: FPDSContract[];
}> {
  const result = await searchFPDS({
    vendorName,
    limit: 50,
  });

  const agencies = [...new Set(result.contracts.map(c => c.agencyName))];
  const totalValue = result.contracts.reduce((sum, c) => sum + (c.obligatedAmount || 0), 0);

  return {
    totalContracts: result.contracts.length,
    totalValue,
    agencies,
    recentContracts: result.contracts.slice(0, 5),
  };
}

// Parse FPDS Atom/XML feed
function parseFPDSAtomFeed(xml: string, limit: number): FPDSContract[] {
  const contracts: FPDSContract[] = [];

  // Simple XML parsing - extract entries
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null && contracts.length < limit) {
    const entry = match[1];

    const contract: FPDSContract = {
      contractId: extractXMLValue(entry, 'id') || `fpds-${contracts.length}`,
      vendorName: extractXMLValue(entry, 'vendorName') ||
                  extractXMLValue(entry, 'VENDOR_FULL_NAME') ||
                  extractFromContent(entry, /vendor[^>]*>([^<]+)/i) ||
                  'Unknown Vendor',
      agencyName: extractXMLValue(entry, 'agencyID') ||
                  extractXMLValue(entry, 'CONTRACTING_AGENCY_NAME') ||
                  extractFromContent(entry, /agency[^>]*>([^<]+)/i) ||
                  'Unknown Agency',
      contractDescription: extractXMLValue(entry, 'title') ||
                          extractXMLValue(entry, 'summary') ||
                          extractXMLValue(entry, 'DESCRIPTION_OF_REQUIREMENT') ||
                          '',
      obligatedAmount: parseFloat(extractXMLValue(entry, 'obligatedAmount') ||
                                  extractXMLValue(entry, 'OBLIGATED_AMOUNT') ||
                                  extractFromContent(entry, /\$?([\d,]+(?:\.\d{2})?)/i)?.replace(/,/g, '') ||
                                  '0'),
      signedDate: extractXMLValue(entry, 'signedDate') ||
                  extractXMLValue(entry, 'DATE_SIGNED') ||
                  extractXMLValue(entry, 'updated') ||
                  '',
      naicsCode: extractXMLValue(entry, 'PRINCIPAL_NAICS_CODE'),
      setAsideType: extractXMLValue(entry, 'TYPE_OF_SET_ASIDE'),
    };

    // Try to extract more details from content/summary
    const content = extractXMLValue(entry, 'content') || extractXMLValue(entry, 'summary') || '';
    if (content) {
      // Extract vendor from content if not found
      if (contract.vendorName === 'Unknown Vendor') {
        const vendorMatch = content.match(/vendor[:\s]+([^,\n<]+)/i);
        if (vendorMatch) contract.vendorName = vendorMatch[1].trim();
      }

      // Extract amount if not found
      if (contract.obligatedAmount === 0) {
        const amountMatch = content.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        if (amountMatch) contract.obligatedAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
      }
    }

    contracts.push(contract);
  }

  return contracts;
}

function extractXMLValue(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

function extractFromContent(xml: string, regex: RegExp): string | undefined {
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

// Cache helpers
async function getCachedFPDSResult(query: string): Promise<FPDSSearchResult | null> {
  try {
    const supabase = getSupabase();
    const cacheKey = `fpds:${query}`;

    const { data } = await supabase
      .from('research_cache')
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (data) {
      // Check if cache is fresh (less than 24 hours)
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return data.data as FPDSSearchResult;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheFPDSResult(query: string, result: FPDSSearchResult): Promise<void> {
  try {
    const supabase = getSupabase();
    const cacheKey = `fpds:${query}`;

    await supabase
      .from('research_cache')
      .upsert({
        cache_key: cacheKey,
        source: 'fpds',
        data: result,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' });
  } catch (error) {
    console.warn('Failed to cache FPDS result:', error);
  }
}

// Format FPDS data for agent response
export function formatFPDSForAgent(contracts: FPDSContract[]): string {
  if (contracts.length === 0) {
    return "No FPDS contract data found.";
  }

  const lines = contracts.slice(0, 3).map(c => {
    const value = c.obligatedAmount ? `$${(c.obligatedAmount / 1000000).toFixed(1)}M` : 'unknown value';
    return `- ${c.vendorName}: ${value} with ${c.agencyName}`;
  });

  return `FPDS shows:\n${lines.join('\n')}`;
}
