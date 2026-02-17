import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  proposeRule,
  adoptRule,
  retireRule,
  overrideRule,
  applyRule,
  getActiveRules,
  getProposedRules,
  checkRuleHealth,
  updateRuleOutcomes,
  createRetrospectiveRun,
  completeRetrospectiveRun,
  getPlaybookStats,
} from '../database.js';
import { RuleType, RuleCategory } from '../types.js';

// Mock Supabase
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSingle = vi.fn();

vi.mock('../../integrations/database/client.js', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

describe('playbook database', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock chain for from().select()...
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      gte: mockGte,
      order: mockOrder,
      single: mockSingle,
    });
    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: mockSingle,
      }),
    });
    mockUpdate.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
      order: mockOrder,
      limit: mockLimit,
    });
    mockGte.mockReturnValue({
      order: mockOrder,
    });
    mockOrder.mockReturnValue({
      limit: mockLimit,
    });
    mockLimit.mockReturnValue(Promise.resolve({ data: [], error: null }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('proposeRule', () => {
    it('should call RPC with correct parameters', async () => {
      mockRpc.mockResolvedValue({ data: 'new-rule-id', error: null });

      const input = {
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.CAPACITY,
        rule: 'Cap active pursuits at 4',
        evidence: { threshold: 4 },
        proposed_by: 'patricia' as const,
        confidence: 0.7,
      };

      const result = await proposeRule(input);

      expect(mockRpc).toHaveBeenCalledWith('propose_rule', {
        p_rule_type: 'threshold',
        p_category: 'capacity',
        p_rule: 'Cap active pursuits at 4',
        p_evidence: { threshold: 4 },
        p_proposed_by: 'patricia',
        p_confidence: 0.7,
      });
      expect(result).toBe('new-rule-id');
    });

    it('should use default confidence when not provided', async () => {
      mockRpc.mockResolvedValue({ data: 'rule-id', error: null });

      const input = {
        rule_type: RuleType.PROCESS_RULE,
        category: RuleCategory.TIMELINE,
        rule: 'Test rule',
        evidence: {},
        proposed_by: 'patricia' as const,
      };

      await proposeRule(input);

      expect(mockRpc).toHaveBeenCalledWith(
        'propose_rule',
        expect.objectContaining({ p_confidence: 0.5 })
      );
    });

    it('should return null on error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'DB Error' } });

      const input = {
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.CAPACITY,
        rule: 'Test',
        evidence: {},
        proposed_by: 'patricia' as const,
      };

      const result = await proposeRule(input);

      expect(result).toBeNull();
    });
  });

  describe('adoptRule', () => {
    it('should call RPC with rule ID', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await adoptRule('test-rule-id');

      expect(mockRpc).toHaveBeenCalledWith('adopt_rule', { p_rule_id: 'test-rule-id' });
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'Error' } });

      const result = await adoptRule('test-rule-id');

      expect(result).toBe(false);
    });
  });

  describe('retireRule', () => {
    it('should call RPC with rule ID and reason', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await retireRule('test-rule-id', 'No longer applicable');

      expect(mockRpc).toHaveBeenCalledWith('retire_rule', {
        p_rule_id: 'test-rule-id',
        p_reason: 'No longer applicable',
      });
      expect(result).toBe(true);
    });

    it('should handle null reason', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      await retireRule('test-rule-id');

      expect(mockRpc).toHaveBeenCalledWith('retire_rule', {
        p_rule_id: 'test-rule-id',
        p_reason: null,
      });
    });
  });

  describe('overrideRule', () => {
    it('should call RPC with all parameters', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await overrideRule('rule-id', 'opp-id', 'Strategic priority', 'james');

      expect(mockRpc).toHaveBeenCalledWith('override_rule', {
        p_rule_id: 'rule-id',
        p_opportunity_id: 'opp-id',
        p_reason: 'Strategic priority',
        p_overridden_by: 'james',
      });
      expect(result).toBe(true);
    });

    it('should default to human override', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      await overrideRule('rule-id', 'opp-id', 'Reason');

      expect(mockRpc).toHaveBeenCalledWith(
        'override_rule',
        expect.objectContaining({ p_overridden_by: 'human' })
      );
    });
  });

  describe('applyRule', () => {
    it('should call RPC with context', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await applyRule('rule-id', 'opp-123', 'Test Opportunity', 'james', {
        value: 500000,
        daysToRespond: 30,
      });

      expect(mockRpc).toHaveBeenCalledWith('apply_rule', {
        p_rule_id: 'rule-id',
        p_opportunity_id: 'opp-123',
        p_opportunity_title: 'Test Opportunity',
        p_applied_by: 'james',
        p_context: { value: 500000, daysToRespond: 30 },
      });
      expect(result).toBe(true);
    });
  });

  describe('getActiveRules', () => {
    it('should call RPC with category and confidence', async () => {
      const mockRules = [{ id: 'rule-1', rule: 'Test rule', confidence: 0.7 }];
      mockRpc.mockResolvedValue({ data: mockRules, error: null });

      const result = await getActiveRules(RuleCategory.CAPACITY, 0.7);

      expect(mockRpc).toHaveBeenCalledWith('get_active_rules', {
        p_category: 'capacity',
        p_min_confidence: 0.7,
      });
      expect(result).toEqual(mockRules);
    });

    it('should use default confidence', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getActiveRules();

      expect(mockRpc).toHaveBeenCalledWith('get_active_rules', {
        p_category: null,
        p_min_confidence: 0.6,
      });
    });

    it('should return empty array on error', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'Error' } });

      const result = await getActiveRules();

      expect(result).toEqual([]);
    });
  });

  describe('getProposedRules', () => {
    it('should query proposed rules ordered by date', async () => {
      const mockRules = [{ id: 'rule-1', status: 'proposed' }];
      mockOrder.mockReturnValue(Promise.resolve({ data: mockRules, error: null }));

      const result = await getProposedRules();

      expect(mockFrom).toHaveBeenCalledWith('team_playbook');
      expect(result).toEqual(mockRules);
    });
  });

  describe('checkRuleHealth', () => {
    it('should call RPC', async () => {
      const mockHealth = [{ rule_id: 'rule-1', override_rate: 0.3, should_retire: false }];
      mockRpc.mockResolvedValue({ data: mockHealth, error: null });

      const result = await checkRuleHealth();

      expect(mockRpc).toHaveBeenCalledWith('check_rule_health');
      expect(result).toEqual(mockHealth);
    });
  });

  describe('updateRuleOutcomes', () => {
    it('should call RPC with support/contradict flag', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await updateRuleOutcomes('rule-id', 'opp-id', true);

      expect(mockRpc).toHaveBeenCalledWith('update_rule_outcomes', {
        p_rule_id: 'rule-id',
        p_opportunity_id: 'opp-id',
        p_supports: true,
      });
      expect(result).toBe(true);
    });
  });

  describe('createRetrospectiveRun', () => {
    it('should insert retrospective run', async () => {
      const mockInsertChain = {
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'run-123' }, error: null }),
        }),
      };
      mockFrom.mockReturnValue({ insert: vi.fn().mockReturnValue(mockInsertChain) });

      const start = new Date('2024-01-01');
      const end = new Date('2024-02-01');

      const result = await createRetrospectiveRun(start, end);

      expect(mockFrom).toHaveBeenCalledWith('retrospective_runs');
      expect(result).toBe('run-123');
    });
  });

  describe('completeRetrospectiveRun', () => {
    it('should update run with results', async () => {
      mockEq.mockResolvedValue({ error: null });

      const results = {
        outcomes_analyzed: 50,
        chains_analyzed: 30,
        rules_proposed: 3,
        rules_adopted: 1,
        findings: { pattern: 'test' },
      };

      const result = await completeRetrospectiveRun('run-123', results);

      expect(mockFrom).toHaveBeenCalledWith('retrospective_runs');
      expect(result).toBe(true);
    });
  });

  describe('getPlaybookStats', () => {
    it('should calculate stats from rules', async () => {
      const mockRules = [
        { status: 'active', confidence: 0.8, times_applied: 10, times_overridden: 2 },
        { status: 'active', confidence: 0.7, times_applied: 5, times_overridden: 1 },
        { status: 'proposed', confidence: 0.6, times_applied: 0, times_overridden: 0 },
        { status: 'retired', confidence: 0.5, times_applied: 3, times_overridden: 3 },
      ];
      mockSelect.mockReturnValue(Promise.resolve({ data: mockRules, error: null }));

      const stats = await getPlaybookStats();

      expect(stats.total_rules).toBe(4);
      expect(stats.active_rules).toBe(2);
      expect(stats.proposed_rules).toBe(1);
      expect(stats.retired_rules).toBe(1);
      expect(stats.total_applications).toBe(18);
      expect(stats.total_overrides).toBe(6);
      expect(stats.avg_confidence).toBe(0.75); // (0.8 + 0.7) / 2
    });

    it('should handle empty rules', async () => {
      mockSelect.mockReturnValue(Promise.resolve({ data: [], error: null }));

      const stats = await getPlaybookStats();

      expect(stats.total_rules).toBe(0);
      expect(stats.avg_confidence).toBe(0);
    });

    it('should return zeros on error', async () => {
      mockSelect.mockReturnValue(Promise.resolve({ data: null, error: { message: 'Error' } }));

      const stats = await getPlaybookStats();

      expect(stats.total_rules).toBe(0);
      expect(stats.active_rules).toBe(0);
    });
  });
});
