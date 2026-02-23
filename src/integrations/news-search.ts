// News Search Integration
// Used by David/Maya to find recent agency news, leadership changes, and program updates

import { getSupabase } from './supabase.js';

export interface NewsArticle {
  title: string;
  snippet: string;
  url: string;
  source: string;
  publishedDate?: string;
}

// ============================================================
// Shared deduplication with gov-news.ts via seen_news table
// ============================================================

/**
 * Check if a news article URL has already been seen/posted
 */
export async function isNewsAlreadySeen(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const supabase = getSupabase();
    // Normalize URL for comparison (remove trailing slashes, query params)
    const normalizedUrl = normalizeUrl(url);
    const { data } = await supabase
      .from('seen_news')
      .select('url')
      .or(`url.eq.${url},url.eq.${normalizedUrl}`)
      .limit(1);
    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

/**
 * Record a news article as seen (prevents future duplicates)
 */
export async function recordSeenNews(article: NewsArticle, relevanceScore?: number): Promise<void> {
  if (!article.url) return;
  try {
    const supabase = getSupabase();
    await supabase.from('seen_news').insert({
      url: article.url,
      title: article.title,
      source: article.source,
      relevance_score: relevanceScore,
      seen_at: new Date().toISOString(),
    });
  } catch {
    // Ignore duplicates or errors
  }
}

/**
 * Normalize URL for comparison (handles trailing slashes, some query params)
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slash from pathname
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    // Remove common tracking params
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Filter out articles that have already been seen
 * Use this before posting news to Slack to prevent duplicates
 */
export async function filterSeenNews(articles: NewsArticle[]): Promise<NewsArticle[]> {
  const newArticles: NewsArticle[] = [];

  for (const article of articles) {
    if (!article.url) continue;
    const seen = await isNewsAlreadySeen(article.url);
    if (!seen) {
      newArticles.push(article);
    }
  }

  return newArticles;
}

/**
 * Filter and record articles as seen in one operation
 * Returns only new (unseen) articles and marks them as seen
 */
export async function getAndMarkNewArticles(
  articles: NewsArticle[],
  relevanceScore?: number
): Promise<NewsArticle[]> {
  const newArticles = await filterSeenNews(articles);

  // Mark new articles as seen
  for (const article of newArticles) {
    await recordSeenNews(article, relevanceScore);
  }

  return newArticles;
}

export interface NewsSearchResult {
  articles: NewsArticle[];
  query: string;
  source: 'bing' | 'google' | 'serpapi' | 'mock';
}

// GovCon news sources for contract award searches
const GOVCON_SITES = [
  'orangeslices.com',
  'govconwire.com',
  'washingtontechnology.com',
  'federalnewsnetwork.com',
  'nextgov.com',
  'fcw.com',
  'executivegov.com',
];

// Main search function - uses whichever API is configured
export async function searchNews(params: {
  query: string;
  agencyName?: string;
  limit?: number;
  daysBack?: number; // How many days of news to search (default 30)
  govconOnly?: boolean; // Search only GovCon news sources
}): Promise<NewsSearchResult> {
  const { query, agencyName, limit = 5, daysBack = 30, govconOnly = false } = params;

  // Build search query
  let searchQuery = query;
  if (agencyName) {
    searchQuery = `${agencyName} ${query}`;
  }

  // If searching for contract awards, use GovCon sites
  if (govconOnly) {
    // Use site: operator to search specific GovCon sources
    const siteFilter = GOVCON_SITES.map((s) => `site:${s}`).join(' OR ');
    searchQuery = `(${siteFilter}) ${searchQuery}`;
  } else {
    searchQuery += ' federal government';
  }

  // Check cache first (include daysBack in cache key for freshness)
  const cacheKey = `news:${searchQuery}:${daysBack}d`;
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    console.log('News: Using cached result');
    return cached;
  }

  // Try APIs in order of preference
  let result: NewsSearchResult;

  if (process.env.BING_SEARCH_API_KEY) {
    result = await searchBing(searchQuery, limit, daysBack);
  } else if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
    result = await searchGoogle(searchQuery, limit, daysBack);
  } else if (process.env.SERPAPI_KEY) {
    result = await searchSerpAPI(searchQuery, limit, daysBack);
  } else {
    console.warn(
      'No news search API configured. Set BING_SEARCH_API_KEY, GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_CX, or SERPAPI_KEY'
    );
    result = {
      articles: [],
      query: searchQuery,
      source: 'mock',
    };
  }

  // Cache result
  if (result.articles.length > 0) {
    await cacheResult(cacheKey, result);
  }

  return result;
}

// Search for agency-specific news
export async function getAgencyNews(agencyName: string): Promise<{
  recentNews: NewsArticle[];
  leadershipChanges: NewsArticle[];
  programNews: NewsArticle[];
  source: string;
}> {
  // Run multiple searches in parallel
  const [general, leadership, programs] = await Promise.all([
    searchNews({ agencyName, query: 'news announcement', limit: 3 }),
    searchNews({ agencyName, query: 'CIO CTO leadership appointed resigned', limit: 3 }),
    searchNews({ agencyName, query: 'contract award program modernization', limit: 3 }),
  ]);

  return {
    recentNews: general.articles,
    leadershipChanges: leadership.articles,
    programNews: programs.articles,
    source: general.source,
  };
}

// Search for contract awards from GovCon news sources (OrangeSlices, GovConWire, etc.)
export async function searchContractAwards(params: {
  agencyName?: string;
  vendorName?: string;
  keywords?: string[];
  limit?: number;
  daysBack?: number;
}): Promise<NewsSearchResult> {
  const { agencyName, vendorName, keywords = [], limit = 5, daysBack = 60 } = params;

  // Build query focused on contract awards
  const queryParts: string[] = [];
  if (agencyName) queryParts.push(agencyName);
  if (vendorName) queryParts.push(vendorName);
  queryParts.push(...keywords);
  queryParts.push('contract award');

  const query = queryParts.join(' ');

  return searchNews({
    query,
    limit,
    daysBack,
    govconOnly: true, // Search GovCon sources like OrangeSlices
  });
}

// Bing News Search API
async function searchBing(
  query: string,
  limit: number,
  daysBack: number = 30
): Promise<NewsSearchResult> {
  const apiKey = process.env.BING_SEARCH_API_KEY!;

  // Bing freshness: Day, Week, Month
  const freshness = daysBack <= 7 ? 'Week' : 'Month';

  try {
    const url = new URL('https://api.bing.microsoft.com/v7.0/news/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', limit.toString());
    url.searchParams.set('freshness', freshness);
    url.searchParams.set('mkt', 'en-US');

    const response = await fetch(url.toString(), {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Bing API error: ${response.status}`);
    }

    const data = (await response.json()) as any;

    const articles: NewsArticle[] = (data.value || []).map((item: any) => ({
      title: item.name,
      snippet: item.description,
      url: item.url,
      source: item.provider?.[0]?.name || 'Unknown',
      publishedDate: item.datePublished,
    }));

    return {
      articles,
      query,
      source: 'bing',
    };
  } catch (error) {
    console.error('Bing search error:', error);
    return { articles: [], query, source: 'bing' };
  }
}

// Google Custom Search API
async function searchGoogle(
  query: string,
  limit: number,
  daysBack: number = 30
): Promise<NewsSearchResult> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY!;
  const cx = process.env.GOOGLE_SEARCH_CX!;

  // Google dateRestrict: d[number], w[number], m[number], y[number]
  const dateRestrict = daysBack <= 7 ? `d${daysBack}` : daysBack <= 31 ? 'm1' : `d${daysBack}`;

  try {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', Math.min(limit, 10).toString());
    url.searchParams.set('dateRestrict', dateRestrict);
    url.searchParams.set('sort', 'date');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = (await response.json()) as any;

    const articles: NewsArticle[] = (data.items || []).map((item: any) => ({
      title: item.title,
      snippet: item.snippet,
      url: item.link,
      source: item.displayLink || 'Unknown',
      publishedDate: item.pagemap?.metatags?.[0]?.['article:published_time'],
    }));

    return {
      articles,
      query,
      source: 'google',
    };
  } catch (error) {
    console.error('Google search error:', error);
    return { articles: [], query, source: 'google' };
  }
}

// SerpAPI (good for news aggregation)
async function searchSerpAPI(
  query: string,
  limit: number,
  daysBack: number = 30
): Promise<NewsSearchResult> {
  const apiKey = process.env.SERPAPI_KEY!;

  // SerpAPI Google News uses 'when' parameter: 1d, 7d, 30d, 1y
  let whenParam = '1m'; // default to last month
  if (daysBack <= 1) whenParam = '1d';
  else if (daysBack <= 7) whenParam = '7d';
  else if (daysBack <= 30) whenParam = '1m';
  else if (daysBack <= 365) whenParam = '1y';

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('engine', 'google_news');
    url.searchParams.set('q', query);
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('when', whenParam); // Filter by time

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = (await response.json()) as any;

    const articles: NewsArticle[] = (data.news_results || []).slice(0, limit).map((item: any) => ({
      title: item.title,
      snippet: item.snippet,
      url: item.link,
      source: item.source?.name || 'Unknown',
      publishedDate: item.date,
    }));

    return {
      articles,
      query,
      source: 'serpapi',
    };
  } catch (error) {
    console.error('SerpAPI error:', error);
    return { articles: [], query, source: 'serpapi' };
  }
}

// Cache helpers
async function getCachedResult(cacheKey: string): Promise<NewsSearchResult | null> {
  try {
    const supabase = getSupabase();

    const { data } = await supabase
      .from('research_cache')
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (data) {
      // News cache is short - 2 hours for fresh results
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      if (cacheAge < 2 * 60 * 60 * 1000) {
        return data.data as NewsSearchResult;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheResult(cacheKey: string, result: NewsSearchResult): Promise<void> {
  try {
    const supabase = getSupabase();

    await supabase.from('research_cache').upsert(
      {
        cache_key: cacheKey,
        source: 'news',
        data: result,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );
  } catch (error) {
    console.warn('Failed to cache news result:', error);
  }
}

// Search for competitor intel - protests, performance issues, contract problems
export async function searchCompetitorNews(params: {
  companyName: string;
  agencyName?: string;
  daysBack?: number;
}): Promise<{
  protests: NewsArticle[];
  performance: NewsArticle[];
  awards: NewsArticle[];
  general: NewsArticle[];
  summary: string;
}> {
  const { companyName, agencyName, daysBack = 180 } = params;

  // Search patterns based on the spec
  const searches = [
    // Protest news
    searchNews({
      query: `"${companyName}" protest GAO`,
      limit: 3,
      daysBack,
      govconOnly: true,
    }),
    // Performance issues
    searchNews({
      query: `"${companyName}" ${agencyName || ''} performance problems issues`,
      limit: 3,
      daysBack,
      govconOnly: true,
    }),
    // Awards (to see what they're winning)
    searchNews({
      query: `"${companyName}" contract award won`,
      limit: 3,
      daysBack: 90,
      govconOnly: true,
    }),
    // General news
    searchNews({
      query: `"${companyName}" federal contract`,
      limit: 3,
      daysBack: 60,
    }),
  ];

  const [protestResult, performanceResult, awardResult, generalResult] =
    await Promise.all(searches);

  // Build summary
  const summaryParts: string[] = [];

  if (protestResult.articles.length > 0) {
    summaryParts.push(`Found ${protestResult.articles.length} GAO protest mention(s)`);
  }
  if (performanceResult.articles.length > 0) {
    summaryParts.push(`Found ${performanceResult.articles.length} performance issue mention(s)`);
  }
  if (awardResult.articles.length > 0) {
    summaryParts.push(`${awardResult.articles.length} recent contract win(s)`);
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join('. ') + '.'
      : `No significant news found for ${companyName}.`;

  return {
    protests: protestResult.articles,
    performance: performanceResult.articles,
    awards: awardResult.articles,
    general: generalResult.articles,
    summary,
  };
}

// Search for agency contract news (awards, issues, recompetes)
export async function searchAgencyContractNews(params: {
  agencyName: string;
  keywords?: string[];
  daysBack?: number;
}): Promise<NewsSearchResult> {
  const { agencyName, keywords = [], daysBack = 90 } = params;

  const keywordStr = keywords.slice(0, 2).join(' ');
  const query = `${agencyName} ${keywordStr} contract award OR recompete OR modernization`;

  return searchNews({
    query,
    limit: 5,
    daysBack,
    govconOnly: true,
  });
}

// Format for agent response
export function formatNewsForAgent(articles: NewsArticle[]): string {
  if (articles.length === 0) {
    return 'No recent news found for this search.';
  }

  const summaries = articles.slice(0, 3).map((a) => {
    const date = a.publishedDate ? ` (${new Date(a.publishedDate).toLocaleDateString()})` : '';
    return `- ${a.title}${date} - ${a.source}`;
  });

  return `Recent news:\n${summaries.join('\n')}`;
}
