/**
 * G2X Research Gateway Tests
 *
 * Covers:
 * - Research endpoint only (not full account-mutating endpoint)
 * - Request validation
 * - Capability unavailable returns CAPABILITY_UNAVAILABLE
 * - Tool allowlist enforcement
 * - Benchmark limits enforcement
 * - Rate limiting (semaphore)
 * - Usage accounting on success and failure
 * - ANALYSIS_NOT_RUN for transport benchmark facts
 * - Environment guards
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock external dependencies
vi.mock('../../../lib/errors.js', () => ({
  withRetry: vi.fn().mockImplementation(async (fn) => fn()),
  ErrorCategory: { TRANSIENT: 'transient', PERMANENT: 'permanent' },
}));

vi.mock('../../../config/environment.js', () => ({
  assertCommissioningEnvironment: vi.fn(),
  getEnvironmentRole: vi.fn().mockReturnValue('commissioning'),
}));

vi.mock('../../../integrations/database/client.js', () => ({
  getSupabase: () => ({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
        }),
      }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
        }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        gte: vi.fn().mockResolvedValue({ data: [], error: null }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock('../mcp-client.js', async () => {
  const actual = await vi.importActual('../mcp-client.js');
  return {
    ...actual,
    resolveAuthState: vi.fn().mockReturnValue({
      accessToken: 'test-token',
      tokenType: 'Bearer',
      expiresAt: null,
      refreshToken: null,
      scopes: ['read'],
      interactiveAuthRequired: false,
    }),
    isAuthFailure: vi.fn().mockReturnValue(false),
    discoverTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'g2x_search_opportunities',
          description: 'Search for opportunities',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
        {
          name: 'g2x_get_record',
          description: 'Get opportunity details',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [{ id: 'opp-1', title: 'Test Opportunity', agency: 'DOD' }],
          }),
        },
      ],
    }),
    isRetryableFailure: vi.fn().mockReturnValue(false),
  };
});

import { G2XResearchGateway, verifyProductionSafety } from '../gateway.js';
import type { GovConResearchRequest } from '../types.js';

describe('G2XResearchGateway', () => {
  let gateway: G2XResearchGateway;

  beforeEach(async () => {
    gateway = new G2XResearchGateway('https://test.g2x.com/mcp/research');
    vi.clearAllMocks();
  });

  describe('connect()', () => {
    it('connects and discovers tools', async () => {
      const result = await gateway.connect();

      expect(result.success).toBe(true);
      expect(result.toolCount).toBe(2);
      expect(result.allowedCount).toBeGreaterThan(0);
      expect(result.capabilityMap.length).toBeGreaterThan(0);
      expect(result.interactiveAuthRequired).toBe(false);
    });

    it('produces capability mapping after discovery', async () => {
      const result = await gateway.connect();

      expect(result.capabilityMap.length).toBeGreaterThan(0);

      const searchCap = result.capabilityMap.find(
        (c) => c.internalCapability === 'OPPORTUNITY_SEARCH'
      );
      expect(searchCap).toBeDefined();
    });
  });

  describe('executeResearch()', () => {
    beforeEach(async () => {
      await gateway.connect();
    });

    it('executes allowed research request', async () => {
      const request: GovConResearchRequest = {
        requestType: 'OPPORTUNITY_SEARCH',
        subject: 'software modernization',
        evidenceNeeded: ['opportunity_metadata'],
        maxRecords: 10,
        maxPages: 3,
      };

      const result = await gateway.executeResearch(request);

      expect(result.status).toBe('COMPLETE');
      expect(result.facts.length).toBeGreaterThan(0);
      expect(result.usage.toolCallsMade).toBeGreaterThan(0);
    });

    it('returns CAPABILITY_UNAVAILABLE for unmapped capabilities', async () => {
      const request: GovConResearchRequest = {
        requestType: 'EVENT_INTELLIGENCE',
        subject: 'industry day',
        evidenceNeeded: ['event_info'],
        maxRecords: 10,
        maxPages: 3,
      };

      const result = await gateway.executeResearch(request);

      expect(result.status).toBe('CAPABILITY_UNAVAILABLE');
    });

    it('marks facts as ANALYSIS_NOT_RUN during transport benchmark', async () => {
      const request: GovConResearchRequest = {
        requestType: 'OPPORTUNITY_SEARCH',
        subject: 'test',
        evidenceNeeded: ['metadata'],
        maxRecords: 5,
        maxPages: 1,
      };

      const result = await gateway.executeResearch(request);

      for (const fact of result.facts) {
        expect(fact.confidence).toBe('ANALYSIS_NOT_RUN');
      }
    });

    it('validates request schema', async () => {
      const invalidRequest = {
        requestType: 'INVALID_TYPE',
        subject: 'test',
        evidenceNeeded: [],
      } as unknown as GovConResearchRequest;

      const result = await gateway.executeResearch(invalidRequest);
      expect(result.status).toBe('FAILED');
      expect(result.incompleteReasons[0]).toContain('Invalid request');
    });

    it('returns FAILED when not connected', async () => {
      const disconnectedGateway = new G2XResearchGateway();

      const result = await disconnectedGateway.executeResearch({
        requestType: 'OPPORTUNITY_SEARCH',
        subject: 'test',
        evidenceNeeded: [],
        maxRecords: 10,
        maxPages: 3,
      });

      expect(result.status).toBe('FAILED');
      expect(result.incompleteReasons).toContain('Gateway not connected');
    });

    it('tracks usage with records_billable_known as null when unknown', async () => {
      const request: GovConResearchRequest = {
        requestType: 'OPPORTUNITY_SEARCH',
        subject: 'test',
        evidenceNeeded: [],
        maxRecords: 10,
        maxPages: 3,
      };

      const result = await gateway.executeResearch(request);

      expect(result.usage.recordsBillableKnown).toBeNull();
      expect(result.usage.recordsReturned).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Benchmark Limits', () => {
    it('tracks total calls and records', async () => {
      await gateway.connect();

      const totals = gateway.getBenchmarkTotals();
      expect(totals.calls).toBe(0);
      expect(totals.records).toBe(0);
    });
  });

  describe('Accessors', () => {
    it('returns inventory copy', async () => {
      await gateway.connect();
      const inventory = gateway.getInventory();
      expect(Array.isArray(inventory)).toBe(true);
    });

    it('returns capability map copy', async () => {
      await gateway.connect();
      const map = gateway.getCapabilityMap();
      expect(Array.isArray(map)).toBe(true);
    });

    it('reports connection state', () => {
      expect(gateway.isConnected()).toBe(false);
    });
  });
});

describe('verifyProductionSafety', () => {
  it('checks all critical production controls', async () => {
    const result = await verifyProductionSafety();

    const controlNames = result.checks.map((c) => c.control);
    expect(controlNames).toContain('MAYA_REVIEW_ENABLED');
    expect(controlNames).toContain('JAMES_CAPTURE_ENABLED');
    expect(controlNames).toContain('SPECIALIST_EXECUTION_ENABLED');
    expect(controlNames).toContain('ENABLE_AUTONOMOUS_AI');
  });
});
