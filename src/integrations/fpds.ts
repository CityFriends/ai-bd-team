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

// Search FPDS by contract number (PIID)
export async function searchByContractNumber(contractNumber: string): Promise<FPDSSearchResult> {
  const query = `PIID:"${contractNumber}"`;

  // Check cache first
  const cached = await getCachedFPDSResult(query);
  if (cached) {
    console.log('FPDS: Using cached result for contract number');
    return cached;
  }

  try {
    const url = new URL(FPDS_BASE_URL);
    url.searchParams.set('s', 'FPDS.GOV');
    url.searchParams.set('indexName', 'awardfull');
    url.searchParams.set('templateName', '1.5.3');
    url.searchParams.set('q', query);
    url.searchParams.set('rss', '1');

    console.log(`FPDS: Searching for contract number "${contractNumber}"`);

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
    const contracts = parseFPDSAtomFeed(xmlText, 20);

    const result: FPDSSearchResult = {
      contracts,
      totalCount: contracts.length,
      query,
      cachedAt: new Date().toISOString(),
    };

    await cacheFPDSResult(query, result);
    return result;
  } catch (error) {
    console.error('FPDS contract number search error:', error);
    return { contracts: [], totalCount: 0, query };
  }
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

  // Build search query using FPDS field syntax for better precision
  const queryParts: string[] = [];

  // Use agency code filter for precision (much better than keyword matching agency name)
  if (agencyCode) queryParts.push(`CONTRACTING_AGENCY_CODE:"${agencyCode}"`);
  if (vendorName) queryParts.push(`VENDOR_FULL_NAME:"${vendorName}"`);
  if (naicsCode) queryParts.push(`PRINCIPAL_NAICS_CODE:"${naicsCode}"`);

  // Add keyword last (less precise, but useful for general terms)
  if (keyword) queryParts.push(keyword);

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

// Parse FPDS RSS/XML feed
function parseFPDSAtomFeed(xml: string, limit: number): FPDSContract[] {
  const contracts: FPDSContract[] = [];

  // FPDS returns RSS format with <item> tags, not Atom <entry> tags
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && contracts.length < limit) {
    const entry = match[1];

    // RSS format: title contains "CONTRACT XXX awarded to VENDOR for $AMOUNT"
    const title = extractCDATA(entry, 'title') || '';
    const link = extractXMLValue(entry, 'link') || '';
    const description = extractCDATA(entry, 'description') || '';
    const pubDate = extractXMLValue(entry, 'pubDate') || '';

    // Parse vendor name from title: "awarded to VENDOR NAME," or "awarded to VENDOR NAME for"
    let vendorName = 'Unknown Vendor';
    const vendorMatch = title.match(/awarded to ([^,]+?)(?:,| for | was )/i);
    if (vendorMatch) {
      vendorName = vendorMatch[1].trim();
    }

    // Parse amount from title: "for the amount of $X" or "for $X"
    let amount = 0;
    const amountMatch = title.match(/(?:for the amount of |for |amount of )\$?([-]?[\d,]+(?:\.\d{2})?)/i);
    if (amountMatch) {
      const parsedAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
      amount = isNaN(parsedAmount) ? 0 : Math.abs(parsedAmount); // Use absolute value for modifications
    }

    // Parse contract ID from title: "CONTRACT XXXXX" or "DELIVERY ORDER XXXXX"
    let contractId = `fpds-${contracts.length}`;
    const contractMatch = title.match(/(?:CONTRACT|ORDER|AGREEMENT)\s+([A-Z0-9]+)/i);
    if (contractMatch) {
      contractId = contractMatch[1];
    }

    // Parse contract type from title
    let contractType = 'Unknown';
    if (title.includes('DELIVERY ORDER')) contractType = 'Delivery Order';
    else if (title.includes('DEFINITIVE CONTRACT')) contractType = 'Definitive Contract';
    else if (title.includes('BPA')) contractType = 'BPA';
    else if (title.includes('TASK ORDER')) contractType = 'Task Order';

    // Extract agency code from link (AGENCY_CODE%3A%22XXXX%22)
    let agencyName = 'Unknown Agency';
    const agencyMatch = link.match(/AGENCY_CODE%3A%22(\d+)%22/);
    if (agencyMatch) {
      agencyName = `Agency ${agencyMatch[1]}`;
    }

    // Parse date from description or pubDate
    let signedDate = '';
    const dateMatch = description.match(/signed on (\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      signedDate = dateMatch[1];
    } else if (pubDate) {
      signedDate = pubDate.split('T')[0];
    }

    const contract: FPDSContract = {
      contractId,
      vendorName,
      agencyName,
      contractDescription: title,
      obligatedAmount: amount,
      signedDate,
      contractType,
    };

    contracts.push(contract);
  }

  return contracts;
}

function extractXMLValue(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

function extractCDATA(xml: string, tag: string): string | undefined {
  // Match CDATA content: <tag><![CDATA[content]]></tag>
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (match) return match[1].trim();

  // Fall back to regular tag content
  return extractXMLValue(xml, tag);
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
