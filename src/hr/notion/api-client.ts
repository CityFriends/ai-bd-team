/**
 * Notion API Client — Rate-Limited, Read-Only
 *
 * Shared request queue with per-connection rate limiting.
 * Handles 429 (Retry-After), 401 (auth failure → connection deactivation),
 * and transient errors gracefully.
 *
 * Never imports BD Notion modules. Uses HR_* env vars only.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MIN_INTERVAL_MS = 340; // ~3 req/sec, well under 180/min limit

export class NotionAuthError extends Error {
  constructor(public connectionId: string) {
    super(`Notion authentication failed for connection ${connectionId}`);
    this.name = 'NotionAuthError';
  }
}

export class NotionRateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Rate limited, retry after ${retryAfterSec}s`);
    this.name = 'NotionRateLimitError';
  }
}

export interface NotionPage {
  id: string;
  url: string;
  parent: { type: string; page_id?: string; workspace?: boolean };
  last_edited_time: string;
  created_time: string;
  properties: Record<string, unknown>;
  in_trash: boolean;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

export interface NotionSearchResult {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionBlockChildren {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Make a rate-limited Notion API request.
 * On 401: throws NotionAuthError (caller must deactivate connection).
 * On 429: waits Retry-After, retries once.
 * On 5xx: throws (caller handles in checkpoint).
 */
export async function notionRequest(
  connectionId: string,
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  await throttle();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${NOTION_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    throw new NotionAuthError(connectionId);
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    // Retry once
    const retry = await fetch(`${NOTION_API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (retry.status === 429) {
      throw new NotionRateLimitError(retryAfter);
    }
    return { status: retry.status, data: await retry.json() };
  }

  if (response.status >= 500) {
    throw new Error(`Notion API ${response.status}: ${response.statusText}`);
  }

  const data = response.ok ? await response.json() : null;
  return { status: response.status, data };
}

/**
 * Search all pages visible to the integration.
 * Complete cursor-safe pagination — never terminates early.
 */
export async function searchAllPages(
  connectionId: string,
  token: string
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;

  do {
    const { data } = await notionRequest(connectionId, token, 'POST', '/search', {
      filter: { property: 'object', value: 'page' },
      start_cursor: cursor || undefined,
      page_size: 100,
    });
    const result = data as NotionSearchResult;
    for (const page of result.results) {
      if (!page.in_trash) pages.push(page);
    }
    cursor = result.next_cursor;
  } while (cursor);

  return pages;
}

/**
 * Retrieve a single page's metadata. Returns null on 404/403.
 */
export async function getPage(
  connectionId: string,
  token: string,
  pageId: string
): Promise<NotionPage | null> {
  const { status, data } = await notionRequest(
    connectionId, token, 'GET', `/pages/${pageId}`
  );
  if (status === 404 || status === 403) return null;
  return data as NotionPage;
}

/**
 * Recursively fetch all blocks from a page. Extracts plain text and block IDs.
 */
export async function fetchPageBlocks(
  connectionId: string,
  token: string,
  pageId: string,
  maxDepth = 5
): Promise<{ text: string; blocks: Array<{ id: string; type: string; text: string; heading?: string }> }> {
  const allBlocks: Array<{ id: string; type: string; text: string; heading?: string }> = [];

  async function fetchChildren(blockId: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let cursor: string | null = null;
    do {
      const { data } = await notionRequest(connectionId, token, 'GET',
        `/blocks/${blockId}/children${cursor ? `?start_cursor=${cursor}` : ''}`);
      const result = data as NotionBlockChildren;
      for (const block of result.results) {
        const text = extractBlockText(block);
        const heading = isHeading(block) ? text : undefined;
        if (text) allBlocks.push({ id: block.id, type: block.type, text, heading });
        if (block.has_children) await fetchChildren(block.id, depth + 1);
      }
      cursor = result.next_cursor;
    } while (cursor);
  }

  await fetchChildren(pageId, 0);
  const fullText = allBlocks.map((b) => b.text).join('\n');
  return { text: fullText, blocks: allBlocks };
}

function extractBlockText(block: NotionBlock): string {
  const content = block[block.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
  if (!content?.rich_text) return '';
  return content.rich_text.map((t) => t.plain_text).join('');
}

function isHeading(block: NotionBlock): boolean {
  return block.type.startsWith('heading_');
}
