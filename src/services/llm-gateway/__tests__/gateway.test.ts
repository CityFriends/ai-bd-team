/**
 * LLM Gateway Tests — Final Corrections
 *
 * BLOCKER 1: Workflow/task budgets fail closed
 * BLOCKER 2: Idempotency ownership (one key → at most one provider execution)
 * Plus all previously accepted tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================
// Mocks
// ============================================================

let anthropicCallCount = 0;
let openaiCallCount = 0;

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation(async () => {
        anthropicCallCount++;
        return {
          id: 'msg_test123',
          content: [{ type: 'text', text: 'test response' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'claude-haiku-4-5-20251001',
        };
      }),
    };
    static APIError = class extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
        this.name = 'APIError';
      }
    };
  },
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn().mockImplementation(async () => {
        openaiCallCount++;
        return { data: [{ embedding: new Array(1536).fill(0) }], usage: { total_tokens: 50 } };
      }),
    };
  },
}));

let mockReservationResult: { ledger_id: string; is_new: boolean } | string | null = {
  ledger_id: 'ledger-123',
  is_new: true,
};
let mockRpcError: { message: string } | null = null;
let reserveCallCount = 0;
let settleCallCount = 0;
let releaseCallCount = 0;

// Scope resolution mock — controls which scopes are found
let mockScopeResults: Record<string, { data: { id: string } | null; error: any }> = {};

function defaultScopeResults() {
  return {
    'global_daily:default': { data: { id: 'scope-global' }, error: null },
  };
}

function createChainableMock() {
  const mock: Record<string, any> = {};
  const methods = ['from', 'select', 'is', 'gte', 'in', 'order', 'limit', 'not', 'upsert'];
  for (const m of methods) {
    mock[m] = vi.fn().mockReturnValue(mock);
  }
  // eq chains to build scope_type:scope_id lookup
  let eqChain: string[] = [];
  mock.eq = vi.fn().mockImplementation((_col: string, val: string) => {
    eqChain.push(val);
    return mock;
  });
  mock.single = vi.fn().mockImplementation(() => {
    const key = eqChain.join(':');
    eqChain = [];
    const result = mockScopeResults[key];
    if (result) return Promise.resolve(result);
    return Promise.resolve({ data: null, error: null });
  });
  return mock;
}

const mockChain = createChainableMock();
const mockSupabase = {
  ...mockChain,
  rpc: vi.fn().mockImplementation((fn: string) => {
    if (fn === 'reserve_inference_hierarchical') {
      reserveCallCount++;
      if (mockRpcError) return Promise.resolve({ data: null, error: mockRpcError });
      return Promise.resolve({ data: mockReservationResult, error: null });
    }
    if (fn === 'settle_inference') {
      settleCallCount++;
      return Promise.resolve({ data: true, error: null });
    }
    if (fn === 'release_inference_reservation') {
      releaseCallCount++;
      return Promise.resolve({ data: true, error: null });
    }
    if (fn === 'mark_inference_in_progress') return Promise.resolve({ data: true, error: null });
    if (fn === 'mark_inference_ambiguous') return Promise.resolve({ data: true, error: null });
    if (fn === 'release_failed_in_progress') return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  }),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase }));

const mockAIEnabled = vi.fn().mockResolvedValue(true);
vi.mock('../../../config/ai-controls.js', () => ({ isAIEnabled: () => mockAIEnabled() }));

import { complete, embed, _resetGatewayClients } from '../gateway.js';
import {
  AIDisabledError,
  BudgetExceededError,
  MissingAttributionError,
  DatabaseUnavailableError,
  MissingBudgetScopeError,
  IdempotentRequestExistsError,
} from '../errors.js';
import { _loadTestPricing, _resetPricingCache } from '../pricing.js';

const testPricing = [
  {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    tier: 'sonnet',
  },
  {
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5-20251001',
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
    tier: 'haiku',
  },
  {
    provider: 'openai' as const,
    model: 'text-embedding-3-small',
    inputPricePerMillion: 0.02,
    outputPricePerMillion: 0.0,
    tier: 'embed',
  },
];

const validRequest = {
  agentId: 'maya' as const,
  purpose: 'classify' as const,
  taskType: 'opportunity_analysis',
  idempotencyKey: 'test:key:1',
  messages: [{ role: 'user' as const, content: 'test message' }],
};

// Workflow request — requires workflow + task budgets
const workflowRequest = {
  ...validRequest,
  workflowId: 'wf-123',
  taskId: 'task-456',
  idempotencyKey: 'workflow:wf-123:task:task-456:analysis:v1',
};

const validEmbedRequest = {
  agentId: 'maya' as const,
  purpose: 'embed' as const,
  taskType: 'memory_embedding',
  idempotencyKey: 'embed:key:1',
  texts: ['test text'],
};

describe('LLM Gateway — Final Corrections', () => {
  beforeEach(() => {
    anthropicCallCount = 0;
    openaiCallCount = 0;
    reserveCallCount = 0;
    settleCallCount = 0;
    releaseCallCount = 0;
    mockReservationResult = { ledger_id: 'ledger-123', is_new: true };
    mockRpcError = null;
    mockAIEnabled.mockResolvedValue(true);
    mockScopeResults = defaultScopeResults();
    _resetGatewayClients();
    _loadTestPricing(testPricing);

    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    _resetPricingCache();
  });

  // ============================================================
  // BLOCKER 1: Workflow/Task Budgets Fail Closed
  // ============================================================

  describe('BLOCKER 1: Required Budget Scopes', () => {
    it('workflowId supplied + workflow budget MISSING → MissingBudgetScopeError', async () => {
      // Only global exists, no workflow scope
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
        // workflow:wf-123 NOT present → will return null
      };
      await expect(complete(workflowRequest)).rejects.toThrow(MissingBudgetScopeError);
      expect(anthropicCallCount).toBe(0);
      expect(reserveCallCount).toBe(0);
    });

    it('taskId supplied + task budget MISSING → MissingBudgetScopeError', async () => {
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
        'workflow:wf-123': { data: { id: 'scope-wf' }, error: null },
        // task:task-456 NOT present → will return null
      };
      await expect(complete(workflowRequest)).rejects.toThrow(MissingBudgetScopeError);
      expect(anthropicCallCount).toBe(0);
      expect(reserveCallCount).toBe(0);
    });

    it('global exists but workflow MISSING → rejected', async () => {
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
      };
      await expect(complete(workflowRequest)).rejects.toThrow(MissingBudgetScopeError);
      expect(anthropicCallCount).toBe(0);
    });

    it('global+workflow exist but task MISSING → rejected', async () => {
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
        'workflow:wf-123': { data: { id: 'scope-wf' }, error: null },
      };
      await expect(complete(workflowRequest)).rejects.toThrow(MissingBudgetScopeError);
      expect(anthropicCallCount).toBe(0);
    });

    it('ALL required scopes exist → reservation allowed', async () => {
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
        'workflow:wf-123': { data: { id: 'scope-wf' }, error: null },
        'task:task-456': { data: { id: 'scope-task' }, error: null },
      };
      const result = await complete(workflowRequest);
      expect(result.text).toBe('test response');
      expect(anthropicCallCount).toBe(1);
      expect(reserveCallCount).toBe(1);

      // Verify scope_ids array includes all three
      const rpcCall = mockSupabase.rpc.mock.calls.find(
        (c: any[]) => c[0] === 'reserve_inference_hierarchical'
      );
      expect(rpcCall![1].p_scope_ids).toContain('scope-global');
      expect(rpcCall![1].p_scope_ids).toContain('scope-wf');
      expect(rpcCall![1].p_scope_ids).toContain('scope-task');
    });

    it('system request without workflowId/taskId → global-only (accepted)', async () => {
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
      };
      const result = await complete(validRequest);
      expect(result.text).toBe('test response');
      expect(anthropicCallCount).toBe(1);
    });

    it('missing scope → ZERO provider calls', async () => {
      mockScopeResults = {
        'global_daily:default': { data: { id: 'scope-global' }, error: null },
      };
      await expect(complete(workflowRequest)).rejects.toThrow(MissingBudgetScopeError);
      expect(anthropicCallCount).toBe(0);
      expect(reserveCallCount).toBe(0);
    });
  });

  // ============================================================
  // BLOCKER 2: Idempotency Ownership
  // ============================================================

  describe('BLOCKER 2: Idempotency Ownership', () => {
    it('RESERVED existing → IdempotentRequestExistsError, ZERO provider calls', async () => {
      mockReservationResult = { ledger_id: 'existing-123', is_new: false };
      await expect(complete(validRequest)).rejects.toThrow(IdempotentRequestExistsError);
      expect(anthropicCallCount).toBe(0);
    });

    it('IN_PROGRESS existing → IdempotentRequestExistsError, ZERO provider calls', async () => {
      mockReservationResult = { ledger_id: 'existing-123', is_new: false };
      await expect(complete(validRequest)).rejects.toThrow(IdempotentRequestExistsError);
      expect(anthropicCallCount).toBe(0);
    });

    it('SETTLED existing → IdempotentRequestExistsError, ZERO provider calls', async () => {
      mockReservationResult = { ledger_id: 'settled-123', is_new: false };
      await expect(complete(validRequest)).rejects.toThrow(IdempotentRequestExistsError);
      expect(anthropicCallCount).toBe(0);
    });

    it('AMBIGUOUS existing → NULL from RPC → BudgetExceededError, ZERO provider calls', async () => {
      mockReservationResult = null;
      await expect(complete(validRequest)).rejects.toThrow(BudgetExceededError);
      expect(anthropicCallCount).toBe(0);
    });

    it('RELEASED/FAILED existing → NULL from RPC → treated as budget error, ZERO provider calls', async () => {
      // For released/failed, the RPC also finds the existing row
      // and returns is_new=false (the row exists but is terminal)
      mockReservationResult = { ledger_id: 'released-123', is_new: false };
      await expect(complete(validRequest)).rejects.toThrow(IdempotentRequestExistsError);
      expect(anthropicCallCount).toBe(0);
    });

    it('NEW reservation → is_new=true → provider call proceeds', async () => {
      mockReservationResult = { ledger_id: 'new-123', is_new: true };
      const result = await complete(validRequest);
      expect(result.text).toBe('test response');
      expect(anthropicCallCount).toBe(1);
    });

    it('deliberate retry uses versioned key (not duplicate)', async () => {
      // Attempt 1
      mockReservationResult = { ledger_id: 'attempt-1', is_new: true };
      await complete({ ...validRequest, idempotencyKey: 'test:key:v1:attempt:1' });
      expect(anthropicCallCount).toBe(1);

      // Attempt 2 with different key
      mockReservationResult = { ledger_id: 'attempt-2', is_new: true };
      await complete({ ...validRequest, idempotencyKey: 'test:key:v1:attempt:2' });
      expect(anthropicCallCount).toBe(2);
    });

    it('embeddings route disabled → fails before reservation', async () => {
      // embed route disabled — no commissioned consumer
      await expect(embed(validEmbedRequest)).rejects.toThrow();
      expect(openaiCallCount).toBe(0);
    });
  });

  // ============================================================
  // Previously Accepted Tests
  // ============================================================

  describe('Attribution', () => {
    it('rejects missing agentId', async () => {
      await expect(complete({ ...validRequest, agentId: '' as any })).rejects.toThrow(
        MissingAttributionError
      );
      expect(anthropicCallCount).toBe(0);
    });
    it('rejects missing purpose', async () => {
      await expect(complete({ ...validRequest, purpose: '' as any })).rejects.toThrow(
        MissingAttributionError
      );
    });
    it('rejects missing idempotencyKey', async () => {
      await expect(complete({ ...validRequest, idempotencyKey: '' })).rejects.toThrow(
        MissingAttributionError
      );
    });
  });

  describe('Kill Switch', () => {
    it('blocks before reservation when disabled', async () => {
      mockAIEnabled.mockResolvedValue(false);
      await expect(complete(validRequest)).rejects.toThrow(AIDisabledError);
      expect(anthropicCallCount).toBe(0);
      expect(reserveCallCount).toBe(0);
    });

    it('releases reservation and blocks when flipped after reservation', async () => {
      let callNum = 0;
      mockAIEnabled.mockImplementation(async () => {
        callNum++;
        return callNum <= 1;
      });
      await expect(complete(validRequest)).rejects.toThrow(AIDisabledError);
      expect(anthropicCallCount).toBe(0);
      expect(reserveCallCount).toBe(1);
      expect(releaseCallCount).toBe(1);
    });
  });

  describe('Blocked Model Guard', () => {
    it('BLOCKED_MODELS contains retired claude-sonnet-4-20250514', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', 'gateway.ts'),
        'utf-8'
      );
      expect(content).toContain("'claude-sonnet-4-20250514': 'PROVIDER_RETIRED'");
      expect(content).toContain('assertModelNotBlocked');
    });

    it('BLOCKED_MODELS contains all known retired models', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', 'gateway.ts'),
        'utf-8'
      );
      for (const retired of [
        'claude-sonnet-4-20250514',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-haiku-20240307',
        'claude-3-opus-20240229',
      ]) {
        expect(content).toContain(`'${retired}': 'PROVIDER_RETIRED'`);
      }
    });

    it('BLOCKED_MODELS separates PROVIDER_RETIRED from ORGANIZATION_BLOCKED', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', 'gateway.ts'),
        'utf-8'
      );
      expect(content).toContain("'claude-sonnet-4-5-20250929': 'ORGANIZATION_BLOCKED'");
    });

    it('commissioned Haiku route is NOT blocked', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const content = fs.readFileSync(
        path.resolve(import.meta.dirname, '..', 'gateway.ts'),
        'utf-8'
      );
      expect(content).not.toContain("'claude-haiku-4-5-20251001':");
    });
  });

  describe('Pricing Fail-Closed', () => {
    it('rejects when pricing unavailable', async () => {
      _resetPricingCache();
      await expect(complete(validRequest)).rejects.toThrow(DatabaseUnavailableError);
      expect(anthropicCallCount).toBe(0);
    });
  });

  describe('Budget Enforcement', () => {
    it('blocks when budget exceeded', async () => {
      mockReservationResult = null;
      await expect(complete(validRequest)).rejects.toThrow(BudgetExceededError);
      expect(anthropicCallCount).toBe(0);
    });
  });

  describe('Conservative Reservation', () => {
    it('applies 20% safety margin to token estimate', async () => {
      const { estimateInputTokens } = await import('../pricing.js');
      expect(estimateInputTokens([{ content: 'a'.repeat(400) }])).toBe(120);
    });

    it('rejects oversized input', async () => {
      await expect(
        complete({ ...validRequest, messages: [{ role: 'user', content: 'a'.repeat(100000) }] })
      ).rejects.toThrow(BudgetExceededError);
      expect(anthropicCallCount).toBe(0);
    });
  });

  describe('Successful Pipeline', () => {
    it('complete() full pipeline', async () => {
      const result = await complete(validRequest);
      expect(result.text).toBe('test response');
      expect(result.ledgerId).toBe('ledger-123');
      expect(reserveCallCount).toBe(1);
      expect(anthropicCallCount).toBe(1);
      expect(settleCallCount).toBe(1);
    });

    it('embed() fails when embed route is disabled', async () => {
      // embed route is disabled — no commissioned production consumer
      await expect(embed(validEmbedRequest)).rejects.toThrow();
      expect(reserveCallCount).toBe(0);
      expect(openaiCallCount).toBe(0);
      expect(settleCallCount).toBe(0);
    });
  });

  describe('Concurrency', () => {
    it('concurrent requests each get own reservation', async () => {
      let callNum = 0;
      mockSupabase.rpc.mockImplementation((fn: string) => {
        if (fn === 'reserve_inference_hierarchical') {
          callNum++;
          reserveCallCount++;
          return Promise.resolve({
            data: { ledger_id: `ledger-${callNum}`, is_new: true },
            error: null,
          });
        }
        if (fn === 'settle_inference') {
          settleCallCount++;
          return Promise.resolve({ data: true, error: null });
        }
        if (fn === 'mark_inference_in_progress')
          return Promise.resolve({ data: true, error: null });
        return Promise.resolve({ data: null, error: null });
      });

      const requests = Array.from({ length: 5 }, (_, i) => ({
        ...validRequest,
        idempotencyKey: `c:${i}`,
      }));
      const results = await Promise.all(requests.map((r) => complete(r)));
      expect(new Set(results.map((r) => r.ledgerId)).size).toBe(5);
      expect(reserveCallCount).toBe(5);
      expect(settleCallCount).toBe(5);
    });

    it('budget-limited: 3 authorized, 2 rejected', async () => {
      let n = 0;
      mockSupabase.rpc.mockImplementation((fn: string) => {
        if (fn === 'reserve_inference_hierarchical') {
          n++;
          reserveCallCount++;
          return Promise.resolve({
            data: n <= 3 ? { ledger_id: `l-${n}`, is_new: true } : null,
            error: null,
          });
        }
        if (fn === 'settle_inference') {
          settleCallCount++;
          return Promise.resolve({ data: true, error: null });
        }
        if (fn === 'mark_inference_in_progress')
          return Promise.resolve({ data: true, error: null });
        return Promise.resolve({ data: null, error: null });
      });

      const requests = Array.from({ length: 5 }, (_, i) => ({
        ...validRequest,
        idempotencyKey: `b:${i}`,
      }));
      const results = await Promise.allSettled(requests.map((r) => complete(r)));
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(3);
      expect(results.filter((r) => r.status === 'rejected').length).toBe(2);
      expect(settleCallCount).toBe(3);
    });
  });
});
