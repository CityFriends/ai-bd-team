// Unified Research Context - fetches relevant data from all APIs based on message content
import { searchNews, searchContractAwards, searchCompetitorNews, searchAgencyContractNews, type NewsArticle } from './news-search.js';
import { searchFPDS, searchByContractNumber, findIncumbent, formatFPDSForAgent, type FPDSContract } from './fpds.js';
import { getAgencySpending, getAgencyTrend, formatUSASpendingForAgent } from './usaspending.js';
import { verifyRegistration, formatSAMEntityForAgent } from './sam-entity.js';
import { searchFAR, formatFARResults } from './far-search.js';
import { saveCompetitorIntel, getCompetitorIntel, hasRecentIntel, type CompetitorIntel } from './supabase.js';
import { searchOpportunities, mapOpportunityType, getSAMOpportunityURL, type SearchOptions as SAMSearchOptions } from './sam-gov.js';
import { getUpcomingForecasts, type ForecastOpportunity } from './agency-forecasts.js';
import { analyzeRepository, formatRepoAnalysisForAgent, parseGitHubUrl, type RepoAnalysis } from './github.js';
import type { SAMOpportunity } from '../types/index.js';

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
    trend?: string;
    source: string;
  };
  forecasts?: {
    opportunities: ForecastOpportunity[];
    source: string;
  };
  githubRepo?: {
    analysis: RepoAnalysis;
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
  competitorIntel?: {
    companyName: string;
    protests: NewsArticle[];
    performance: NewsArticle[];
    awards: NewsArticle[];
    savedIntel: CompetitorIntel[];
    summary: string;
    source: string;
  };
  samOpportunities?: {
    opportunities: SAMOpportunity[];
    totalFound: number;
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

// Detect if a company name is mentioned (for partner verification)
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

// Known GovCon competitors/primes to watch for
const KNOWN_COMPETITORS = [
  'Booz Allen', 'Booz Allen Hamilton', 'BAH',
  'Deloitte', 'Accenture Federal', 'Accenture',
  'SAIC', 'Leidos', 'General Dynamics IT', 'GDIT',
  'ManTech', 'CACI', 'Peraton', 'ICF',
  'Maximus', 'Guidehouse', 'CGI Federal', 'CGI',
  'Northrop Grumman', 'Raytheon', 'Lockheed Martin',
  'IBM Federal', 'IBM', 'Microsoft Federal', 'AWS',
  'Palantir', 'Appian', 'Salesforce',
  'Serco', 'PAE', 'KBR', 'Amentum',
  'Cognosante', 'Optum', 'UnitedHealth',
  'FCN', 'Federal Computer Network', 'Fearless',
];

// Detect competitor/incumbent company mentions
function detectCompetitorMention(text: string): string | null {
  const lowerText = text.toLowerCase();

  // Check for known competitors first
  for (const company of KNOWN_COMPETITORS) {
    if (lowerText.includes(company.toLowerCase())) {
      return company;
    }
  }

  // Look for patterns that indicate a company being discussed
  const competitorPatterns = [
    /incumbent (?:is |was )?([A-Z][A-Za-z\s&]+?)(?:\s|,|\.|\?|$)/i,
    /([A-Z][A-Za-z\s&]+?) (?:is |was )(?:the )?incumbent/i,
    /([A-Z][A-Za-z\s&]+?) (?:has|had|won) (?:the |this )?contract/i,
    /competing (?:against|with) ([A-Z][A-Za-z\s&]+?)(?:\s|,|\.|\?|$)/i,
    /(?:what about|research|look into|dig into) ([A-Z][A-Za-z\s&]+?)(?:\s|,|\.|\?|$)/i,
    /([A-Z][A-Za-z\s&]+?) protest/i,
    /protest (?:by |from )?([A-Z][A-Za-z\s&]+?)(?:\s|,|\.|\?|$)/i,
  ];

  for (const pattern of competitorPatterns) {
    const match = text.match(pattern);
    if (match) {
      const company = match[1].trim();
      // Filter out common false positives
      if (company.length > 2 && !['the', 'a', 'an', 'this', 'that'].includes(company.toLowerCase())) {
        return company;
      }
    }
  }

  return null;
}

// Detect contract numbers (PIIDs) in text
// Common formats: 36C10B18D0003, GS-35F-0511T, HHSN316201200018W
function detectContractNumbers(text: string): string[] {
  const patterns = [
    /\b(\d{2}[A-Z]\d{2}[A-Z]\d{2}[A-Z]\d{4,})\b/gi,           // VA format: 36C10B18D0003
    /\b(GS-\d{2}F-\d{4,}[A-Z]?)\b/gi,                          // GSA schedule: GS-35F-0511T
    /\b([A-Z]{4}\d{12,}[A-Z]?)\b/gi,                           // HHS format: HHSN316201200018W
    /\b(\d{1,2}[A-Z]{2,4}\d{6,})\b/gi,                         // General: 47QTCA18D0003
    /\b([A-Z]{1,4}\d{2}[A-Z]{1,4}\d{2}[A-Z]\d{4,})\b/gi,      // Mixed format
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    found.push(...matches);
  }

  // Deduplicate
  return [...new Set(found)];
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
  needsAwardNews: boolean;
  needsRiskNews: boolean;
  needsCompetitorIntel: boolean;
  needsFPDS: boolean;
  needsSpending: boolean;
  needsPartnerCheck: boolean;
  needsFAR: boolean;
  needsSAMOpportunities: boolean;
  needsGitHubRepo: boolean;
  agency: { code: string; name: string } | null;
  companyName: string | null;
  competitorName: string | null;
  contractNumbers: string[];
  githubUrl: string | null;
  keywords: string[];
} {
  const cleanedText = cleanTextForSearch(text);
  const lowerText = cleanedText.toLowerCase();

  const newsKeywords = ['news', 'article', 'recent', 'latest', 'update', 'announce', 'modernization', 'initiative', 'happening', 'going on'];
  const awardNewsKeywords = ['award', 'awarded', 'won', 'wins', 'winner', 'orangeslices', 'govconwire', 'contract news'];
  const riskNewsKeywords = [
    'cancel', 'cancelled', 'canceled', 'cancellation', 'terminated', 'termination',
    'fraud', 'investigation', 'investigated', 'oig', 'inspector general',
    'protest', 'protested', 'gao protest', 'bid protest',
    '8a', '8(a)', 'graduation', 'graduated', 'decertified', 'decertification',
    'debarred', 'debarment', 'suspended', 'suspension',
    'false claims', 'qui tam', 'whistleblower',
    'breach', 'default', 'non-compliance', 'violation',
    'recompete', 'bridge contract', 'stop work',
  ];
  // Keywords that trigger competitor intel search
  const competitorKeywords = [
    'incumbent', 'competitor', 'competing', 'competition',
    'protest', 'gao', 'performance', 'issues', 'problems',
    'who has', 'who won', 'who is', 'what about',
    'dig into', 'research', 'look into',
  ];
  const fpdsKeywords = ['incumbent', 'contract', 'fpds', 'who has', 'who won', 'awarded', 'contractor', 'vendor', 'piid', 'idiq'];
  const spendingKeywords = ['budget', 'spending', 'usaspending', 'obligat', 'fund', 'money', 'fiscal'];
  const partnerKeywords = ['partner', 'team', 'verify', 'registration', 'sam.gov', 'certified', 'certification', '8(a)', 'wosb', 'sdvosb', 'hubzone'];
  const farKeywords = ['far ', 'far.', 'regulation', 'cfr', 'acquisition', 'evaluation', 'past performance', 'source selection', 'protest'];
  const samOpportunityKeywords = ['opportunity', 'opportunities', 'opp', 'opps', 'rfp', 'rfi', 'solicitation', 'sam.gov', 'search', 'find', 'look for', 'looking for', 'hunt', 'scan', 'what\'s out there', 'what\'s available', 'health it', 'healthcare', 'modernization'];

  // Detect competitor/incumbent mentions
  const competitorName = detectCompetitorMention(cleanedText);

  // Detect contract numbers in the message
  const contractNumbers = detectContractNumbers(text);

  // Filter out common question/trigger words that make bad FPDS queries
  const stopwords = [
    'who\'s', 'whos', 'what\'s', 'whats', 'where', 'which', 'there', 'their', 'about',
    'incumbent', 'incumbents', 'contract', 'contracts', 'contractor', 'contractors',
    'vendor', 'vendors', 'awarded', 'winning', 'winner', 'looking', 'think', 'thinking',
    'could', 'would', 'should', 'doing', 'going', 'getting', 'having', 'being',
    'these', 'those', 'other', 'another', 'something', 'anything', 'nothing',
    'what', 'have', 'does', 'area', 'areas', 'kind', 'type', 'types',
  ];

  const meaningfulKeywords = cleanedText
    .split(/\s+/)
    .map(w => w.replace(/[?!.,;:'"]/g, '').toLowerCase()) // Clean punctuation
    .filter(w => w.length > 2 && !w.startsWith('@') && !stopwords.includes(w));

  const needsAwardNews = awardNewsKeywords.some(kw => lowerText.includes(kw));
  const needsRiskNews = riskNewsKeywords.some(kw => lowerText.includes(kw));
  const needsCompetitorIntel = competitorName !== null ||
    competitorKeywords.some(kw => lowerText.includes(kw));

  // Detect GitHub URLs in the message
  const githubUrlMatch = text.match(/github\.com\/([^\/\s]+)\/([^\/\s>]+)/i);
  const githubUrl = githubUrlMatch ? `https://github.com/${githubUrlMatch[1]}/${githubUrlMatch[2].replace(/[>.,)]+$/, '')}` : null;
  const githubKeywords = ['repo', 'repository', 'codebase', 'github', 'code review', 'tech stack', 'architecture'];
  const needsGitHubRepo = githubUrl !== null || githubKeywords.some(kw => lowerText.includes(kw));

  return {
    needsNews: newsKeywords.some(kw => lowerText.includes(kw)) || needsAwardNews || needsRiskNews,
    needsAwardNews, // Specifically for GovCon award sources like OrangeSlices
    needsRiskNews,  // Contract cancellations, fraud, protests, debarments
    needsCompetitorIntel, // Incumbent/competitor research
    needsFPDS: fpdsKeywords.some(kw => lowerText.includes(kw)) || contractNumbers.length > 0,
    needsSpending: spendingKeywords.some(kw => lowerText.includes(kw)),
    needsPartnerCheck: partnerKeywords.some(kw => lowerText.includes(kw)),
    needsFAR: farKeywords.some(kw => lowerText.includes(kw)),
    needsSAMOpportunities: samOpportunityKeywords.some(kw => lowerText.includes(kw)),
    needsGitHubRepo,
    agency: detectAgency(cleanedText),
    companyName: detectCompanyName(cleanedText),
    competitorName,
    contractNumbers,
    githubUrl,
    keywords: meaningfulKeywords,
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

  // Maya should ALWAYS search SAM.gov when asked about opportunities, searching, or finding work
  // She has access to company NAICS codes and should use them proactively
  const lowerTextForSAM = text.toLowerCase();
  const shouldFetchSAMOpportunities = agentName === 'maya' && (
    topics.needsSAMOpportunities ||
    lowerTextForSAM.includes('search') ||
    lowerTextForSAM.includes('find') ||
    lowerTextForSAM.includes('look') ||
    lowerTextForSAM.includes('opportunities') ||
    lowerTextForSAM.includes('opps') ||
    lowerTextForSAM.includes('what\'s out there') ||
    lowerTextForSAM.includes('sam.gov') ||
    lowerTextForSAM.includes('health') ||
    lowerTextForSAM.includes('rfp') ||
    lowerTextForSAM.includes('rfi')
  );

  // Fetch in parallel
  const promises: Promise<void>[] = [];

  if (shouldFetchNews && topics.agency) {
    promises.push(
      (async () => {
        try {
          // Use GovCon sources for risk news (cancellations, fraud, protests)
          if (topics.needsRiskNews) {
            console.log(`Research: Fetching risk/negative news for ${topics.agency!.name} from GovCon sources`);
            const riskTerms = ['cancel', 'fraud', 'protest', 'debarment', 'terminated', 'investigation'];
            const matchedTerm = riskTerms.find(t => topics.keywords.some(k => k.includes(t))) || 'contract issues';
            const result = await searchNews({
              query: `${topics.agency!.name} ${matchedTerm}`,
              limit: 5,
              daysBack: 90,
              govconOnly: true,
            });
            if (result.articles.length > 0) {
              context.news = {
                articles: result.articles,
                source: `${result.source} (GovCon Risk)`,
              };
              return;
            }
          }

          // Use GovCon sources (OrangeSlices, GovConWire) for award news
          if (topics.needsAwardNews) {
            console.log(`Research: Fetching contract award news for ${topics.agency!.name} from GovCon sources`);
            const result = await searchContractAwards({
              agencyName: topics.agency!.name,
              keywords: topics.keywords.slice(0, 2),
              limit: 5,
              daysBack: 60,
            });
            if (result.articles.length > 0) {
              context.news = {
                articles: result.articles,
                source: `${result.source} (GovCon)`,
              };
              return;
            }
          }

          // Fall back to general news search
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

  // FPDS: Check for contract numbers first, then use agency code filtering
  if (shouldFetchFPDS) {
    promises.push(
      (async () => {
        try {
          // Priority 1: Direct contract number lookup
          if (topics.contractNumbers.length > 0) {
            console.log(`Research: Fetching FPDS for contract number ${topics.contractNumbers[0]}`);
            const result = await searchByContractNumber(topics.contractNumbers[0]);
            if (result.contracts.length > 0) {
              context.fpds = {
                contracts: result.contracts,
                incumbent: result.contracts[0]?.vendorName || undefined,
                source: `FPDS (contract ${topics.contractNumbers[0]})`,
              };
              return;
            }
          }

          // Priority 2: Agency code + keywords (much more precise)
          if (topics.agency) {
            console.log(`Research: Fetching FPDS for ${topics.agency.name} (code: ${topics.agency.code})`);
            const result = await findIncumbent({
              agencyCode: topics.agency.code,
              agencyName: topics.agency.name,
              keywords: topics.keywords.slice(0, 3),
            });
            if (result.contracts.length > 0) {
              context.fpds = {
                contracts: result.contracts,
                incumbent: result.incumbent || undefined,
                source: result.source,
              };
            }
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
          // Get both current spending and trend
          const [spendingResult, trendResult] = await Promise.all([
            getAgencySpending({ agencyName: topics.agency!.name }),
            getAgencyTrend({ agencyName: topics.agency!.name, years: 3 }),
          ]);

          if (spendingResult.spending) {
            let trendSummary: string | undefined;
            if (trendResult.percentChange !== null) {
              const direction = trendResult.percentChange >= 0 ? 'increased' : 'decreased';
              trendSummary = `Budget has ${direction} ${Math.abs(trendResult.percentChange)}% over 3 years`;
            }

            context.spending = {
              summary: formatUSASpendingForAgent(spendingResult.spending, trendResult),
              trend: trendSummary,
              source: spendingResult.source + ' (Note: USASpending shows AWARDED contracts with 2-4 week lag. For new opportunities, incumbent data comes from prior similar contracts.)',
            };
          }
        } catch (err) {
          console.warn('USASpending fetch failed:', err);
        }
      })()
    );

    // Also fetch agency forecasts for budget context
    promises.push(
      (async () => {
        try {
          console.log(`Research: Fetching agency forecasts`);
          const forecasts = await getUpcomingForecasts(50);
          // Filter to relevant agency if we have one
          const agencyForecasts = topics.agency
            ? forecasts.filter(f =>
                f.agency.toLowerCase().includes(topics.agency!.name.toLowerCase().split(' ')[0]) ||
                topics.agency!.name.toLowerCase().includes(f.agency.toLowerCase())
              )
            : forecasts;

          if (agencyForecasts.length > 0) {
            context.forecasts = {
              opportunities: agencyForecasts.slice(0, 5),
              source: 'Agency Procurement Forecasts (planned future procurements)',
            };
          }
        } catch (err) {
          console.warn('Agency forecasts fetch failed:', err);
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

  // SAM.gov Opportunities: Search for current opportunities
  if (shouldFetchSAMOpportunities) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Searching SAM.gov for opportunities`);
          // Search last 14 days by default
          const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
          const result = await searchOpportunities({
            postedFrom: twoWeeksAgo,
            postedTo: new Date(),
            limit: 10,
          });
          if (result.opportunitiesData && result.opportunitiesData.length > 0) {
            context.samOpportunities = {
              opportunities: result.opportunitiesData,
              totalFound: result.totalRecords,
              source: 'SAM.gov',
            };
            console.log(`Research: Found ${result.opportunitiesData.length} opportunities from SAM.gov`);
          } else {
            console.log(`Research: No opportunities found on SAM.gov`);
          }
        } catch (err) {
          console.warn('SAM.gov opportunity search failed:', err);
        }
      })()
    );
  }

  // Competitor Intel: Search for incumbent/competitor issues
  const shouldFetchCompetitorIntel = (agentName === 'david' || agentName === 'rosa') &&
    (topics.needsCompetitorIntel || topics.competitorName);

  if (shouldFetchCompetitorIntel) {
    promises.push(
      (async () => {
        try {
          // Get company name from explicit mention or from FPDS incumbent
          let companyToResearch = topics.competitorName;

          // If we found an incumbent from FPDS, also research them
          if (!companyToResearch && context.fpds?.incumbent) {
            companyToResearch = context.fpds.incumbent;
          }

          if (companyToResearch) {
            // Check if we have recent intel already
            const hasRecent = await hasRecentIntel(companyToResearch);

            console.log(`Research: Fetching competitor intel for ${companyToResearch}${hasRecent ? ' (have recent)' : ''}`);

            // Always search for fresh news
            const intelResult = await searchCompetitorNews({
              companyName: companyToResearch,
              agencyName: topics.agency?.name,
              daysBack: 180,
            });

            // Get any saved intel from database
            const savedIntel = await getCompetitorIntel(companyToResearch);

            context.competitorIntel = {
              companyName: companyToResearch,
              protests: intelResult.protests,
              performance: intelResult.performance,
              awards: intelResult.awards,
              savedIntel,
              summary: intelResult.summary,
              source: 'GovCon News + Database',
            };

            // Save significant findings to database
            if (intelResult.protests.length > 0) {
              for (const article of intelResult.protests.slice(0, 2)) {
                await saveCompetitorIntel({
                  company_name: companyToResearch,
                  agency_code: topics.agency?.code,
                  intel_type: 'protest',
                  summary: article.title,
                  source_url: article.url,
                  source_name: article.source,
                  confidence: 'MEDIUM',
                  discovered_by: agentName,
                });
              }
            }

            if (intelResult.performance.length > 0) {
              for (const article of intelResult.performance.slice(0, 2)) {
                await saveCompetitorIntel({
                  company_name: companyToResearch,
                  agency_code: topics.agency?.code,
                  intel_type: 'performance',
                  summary: article.title,
                  source_url: article.url,
                  source_name: article.source,
                  confidence: 'MEDIUM',
                  discovered_by: agentName,
                });
              }
            }
          }
        } catch (err) {
          console.warn('Competitor intel fetch failed:', err);
        }
      })()
    );
  }

  // GitHub Repo Analysis: For Marcus (engineering lead) when a GitHub URL is mentioned
  const shouldFetchGitHubRepo = agentName === 'marcus' &&
    (topics.needsGitHubRepo || topics.githubUrl);

  if (shouldFetchGitHubRepo && topics.githubUrl) {
    promises.push(
      (async () => {
        try {
          console.log(`Research: Analyzing GitHub repo ${topics.githubUrl}`);
          const analysis = await analyzeRepository(topics.githubUrl!);
          if (analysis) {
            context.githubRepo = {
              analysis,
              source: analysis.source,
            };
            console.log(`Research: Analyzed ${analysis.owner}/${analysis.repo} - ${analysis.techStack.length} tech stack items detected`);
          } else {
            console.log(`Research: Could not analyze GitHub repo ${topics.githubUrl}`);
          }
        } catch (err) {
          console.warn('GitHub repo analysis failed:', err);
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
    parts.push('\nAGENCY SPENDING (Historical - from USASpending):');
    parts.push(context.spending.summary);
    if (context.spending.trend) {
      parts.push(`Trend: ${context.spending.trend}`);
    }
    parts.push(`Source: ${context.spending.source}`);
  }

  if (context.forecasts && context.forecasts.opportunities.length > 0) {
    parts.push('\nAGENCY PROCUREMENT FORECASTS (Planned Future Work):');
    context.forecasts.opportunities.slice(0, 5).forEach(f => {
      const value = f.estimated_value || 'TBD';
      const release = f.estimated_release || 'TBD';
      parts.push(`- ${f.title.slice(0, 80)}...`);
      parts.push(`  Agency: ${f.agency} | Est. Value: ${value} | Expected: ${release}`);
      if (f.set_aside) {
        parts.push(`  Set-aside: ${f.set_aside}`);
      }
    });
    parts.push(`Source: ${context.forecasts.source}`);
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

  if (context.competitorIntel) {
    const intel = context.competitorIntel;
    parts.push(`\nCOMPETITOR INTEL FOR ${intel.companyName.toUpperCase()}:`);
    parts.push(intel.summary);

    if (intel.protests.length > 0) {
      parts.push('\nPROTEST/GAO NEWS:');
      intel.protests.slice(0, 2).forEach(article => {
        parts.push(`- ${article.title}`);
        parts.push(`  Link: ${article.url}`);
      });
    }

    if (intel.performance.length > 0) {
      parts.push('\nPERFORMANCE ISSUES:');
      intel.performance.slice(0, 2).forEach(article => {
        parts.push(`- ${article.title}`);
        parts.push(`  Link: ${article.url}`);
      });
    }

    if (intel.awards.length > 0) {
      parts.push('\nRECENT WINS:');
      intel.awards.slice(0, 2).forEach(article => {
        parts.push(`- ${article.title}`);
        parts.push(`  Link: ${article.url}`);
      });
    }

    if (intel.savedIntel.length > 0) {
      parts.push('\nPREVIOUSLY DISCOVERED:');
      intel.savedIntel.slice(0, 3).forEach(saved => {
        parts.push(`- [${saved.intel_type.toUpperCase()}] ${saved.summary}`);
      });
    }

    parts.push(`Source: ${intel.source}`);
  }

  // SAM.gov Opportunities
  if (context.samOpportunities && context.samOpportunities.opportunities.length > 0) {
    const opps = context.samOpportunities;
    parts.push(`\nSAM.GOV OPPORTUNITIES (${opps.totalFound} total found, showing top ${opps.opportunities.length}):`);
    opps.opportunities.forEach((opp, i) => {
      const dueDate = opp.responseDeadLine ? ` | Due: ${opp.responseDeadLine}` : '';
      const type = opp.type ? mapOpportunityType(opp.type) : 'Unknown';
      parts.push(`\n${i + 1}. ${opp.title}`);
      parts.push(`   Agency: ${(opp as any).fullParentPathName || opp.department || 'Unknown'}`);
      parts.push(`   Type: ${type}${dueDate}`);
      if (opp.naicsCode) {
        parts.push(`   NAICS: ${opp.naicsCode}`);
      }
      if (opp.description) {
        // Truncate long descriptions
        const desc = opp.description.length > 200 ? opp.description.slice(0, 200) + '...' : opp.description;
        parts.push(`   Description: ${desc}`);
      }
      parts.push(`   Link: ${opp.uiLink || getSAMOpportunityURL(opp.noticeId)}`);
    });
    parts.push(`\nSource: ${opps.source}`);
  }

  // GitHub Repository Analysis
  if (context.githubRepo) {
    parts.push(formatRepoAnalysisForAgent(context.githubRepo.analysis));
  }

  if (parts.length === 0) {
    return '';
  }

  return '\n\n=== RESEARCH DATA (use this in your response, cite sources) ===' + parts.join('\n');
}
