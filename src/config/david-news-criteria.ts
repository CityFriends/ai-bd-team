/**
 * David's News Intelligence Criteria
 *
 * Defines what news is relevant for FFTC's BD team:
 * - Agency budget and spending news
 * - Policy and regulatory changes
 * - Technology and modernization initiatives
 * - AI in government
 * - HCD/UX in government
 * - Congressional/legislative changes
 *
 * Includes relevance scoring to filter noise.
 */

// Target agencies FFTC cares about
export const TARGET_AGENCIES = [
  { code: '036', name: 'VA', fullName: 'Department of Veterans Affairs' },
  { code: '075', name: 'HHS', fullName: 'Department of Health and Human Services' },
  { code: '075', name: 'CMS', fullName: 'Centers for Medicare and Medicaid Services' },
  { code: '012', name: 'DOL', fullName: 'Department of Labor' },
  { code: '091', name: 'Education', fullName: 'Department of Education' },
  { code: '019', name: 'State', fullName: 'Department of State' },
  { code: '073', name: 'SBA', fullName: 'Small Business Administration' },
  { code: '047', name: 'GSA', fullName: 'General Services Administration' },
  { code: '005', name: 'USDA', fullName: 'Department of Agriculture' },
  { code: '069', name: 'DOT', fullName: 'Department of Transportation' },
  { code: '070', name: 'DHS', fullName: 'Department of Homeland Security' },
  { code: '020', name: 'IRS', fullName: 'Internal Revenue Service' },
];

// News topic categories with search queries
export const NEWS_TOPICS = {
  // Agency budget and spending - high priority for BD
  budgetSpending: {
    name: 'Budget & Spending',
    priority: 'high',
    queries: [
      'federal agency IT budget 2025 2026',
      'federal technology modernization fund',
      'agency IT spending appropriations',
      'federal digital services budget',
    ],
    daysBack: 7,
    limit: 5,
  },

  // Policy and regulatory changes
  policyChanges: {
    name: 'Policy & Regulatory',
    priority: 'high',
    queries: [
      'OMB memo federal technology',
      'executive order federal IT digital',
      'FAR rule change federal contracting',
      'FedRAMP policy authorization',
      'Section 508 accessibility federal',
    ],
    daysBack: 14,
    limit: 4,
  },

  // Technology and modernization - core focus
  techModernization: {
    name: 'Technology & Modernization',
    priority: 'high',
    queries: [
      'federal IT modernization program',
      'agency legacy system replacement',
      'federal cloud migration',
      'government digital transformation',
      'federal customer experience CX initiative',
    ],
    daysBack: 7,
    limit: 5,
  },

  // AI in government - emerging opportunity
  aiGovernment: {
    name: 'AI in Government',
    priority: 'medium',
    queries: [
      'federal government AI artificial intelligence',
      'agency AI pilot program',
      'responsible AI federal government',
      'generative AI federal agency',
    ],
    daysBack: 7,
    limit: 4,
  },

  // HCD/UX in government - FFTC sweet spot
  hcdUx: {
    name: 'HCD/UX in Government',
    priority: 'high',
    queries: [
      'human centered design federal government',
      'user experience UX federal agency',
      'USWDS design system government',
      'federal customer experience research',
      'plain language federal government',
      'digital services federal user research',
    ],
    daysBack: 14,
    limit: 5,
  },

  // Congressional and legislative - context
  congressional: {
    name: 'Congressional & Legislative',
    priority: 'medium',
    queries: [
      'congress federal IT appropriations',
      'FITARA scorecard federal agency',
      'GAO federal IT report',
      'congressional oversight federal technology',
    ],
    daysBack: 14,
    limit: 3,
  },

  // Protests and performance - only if relevant to digital/IT
  performanceIssues: {
    name: 'Contract Performance',
    priority: 'low',
    queries: [
      'federal IT contract performance issues',
      'GAO protest digital services',
      'federal website outage failure',
      'agency IT project delay',
    ],
    daysBack: 7,
    limit: 3,
  },
};

// Keywords that increase relevance score
export const RELEVANCE_KEYWORDS = {
  // Core capability keywords (high value)
  coreCapabilities: [
    'human-centered design',
    'human centered design',
    'hcd',
    'user experience',
    'user research',
    'ux',
    'service design',
    'customer experience',
    'digital services',
    'digital transformation',
    'it modernization',
    'technology modernization',
    'software development',
    'agile',
    'devops',
    'cloud native',
    'design system',
    'uswds',
    'accessibility',
    '508 compliance',
    'plain language',
  ],

  // AI/ML keywords (emerging focus)
  aiMl: [
    'artificial intelligence',
    'machine learning',
    'generative ai',
    'large language model',
    'llm',
    'chatbot',
    'ai',
  ],

  // Budget/spending keywords
  budget: [
    'budget',
    'appropriation',
    'funding',
    'spending',
    'investment',
    'modernization fund',
    'tmf',
  ],

  // Policy keywords
  policy: [
    'executive order',
    'omb memo',
    'policy',
    'regulation',
    'far',
    'fedramp',
    'mandate',
    'requirement',
  ],

  // Technology keywords
  technology: [
    'cloud',
    'aws',
    'azure',
    'modernization',
    'legacy',
    'migration',
    'api',
    'microservices',
    'devops',
    'ci/cd',
  ],
};

// Keywords that decrease relevance (not our focus)
export const NEGATIVE_KEYWORDS = [
  'weapons',
  'munitions',
  'missile',
  'fighter jet',
  'submarine',
  'tank',
  'artillery',
  'construction',
  'building',
  'facilities',
  'janitorial',
  'landscaping',
  'vehicle fleet',
  'furniture',
  'office supplies',
  'staffing augmentation',
  'body shop',
  'help desk',
  'tier 1 support',
  'mainframe',
  'cobol',
];

// Quality news sources (boost score)
export const QUALITY_SOURCES = [
  'federal news network',
  'federalnewsnetwork',
  'nextgov',
  'fcw',
  'govexec',
  'government executive',
  'meritalk',
  'fedscoop',
  'govconwire',
  'washington technology',
  'bloomberg government',
  'gao',
  'omb',
  'whitehouse',
];

export interface NewsArticle {
  title: string;
  snippet?: string;
  url: string;
  source: string;
  publishedDate?: string;
}

export interface ScoredArticle extends NewsArticle {
  score: number;
  reasons: string[];
  topic: string;
}

/**
 * Score a news article for relevance to FFTC
 * Returns 0-100 score with reasons
 */
export function scoreNewsArticle(
  article: NewsArticle,
  topic: string
): { score: number; reasons: string[] } {
  let score = 20; // Base score for matching a topic query
  const reasons: string[] = [];

  const text = `${article.title} ${article.snippet || ''}`.toLowerCase();
  const source = article.source.toLowerCase();

  // Check for negative keywords first (hard exclude)
  for (const keyword of NEGATIVE_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      return { score: 0, reasons: [`Excluded: contains "${keyword}"`] };
    }
  }

  // Target agency mentioned (+20)
  for (const agency of TARGET_AGENCIES) {
    if (text.includes(agency.name.toLowerCase()) || text.includes(agency.fullName.toLowerCase())) {
      score += 20;
      reasons.push(`Target agency: ${agency.name}`);
      break; // Only count once
    }
  }

  // Core capability keywords (+25 for first match, +5 for additional)
  let coreMatches = 0;
  for (const keyword of RELEVANCE_KEYWORDS.coreCapabilities) {
    if (text.includes(keyword.toLowerCase())) {
      coreMatches++;
    }
  }
  if (coreMatches > 0) {
    score += 25 + Math.min((coreMatches - 1) * 5, 15);
    reasons.push(`Core capability match (${coreMatches} keywords)`);
  }

  // AI/ML keywords (+15)
  const hasAiKeyword = RELEVANCE_KEYWORDS.aiMl.some((kw) => text.includes(kw.toLowerCase()));
  if (hasAiKeyword) {
    score += 15;
    reasons.push('AI/ML focus');
  }

  // Budget/spending keywords (+15)
  const hasBudgetKeyword = RELEVANCE_KEYWORDS.budget.some((kw) => text.includes(kw.toLowerCase()));
  if (hasBudgetKeyword) {
    score += 15;
    reasons.push('Budget/spending news');
  }

  // Policy keywords (+15)
  const hasPolicyKeyword = RELEVANCE_KEYWORDS.policy.some((kw) => text.includes(kw.toLowerCase()));
  if (hasPolicyKeyword) {
    score += 15;
    reasons.push('Policy/regulatory');
  }

  // Quality source (+10)
  const isQualitySource = QUALITY_SOURCES.some((s) => source.includes(s));
  if (isQualitySource) {
    score += 10;
    reasons.push('Quality source');
  }

  // Recency bonus (+10 if published date is recent)
  if (article.publishedDate) {
    const publishedDate = new Date(article.publishedDate);
    const daysAgo = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 3) {
      score += 10;
      reasons.push('Recent (< 3 days)');
    }
  }

  // Topic priority bonus
  const topicConfig = Object.values(NEWS_TOPICS).find((t) => t.name === topic);
  if (topicConfig?.priority === 'high') {
    score += 5;
  }

  // Cap at 100
  score = Math.min(100, score);

  return { score, reasons };
}

/**
 * Filter and score articles, returning only those above threshold
 */
export function filterRelevantArticles(
  articles: NewsArticle[],
  topic: string,
  threshold: number = 50
): ScoredArticle[] {
  const scored: ScoredArticle[] = [];

  for (const article of articles) {
    const { score, reasons } = scoreNewsArticle(article, topic);
    if (score >= threshold) {
      scored.push({
        ...article,
        score,
        reasons,
        topic,
      });
    }
  }

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Determine posting threshold based on article score
 */
export function getPostingDecision(score: number): {
  shouldPost: boolean;
  urgency: 'immediate' | 'digest' | 'skip';
  enthusiasm: 'high' | 'medium' | 'low';
} {
  if (score >= 75) {
    return { shouldPost: true, urgency: 'immediate', enthusiasm: 'high' };
  } else if (score >= 60) {
    return { shouldPost: true, urgency: 'digest', enthusiasm: 'medium' };
  } else if (score >= 50) {
    return { shouldPost: true, urgency: 'digest', enthusiasm: 'low' };
  } else {
    return { shouldPost: false, urgency: 'skip', enthusiasm: 'low' };
  }
}
