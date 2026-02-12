import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkOpportunityAgainstRules,
  checkCapacity,
  getAgentInvolvementRules,
  formatRulesForPrompt,
  formatViolationsForPrompt,
  type OpportunityContext,
} from '../rules.js';
import { RuleCategory, RuleType } from '../types.js';
import type { ActiveRule, RuleViolation } from '../types.js';

// Mock the database module
vi.mock('../database.js', () => ({
  getActiveRules: vi.fn(),
  applyRule: vi.fn().mockResolvedValue(true),
}));

import { getActiveRules, applyRule } from '../database.js';

const mockGetActiveRules = vi.mocked(getActiveRules);

describe('playbook rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkOpportunityAgainstRules', () => {
    const baseOpportunity: OpportunityContext = {
      noticeId: 'test-123',
      title: 'Test Opportunity',
      agency: 'DOD',
      value: 500000,
      daysToRespond: 45,
    };

    it('should return proceed when no rules are active', async () => {
      mockGetActiveRules.mockResolvedValue([]);

      const result = await checkOpportunityAgainstRules(baseOpportunity);

      expect(result.recommendation).toBe('proceed');
      expect(result.violations).toHaveLength(0);
      expect(result.passed).toHaveLength(0);
    });

    it('should detect short deadline violation', async () => {
      const deadlineRule: ActiveRule = {
        id: 'rule-1',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.PURSUIT_CRITERIA,
        rule: 'Avoid opportunities with less than 30 days to respond',
        evidence: { shortDeadlineWinRate: 0.15, threshold: 30 },
        confidence: 0.7,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 5,
        times_overridden: 1,
      };

      mockGetActiveRules.mockResolvedValue([deadlineRule]);

      const shortDeadlineOpp: OpportunityContext = {
        ...baseOpportunity,
        daysToRespond: 20,
      };

      const result = await checkOpportunityAgainstRules(shortDeadlineOpp);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].violation).toContain('20 days to respond');
      expect(result.recommendation).toBe('caution');
    });

    it('should detect value below minimum', async () => {
      const valueRule: ActiveRule = {
        id: 'rule-2',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.PURSUIT_CRITERIA,
        rule: 'Minimum contract value $100,000',
        evidence: { minValue: 100000 },
        confidence: 0.65,
        proposed_by: 'james',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 10,
        times_overridden: 2,
      };

      mockGetActiveRules.mockResolvedValue([valueRule]);

      const lowValueOpp: OpportunityContext = {
        ...baseOpportunity,
        value: 50000,
      };

      const result = await checkOpportunityAgainstRules(lowValueOpp);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].violation).toContain('below minimum');
    });

    it('should detect value above maximum', async () => {
      const valueRule: ActiveRule = {
        id: 'rule-3',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.PURSUIT_CRITERIA,
        rule: 'Maximum contract value $5M',
        evidence: { maxValue: 5000000 },
        confidence: 0.6,
        proposed_by: 'james',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 3,
        times_overridden: 0,
      };

      mockGetActiveRules.mockResolvedValue([valueRule]);

      const highValueOpp: OpportunityContext = {
        ...baseOpportunity,
        value: 10000000,
      };

      const result = await checkOpportunityAgainstRules(highValueOpp);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].violation).toContain('above maximum');
    });

    it('should detect excluded agency', async () => {
      const agencyRule: ActiveRule = {
        id: 'rule-4',
        rule_type: RuleType.PREFERENCE,
        category: RuleCategory.AGENCY_PREFERENCE,
        rule: 'Avoid GSA OASIS contracts',
        evidence: { excludedAgencies: ['gsa', 'omb'] },
        confidence: 0.75,
        proposed_by: 'david',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 8,
        times_overridden: 1,
      };

      mockGetActiveRules.mockResolvedValue([agencyRule]);

      const gsaOpp: OpportunityContext = {
        ...baseOpportunity,
        agency: 'GSA',
      };

      const result = await checkOpportunityAgainstRules(gsaOpp);

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].violation).toContain('excluded list');
    });

    it('should return stop for high-confidence violations', async () => {
      const criticalRule: ActiveRule = {
        id: 'rule-5',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.PURSUIT_CRITERIA,
        rule: 'Never bid on contracts under $50K',
        evidence: { minValue: 50000 },
        confidence: 0.9, // High confidence
        proposed_by: 'james',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 20,
        times_overridden: 0,
      };

      mockGetActiveRules.mockResolvedValue([criticalRule]);

      const tinyOpp: OpportunityContext = {
        ...baseOpportunity,
        value: 25000,
      };

      const result = await checkOpportunityAgainstRules(tinyOpp);

      expect(result.recommendation).toBe('caution');
      expect(result.violations).toHaveLength(1);
    });

    it('should pass rules when no violations', async () => {
      const passableRule: ActiveRule = {
        id: 'rule-6',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.PURSUIT_CRITERIA,
        rule: 'Minimum 30 days to respond',
        evidence: { shortDeadlineWinRate: 0.2, threshold: 30 },
        confidence: 0.7,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 15,
        times_overridden: 3,
      };

      mockGetActiveRules.mockResolvedValue([passableRule]);

      const goodOpp: OpportunityContext = {
        ...baseOpportunity,
        daysToRespond: 60,
      };

      const result = await checkOpportunityAgainstRules(goodOpp);

      expect(result.violations).toHaveLength(0);
      expect(result.passed).toHaveLength(1);
      expect(result.recommendation).toBe('proceed');
    });

    it('should filter rules by category', async () => {
      const timelineRule: ActiveRule = {
        id: 'rule-7',
        rule_type: RuleType.PROCESS_RULE,
        category: RuleCategory.TIMELINE,
        rule: 'Start early',
        evidence: {},
        confidence: 0.6,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 5,
        times_overridden: 0,
      };

      mockGetActiveRules.mockImplementation(async (category) => {
        if (category === RuleCategory.TIMELINE) return [timelineRule];
        return [];
      });

      const result = await checkOpportunityAgainstRules(baseOpportunity, [RuleCategory.TIMELINE]);

      expect(mockGetActiveRules).toHaveBeenCalledWith(RuleCategory.TIMELINE);
    });
  });

  describe('checkCapacity', () => {
    it('should return not over capacity when no rules exist', async () => {
      mockGetActiveRules.mockResolvedValue([]);

      const result = await checkCapacity(3);

      expect(result.overCapacity).toBe(false);
      expect(result.threshold).toBe(5); // Default threshold
    });

    it('should detect over capacity', async () => {
      const capacityRule: ActiveRule = {
        id: 'cap-1',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.CAPACITY,
        rule: 'Cap at 4 pursuits',
        evidence: { threshold: 4 },
        confidence: 0.7,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 10,
        times_overridden: 2,
      };

      mockGetActiveRules.mockResolvedValue([capacityRule]);

      const result = await checkCapacity(5);

      expect(result.overCapacity).toBe(true);
      expect(result.threshold).toBe(4);
      expect(result.rule).toBeDefined();
    });

    it('should return not over capacity when under threshold', async () => {
      const capacityRule: ActiveRule = {
        id: 'cap-2',
        rule_type: RuleType.THRESHOLD,
        category: RuleCategory.CAPACITY,
        rule: 'Cap at 6 pursuits',
        evidence: { threshold: 6 },
        confidence: 0.65,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 5,
        times_overridden: 0,
      };

      mockGetActiveRules.mockResolvedValue([capacityRule]);

      const result = await checkCapacity(4);

      expect(result.overCapacity).toBe(false);
    });
  });

  describe('getAgentInvolvementRules', () => {
    it('should return empty array when no rules', async () => {
      mockGetActiveRules.mockResolvedValue([]);

      const result = await getAgentInvolvementRules();

      expect(result).toHaveLength(0);
    });

    it('should extract agent involvement rules', async () => {
      const marcusRule: ActiveRule = {
        id: 'agent-1',
        rule_type: RuleType.SOP,
        category: RuleCategory.TECH_ASSESSMENT,
        rule: 'Always include Marcus for tech assessment',
        evidence: {
          agent: 'marcus',
          winRateWithAgent: 0.65,
          winRateWithoutAgent: 0.35,
        },
        confidence: 0.75,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 15,
        times_overridden: 1,
      };

      mockGetActiveRules.mockResolvedValue([marcusRule]);

      const result = await getAgentInvolvementRules();

      expect(result).toHaveLength(1);
      expect(result[0].agent).toBe('marcus');
      expect(result[0].winRateWith).toBe(0.65);
      expect(result[0].winRateWithout).toBe(0.35);
    });
  });

  describe('formatRulesForPrompt', () => {
    it('should return empty string when no rules', async () => {
      mockGetActiveRules.mockResolvedValue([]);

      const result = await formatRulesForPrompt();

      expect(result).toBe('');
    });

    it('should format rules with confidence', async () => {
      const rule: ActiveRule = {
        id: 'fmt-1',
        rule_type: RuleType.PROCESS_RULE,
        category: RuleCategory.TIMELINE,
        rule: 'Act fast on good opportunities',
        evidence: {},
        confidence: 0.85,
        proposed_by: 'patricia',
        adopted_at: '2024-01-01T00:00:00Z',
        times_applied: 10,
        times_overridden: 0,
      };

      mockGetActiveRules.mockResolvedValue([rule]);

      const result = await formatRulesForPrompt();

      expect(result).toContain('TEAM PLAYBOOK RULES');
      expect(result).toContain('85% confidence');
      expect(result).toContain('Act fast on good opportunities');
    });
  });

  describe('formatViolationsForPrompt', () => {
    it('should return empty string when no violations', () => {
      const result = formatViolationsForPrompt([]);
      expect(result).toBe('');
    });

    it('should format violations correctly', () => {
      const violation: RuleViolation = {
        rule: {
          id: 'vio-1',
          rule_type: RuleType.THRESHOLD,
          category: RuleCategory.PURSUIT_CRITERIA,
          rule: 'Minimum 30 days to respond',
          evidence: {},
          confidence: 0.75,
          proposed_by: 'patricia',
          adopted_at: '2024-01-01T00:00:00Z',
          times_applied: 10,
          times_overridden: 2,
        },
        violation: 'Only 15 days to respond',
        recommendation: 'Consider passing unless compelling reason',
        overrideable: true,
      };

      const result = formatViolationsForPrompt([violation]);

      expect(result).toContain('PLAYBOOK CONCERNS');
      expect(result).toContain('Only 15 days to respond');
      expect(result).toContain('75% confidence');
      expect(result).toContain('Consider passing');
    });
  });
});
