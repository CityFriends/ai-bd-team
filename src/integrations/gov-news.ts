/**
 * Government News Scanner
 *
 * Scans government news sources for relevant updates:
 * - whitehouse.gov - Executive orders, policy announcements
 * - Federal News Network - Agency news, budget updates
 * - GovExec/Nextgov - Federal IT news
 * - Agency blogs (VA, HHS, CMS)
 *
 * Used by David for daily news digests.
 */

import * as cheerio from 'cheerio';
import { getSupabase } from './supabase.js';

export interface GovNewsItem {
  title: string;
  url: string;
  source: string;
  summary?: string;
  publishedDate?: string;
  agency?: string;
  relevanceScore?: number;
  reasons?: string[];
}

interface NewsSource {
  name: string;
  url: string;
  parseFunction: (html: string, baseUrl: string) => GovNewsItem[];
}

/**
 * News sources configuration
 */
const NEWS_SOURCES: NewsSource[] = [
  {
    name: 'White House',
    url: 'https://www.whitehouse.gov/news/',
    parseFunction: parseWhiteHouseNews,
  },
  {
    name: 'Federal News Network',
    url: 'https://federalnewsnetwork.com/category/government-news/',
    parseFunction: parseFederalNewsNetwork,
  },
  {
    name: 'Nextgov',
    url: 'https://www.nextgov.com/it-modernization/',
    parseFunction: parseNextgov,
  },
  {
    name: 'GovExec',
    url: 'https://www.govexec.com/technology/',
    parseFunction: parseGovExec,
  },
  {
    name: 'VA News',
    url: 'https://news.va.gov/',
    parseFunction: parseVANews,
  },
  {
    name: 'HHS News',
    url: 'https://www.hhs.gov/about/news/index.html',
    parseFunction: parseHHSNews,
  },
];

/**
 * Fetch a URL with error handling
 */
async function fetchWithTimeout(url: string, timeout = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BD-Team-News-Bot/1.0)',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[GovNews] HTTP ${response.status} from ${url}`);
      return null;
    }

    return await response.text();
  } catch (err) {
    console.warn(`[GovNews] Error fetching ${url}:`, err);
    return null;
  }
}

/**
 * Parse White House news
 */
function parseWhiteHouseNews(html: string, baseUrl: string): GovNewsItem[] {
  const $ = cheerio.load(html);
  const items: GovNewsItem[] = [];

  // Look for news article links
  $('article, .news-item, .briefing-statement, [class*="post"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a').first();
    const title = $link.text().trim() || $el.find('h2, h3, .title').first().text().trim();
    let url = $link.attr('href') || '';

    if (!title || title.length < 10) return;

    if (url && !url.startsWith('http')) {
      url = new URL(url, baseUrl).toString();
    }

    items.push({
      title,
      url,
      source: 'White House',
      publishedDate: $el.find('time, .date, [class*="date"]').first().text().trim() || undefined,
    });
  });

  return items.slice(0, 10);
}

/**
 * Parse Federal News Network
 */
function parseFederalNewsNetwork(html: string, baseUrl: string): GovNewsItem[] {
  const $ = cheerio.load(html);
  const items: GovNewsItem[] = [];

  $('article, .post, .story, [class*="article"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a[href*="/20"]').first(); // Links with year in URL
    const title = $link.text().trim() || $el.find('h2, h3, .headline').first().text().trim();
    let url = $link.attr('href') || '';

    if (!title || title.length < 10) return;

    if (url && !url.startsWith('http')) {
      url = new URL(url, baseUrl).toString();
    }

    items.push({
      title,
      url,
      source: 'Federal News Network',
      summary: $el.find('.excerpt, .summary, p').first().text().trim().slice(0, 200) || undefined,
    });
  });

  return items.slice(0, 10);
}

/**
 * Parse Nextgov
 */
function parseNextgov(html: string, baseUrl: string): GovNewsItem[] {
  const $ = cheerio.load(html);
  const items: GovNewsItem[] = [];

  $('article, .article-item, [class*="story"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a').first();
    const title = $el.find('h2, h3, .title, .headline').first().text().trim();
    let url = $link.attr('href') || '';

    if (!title || title.length < 10) return;

    if (url && !url.startsWith('http')) {
      url = new URL(url, baseUrl).toString();
    }

    items.push({
      title,
      url,
      source: 'Nextgov',
      summary:
        $el.find('.deck, .excerpt, .summary').first().text().trim().slice(0, 200) || undefined,
    });
  });

  return items.slice(0, 10);
}

/**
 * Parse GovExec
 */
function parseGovExec(html: string, baseUrl: string): GovNewsItem[] {
  const $ = cheerio.load(html);
  const items: GovNewsItem[] = [];

  $('article, .article, [class*="story"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a').first();
    const title = $el.find('h2, h3, .title, .headline').first().text().trim();
    let url = $link.attr('href') || '';

    if (!title || title.length < 10) return;

    if (url && !url.startsWith('http')) {
      url = new URL(url, baseUrl).toString();
    }

    items.push({
      title,
      url,
      source: 'GovExec',
    });
  });

  return items.slice(0, 10);
}

/**
 * Parse VA News
 */
function parseVANews(html: string, baseUrl: string): GovNewsItem[] {
  const $ = cheerio.load(html);
  const items: GovNewsItem[] = [];

  $('article, .news-item, [class*="post"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a').first();
    const title = $link.text().trim() || $el.find('h2, h3').first().text().trim();
    let url = $link.attr('href') || '';

    if (!title || title.length < 10) return;

    if (url && !url.startsWith('http')) {
      url = new URL(url, baseUrl).toString();
    }

    items.push({
      title,
      url,
      source: 'VA News',
      agency: 'VA',
    });
  });

  return items.slice(0, 10);
}

/**
 * Parse HHS News
 */
function parseHHSNews(html: string, baseUrl: string): GovNewsItem[] {
  const $ = cheerio.load(html);
  const items: GovNewsItem[] = [];

  $('article, .news-item, .views-row, [class*="news"]').each((_, el) => {
    const $el = $(el);
    const $link = $el.find('a').first();
    const title = $link.text().trim() || $el.find('h2, h3, .title').first().text().trim();
    let url = $link.attr('href') || '';

    if (!title || title.length < 10) return;

    if (url && !url.startsWith('http')) {
      url = new URL(url, baseUrl).toString();
    }

    items.push({
      title,
      url,
      source: 'HHS News',
      agency: 'HHS',
    });
  });

  return items.slice(0, 10);
}

/**
 * Score news relevance for BD team
 */
export function scoreNewsRelevance(item: GovNewsItem): { score: number; reasons: string[] } {
  let score = 30;
  const reasons: string[] = [];
  const text = `${item.title} ${item.summary || ''}`.toLowerCase();

  // High relevance keywords
  const highRelevance = [
    'contract',
    'procurement',
    'rfp',
    'rfi',
    'solicitation',
    'award',
    'acquisition',
    'vendor',
    'contractor',
    'small business',
    '8(a)',
    'wosb',
    'set-aside',
    'modernization',
    'digital transformation',
    'it modernization',
    'budget',
    'funding',
    'appropriation',
    'spending',
  ];

  const highMatches = highRelevance.filter((kw) => text.includes(kw));
  if (highMatches.length > 0) {
    score += highMatches.length * 15;
    reasons.push(`BD relevance: ${highMatches.slice(0, 2).join(', ')}`);
  }

  // Medium relevance - technology/service delivery
  const mediumRelevance = [
    'technology',
    'software',
    'cloud',
    'ai',
    'artificial intelligence',
    'cybersecurity',
    'data',
    'analytics',
    'digital',
    'website',
    'portal',
    'user experience',
    'customer experience',
    'service delivery',
    'agile',
    'devops',
    'innovation',
  ];

  const mediumMatches = mediumRelevance.filter((kw) => text.includes(kw));
  if (mediumMatches.length > 0) {
    score += mediumMatches.length * 8;
    reasons.push(`Tech focus: ${mediumMatches.slice(0, 2).join(', ')}`);
  }

  // Agency relevance
  const priorityAgencies = [
    'va',
    'veterans',
    'hhs',
    'cms',
    'medicare',
    'medicaid',
    'labor',
    'dol',
    'education',
  ];
  if (priorityAgencies.some((a) => text.includes(a))) {
    score += 10;
    reasons.push('Priority agency');
  }

  // Executive/policy relevance
  if (text.includes('executive order') || text.includes('policy') || text.includes('mandate')) {
    score += 12;
    reasons.push('Policy impact');
  }

  // Budget/funding relevance
  if (text.includes('billion') || text.includes('million') || text.includes('budget')) {
    score += 10;
    reasons.push('Funding news');
  }

  return { score: Math.min(100, score), reasons };
}

/**
 * Scan all news sources
 */
export async function scanAllNewsSources(): Promise<GovNewsItem[]> {
  console.log('[GovNews] Scanning news sources...');

  const allNews: GovNewsItem[] = [];

  for (const source of NEWS_SOURCES) {
    console.log(`[GovNews] Fetching ${source.name}...`);

    const html = await fetchWithTimeout(source.url);
    if (!html) {
      console.warn(`[GovNews] Could not fetch ${source.name}`);
      continue;
    }

    try {
      const items = source.parseFunction(html, source.url);
      console.log(`[GovNews] Found ${items.length} items from ${source.name}`);

      // Score items
      for (const item of items) {
        const { score, reasons } = scoreNewsRelevance(item);
        item.relevanceScore = score;
        item.reasons = reasons;
        allNews.push(item);
      }
    } catch (err) {
      console.warn(`[GovNews] Error parsing ${source.name}:`, err);
    }

    // Small delay between requests
    await new Promise((r) => setTimeout(r, 500));
  }

  // Sort by relevance
  allNews.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

  console.log(`[GovNews] Total: ${allNews.length} news items`);

  return allNews;
}

/**
 * Get relevant news (score >= 50)
 */
export async function getRelevantNews(minScore = 50, limit = 15): Promise<GovNewsItem[]> {
  const allNews = await scanAllNewsSources();

  return allNews.filter((item) => (item.relevanceScore || 0) >= minScore).slice(0, limit);
}

/**
 * Check if we've already reported this news item
 */
async function isNewsAlreadySeen(url: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from('seen_news').select('url').eq('url', url).single();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Record that we've seen/reported a news item
 */
async function recordSeenNews(item: GovNewsItem): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('seen_news').insert({
      url: item.url,
      title: item.title,
      source: item.source,
      relevance_score: item.relevanceScore,
      seen_at: new Date().toISOString(),
    });
  } catch {
    // Ignore duplicates
  }
}

/**
 * Get new relevant news (not previously reported)
 */
export async function getNewRelevantNews(minScore = 50, limit = 10): Promise<GovNewsItem[]> {
  const relevant = await getRelevantNews(minScore, limit * 2);

  const newItems: GovNewsItem[] = [];

  for (const item of relevant) {
    if (!item.url) continue;

    const seen = await isNewsAlreadySeen(item.url);
    if (!seen) {
      newItems.push(item);
      await recordSeenNews(item);

      if (newItems.length >= limit) break;
    }
  }

  console.log(`[GovNews] ${newItems.length} new relevant news items`);

  return newItems;
}

/**
 * Format news digest for Slack
 */
export function formatNewsDigest(news: GovNewsItem[]): string {
  if (news.length === 0) {
    return 'Quiet news day - nothing significant to report from my usual sources.';
  }

  // Deduplicate by URL first
  const seenUrls = new Set<string>();
  const uniqueNews = news.filter((item) => {
    if (!item.url || seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });

  let digest = `📰 *Government News Digest*\n\n`;

  // Group by category (mutually exclusive - each item in only one category)
  const usedUrls = new Set<string>();

  const procurement = uniqueNews.filter((n) => {
    if (n.reasons?.some((r) => r.includes('BD relevance'))) {
      usedUrls.add(n.url);
      return true;
    }
    return false;
  });

  const tech = uniqueNews.filter((n) => {
    if (!usedUrls.has(n.url) && n.reasons?.some((r) => r.includes('Tech'))) {
      usedUrls.add(n.url);
      return true;
    }
    return false;
  });

  const policy = uniqueNews.filter((n) => {
    if (!usedUrls.has(n.url) && n.reasons?.some((r) => r.includes('Policy'))) {
      usedUrls.add(n.url);
      return true;
    }
    return false;
  });

  const other = uniqueNews.filter((n) => !usedUrls.has(n.url));

  if (procurement.length > 0) {
    digest += `*Procurement & Contracts*\n`;
    for (const item of procurement.slice(0, 4)) {
      digest += `• <${item.url}|${item.title}> _(${item.source})_\n`;
    }
    digest += '\n';
  }

  if (tech.length > 0) {
    digest += `*Technology & Modernization*\n`;
    for (const item of tech.slice(0, 4)) {
      digest += `• <${item.url}|${item.title}> _(${item.source})_\n`;
    }
    digest += '\n';
  }

  if (policy.length > 0) {
    digest += `*Policy & Executive*\n`;
    for (const item of policy.slice(0, 3)) {
      digest += `• <${item.url}|${item.title}> _(${item.source})_\n`;
    }
    digest += '\n';
  }

  if (other.length > 0 && procurement.length + tech.length + policy.length < 8) {
    digest += `*Other Agency News*\n`;
    for (const item of other.slice(0, 3)) {
      digest += `• <${item.url}|${item.title}> _(${item.source})_\n`;
    }
  }

  return digest;
}
