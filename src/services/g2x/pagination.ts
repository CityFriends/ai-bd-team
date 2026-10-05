/**
 * G2X Deterministic Pagination
 *
 * Follows patterns from src/pipeline/maya/source-sam.ts:
 * - Explicit page/cursor state
 * - Global record-ID deduplication
 * - Maximum pages/records per task
 * - Incomplete state if pagination cannot finish
 * - No checkpoint claiming completeness after partial failure
 * - No agent "get everything" without execution limits
 */

import { logger } from '../../lib/logger.js';
import type {
  G2XAuthState,
  G2XFailure,
  MCPToolCallResponse,
  PaginationResult,
  PaginationState,
} from './types.js';
import { callTool } from './mcp-client.js';

const log = logger.child({ service: 'G2XPagination' });

/**
 * Create initial pagination state with bounded limits.
 */
export function createPaginationState(maxRecords: number, maxPages: number): PaginationState {
  return {
    currentPage: 0,
    pagesConsumed: 0,
    cursor: null,
    seenIds: new Set(),
    totalRetrieved: 0,
    maxRecords,
    maxPages,
  };
}

/**
 * Extract records from an MCP tool response.
 * Handles various response formats (array, object with results, etc.)
 */
export function extractRecordsFromResponse(response: MCPToolCallResponse): {
  records: Record<string, unknown>[];
  nextCursor: string | null;
  totalAvailable: number | null;
} {
  const textContent = response.content?.find((c) => c.type === 'text');
  if (!textContent?.text) {
    return { records: [], nextCursor: null, totalAvailable: null };
  }

  try {
    const parsed = JSON.parse(textContent.text);

    // Handle array response
    if (Array.isArray(parsed)) {
      return { records: parsed, nextCursor: null, totalAvailable: null };
    }

    // Handle paginated response with results/data field
    const records = parsed.results || parsed.data || parsed.items || parsed.records || [];
    const nextCursor = parsed.nextCursor || parsed.next_cursor || parsed.cursor || null;
    const totalAvailable = parsed.total || parsed.totalCount || parsed.total_count || null;

    return {
      records: Array.isArray(records) ? records : [],
      nextCursor: nextCursor ? String(nextCursor) : null,
      totalAvailable: typeof totalAvailable === 'number' ? totalAvailable : null,
    };
  } catch {
    log.warn('Failed to parse MCP tool response as JSON');
    return { records: [], nextCursor: null, totalAvailable: null };
  }
}

/**
 * Extract a unique record ID from a record.
 * Tries common ID field names.
 */
export function extractRecordId(record: Record<string, unknown>): string | null {
  const idFields = [
    'id',
    'noticeId',
    'notice_id',
    'opportunityId',
    'opportunity_id',
    'contractId',
    'contract_id',
    'awardId',
    'award_id',
    'companyId',
    'company_id',
  ];

  for (const field of idFields) {
    if (record[field] !== null && record[field] !== undefined) {
      return String(record[field]);
    }
  }

  return null;
}

/**
 * Execute a paginated MCP tool call with deterministic bounds.
 *
 * Guarantees:
 * - Never exceeds maxPages or maxRecords
 * - Deduplicates by record ID
 * - Reports incomplete state on any failure
 * - Does not claim completeness after partial failure
 */
export async function paginatedFetch<T>(
  auth: G2XAuthState,
  toolName: string,
  baseParams: Record<string, unknown>,
  state: PaginationState,
  endpoint?: string
): Promise<PaginationResult<T>> {
  const records: T[] = [];
  let duplicatesSkipped = 0;
  let incomplete = false;
  let incompleteReason: string | null = null;

  while (state.pagesConsumed < state.maxPages && state.totalRetrieved < state.maxRecords) {
    // Build paginated params
    const params: Record<string, unknown> = {
      ...baseParams,
      ...(state.cursor ? { cursor: state.cursor } : {}),
      limit: Math.min(
        100, // Page size cap
        state.maxRecords - state.totalRetrieved
      ),
      offset: state.cursor ? undefined : state.currentPage * 100,
    };

    const response = await callTool(auth, { name: toolName, arguments: params }, endpoint);

    // Handle failure
    if ('type' in response && !('content' in response)) {
      const failure = response as G2XFailure;
      incomplete = true;
      incompleteReason = `${failure.type}: ${failure.message}`;

      // Retryable failures are handled by caller (gateway retry logic)
      // We just report the state
      log.warn(
        {
          tool: toolName,
          page: state.pagesConsumed,
          failureType: failure.type,
        },
        'Pagination stopped due to failure'
      );
      break;
    }

    state.pagesConsumed++;
    state.currentPage++;

    // Extract records
    const { records: pageRecords, nextCursor } = extractRecordsFromResponse(
      response as MCPToolCallResponse
    );

    if (pageRecords.length === 0) {
      // No more results
      break;
    }

    // Deduplicate
    for (const record of pageRecords) {
      if (state.totalRetrieved >= state.maxRecords) {
        incomplete = true;
        incompleteReason = `Record limit reached (${state.maxRecords})`;
        break;
      }

      const id = extractRecordId(record);
      if (id !== null && state.seenIds.has(id)) {
        duplicatesSkipped++;
        continue;
      }

      if (id) {
        state.seenIds.add(id);
      }

      records.push(record as T);
      state.totalRetrieved++;
    }

    // Update cursor for next page
    if (nextCursor) {
      state.cursor = nextCursor;
    } else {
      // No cursor and we got results — either last page or offset-based
      // Check if we likely have more
      if (pageRecords.length >= 100) {
        // Full page — probably more results
        state.cursor = null;
      } else {
        // Partial page — we're done
        break;
      }
    }

    // Page limit check
    if (state.pagesConsumed >= state.maxPages) {
      incomplete = true;
      incompleteReason = `Page limit reached (${state.maxPages})`;
      break;
    }
  }

  const result: PaginationResult<T> = {
    records,
    hasMore: incomplete || false,
    pagesConsumed: state.pagesConsumed,
    totalRetrieved: state.totalRetrieved,
    duplicatesSkipped,
    incomplete,
    incompleteReason,
  };

  log.info(
    {
      tool: toolName,
      records: records.length,
      pages: state.pagesConsumed,
      duplicates: duplicatesSkipped,
      incomplete,
      incompleteReason,
    },
    'Pagination complete'
  );

  return result;
}
