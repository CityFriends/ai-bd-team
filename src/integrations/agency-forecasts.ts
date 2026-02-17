/**
 * Agency Forecast Scraper
 *
 * Scrapes procurement forecast pages from federal agencies to get early intel
 * on upcoming opportunities. Runs weekly to gather pre-SAM.gov data.
 */

import { getSupabase } from './supabase.js';
import { OPPORTUNITY_FILTERS } from '../config/opportunity-filters.js';

// Agency forecast sources
export const AGENCY_FORECAST_SOURCES: Array<{
  agency: string;
  abbrev: string;
  url: string;
  format: 'html' | 'pdf' | 'json' | 'unknown';
}> = [
  {
    agency: 'Centers for Medicare & Medicaid Services',
    abbrev: 'CMS',
    url: 'https://www.cms.gov/about-cms/contracting/forecast-contract-opportunities',
    format: 'html',
  },
  {
    agency: 'Department of Veterans Affairs',
    abbrev: 'VA',
    url: 'https://www.va.gov/opal/fo/forecast.asp',
    format: 'html',
  },
  {
    agency: 'Department of Health and Human Services',
    abbrev: 'HHS',
    url: 'https://www.hhs.gov/grants-contracts/contract-opportunities/forecast/index.html',
    format: 'html',
  },
  {
    agency: 'General Services Administration',
    abbrev: 'GSA',
    url: 'https://www.gsa.gov/buying-selling/purchasing-programs/gsa-schedule/gsa-schedule-procurement-forecast',
    format: 'html',
  },
  {
    agency: 'Federal Emergency Management Agency',
    abbrev: 'FEMA',
    url: 'https://www.fema.gov/about/doing-business-with-fema/forecast',
    format: 'html',
  },
  {
    agency: 'Department of Labor',
    abbrev: 'DOL',
    url: 'https://www.dol.gov/agencies/oasam/centers-offices/procurement-services/forecast',
    format: 'html',
  },
  {
    agency: 'Department of State',
    abbrev: 'STATE',
    url: 'https://www.state.gov/procurement-forecast/',
    format: 'html',
  },
  {
    agency: 'Department of Education',
    abbrev: 'ED',
    url: 'https://www.ed.gov/about/ed-jobs/contracts/forecast',
    format: 'html',
  },
  {
    agency: 'Department of Homeland Security',
    abbrev: 'DHS',
    url: 'https://www.dhs.gov/procurement-forecast',
    format: 'html',
  },
  {
    agency: 'Small Business Administration',
    abbrev: 'SBA',
    url: 'https://www.sba.gov/contracting/resources-small-businesses/forecast-contracting-opportunities',
    format: 'html',
  },
  {
    agency: 'Department of Agriculture',
    abbrev: 'USDA',
    url: 'https://www.usda.gov/da/procurement/forecast',
    format: 'html',
  },
  {
    agency: 'Department of Transportation',
    abbrev: 'DOT',
    url: 'https://www.transportation.gov/administrations/office-small-disadvantaged-business-utilization/procurement-forecast',
    format: 'html',
  },
];

export interface ForecastOpportunity {
  agency: string;
  sub_agency?: string;
  title: string;
  description?: string;
  estimated_release?: string;
  estimated_value?: string;
  naics_code?: string;
  set_aside?: string;
  contract_type?: string;
  contact_name?: string;
  contact_email?: string;
  source_url: string;
  relevance_score?: number;
}

// Keywords that indicate relevance to FFTC
const RELEVANCE_KEYWORDS = {
  high: [
    'human-centered design',
    'hcd',
    'user experience',
    'ux',
    'user research',
    'journey mapping',
    'design thinking',
    'service design',
    'customer experience',
    'digital services',
    'modernization',
    'agile',
    'devops',
    'cloud',
    'accessibility',
    '508 compliance',
    'plain language',
    'content strategy',
  ],
  medium: [
    'website',
    'portal',
    'mobile',
    'application',
    'software development',
    'it services',
    'information technology',
    'data analytics',
    'dashboard',
    'user interface',
    'ui',
    'design',
    'research',
    'discovery',
    'product management',
    'program support',
    'technical assistance',
  ],
  low: [
    'consulting',
    'support services',
    'program management',
    'communications',
    'training',
    'facilitation',
    'strategic planning',
    'stakeholder engagement',
  ],
};

// Score a forecast opportunity for relevance
export function scoreForecastRelevance(title: string, description?: string): number {
  const text = `${title} ${description || ''}`.toLowerCase();
  let score = 0;

  // High relevance keywords (+20 each, max 60)
  const highMatches = RELEVANCE_KEYWORDS.high.filter((kw) => text.includes(kw));
  score += Math.min(highMatches.length * 20, 60);

  // Medium relevance keywords (+10 each, max 30)
  const medMatches = RELEVANCE_KEYWORDS.medium.filter((kw) => text.includes(kw));
  score += Math.min(medMatches.length * 10, 30);

  // Low relevance keywords (+5 each, max 10)
  const lowMatches = RELEVANCE_KEYWORDS.low.filter((kw) => text.includes(kw));
  score += Math.min(lowMatches.length * 5, 10);

  // NAICS boost: if title mentions our NAICS codes
  if (OPPORTUNITY_FILTERS.naicsCodes.some((naics) => text.includes(naics))) {
    score += 15;
  }

  // Set-aside boost: if it mentions small business set-asides
  if (
    text.includes('8(a)') ||
    text.includes('wosb') ||
    text.includes('sdvosb') ||
    text.includes('hubzone') ||
    text.includes('small business set-aside')
  ) {
    score += 10;
  }

  return Math.min(score, 100);
}

// Parse date strings from various formats
function parseEstimatedDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const lowerStr = dateStr.toLowerCase();

  // Quarters
  if (/q[1-4]\s*20\d{2}/i.test(lowerStr)) {
    const match = lowerStr.match(/q([1-4])\s*(20\d{2})/i);
    if (match) {
      const quarter = parseInt(match[1]);
      const year = parseInt(match[2]);
      const month = (quarter - 1) * 3 + 1;
      return `${year}-${String(month).padStart(2, '0')}-01`;
    }
  }

  // Fiscal year quarters (FY starts in October)
  if (/fy\s*20\d{2}\s*q[1-4]/i.test(lowerStr)) {
    const match = lowerStr.match(/fy\s*(20\d{2})\s*q([1-4])/i);
    if (match) {
      const fy = parseInt(match[1]);
      const quarter = parseInt(match[2]);
      // FY Q1 = Oct-Dec, Q2 = Jan-Mar, Q3 = Apr-Jun, Q4 = Jul-Sep
      const monthMap: Record<number, number> = { 1: 10, 2: 1, 3: 4, 4: 7 };
      const month = monthMap[quarter];
      const year = quarter === 1 ? fy - 1 : fy;
      return `${year}-${String(month).padStart(2, '0')}-01`;
    }
  }

  // Month Year format (e.g., "March 2026")
  const monthYearMatch = lowerStr.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s*(20\d{2})/i
  );
  if (monthYearMatch) {
    const months: Record<string, string> = {
      january: '01',
      february: '02',
      march: '03',
      april: '04',
      may: '05',
      june: '06',
      july: '07',
      august: '08',
      september: '09',
      october: '10',
      november: '11',
      december: '12',
    };
    const month = months[monthYearMatch[1].toLowerCase()];
    const year = monthYearMatch[2];
    return `${year}-${month}-01`;
  }

  // Already a date-like string
  if (/20\d{2}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr;
  }

  return null;
}

// Fetch and parse a forecast page (basic HTML parsing)
export async function fetchForecastPage(
  source: (typeof AGENCY_FORECAST_SOURCES)[0]
): Promise<ForecastOpportunity[]> {
  console.log(`[Forecast] Fetching ${source.abbrev} from ${source.url}`);

  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FFTC-BD-Bot/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      console.warn(`[Forecast] ${source.abbrev} returned ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Log the raw response length for debugging
    console.log(`[Forecast] ${source.abbrev} received ${html.length} bytes`);

    // Parse opportunities from HTML
    // This is a simplified parser - real implementation would need agency-specific parsers
    const opportunities = parseGenericForecastHTML(html, source);

    console.log(
      `[Forecast] ${source.abbrev} found ${opportunities.length} potential opportunities`
    );

    return opportunities;
  } catch (err) {
    console.error(`[Forecast] Error fetching ${source.abbrev}:`, err);
    return [];
  }
}

// Generic HTML parser for forecast tables
// This attempts to find tables with opportunity data
function parseGenericForecastHTML(
  html: string,
  source: (typeof AGENCY_FORECAST_SOURCES)[0]
): ForecastOpportunity[] {
  const opportunities: ForecastOpportunity[] = [];

  // Look for table rows that might contain opportunity data
  // This is a heuristic approach - real implementation would be agency-specific

  // Simple row extraction from tables
  // Match table rows
  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const match of trMatches) {
    const rowHtml = match[1];

    // Extract cell contents
    const cells: string[] = [];
    const cellMatches = rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);

    for (const cellMatch of cellMatches) {
      // Strip HTML tags and clean whitespace
      const cellText = cellMatch[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(cellText);
    }

    // Skip header rows or empty rows
    if (cells.length < 2) continue;
    if (cells.some((c) => /^(title|description|naics|date|value)$/i.test(c))) continue;

    // Try to identify if this looks like an opportunity row
    const hasTitle = cells.some((c) => c.length > 20 && c.length < 500);

    if (hasTitle) {
      // Best guess at which cell is what
      const titleCell = cells.find((c) => c.length > 20 && c.length < 500) || cells[0];
      const dateCell = cells.find((c) => /20\d{2}|q[1-4]|fy/i.test(c));
      const valueCell = cells.find((c) => /\$|\d+[mk]/i.test(c));
      const naicsCell = cells.find((c) => /^\d{6}$/.test(c.trim()));
      const setAsideCell = cells.find((c) => /8\(a\)|wosb|sdvosb|hubzone|small\s+bus/i.test(c));

      const relevance = scoreForecastRelevance(titleCell, cells.join(' '));

      // Only include if relevant enough
      if (relevance >= 30) {
        opportunities.push({
          agency: source.abbrev,
          title: titleCell.slice(0, 300),
          description: cells.slice(1).join(' ').slice(0, 1000),
          estimated_release: dateCell ? parseEstimatedDate(dateCell) || dateCell : undefined,
          estimated_value: valueCell,
          naics_code: naicsCell,
          set_aside: setAsideCell,
          source_url: source.url,
          relevance_score: relevance,
        });
      }
    }
  }

  return opportunities;
}

// Save forecasts to database
export async function saveForecast(forecast: ForecastOpportunity): Promise<boolean> {
  try {
    const supabase = getSupabase();

    // Check if this forecast already exists (by agency + title)
    const { data: existing } = await supabase
      .from('agency_forecasts')
      .select('id')
      .eq('agency', forecast.agency)
      .eq('title', forecast.title)
      .single();

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from('agency_forecasts')
        .update({
          ...forecast,
          last_checked: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (error) throw error;
      console.log(`[Forecast] Updated: ${forecast.title.slice(0, 50)}...`);
    } else {
      // Insert new
      const { error } = await supabase.from('agency_forecasts').insert({
        ...forecast,
        status: 'upcoming',
        last_checked: new Date().toISOString(),
      });

      if (error) throw error;
      console.log(`[Forecast] Added: ${forecast.title.slice(0, 50)}...`);
    }

    return true;
  } catch (err) {
    console.error(`[Forecast] Save error:`, err);
    return false;
  }
}

// Get high-relevance upcoming forecasts
export async function getUpcomingForecasts(
  minRelevance: number = 60
): Promise<ForecastOpportunity[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('agency_forecasts')
      .select('*')
      .eq('status', 'upcoming')
      .gte('relevance_score', minRelevance)
      .order('relevance_score', { ascending: false })
      .order('estimated_release', { ascending: true })
      .limit(20);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error(`[Forecast] Query error:`, err);
    return [];
  }
}

// Check if a SAM.gov opportunity matches a forecast
export async function matchForecastToSAM(
  samTitle: string,
  samAgency: string
): Promise<{ matched: boolean; forecastId?: string; forecastTitle?: string }> {
  try {
    const supabase = getSupabase();

    // Look for forecasts with similar titles from the same agency
    const { data: forecasts } = await supabase
      .from('agency_forecasts')
      .select('id, title')
      .eq('agency', samAgency)
      .eq('status', 'upcoming');

    if (!forecasts || forecasts.length === 0) {
      return { matched: false };
    }

    // Simple title similarity check
    const samWords = samTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    for (const forecast of forecasts) {
      const forecastWords = forecast.title
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 3);
      const commonWords = samWords.filter((w) => forecastWords.includes(w));

      // If >40% of words match, consider it a match
      if (commonWords.length / Math.max(samWords.length, forecastWords.length) > 0.4) {
        return { matched: true, forecastId: forecast.id, forecastTitle: forecast.title };
      }
    }

    return { matched: false };
  } catch (err) {
    console.error(`[Forecast] Match error:`, err);
    return { matched: false };
  }
}

// Update a forecast when it hits SAM.gov
export async function linkForecastToSAM(forecastId: string, samUrl: string): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('agency_forecasts')
      .update({
        status: 'released',
        sam_gov_link: samUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', forecastId);

    if (error) throw error;
    console.log(`[Forecast] Linked to SAM: ${forecastId}`);
    return true;
  } catch (err) {
    console.error(`[Forecast] Link error:`, err);
    return false;
  }
}

// Run full forecast scan
export async function runForecastScan(): Promise<{
  total: number;
  saved: number;
  byAgency: Record<string, number>;
}> {
  console.log('[Forecast] Starting full agency forecast scan...\n');

  let total = 0;
  let saved = 0;
  const byAgency: Record<string, number> = {};

  for (const source of AGENCY_FORECAST_SOURCES) {
    try {
      const opportunities = await fetchForecastPage(source);
      total += opportunities.length;
      byAgency[source.abbrev] = 0;

      for (const opp of opportunities) {
        const success = await saveForecast(opp);
        if (success) {
          saved++;
          byAgency[source.abbrev]++;
        }
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[Forecast] Error processing ${source.abbrev}:`, err);
    }
  }

  console.log(`\n[Forecast] Scan complete: ${saved}/${total} opportunities saved`);

  return { total, saved, byAgency };
}
