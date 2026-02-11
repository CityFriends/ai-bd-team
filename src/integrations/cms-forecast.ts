/**
 * CMS Forecast Excel Parser
 *
 * Downloads and parses the CMS procurement forecast Excel file.
 * URL: https://www.cms.gov/about-cms/work-us/business-resources/contract-opportunities
 *
 * The Excel file contains upcoming contract opportunities from CMS.
 */

import * as XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import { getSupabase } from './supabase.js';

export interface CMSForecastOpportunity {
  title: string;
  description?: string;
  component?: string; // CMS component (e.g., OIT, CMMI, CCIIO)
  naicsCode?: string;
  estimatedValue?: string;
  estimatedRelease?: string;
  setAside?: string;
  contactName?: string;
  contactEmail?: string;
  contractType?: string;
  status?: string;
}

const CMS_FORECAST_PAGE = 'https://www.cms.gov/about-cms/work-us/business-resources/contract-opportunities';

/**
 * Find the Excel download link on the CMS page
 */
async function findExcelDownloadLink(): Promise<string | null> {
  try {
    const response = await fetch(CMS_FORECAST_PAGE);
    const html = await response.text();
    const $ = cheerio.load(html);

    // Look for Excel file links (.xlsx, .xls)
    // Use object to avoid TypeScript closure narrowing issues
    const result: { link: string | null } = { link: null };

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('.xlsx') || href.includes('.xls'))) {
        // Check if it's a forecast-related file
        const text = $(el).text().toLowerCase();
        if (text.includes('forecast') || text.includes('opportunity') || text.includes('procurement')) {
          result.link = href;
          return false; // break
        }
        // If no text match, still capture it as a candidate
        if (!result.link) {
          result.link = href;
        }
      }
    });

    // Also check for common CMS patterns
    if (!result.link) {
      $('a[href*="forecast"], a[href*="Forecast"], a[href*="FORECAST"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && (href.endsWith('.xlsx') || href.endsWith('.xls'))) {
          result.link = href;
          return false;
        }
      });
    }

    // Make absolute URL if needed
    let excelLink = result.link;
    if (excelLink && !excelLink.startsWith('http')) {
      const base = new URL(CMS_FORECAST_PAGE);
      excelLink = new URL(excelLink, base).toString();
    }

    console.log(`[CMS Forecast] Found Excel link: ${excelLink}`);
    return excelLink;
  } catch (err) {
    console.error('[CMS Forecast] Error finding Excel link:', err);
    return null;
  }
}

/**
 * Download and parse the CMS forecast Excel file
 */
export async function downloadAndParseCMSForecast(): Promise<CMSForecastOpportunity[]> {
  const excelUrl = await findExcelDownloadLink();

  if (!excelUrl) {
    console.error('[CMS Forecast] Could not find Excel download link');
    return [];
  }

  console.log(`[CMS Forecast] Downloading: ${excelUrl}`);

  try {
    const response = await fetch(excelUrl);
    const buffer = await response.arrayBuffer();

    const workbook = XLSX.read(buffer, { type: 'array' });

    // Get the first sheet (or look for a specific one)
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];

    console.log(`[CMS Forecast] Parsed ${data.length} rows from sheet "${sheetName}"`);

    // Find header row and map columns
    const opportunities = parseExcelData(data);

    console.log(`[CMS Forecast] Extracted ${opportunities.length} opportunities`);

    return opportunities;
  } catch (err) {
    console.error('[CMS Forecast] Error downloading/parsing Excel:', err);
    return [];
  }
}

/**
 * Parse Excel data into structured opportunities
 * Handles varying column layouts by looking for common headers
 */
function parseExcelData(data: string[][]): CMSForecastOpportunity[] {
  const opportunities: CMSForecastOpportunity[] = [];

  // Find header row
  let headerRow = -1;
  let columnMap: Record<string, number> = {};

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row) continue;

    const rowText = row.map(c => String(c || '').toLowerCase()).join(' ');

    // Look for common header keywords
    if (rowText.includes('title') || rowText.includes('description') || rowText.includes('naics') || rowText.includes('contract')) {
      headerRow = i;

      // Map columns
      row.forEach((cell, idx) => {
        const header = String(cell || '').toLowerCase().trim();

        if (header.includes('title') || header.includes('name')) {
          columnMap.title = idx;
        } else if (header.includes('description') || header.includes('scope')) {
          columnMap.description = idx;
        } else if (header.includes('component') || header.includes('office') || header.includes('organization')) {
          columnMap.component = idx;
        } else if (header.includes('naics')) {
          columnMap.naicsCode = idx;
        } else if (header.includes('value') || header.includes('amount') || header.includes('estimate')) {
          columnMap.estimatedValue = idx;
        } else if (header.includes('release') || header.includes('award') || header.includes('date') || header.includes('quarter') || header.includes('fy')) {
          if (!columnMap.estimatedRelease) columnMap.estimatedRelease = idx;
        } else if (header.includes('set-aside') || header.includes('setaside') || header.includes('small business')) {
          columnMap.setAside = idx;
        } else if (header.includes('contact') && header.includes('name')) {
          columnMap.contactName = idx;
        } else if (header.includes('email')) {
          columnMap.contactEmail = idx;
        } else if (header.includes('type') && header.includes('contract')) {
          columnMap.contractType = idx;
        } else if (header.includes('status')) {
          columnMap.status = idx;
        }
      });

      console.log(`[CMS Forecast] Found header at row ${i}, columns:`, columnMap);
      break;
    }
  }

  if (headerRow === -1) {
    console.warn('[CMS Forecast] Could not find header row');
    // Try to use first row as headers
    headerRow = 0;
    columnMap = { title: 0, description: 1 };
  }

  // Parse data rows
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every(c => !c)) continue; // Skip empty rows

    const title = columnMap.title !== undefined ? String(row[columnMap.title] || '').trim() : '';

    if (!title) continue; // Skip rows without title

    opportunities.push({
      title,
      description: columnMap.description !== undefined ? String(row[columnMap.description] || '').trim() : undefined,
      component: columnMap.component !== undefined ? String(row[columnMap.component] || '').trim() : undefined,
      naicsCode: columnMap.naicsCode !== undefined ? String(row[columnMap.naicsCode] || '').trim() : undefined,
      estimatedValue: columnMap.estimatedValue !== undefined ? String(row[columnMap.estimatedValue] || '').trim() : undefined,
      estimatedRelease: columnMap.estimatedRelease !== undefined ? String(row[columnMap.estimatedRelease] || '').trim() : undefined,
      setAside: columnMap.setAside !== undefined ? String(row[columnMap.setAside] || '').trim() : undefined,
      contactName: columnMap.contactName !== undefined ? String(row[columnMap.contactName] || '').trim() : undefined,
      contactEmail: columnMap.contactEmail !== undefined ? String(row[columnMap.contactEmail] || '').trim() : undefined,
      contractType: columnMap.contractType !== undefined ? String(row[columnMap.contractType] || '').trim() : undefined,
      status: columnMap.status !== undefined ? String(row[columnMap.status] || '').trim() : undefined,
    });
  }

  return opportunities;
}

/**
 * Score a CMS forecast opportunity for relevance
 */
export function scoreCMSOpportunity(opp: CMSForecastOpportunity): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  const text = `${opp.title} ${opp.description || ''}`.toLowerCase();

  // Relevant keywords
  const relevantKeywords = [
    'software', 'development', 'web', 'application', 'digital',
    'design', 'ux', 'user experience', 'human-centered', 'hcd',
    'modernization', 'agile', 'cloud', 'portal', 'website',
    'ai', 'artificial intelligence', 'data', 'analytics',
    'it services', 'technology',
  ];

  const matched = relevantKeywords.filter(kw => text.includes(kw));
  if (matched.length > 0) {
    score += matched.length * 8;
    reasons.push(`Keywords: ${matched.slice(0, 3).join(', ')}`);
  }

  // NAICS match
  const ourNaics = ['541511', '541512', '541519', '541611', '541430'];
  if (opp.naicsCode && ourNaics.some(n => opp.naicsCode?.includes(n))) {
    score += 15;
    reasons.push(`NAICS match: ${opp.naicsCode}`);
  }

  // Set-aside bonus
  if (opp.setAside) {
    const sa = opp.setAside.toLowerCase();
    if (sa.includes('8(a)') || sa.includes('wosb') || sa.includes('small')) {
      score += 10;
      reasons.push(`Set-aside: ${opp.setAside}`);
    }
  }

  // Exclude keywords
  const excludeKeywords = ['infrastructure', 'hardware', 'construction', 'facilities', 'janitorial'];
  if (excludeKeywords.some(kw => text.includes(kw))) {
    score -= 30;
    reasons.push('Not our space');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * Save CMS forecast opportunities to database
 */
export async function saveCMSForecasts(opportunities: CMSForecastOpportunity[]): Promise<number> {
  const supabase = getSupabase();
  let saved = 0;

  for (const opp of opportunities) {
    try {
      const { error } = await supabase.from('agency_forecasts').upsert({
        agency: 'CMS',
        sub_agency: opp.component,
        title: opp.title,
        description: opp.description,
        naics_code: opp.naicsCode,
        estimated_value: opp.estimatedValue,
        estimated_release: opp.estimatedRelease,
        set_aside: opp.setAside,
        contact_name: opp.contactName,
        contact_email: opp.contactEmail,
        source_url: CMS_FORECAST_PAGE,
        status: 'upcoming',
        last_checked: new Date().toISOString(),
      }, {
        onConflict: 'agency,title',
      });

      if (!error) saved++;
    } catch {
      // Ignore duplicates
    }
  }

  console.log(`[CMS Forecast] Saved ${saved} opportunities to database`);
  return saved;
}

/**
 * Main function: Scan CMS forecast and return relevant opportunities
 */
export async function scanCMSForecast(): Promise<CMSForecastOpportunity[]> {
  console.log('[CMS Forecast] Starting scan...');

  const opportunities = await downloadAndParseCMSForecast();

  if (opportunities.length === 0) {
    console.log('[CMS Forecast] No opportunities found');
    return [];
  }

  // Score and filter
  const relevant = opportunities
    .map(opp => ({ opp, ...scoreCMSOpportunity(opp) }))
    .filter(({ score }) => score >= 60)
    .sort((a, b) => b.score - a.score);

  console.log(`[CMS Forecast] ${relevant.length} relevant opportunities (score >= 60)`);

  // Save to database
  await saveCMSForecasts(opportunities);

  return relevant.map(r => r.opp);
}
