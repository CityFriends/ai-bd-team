/**
 * HR Knowledge Keyword Search
 *
 * C8X-107BQ: Guru-style keyword search across approved HR content.
 *
 * Features:
 *   - Full-text search with relevance ranking
 *   - Date-aware filtering (only effective approvals)
 *   - Page-level deduplication
 *   - Phrase query support ("quoted terms")
 *   - Rate limiting (10 searches/minute/user)
 *   - Privacy-conscious analytics
 *
 * Usage:
 *   const results = await searchHRKnowledge(pool, userId, 'parental leave');
 *   const formatted = formatSearchResultsForSlack(results);
 */

import type { Pool } from 'pg';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface SearchResult {
  pageId: string;
  pageTitle: string;
  excerpt: string;
  notionUrl: string;
  rank: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  resultCount: number;
  truncated: boolean;
}

export interface SearchError {
  code: 'INVALID_QUERY' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_QUERY_LENGTH = 500;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate and sanitize search query.
 */
export function validateQuery(query: string): {
  valid: boolean;
  error?: string;
  sanitized?: string;
} {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query is required' };
  }

  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { valid: false, error: `Query must be at least ${MIN_QUERY_LENGTH} characters` };
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return {
      valid: false,
      error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
    };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Check if query is a phrase query (quoted).
 */
export function isPhraseQuery(query: string): boolean {
  return /^".*"$/.test(query.trim());
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search HR knowledge base.
 *
 * @param pool - PostgreSQL connection pool (hr_reader role)
 * @param userId - Slack user ID for rate limiting and analytics
 * @param query - Search query (supports "quoted phrases")
 * @param limit - Maximum results (default 5, max 20)
 */
export async function searchHRKnowledge(
  pool: Pool,
  userId: string,
  query: string,
  limit: number = DEFAULT_LIMIT
): Promise<SearchResponse | SearchError> {
  // Validate query
  const validation = validateQuery(query);
  if (!validation.valid) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { code: 'INVALID_QUERY', message: validation.error! };
  }

  // Enforce limit
  const effectiveLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);

  try {
    const result = await pool.query('SELECT * FROM hr_search_knowledge($1, $2, $3)', [
      userId,
      validation.sanitized,
      effectiveLimit,
    ]);

    const results: SearchResult[] = result.rows.map((row) => ({
      pageId: row.page_id,
      pageTitle: row.page_title,
      excerpt: row.excerpt,
      notionUrl: row.notion_url,
      rank: parseFloat(row.rank),
    }));

    return {
      results,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      query: validation.sanitized!,
      resultCount: results.length,
      truncated: results.length === effectiveLimit,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Check for rate limiting
    if (message.includes('rate limit exceeded')) {
      return {
        code: 'RATE_LIMITED',
        message: 'Too many searches. Please wait a moment and try again.',
      };
    }

    // Check for validation errors from function
    if (message.includes('query must be') || message.includes('user_id is required')) {
      return { code: 'INVALID_QUERY', message };
    }

    // Log internal error (without exposing details)
    // eslint-disable-next-line no-console
    console.error('[HR Search] Internal error:', message);
    return { code: 'INTERNAL_ERROR', message: 'Search temporarily unavailable. Please try again.' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SLACK FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format search results for Slack display.
 *
 * Uses Slack mrkdwn formatting with safe escaping.
 * Produces clean, readable output with:
 * - Clear policy titles as clickable links
 * - Short, coherent excerpts
 * - Consistent spacing
 */
export function formatSearchResultsForSlack(response: SearchResponse | SearchError): string {
  // Handle errors
  if ('code' in response) {
    switch (response.code) {
      case 'RATE_LIMITED':
        return `⏱️ ${response.message}`;
      case 'INVALID_QUERY':
        return `⚠️ ${response.message}`;
      default:
        return `❌ ${response.message}`;
    }
  }

  // Handle no results
  if (response.results.length === 0) {
    return `🔍 No results found for "${escapeSlackText(response.query)}"\n\nTry:\n• Using different keywords\n• Removing quotes for broader search\n• Checking spelling`;
  }

  // Format results with clean presentation
  const lines: string[] = [
    `📋 *${response.resultCount} result${response.resultCount === 1 ? '' : 's'} for "${escapeSlackText(response.query)}"*`,
  ];

  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];

    // Blank line before each result
    lines.push('');

    // Title as clickable link (bold)
    lines.push(`*<${result.notionUrl}|${escapeSlackText(result.pageTitle)}>*`);

    // Clean excerpt (indented, properly formatted)
    const excerpt = formatExcerpt(result.excerpt);
    if (excerpt) {
      lines.push(`>${excerpt}`);
    }
  }

  // Footer with helpful tip
  if (response.truncated) {
    lines.push('');
    lines.push(
      `_Showing top ${response.resultCount}. Try more specific terms for better results._`
    );
  }

  return lines.join('\n');
}

/**
 * Escape special Slack mrkdwn characters.
 */
function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Format excerpt with Slack-compatible presentation.
 *
 * - Converts **highlighted** from PostgreSQL to Slack bold
 * - Cleans up whitespace and fragments
 * - Truncates to reasonable length
 * - Ensures readable, coherent output
 */
function formatExcerpt(excerpt: string): string {
  if (!excerpt) return '';

  let formatted = excerpt;

  // Clean up whitespace (normalize spaces, remove excessive newlines)
  formatted = formatted.replace(/\s+/g, ' ').trim();

  // Convert PostgreSQL ** markers to Slack bold *
  // ts_headline uses ** for StartSel/StopSel, Slack uses single *
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  // Escape Slack special characters (but preserve our * markers)
  // We need to escape &, <, > but NOT *
  formatted = formatted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Clean up any trailing/leading fragments
  // Remove leading "... " if present
  formatted = formatted.replace(/^\.\.\.\s*/, '');

  // If excerpt starts with lowercase, it's likely a fragment - add ellipsis
  if (
    formatted.length > 0 &&
    formatted[0] === formatted[0].toLowerCase() &&
    /[a-z]/.test(formatted[0])
  ) {
    formatted = '...' + formatted;
  }

  // Truncate if too long (preserve word boundaries)
  const maxLength = 150;
  if (formatted.length > maxLength) {
    // Find last space before max length
    const truncateAt = formatted.lastIndexOf(' ', maxLength);
    if (truncateAt > 50) {
      formatted = formatted.slice(0, truncateAt) + '...';
    } else {
      formatted = formatted.slice(0, maxLength - 3) + '...';
    }
  }

  // Ensure excerpt ends properly (not mid-word if possible)
  // If it doesn't end with punctuation or ..., check if we cut mid-sentence
  if (!/[.!?…]$/.test(formatted) && !formatted.endsWith('...')) {
    formatted = formatted + '...';
  }

  return formatted;
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a message is a search command.
 *
 * Supported patterns:
 *   - "search: <query>"
 *   - "search <query>"
 */
export function parseSearchCommand(message: string): string | null {
  const trimmed = message.trim();

  // Pattern: "search: <query>" or "search <query>"
  const match = trimmed.match(/^search[:\s]+(.+)$/i);
  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Check if message contains a search command and return the query.
 */
export function extractSearchQuery(message: string): string | null {
  return parseSearchCommand(message);
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hash a query for privacy-conscious logging.
 */
export function hashQuery(query: string): string {
  return createHash('sha256').update(query).digest('hex');
}

/**
 * Check if a response is an error.
 */
export function isSearchError(response: SearchResponse | SearchError): response is SearchError {
  return 'code' in response;
}
