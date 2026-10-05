/**
 * G2X Usage Ledger Tests
 *
 * Covers:
 * - Usage recording (success and failure)
 * - Query hash computation
 * - Request ID generation
 * - Monthly consumption tracking
 * - Failed/partial calls are recorded
 * - Records_billable_known vs records_returned distinction
 * - Commissioning environment guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/environment.js', () => ({
  assertCommissioningEnvironment: vi.fn(),
}));

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockSelect = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

vi.mock('../../../integrations/database/client.js', () => ({
  getSupabase: () => ({
    from: vi.fn().mockReturnValue({
      insert: mockInsert,
      select: mockSelect,
    }),
  }),
}));

mockSelect.mockReturnValue({ gte: mockGte, order: mockOrder });
mockGte.mockResolvedValue({ data: [], error: null });
mockOrder.mockReturnValue({ limit: mockLimit });
mockLimit.mockResolvedValue({ data: [], error: null });

import {
  computeQueryHash,
  generateRequestId,
  recordUsage,
  buildFailureUsageEntry,
  getMonthlyConsumption,
} from '../usage-ledger.js';
import type { ExternalUsageEntry } from '../types.js';

describe('Query Hash', () => {
  it('produces consistent hash for same inputs', () => {
    const hash1 = computeQueryHash('search', { query: 'test' });
    const hash2 = computeQueryHash('search', { query: 'test' });
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different inputs', () => {
    const hash1 = computeQueryHash('search', { query: 'test' });
    const hash2 = computeQueryHash('search', { query: 'other' });
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash for different tools', () => {
    const hash1 = computeQueryHash('search', { query: 'test' });
    const hash2 = computeQueryHash('get', { query: 'test' });
    expect(hash1).not.toBe(hash2);
  });

  it('returns 16-character hex string', () => {
    const hash = computeQueryHash('tool', { param: 'value' });
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('Request ID Generation', () => {
  it('generates unique IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });

  it('uses provided prefix', () => {
    const id = generateRequestId('test');
    expect(id.startsWith('test-')).toBe(true);
  });

  it('defaults to g2x prefix', () => {
    const id = generateRequestId();
    expect(id.startsWith('g2x-')).toBe(true);
  });
});

describe('Usage Recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it('records successful usage entry', async () => {
    const entry: ExternalUsageEntry = {
      requestId: 'req-123',
      timestamp: new Date().toISOString(),
      workflowId: 'wf-456',
      agentCapability: 'maya',
      tool: 'search_opportunities',
      queryHash: 'abc123',
      recordsReturned: 10,
      recordsBillableKnown: null,
      pages: 1,
      httpStatus: 200,
      latencyMs: 500,
      retryCount: 0,
      sourceRecordIds: ['rec-1', 'rec-2'],
      documentBytes: null,
      meteredAiClassification: 'NONE',
      estimatedMonthlyConsumption: null,
      success: true,
    };

    await recordUsage(entry);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: 'req-123',
        tool: 'search_opportunities',
        success: true,
        records_returned: 10,
        records_billable_known: null,
      })
    );
  });

  it('records failed usage entry', async () => {
    const entry: ExternalUsageEntry = {
      requestId: 'req-fail',
      timestamp: new Date().toISOString(),
      tool: 'search_opportunities',
      queryHash: 'def456',
      recordsReturned: 0,
      recordsBillableKnown: null,
      pages: 0,
      httpStatus: 429,
      latencyMs: 100,
      retryCount: 3,
      sourceRecordIds: [],
      documentBytes: null,
      meteredAiClassification: 'NONE',
      estimatedMonthlyConsumption: null,
      success: false,
      errorMessage: 'Rate limited',
    };

    await recordUsage(entry);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        http_status: 429,
        error_message: 'Rate limited',
        retry_count: 3,
      })
    );
  });

  it('does not throw on recording failure', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'DB error' } });

    const entry: ExternalUsageEntry = {
      requestId: 'req-err',
      timestamp: new Date().toISOString(),
      tool: 'test',
      queryHash: 'hash',
      recordsReturned: 0,
      recordsBillableKnown: null,
      pages: 0,
      httpStatus: 200,
      latencyMs: 0,
      retryCount: 0,
      sourceRecordIds: [],
      documentBytes: null,
      meteredAiClassification: 'NONE',
      estimatedMonthlyConsumption: null,
      success: true,
    };

    // Should not throw — usage recording failure should not block operations
    await expect(recordUsage(entry)).resolves.not.toThrow();
  });
});

describe('Failure Usage Entry Builder', () => {
  it('creates entry with correct failure fields', () => {
    const entry = buildFailureUsageEntry(
      'req-1',
      'tool-name',
      'hash',
      503,
      2000,
      'Server unavailable',
      2
    );

    expect(entry.success).toBe(false);
    expect(entry.httpStatus).toBe(503);
    expect(entry.errorMessage).toBe('Server unavailable');
    expect(entry.retryCount).toBe(2);
    expect(entry.recordsReturned).toBe(0);
    expect(entry.recordsBillableKnown).toBeNull();
    expect(entry.latencyMs).toBe(2000);
  });

  it('includes workflow and agent context', () => {
    const entry = buildFailureUsageEntry(
      'req-1',
      'tool',
      'hash',
      400,
      100,
      'Bad request',
      0,
      'workflow-123',
      'david'
    );

    expect(entry.workflowId).toBe('workflow-123');
    expect(entry.agentCapability).toBe('david');
  });

  it('defaults retry count to 0', () => {
    const entry = buildFailureUsageEntry('req-1', 'tool', 'hash', 401, 50, 'Unauthorized');

    expect(entry.retryCount).toBe(0);
  });
});

describe('Monthly Consumption', () => {
  it('returns zero totals when no data', async () => {
    mockGte.mockResolvedValue({ data: [], error: null });

    const result = await getMonthlyConsumption();

    expect(result.totalRecords).toBe(0);
    expect(result.totalCalls).toBe(0);
    expect(result.failedCalls).toBe(0);
  });

  it('handles database errors gracefully', async () => {
    mockGte.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const result = await getMonthlyConsumption();

    expect(result.totalRecords).toBe(0);
    expect(result.totalCalls).toBe(0);
  });
});
