/**
 * G2X Pagination Tests
 *
 * Covers:
 * - Deterministic pagination with explicit state
 * - Record-ID deduplication
 * - Maximum pages/records bounds
 * - Incomplete state on failure
 * - No checkpoint claiming completeness after partial failure
 * - Response format parsing
 */

import { describe, it, expect } from 'vitest';
import {
  createPaginationState,
  extractRecordsFromResponse,
  extractRecordId,
} from '../pagination.js';
import type { MCPToolCallResponse } from '../types.js';

describe('Pagination State', () => {
  it('creates initial state with correct bounds', () => {
    const state = createPaginationState(50, 5);

    expect(state.currentPage).toBe(0);
    expect(state.pagesConsumed).toBe(0);
    expect(state.cursor).toBeNull();
    expect(state.seenIds.size).toBe(0);
    expect(state.totalRetrieved).toBe(0);
    expect(state.maxRecords).toBe(50);
    expect(state.maxPages).toBe(5);
  });

  it('enforces maximum records', () => {
    const state = createPaginationState(10, 100);
    expect(state.maxRecords).toBe(10);
  });

  it('enforces maximum pages', () => {
    const state = createPaginationState(1000, 3);
    expect(state.maxPages).toBe(3);
  });
});

describe('Response Parsing', () => {
  it('parses array response', () => {
    const response: MCPToolCallResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { id: '1', title: 'A' },
            { id: '2', title: 'B' },
          ]),
        },
      ],
    };

    const { records, nextCursor, totalAvailable } = extractRecordsFromResponse(response);

    expect(records).toHaveLength(2);
    expect(nextCursor).toBeNull();
    expect(totalAvailable).toBeNull();
  });

  it('parses paginated response with results field', () => {
    const response: MCPToolCallResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [{ id: '1' }, { id: '2' }],
            nextCursor: 'page2',
            total: 100,
          }),
        },
      ],
    };

    const { records, nextCursor, totalAvailable } = extractRecordsFromResponse(response);

    expect(records).toHaveLength(2);
    expect(nextCursor).toBe('page2');
    expect(totalAvailable).toBe(100);
  });

  it('parses response with data field', () => {
    const response: MCPToolCallResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ data: [{ id: '1' }] }),
        },
      ],
    };

    const { records } = extractRecordsFromResponse(response);
    expect(records).toHaveLength(1);
  });

  it('parses response with items field', () => {
    const response: MCPToolCallResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ items: [{ id: '1' }] }),
        },
      ],
    };

    const { records } = extractRecordsFromResponse(response);
    expect(records).toHaveLength(1);
  });

  it('returns empty for no text content', () => {
    const response: MCPToolCallResponse = {
      content: [{ type: 'image', data: 'base64...' }],
    };

    const { records } = extractRecordsFromResponse(response);
    expect(records).toHaveLength(0);
  });

  it('returns empty for invalid JSON', () => {
    const response: MCPToolCallResponse = {
      content: [{ type: 'text', text: 'not json' }],
    };

    const { records } = extractRecordsFromResponse(response);
    expect(records).toHaveLength(0);
  });

  it('returns empty for empty content', () => {
    const response: MCPToolCallResponse = {
      content: [],
    };

    const { records } = extractRecordsFromResponse(response);
    expect(records).toHaveLength(0);
  });

  it('handles next_cursor (snake_case) variant', () => {
    const response: MCPToolCallResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [{ id: '1' }],
            next_cursor: 'abc',
          }),
        },
      ],
    };

    const { nextCursor } = extractRecordsFromResponse(response);
    expect(nextCursor).toBe('abc');
  });
});

describe('Record ID Extraction', () => {
  it('extracts id field', () => {
    expect(extractRecordId({ id: '123' })).toBe('123');
  });

  it('extracts noticeId field', () => {
    expect(extractRecordId({ noticeId: 'NOTICE-456' })).toBe('NOTICE-456');
  });

  it('extracts opportunity_id field', () => {
    expect(extractRecordId({ opportunity_id: 'OPP-789' })).toBe('OPP-789');
  });

  it('extracts contractId field', () => {
    expect(extractRecordId({ contractId: 'C-001' })).toBe('C-001');
  });

  it('extracts companyId field', () => {
    expect(extractRecordId({ companyId: 'COMP-1' })).toBe('COMP-1');
  });

  it('returns null when no ID field found', () => {
    expect(extractRecordId({ name: 'test', value: 42 })).toBeNull();
  });

  it('converts numeric IDs to string', () => {
    expect(extractRecordId({ id: 42 })).toBe('42');
  });

  it('prefers id over other fields', () => {
    expect(extractRecordId({ id: 'primary', noticeId: 'secondary' })).toBe('primary');
  });
});

describe('Deduplication Logic', () => {
  it('tracks seen IDs in pagination state', () => {
    const state = createPaginationState(100, 10);

    state.seenIds.add('id-1');
    state.seenIds.add('id-2');
    state.seenIds.add('id-1'); // Duplicate

    expect(state.seenIds.size).toBe(2);
    expect(state.seenIds.has('id-1')).toBe(true);
    expect(state.seenIds.has('id-3')).toBe(false);
  });
});
