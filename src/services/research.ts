// Research Service
// Orchestrates external APIs to provide comprehensive research for agents

import { searchFPDS, findIncumbent, getVendorHistory, formatFPDSForAgent } from '../integrations/fpds.js';
import { getAgencySpending, getAgencyTrend, searchContractorSpending, formatUSASpendingForAgent } from '../integrations/usaspending.js';
import { verifyRegistration, checkCertification, findPartnersByNAICS, formatSAMEntityForAgent } from '../integrations/sam-entity.js';
import { searchNews, getAgencyNews, formatNewsForAgent } from '../integrations/news-search.js';

export interface OpportunityResearch {
  // Incumbent info
  incumbent: {
    name: string | null;
    contractValue: number | null;
    contractYears: number | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    source: string;
  };
  // Agency budget context
  agencyBudget: {
    totalSpending: number | null;
    trend: string | null;
    source: string;
  };
  // Recent news
  news: {
    articles: { title: string; summary: string }[];
    source: string;
  };
  // Summary for agent
  summary: string;
}

export interface PartnerResearch {
  // SAM verification
  samStatus: {
    isRegistered: boolean;
    isActive: boolean;
    certifications: string[];
    expirationWarning?: string;
    source: string;
  };
  // Contract history
  contractHistory: {
    totalContracts: number;
    totalValue: number;
    agencies: string[];
    source: string;
  };
  // Summary for agent
  summary: string;
}

// Research an opportunity (used by David)
export async function researchOpportunity(params: {
  agencyName: string;
  agencyCode?: string;
  keywords?: string[];
  naicsCode?: string;
}): Promise<OpportunityResearch> {
  const { agencyName, agencyCode, keywords = [], naicsCode } = params;

  console.log(`Research: Starting opportunity research for ${agencyName}`);

  // Run all research in parallel
  const [incumbentResult, budgetResult, trendResult, newsResult] = await Promise.all([
    findIncumbent({ agencyCode, agencyName, keywords, naicsCode }),
    getAgencySpending({ agencyCode, agencyName }),
    getAgencyTrend({ agencyCode, agencyName, years: 2 }),
    getAgencyNews(agencyName),
  ]);

  // Build summary
  const summaryParts: string[] = [];

  // Incumbent summary
  if (incumbentResult.incumbent) {
    const value = incumbentResult.contractValue
      ? `$${(incumbentResult.contractValue / 1000000).toFixed(1)}M`
      : 'unknown value';
    summaryParts.push(
      `FPDS shows ${incumbentResult.incumbent} as likely incumbent (${value}, ${incumbentResult.confidence} confidence)`
    );
  } else {
    summaryParts.push('Could not identify incumbent from FPDS');
  }

  // Budget summary
  if (budgetResult.spending) {
    const spending = (budgetResult.spending.totalObligations / 1000000000).toFixed(1);
    let trendText = '';
    if (trendResult.percentChange !== null) {
      const direction = trendResult.percentChange >= 0 ? 'up' : 'down';
      trendText = ` (${direction} ${Math.abs(trendResult.percentChange)}% YoY)`;
    }
    summaryParts.push(
      `USASpending: ${agencyName} obligated $${spending}B in FY${budgetResult.spending.fiscalYear}${trendText}`
    );
  }

  // News summary
  const allNews = [...newsResult.recentNews, ...newsResult.leadershipChanges].slice(0, 2);
  if (allNews.length > 0) {
    summaryParts.push(
      `Recent news: ${allNews.map(n => n.title).join('; ')}`
    );
  }

  return {
    incumbent: {
      name: incumbentResult.incumbent,
      contractValue: incumbentResult.contractValue,
      contractYears: incumbentResult.contractYears,
      confidence: incumbentResult.confidence,
      source: incumbentResult.source,
    },
    agencyBudget: {
      totalSpending: budgetResult.spending?.totalObligations || null,
      trend: trendResult.percentChange !== null
        ? `${trendResult.percentChange >= 0 ? '+' : ''}${trendResult.percentChange}%`
        : null,
      source: budgetResult.source,
    },
    news: {
      articles: allNews.map(a => ({ title: a.title, summary: a.snippet })),
      source: newsResult.source,
    },
    summary: summaryParts.join('\n'),
  };
}

// Research a potential partner (used by Rosa)
export async function researchPartner(companyName: string): Promise<PartnerResearch> {
  console.log(`Research: Starting partner research for ${companyName}`);

  // Run research in parallel
  const [samResult, historyResult] = await Promise.all([
    verifyRegistration(companyName),
    getVendorHistory(companyName),
  ]);

  // Build summary
  const summaryParts: string[] = [];

  // SAM status
  if (samResult.isRegistered && samResult.entity) {
    const certs = samResult.certifications.length > 0
      ? ` (${samResult.certifications.join(', ')})`
      : '';
    summaryParts.push(
      `SAM.gov: ${samResult.entity.legalBusinessName} is actively registered${certs}`
    );
    if (samResult.expirationWarning) {
      summaryParts.push(`⚠️ ${samResult.expirationWarning}`);
    }
  } else {
    summaryParts.push(`SAM.gov: Could not verify ${companyName} - may not be registered or different name`);
  }

  // Contract history
  if (historyResult.totalContracts > 0) {
    const value = (historyResult.totalValue / 1000000).toFixed(1);
    summaryParts.push(
      `FPDS: ${historyResult.totalContracts} contracts totaling $${value}M with ${historyResult.agencies.slice(0, 3).join(', ')}`
    );
  } else {
    summaryParts.push('FPDS: No federal contract history found');
  }

  return {
    samStatus: {
      isRegistered: samResult.isRegistered,
      isActive: samResult.isActive,
      certifications: samResult.certifications,
      expirationWarning: samResult.expirationWarning,
      source: samResult.source,
    },
    contractHistory: {
      totalContracts: historyResult.totalContracts,
      totalValue: historyResult.totalValue,
      agencies: historyResult.agencies,
      source: 'FPDS',
    },
    summary: summaryParts.join('\n'),
  };
}

// Quick incumbent lookup (for David's fast responses)
export async function quickIncumbentLookup(params: {
  agencyName: string;
  keywords?: string[];
}): Promise<string> {
  const result = await findIncumbent({
    agencyName: params.agencyName,
    keywords: params.keywords,
  });

  if (result.incumbent) {
    const value = result.contractValue
      ? `$${(result.contractValue / 1000000).toFixed(1)}M`
      : 'unknown value';
    return `FPDS shows ${result.incumbent} as incumbent (${value}, ${result.confidence} confidence)`;
  }
  return "Couldn't find incumbent data in FPDS for this search";
}

// Quick partner verification (for Rosa's fast responses)
export async function quickPartnerVerify(companyName: string): Promise<string> {
  const result = await verifyRegistration(companyName);
  return formatSAMEntityForAgent(result);
}

// Quick agency budget lookup (for David)
export async function quickAgencyBudget(agencyName: string): Promise<string> {
  const [spending, trend] = await Promise.all([
    getAgencySpending({ agencyName }),
    getAgencyTrend({ agencyName, years: 2 }),
  ]);
  return formatUSASpendingForAgent(spending.spending, trend);
}

// Quick news lookup
export async function quickNewsSearch(query: string, agencyName?: string): Promise<string> {
  const result = await searchNews({ query, agencyName, limit: 3 });
  return formatNewsForAgent(result.articles);
}
