// USASpending API Integration
// Used by David to research agency budgets and spending trends

import { getSupabase } from './supabase.js';

const USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';

export interface AgencySpending {
  agencyName: string;
  agencyCode: string;
  totalObligations: number;
  totalOutlays: number;
  fiscalYear: number;
}

export interface SpendingByCategory {
  category: string;
  amount: number;
  percentOfTotal: number;
}

export interface ContractorSpending {
  recipientName: string;
  recipientDuns?: string;
  totalAmount: number;
  contractCount: number;
}

export interface AgencyBudgetTrend {
  fiscalYear: number;
  totalBudget: number;
  itSpending?: number;
  servicesSpending?: number;
}

// Get agency spending overview
export async function getAgencySpending(params: {
  agencyCode?: string;
  agencyName?: string;
  fiscalYear?: number;
}): Promise<{
  spending: AgencySpending | null;
  topCategories: SpendingByCategory[];
  topContractors: ContractorSpending[];
  source: string;
}> {
  const { agencyCode, agencyName, fiscalYear = new Date().getFullYear() } = params;

  // Check cache
  const cacheKey = `usaspending:agency:${agencyCode || agencyName}:${fiscalYear}`;
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    console.log('USASpending: Using cached result');
    return cached;
  }

  try {
    // Search for agency if we only have name
    let toptierCode = agencyCode;
    if (!toptierCode && agencyName) {
      toptierCode = await findAgencyCode(agencyName);
    }

    if (!toptierCode) {
      return {
        spending: null,
        topCategories: [],
        topContractors: [],
        source: 'USASpending (agency not found)',
      };
    }

    console.log(`USASpending: Fetching data for agency ${toptierCode}`);

    // Get agency overview
    const overviewResponse = await fetch(
      `${USASPENDING_BASE_URL}/agency/${toptierCode}/?fiscal_year=${fiscalYear}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    let spending: AgencySpending | null = null;

    if (overviewResponse.ok) {
      const overviewData = (await overviewResponse.json()) as any;
      spending = {
        agencyName: overviewData.name || agencyName || 'Unknown',
        agencyCode: toptierCode,
        totalObligations: overviewData.total_obligations || 0,
        totalOutlays: overviewData.total_outlays || 0,
        fiscalYear,
      };
    }

    // Get spending by category (using spending_by_category endpoint)
    const topCategories = await getSpendingByCategory(toptierCode, fiscalYear);

    // Get top contractors
    const topContractors = await getTopContractors(toptierCode, fiscalYear);

    const result = {
      spending,
      topCategories,
      topContractors,
      source: `USASpending FY${fiscalYear}`,
    };

    // Cache result
    await cacheResult(cacheKey, result);

    return result;
  } catch (error) {
    console.error('USASpending error:', error);
    return {
      spending: null,
      topCategories: [],
      topContractors: [],
      source: 'USASpending (API error)',
    };
  }
}

// Get spending trends over multiple years
export async function getAgencyTrend(params: {
  agencyCode?: string;
  agencyName?: string;
  years?: number;
}): Promise<{
  trends: AgencyBudgetTrend[];
  percentChange: number | null;
  source: string;
}> {
  const { agencyCode, agencyName, years = 3 } = params;
  const currentYear = new Date().getFullYear();

  const trends: AgencyBudgetTrend[] = [];

  for (let i = 0; i < years; i++) {
    const year = currentYear - i;
    const result = await getAgencySpending({
      agencyCode,
      agencyName,
      fiscalYear: year,
    });

    if (result.spending) {
      trends.push({
        fiscalYear: year,
        totalBudget: result.spending.totalObligations,
      });
    }
  }

  // Calculate percent change
  let percentChange: number | null = null;
  if (trends.length >= 2) {
    const newest = trends[0].totalBudget;
    const oldest = trends[trends.length - 1].totalBudget;
    if (oldest > 0) {
      percentChange = Math.round(((newest - oldest) / oldest) * 100);
    }
  }

  return {
    trends: trends.sort((a, b) => a.fiscalYear - b.fiscalYear),
    percentChange,
    source: `USASpending FY${currentYear - years + 1}-FY${currentYear}`,
  };
}

// Search for recipient/contractor spending
export async function searchContractorSpending(params: {
  recipientName: string;
  fiscalYear?: number;
}): Promise<{
  totalAwarded: number;
  contractCount: number;
  topAgencies: { agency: string; amount: number }[];
  source: string;
}> {
  const { recipientName, fiscalYear = new Date().getFullYear() } = params;

  try {
    const response = await fetch(`${USASPENDING_BASE_URL}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: {
          recipient_search_text: [recipientName],
          time_period: [
            {
              start_date: `${fiscalYear - 1}-10-01`,
              end_date: `${fiscalYear}-09-30`,
            },
          ],
          award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
        },
        fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency'],
        limit: 100,
      }),
    });

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const results = data.results || [];

    // Aggregate by agency
    const agencyTotals: Record<string, number> = {};
    let totalAwarded = 0;

    for (const award of results) {
      totalAwarded += award['Award Amount'] || 0;
      const agency = award['Awarding Agency'] || 'Unknown';
      agencyTotals[agency] = (agencyTotals[agency] || 0) + (award['Award Amount'] || 0);
    }

    const topAgencies = Object.entries(agencyTotals)
      .map(([agency, amount]) => ({ agency, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    return {
      totalAwarded,
      contractCount: results.length,
      topAgencies,
      source: `USASpending FY${fiscalYear}`,
    };
  } catch (error) {
    console.error('USASpending contractor search error:', error);
    return {
      totalAwarded: 0,
      contractCount: 0,
      topAgencies: [],
      source: 'USASpending (error)',
    };
  }
}

// Helper: Find agency toptier code by name
async function findAgencyCode(agencyName: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${USASPENDING_BASE_URL}/autocomplete/awarding_agency/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        search_text: agencyName,
        limit: 5,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      if (data.results && data.results.length > 0) {
        // Return the toptier agency code
        return data.results[0].toptier_agency?.toptier_code;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Helper: Get spending by category
async function getSpendingByCategory(
  agencyCode: string,
  fiscalYear: number
): Promise<SpendingByCategory[]> {
  try {
    const response = await fetch(
      `${USASPENDING_BASE_URL}/agency/${agencyCode}/budget_function/?fiscal_year=${fiscalYear}`,
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const results = data.results || [];

    return results.slice(0, 5).map((item: any) => ({
      category: item.name || 'Unknown',
      amount: item.obligated_amount || 0,
      percentOfTotal: item.gross_outlay_amount_by_award_percentage || 0,
    }));
  } catch {
    return [];
  }
}

// Helper: Get top contractors
async function getTopContractors(
  agencyCode: string,
  fiscalYear: number
): Promise<ContractorSpending[]> {
  try {
    const response = await fetch(`${USASPENDING_BASE_URL}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: {
          agencies: [
            {
              type: 'awarding',
              tier: 'toptier',
              toptier_name: agencyCode,
            },
          ],
          time_period: [
            {
              start_date: `${fiscalYear - 1}-10-01`,
              end_date: `${fiscalYear}-09-30`,
            },
          ],
          award_type_codes: ['A', 'B', 'C', 'D'],
        },
        fields: ['Recipient Name', 'Award Amount'],
        limit: 100,
        order: 'desc',
        sort: 'Award Amount',
      }),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const results = data.results || [];

    // Aggregate by recipient
    const recipientTotals: Record<string, { amount: number; count: number }> = {};

    for (const award of results) {
      const name = award['Recipient Name'] || 'Unknown';
      if (!recipientTotals[name]) {
        recipientTotals[name] = { amount: 0, count: 0 };
      }
      recipientTotals[name].amount += award['Award Amount'] || 0;
      recipientTotals[name].count += 1;
    }

    return Object.entries(recipientTotals)
      .map(([name, data]) => ({
        recipientName: name,
        totalAmount: data.amount,
        contractCount: data.count,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// Cache helpers
async function getCachedResult(cacheKey: string): Promise<any | null> {
  try {
    const supabase = getSupabase();

    const { data } = await supabase
      .from('research_cache')
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (data) {
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return data.data;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheResult(cacheKey: string, result: any): Promise<void> {
  try {
    const supabase = getSupabase();

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
    console.warn('Failed to cache USASpending result:', error);
  }
}

// Format for agent response
export function formatUSASpendingForAgent(
  spending: AgencySpending | null,
  trend?: { percentChange: number | null }
): string {
  if (!spending) {
    return "Couldn't find USASpending data for this agency.";
  }

  const obligations = (spending.totalObligations / 1000000).toFixed(1);
  let response = `USASpending shows ${spending.agencyName} obligated $${obligations}M in FY${spending.fiscalYear}`;

  if (trend?.percentChange !== null && trend?.percentChange !== undefined) {
    const direction = trend.percentChange >= 0 ? 'up' : 'down';
    response += ` (${direction} ${Math.abs(trend.percentChange)}% from prior year)`;
  }

  return response;
}
