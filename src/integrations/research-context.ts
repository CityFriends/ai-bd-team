// Unified Research Context - fetches relevant data from all APIs based on message content
import { searchNews, getAgencyNews, type NewsArticle } from './news-search.js';
import { searchFPDS, findIncumbent, formatFPDSForAgent, type FPDSContract } from './fpds.js';
import { getAgencySpending, formatUSASpendingForAgent } from './usaspending.js';
import { verifyRegistration, formatSAMEntityForAgent } from './sam-entity.js';
import { searchFAR, formatFARResults } from './far-search.js';

// Agency name mappings for detection
const AGENCY_PATTERNS: Record<string, { code: string; name: string; keywords: string[] }> = {
  VA: { code: '036', name: 'Department of Veterans Affairs', keywords: ['va', 'veterans', 'veteran affairs'] },
  HHS: { code: '075', name: 'Department of Health and Human Services', keywords: ['hhs', 'health human services', 'cms', 'cdc', 'nih', 'fda'] },
  DOD: { code: '097', name: 'Department of Defense', keywords: ['dod', 'defense', 'army', 'navy', 'air force', 'pentagon'] },
  DHS: { code: '070', name: 'Department of Homeland Security', keywords: ['dhs', 'homeland', 'tsa', 'fema', 'ice', 'cbp'] },
  DOJ: { code: '015', name: 'Department of Justice', keywords: ['doj', 'justice', 'fbi', 'dea', 'atf'] },
  DOL: { code: '012', name: 'Department of Labor', keywords: ['dol', 'labor', 'osha'] },
  ED: { code: '091', name: 'Department of Education', keywords: ['education', 'ed '] },
  STATE: { code: '019', name: 'Department of State', keywords: ['state department', 'state dept', 'usaid'] },
  GSA: { code: '047', name: 'General Services Administration', keywords: ['gsa', 'general services'] },
  SBA: { code: '073', name: 'Small Business Administration', keywords: ['sba', 'small business admin'] },
  EPA: { code: '068', name: 'Environmental Protection Agency', keywords: ['epa', 'environmental protection'] },
  NASA: { code: '080', name: 'NASA', keywords: ['nasa', 'space'] },
  SSA: { code: '028', name: 'Social Security Administration', keywords: ['ssa', 'social security'] },
  USDA: { code: '012', name: 'Department of Agriculture', keywords: ['usda', 'agriculture'] },
  DOT: { code: '069', name: 'Department of Transportation', keywords: ['dot', 'transportation', 'faa', 'fhwa'] },
  DOE: { code: '089', name: 'Department of Energy', keywords: ['doe', 'energy'] },
  TREASURY: { code: '020', name: 'Department of Treasury', keywords: ['treasury', 'irs'] },
  OPM: { code: '024', name: 'Office of Personnel Management', keywords: ['opm', 'personnel management'] },
};

export interface ResearchContext {
  news?: {
    articles: NewsArticle[];
    source: string;
  };
  fpds?: {
    contracts: FPDSContract[];
    incumbent?: string;
    source: string;
  };
  spending?: {
    summary: string;
    source: string;
  };
  partner?: {
    summary: string;
    source: string;
  };
  far?: {
    sections: string;
    source: string;
  };
}

// Detect which agency is being discussed
function detectAgency(text: string): { code: string; name: string } | null {
  const lowerText = text.toLowerCase();

  for (const [abbrev, info] of Object.entries(AGENCY_PATTERNS)) {
    if (info.keywords.some(kw => lowerText.includes(kw))) {
      return { code: info.code, name: info.name };
    }
  }
  return null;
}

// Detect if a company name is mentioned
function detectCompanyName(text: string): string | null {
  // Look for patterns like "partner with X" or "team with X" or "verify X"
  const patterns = [
    /partner(?:ing)? with ([A-Z][A-Za-z\s&]+?)(?:\s|,|\.|\?|$)/,
    /team(?:ing)? with ([A-Z][A-Za-z\s&]+?)(?:\s|,|\.|\?|$)/,
    /verify ([A-Z][A-Za-z\s&]+?)(?:'s|\s|,|\.|\?|$)/,
    /check (?:on )?([A-Z][A-Za-z\s&]+?)(?:'s|\s|,|\.|\?|$)/,
    /about ([A-Z][A-Za-z\s&]+?)(?:'s|\s|,|\.|\?|$)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

// Clean text of Slack mentions and formatting
function cleanTextForSearch(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/g, '') // Remove Slack user mentions
    .replace(/<#[A-Z0-9]+\|[^>]+>/g, '') // Remove channel mentions
    .replace(/<[^>]+>/g, '') // Remove other Slack formatting
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect research topics in the message
function detectTopics(text: string): {
  needsNews: boolean;
  needsFPDS: boolean;
  needsSpending: boolean;
  needsPartnerCheck: boolean;
  needsFAR: boolean;
  agency: { code: string; name: string } | null;
  companyName: string | null;
  keywords: string[];
} {
  const cleanedText = cleanTextForSearch(text);
  const lowerText = cleanedText.toLowerCase();

  const newsKeywords = ['news', 'article', 'recent', 'latest', 'update', 'announce', 'modernization', 'initiative', 'happening', 'going on'];
  const fpdsKeywords = ['incumbent', 'contract', 'fpds', 'who has', 'who won', 'awarded', 'contractor', 'vendor'];
  const spendingKeywords = ['budget', 'spending', 'usaspending', 'obligat', 'fund', 'money', 'fiscal'];
  const partnerKeywords = ['partner', 'team', 'verify', 'registration', 'sam.gov', 'certified', 'certification', '8(a)', 'wosb', 'sdvosb', 'hubzone'];
  const farKeywords = ['far ', 'far.', 'regulation', 'cfr', 'acquisition', 'evaluation', 'past performance', 'source selection', 'protest'];

  return {
    needsNews: newsKeywords.some(kw => lowerText.includes(kw)),
    needsFPDS: fpdsKeywords.some(kw => lowerText.includes(kw)),
    needsSpending: spendingKeywords.some(kw => lowerText.includes(kw)),
    needsPartnerCheck: partnerKeywords.some(kw => lowerText.includes(kw)),
    needsFAR: farKeywords.some(kw => lowerText.includes(kw)),
    agency: detectAgency(cleanedText),
    companyName: detectCompanyName(cleanedText),
    keywords: cleanedText.split(/\s+/).filter(w => w.length > 4 && !w.startsWith('@')),
  };
}

// Main function to gather research context
export async function gatherResearchContext(
  text: string,
  agentName: string
): Promise<ResearchContext> {
  const topics = detectTopics(text);
  const context: ResearchContext = {};

  // Determine what to fetch based on agent role and detected topics
  const shouldFetchNews = (agentName === 'maya' || agentName === 'david') &&
                          (topics.needsNews || topics.agency);

  const shouldFetchFPDS = agentName === 'david' &&
                          (topics.needsFPDS || topics.agency);

  const shouldFetchSpending = agentName === 'david' &&
                              (topics.needsSpending || topics.agency);

  const shouldFetchPartner = agentName === 'rosa' &&
                             (topics.needsPartnerCheck || topics.companyName);

  const shouldFetchFAR = (agentName === 'david' || agentName === 'james') &&
                         topics.needsFAR;

  // Fetch in parallel
  const promises: Promise<void>[] = [];

  if (shouldFetchNews && topics.agency) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Fetching news for ${topics.agency!.name}`);
          const result = await searchNews({
            query: topics.agency!.name,
            limit: 5
          });
          if (result.articles.length > 0) {
            context.news = {
              articles: result.articles,
              source: result.source,
            };
          }
        } catch (err) {
          console.warn('News fetch failed:', err);
        }
      })()
    );
  }

  if (shouldFetchFPDS && topics.agency) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Fetching FPDS for ${topics.agency!.name}`);
          const result = await findIncumbent({
            agencyName: topics.agency!.name,
            keywords: topics.keywords.slice(0, 3),
          });
          if (result.contracts.length > 0) {
            context.fpds = {
              contracts: result.contracts,
              incumbent: result.incumbent || undefined,
              source: result.source,
            };
          }
        } catch (err) {
          console.warn('FPDS fetch failed:', err);
        }
      })()
    );
  }

  if (shouldFetchSpending && topics.agency) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Fetching USASpending for ${topics.agency!.name}`);
          const result = await getAgencySpending({
            agencyName: topics.agency!.name,
          });
          if (result.spending) {
            context.spending = {
              summary: formatUSASpendingForAgent(result.spending),
              source: result.source,
            };
          }
        } catch (err) {
          console.warn('USASpending fetch failed:', err);
        }
      })()
    );
  }

  if (shouldFetchPartner && topics.companyName) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Verifying ${topics.companyName} in SAM.gov`);
          const result = await verifyRegistration(topics.companyName!);
          context.partner = {
            summary: formatSAMEntityForAgent(result),
            source: result.source,
          };
        } catch (err) {
          console.warn('SAM Entity fetch failed:', err);
        }
      })()
    );
  }

  if (shouldFetchFAR) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Searching FAR for relevant sections`);
          const results = await searchFAR(text, 3);
          if (results.length > 0) {
            context.far = {
              sections: formatFARResults(results),
              source: 'FAR',
            };
          }
        } catch (err) {
          console.warn('FAR search failed:', err);
        }
      })()
    );
  }

  // Wait for all fetches
  await Promise.all(promises);

  return context;
}

// Format context for agent prompt
export function formatResearchContext(context: ResearchContext): string {
  const parts: string[] = [];

  if (context.news && context.news.articles.length > 0) {
    parts.push('\nRECENT NEWS (from ' + context.news.source + '):');
    context.news.articles.slice(0, 3).forEach(article => {
      const date = article.publishedDate ? ` (${article.publishedDate})` : '';
      parts.push(`- ${article.title}${date}`);
      parts.push(`  Source: ${article.source}`);
      parts.push(`  Link: ${article.url}`);
    });
  }

  if (context.fpds && context.fpds.contracts.length > 0) {
    parts.push('\nFPDS CONTRACT DATA:');
    if (context.fpds.incumbent) {
      parts.push(`Likely incumbent: ${context.fpds.incumbent}`);
    }
    context.fpds.contracts.slice(0, 3).forEach(c => {
      const value = c.obligatedAmount ? `$${(c.obligatedAmount / 1000000).toFixed(1)}M` : 'value unknown';
      parts.push(`- ${c.vendorName}: ${value} (${c.agencyName})`);
      if (c.contractDescription) {
        parts.push(`  Description: ${c.contractDescription.slice(0, 100)}...`);
      }
    });
    parts.push(`Source: ${context.fpds.source}`);
  }

  if (context.spending) {
    parts.push('\nAGENCY SPENDING:');
    parts.push(context.spending.summary);
    parts.push(`Source: ${context.spending.source}`);
  }

  if (context.partner) {
    parts.push('\nPARTNER VERIFICATION:');
    parts.push(context.partner.summary);
    parts.push(`Source: ${context.partner.source}`);
  }

  if (context.far) {
    parts.push('\nRELEVANT FAR SECTIONS:');
    parts.push(context.far.sections);
  }

  if (parts.length === 0) {
    return '';
  }

  return '\n\n=== RESEARCH DATA (use this in your response, cite sources) ===' + parts.join('\n');
}
