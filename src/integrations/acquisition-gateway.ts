/**
 * Acquisition Gateway / FCO (Forecast of Contracting Opportunities) Integration
 *
 * The FCO tool at acquisitiongateway.gov aggregates procurement forecasts from
 * across the federal government. It provides standardized forecast data that
 * vendors can search by NAICS, agency, location, etc.
 *
 * Note: The Acquisition Gateway API is limited. This integration uses the FCO
 * web interface search functionality.
 *
 * Sources:
 * - https://acquisitiongateway.gov/forecast
 * - https://www.gsa.gov/small-business/forecast-of-contracting-opportunities
 */

import { getSupabase } from './supabase.js';

const FCO_BASE_URL = 'https://acquisitiongateway.gov';
const FCO_SEARCH_URL = `${FCO_BASE_URL}/forecast`;

export interface FCOForecast {
  id: string;
  title: string;
  description?: string;
  agency: string;
  subAgency?: string;
  naicsCode?: string;
  estimatedValue?: string;
  estimatedAwardDate?: string;
  acquisitionStrategy?: string;
  contractType?: string;
  setAside?: string;
  placeOfPerformance?: string;
  contactName?: string;
  contactEmail?: string;
  status?: 'planned' | 'posted' | 'awarded' | 'cancelled';
  sourceUrl: string;
  lastUpdated?: string;
}

export interface FCOSearchParams {
  keyword?: string;
  naicsCodes?: string[];
  agencies?: string[];
  setAsides?: string[];
  estimatedAwardDateFrom?: string;
  estimatedAwardDateTo?: string;
  limit?: number;
}

export interface FCOSearchResult {
  forecasts: FCOForecast[];
  totalCount: number;
  source: string;
}

/**
 * Search the FCO tool for procurement forecasts
 *
 * Note: This attempts to use the FCO web interface. The Acquisition Gateway
 * API is limited, so we may need to fall back to scraping or use cached data.
 */
export async function searchFCO(params: FCOSearchParams): Promise<FCOSearchResult> {
  const { keyword, naicsCodes = [], agencies = [], setAsides = [], limit = 20 } = params;

  // Check cache first
  const cacheKey = `fco:${JSON.stringify(params)}`;
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    console.log('FCO: Using cached result');
    return cached;
  }

  try {
    // Build search URL with query parameters
    const searchUrl = new URL(FCO_SEARCH_URL);

    if (keyword) {
      searchUrl.searchParams.set('keyword', keyword);
    }
    if (naicsCodes.length > 0) {
      searchUrl.searchParams.set('naics', naicsCodes.join(','));
    }
    if (agencies.length > 0) {
      searchUrl.searchParams.set('agency', agencies.join(','));
    }
    if (setAsides.length > 0) {
      searchUrl.searchParams.set('setaside', setAsides.join(','));
    }

    console.log(`FCO: Searching ${searchUrl.toString()}`);

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FFTC-BD-Bot/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      console.warn(`FCO: Search returned ${response.status}`);
      return { forecasts: [], totalCount: 0, source: 'FCO (error)' };
    }

    const html = await response.text();
    const forecasts = parseFCOSearchResults(html, limit);

    const result: FCOSearchResult = {
      forecasts,
      totalCount: forecasts.length,
      source: 'Acquisition Gateway FCO',
    };

    // Cache results for 24 hours
    await cacheResult(cacheKey, result);

    return result;
  } catch (error) {
    console.error('FCO search error:', error);
    return { forecasts: [], totalCount: 0, source: 'FCO (error)' };
  }
}

/**
 * Parse FCO search results from HTML
 *
 * This is a heuristic parser for the FCO web interface. It extracts
 * forecast data from the search results page.
 */
function parseFCOSearchResults(html: string, limit: number): FCOForecast[] {
  const forecasts: FCOForecast[] = [];

  // Look for forecast cards/rows in the HTML
  // The FCO tool typically displays forecasts in a table or card format

  // Pattern 1: Look for data rows with forecast information
  const rowPatterns = [
    // Table rows
    /<tr[^>]*class="[^"]*forecast[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi,
    // Card elements
    /<div[^>]*class="[^"]*forecast-card[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    // List items
    /<li[^>]*class="[^"]*forecast-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi,
  ];

  for (const pattern of rowPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      if (forecasts.length >= limit) break;

      const rowHtml = match[1];
      const forecast = extractForecastFromHtml(rowHtml);
      if (forecast) {
        forecasts.push(forecast);
      }
    }
    if (forecasts.length > 0) break;
  }

  // If no structured data found, try generic extraction
  if (forecasts.length === 0) {
    const genericForecasts = extractGenericForecasts(html, limit);
    forecasts.push(...genericForecasts);
  }

  return forecasts;
}

/**
 * Extract forecast data from an HTML row/card
 */
function extractForecastFromHtml(html: string): FCOForecast | null {
  // Clean HTML and extract text content
  const cleanHtml = (s: string) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  // Try to extract key fields
  const title =
    extractField(html, ['title', 'name', 'requirement', 'project']) ||
    extractFirstMatch(html, /<(?:h[1-6]|strong|b)[^>]*>([\s\S]*?)<\/(?:h[1-6]|strong|b)>/i);

  if (!title || title.length < 10) return null;

  const agency = extractField(html, ['agency', 'department', 'organization']);
  const naics = extractField(html, ['naics']) || extractFirstMatch(html, /\b(\d{6})\b/);
  const value = extractField(html, ['value', 'amount', 'estimated', 'dollars']);
  const awardDate = extractField(html, ['award', 'date', 'timeframe', 'quarter']);
  const setAside = extractField(html, ['set-aside', 'setaside', 'small business']);
  const contact = extractField(html, ['contact', 'poc', 'email']);

  // Generate a unique ID
  const id = `fco-${Buffer.from(title.slice(0, 50)).toString('base64').slice(0, 16)}`;

  return {
    id,
    title: cleanHtml(title).slice(0, 300),
    agency: agency ? cleanHtml(agency) : 'Unknown',
    naicsCode: naics ? cleanHtml(naics).slice(0, 6) : undefined,
    estimatedValue: value ? cleanHtml(value) : undefined,
    estimatedAwardDate: awardDate ? cleanHtml(awardDate) : undefined,
    setAside: setAside ? cleanHtml(setAside) : undefined,
    contactEmail: contact && contact.includes('@') ? cleanHtml(contact) : undefined,
    sourceUrl: FCO_SEARCH_URL,
  };
}

/**
 * Extract a field value from HTML by looking for common patterns
 */
function extractField(html: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    // Look for label:value patterns
    const patterns = [
      new RegExp(`${kw}[:\\s]*<[^>]*>([^<]+)<`, 'i'),
      new RegExp(`<[^>]*${kw}[^>]*>([^<]+)<`, 'i'),
      new RegExp(`${kw}[:\\s]+([^<]+)(?:<|$)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1] && match[1].trim().length > 1) {
        return match[1].trim();
      }
    }
  }
  return null;
}

/**
 * Extract first regex match from HTML
 */
function extractFirstMatch(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Generic extraction when structured patterns don't match
 */
function extractGenericForecasts(html: string, limit: number): FCOForecast[] {
  const forecasts: FCOForecast[] = [];

  // Look for any content that looks like a forecast listing
  // This is a last resort for pages with non-standard formatting

  // Find all links that might be forecast detail pages
  const linkMatches = html.matchAll(/<a[^>]*href="([^"]*forecast[^"]*)"[^>]*>([^<]+)</gi);

  for (const match of linkMatches) {
    if (forecasts.length >= limit) break;

    const url = match[1];
    const title = match[2].trim();

    if (title.length > 20) {
      forecasts.push({
        id: `fco-generic-${forecasts.length}`,
        title: title.slice(0, 300),
        agency: 'See details',
        sourceUrl: url.startsWith('http') ? url : `${FCO_BASE_URL}${url}`,
      });
    }
  }

  return forecasts;
}

/**
 * Get forecasts relevant to FFTC's capabilities
 */
export async function getRelevantForecasts(naicsCodes: string[]): Promise<FCOSearchResult> {
  console.log(`FCO: Searching for NAICS codes: ${naicsCodes.join(', ')}`);

  const allForecasts: FCOForecast[] = [];

  // Search for each NAICS code
  for (const naics of naicsCodes.slice(0, 5)) {
    // Limit to avoid rate limiting
    const result = await searchFCO({ naicsCodes: [naics], limit: 10 });
    allForecasts.push(...result.forecasts);

    // Rate limit
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Deduplicate by title similarity
  const seen = new Set<string>();
  const unique = allForecasts.filter((f) => {
    const key = f.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    forecasts: unique,
    totalCount: unique.length,
    source: 'Acquisition Gateway FCO',
  };
}

/**
 * Score a forecast for relevance to FFTC
 */
export function scoreForecastRelevance(forecast: FCOForecast, relevanceKeywords: string[]): number {
  const text = `${forecast.title} ${forecast.description || ''}`.toLowerCase();
  let score = 0;

  // Check for relevant keywords
  for (const kw of relevanceKeywords) {
    if (text.includes(kw.toLowerCase())) {
      score += 15;
    }
  }

  // Boost for small business set-asides
  if (forecast.setAside) {
    const setAside = forecast.setAside.toLowerCase();
    if (
      setAside.includes('8(a)') ||
      setAside.includes('wosb') ||
      setAside.includes('sdvosb') ||
      setAside.includes('hubzone') ||
      setAside.includes('small')
    ) {
      score += 20;
    }
  }

  // Boost for HCD/UX keywords
  const hcdKeywords = ['human-centered', 'user experience', 'ux', 'design', 'research', 'digital'];
  for (const kw of hcdKeywords) {
    if (text.includes(kw)) {
      score += 10;
    }
  }

  return Math.min(score, 100);
}

/**
 * Format forecast for agent response
 */
export function formatFCOForAgent(forecasts: FCOForecast[]): string {
  if (forecasts.length === 0) {
    return 'No relevant forecasts found in Acquisition Gateway FCO.';
  }

  const lines = forecasts.slice(0, 5).map((f) => {
    let line = `• *${f.title.slice(0, 60)}${f.title.length > 60 ? '...' : ''}*`;
    line += `\n  Agency: ${f.agency}`;
    if (f.estimatedValue) line += ` | Value: ${f.estimatedValue}`;
    if (f.estimatedAwardDate) line += ` | Expected: ${f.estimatedAwardDate}`;
    if (f.setAside) line += `\n  Set-aside: ${f.setAside}`;
    return line;
  });

  return `*Acquisition Gateway Forecasts*\n${lines.join('\n\n')}`;
}

// Cache helpers
async function getCachedResult(cacheKey: string): Promise<FCOSearchResult | null> {
  try {
    const supabase = getSupabase();

    const { data } = await supabase
      .from('research_cache')
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (data) {
      // Cache for 24 hours
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return data.data as FCOSearchResult;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheResult(cacheKey: string, result: FCOSearchResult): Promise<void> {
  try {
    const supabase = getSupabase();

    await supabase.from('research_cache').upsert(
      {
        cache_key: cacheKey,
        source: 'acquisition-gateway',
        data: result,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );
  } catch (error) {
    console.warn('Failed to cache FCO result:', error);
  }
}
