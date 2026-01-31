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

export interface NewsSearchResult {
  articles: NewsArticle[];
  query: string;
  source: 'bing' | 'google' | 'serpapi' | 'mock';
}

// Main search function - uses whichever API is configured
export async function searchNews(params: {
  query: string;
  agencyName?: string;
  limit?: number;
}): Promise<NewsSearchResult> {
  const { query, agencyName, limit = 5 } = params;

  // Build search query focused on gov/federal news
  let searchQuery = query;
  if (agencyName) {
    searchQuery = `${agencyName} ${query}`;
  }
  searchQuery += ' federal government';

  // Check cache first
  const cacheKey = `news:${searchQuery}`;
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    console.log('News: Using cached result');
    return cached;
  }

  // Try APIs in order of preference
  let result: NewsSearchResult;

  if (process.env.BING_SEARCH_API_KEY) {
    result = await searchBing(searchQuery, limit);
  } else if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) {
    result = await searchGoogle(searchQuery, limit);
  } else if (process.env.SERPAPI_KEY) {
    result = await searchSerpAPI(searchQuery, limit);
  } else {
    console.warn('No news search API configured. Set BING_SEARCH_API_KEY, GOOGLE_SEARCH_API_KEY/GOOGLE_SEARCH_CX, or SERPAPI_KEY');
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

// Bing News Search API
async function searchBing(query: string, limit: number): Promise<NewsSearchResult> {
  const apiKey = process.env.BING_SEARCH_API_KEY!;

  try {
    const url = new URL('https://api.bing.microsoft.com/v7.0/news/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', limit.toString());
    url.searchParams.set('freshness', 'Month'); // Last 30 days
    url.searchParams.set('mkt', 'en-US');

    const response = await fetch(url.toString(), {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Bing API error: ${response.status}`);
    }

    const data = await response.json() as any;

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
async function searchGoogle(query: string, limit: number): Promise<NewsSearchResult> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY!;
  const cx = process.env.GOOGLE_SEARCH_CX!;

  try {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', Math.min(limit, 10).toString());
    url.searchParams.set('dateRestrict', 'm1'); // Last month
    url.searchParams.set('sort', 'date');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json() as any;

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
async function searchSerpAPI(query: string, limit: number): Promise<NewsSearchResult> {
  const apiKey = process.env.SERPAPI_KEY!;

  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('engine', 'google_news');
    url.searchParams.set('q', query);
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status}`);
    }

    const data = await response.json() as any;

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
      // News cache is short - 6 hours
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      if (cacheAge < 6 * 60 * 60 * 1000) {
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

    await supabase
      .from('research_cache')
      .upsert({
        cache_key: cacheKey,
        source: 'news',
        data: result,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' });
  } catch (error) {
    console.warn('Failed to cache news result:', error);
  }
}

// Format for agent response
export function formatNewsForAgent(articles: NewsArticle[]): string {
  if (articles.length === 0) {
    return "No recent news found for this search.";
  }

  const summaries = articles.slice(0, 3).map(a => {
    const date = a.publishedDate ? ` (${new Date(a.publishedDate).toLocaleDateString()})` : '';
    return `- ${a.title}${date} - ${a.source}`;
  });

  return `Recent news:\n${summaries.join('\n')}`;
}
