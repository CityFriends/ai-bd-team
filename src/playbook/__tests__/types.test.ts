import { describe, it, expect } from 'vitest';
import {
  RuleType,
  RuleCategory,
  RuleStatus,
  RuleEvidenceSchema,
  PlaybookRuleSchema,
} from '../types.js';

describe('playbook types', () => {
  describe('RuleType constants', () => {
    it('should define all expected rule types', () => {
      expect(RuleType.PROCESS_RULE).toBe('process_rule');
      expect(RuleType.THRESHOLD).toBe('threshold');
      expect(RuleType.PREFERENCE).toBe('preference');
      expect(RuleType.SOP).toBe('sop');
      expect(RuleType.LESSON_LEARNED).toBe('lesson_learned');
    });
  });

  describe('RuleCategory constants', () => {
    it('should define all expected categories', () => {
      expect(RuleCategory.PURSUIT_CRITERIA).toBe('pursuit_criteria');
      expect(RuleCategory.TIMELINE).toBe('timeline');
      expect(RuleCategory.TEAMING).toBe('teaming');
      expect(RuleCategory.TECH_ASSESSMENT).toBe('tech_assessment');
      expect(RuleCategory.PROPOSAL_PROCESS).toBe('proposal_process');
      expect(RuleCategory.AGENCY_PREFERENCE).toBe('agency_preference');
      expect(RuleCategory.CAPACITY).toBe('capacity');
    });
  });

  describe('RuleStatus constants', () => {
    it('should define all expected statuses', () => {
      expect(RuleStatus.PROPOSED).toBe('proposed');
      expect(RuleStatus.ACTIVE).toBe('active');
      expect(RuleStatus.RETIRED).toBe('retired');
      expect(RuleStatus.OVERRIDDEN_BY_HUMAN).toBe('overridden_by_human');
    });
  });

  describe('RuleEvidenceSchema', () => {
    it('should validate empty evidence', () => {
      const result = RuleEvidenceSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate timeline evidence', () => {
      const evidence = {
        avgWinDiscoveryToGo: 3.5,
        avgLossDiscoveryToGo: 7.2,
        sample_size: 25,
      };
      const result = RuleEvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(true);
    });

    it('should validate threshold evidence', () => {
      const evidence = {
        threshold: 5,
        overloadWinRate: 0.25,
        normalWinRate: 0.55,
        sample_size: 30,
      };
      const result = RuleEvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(true);
    });

    it('should validate agent involvement evidence', () => {
      const evidence = {
        agent: 'marcus',
        winRateWithAgent: 0.65,
        winRateWithoutAgent: 0.35,
        sample_size: 20,
      };
      const result = RuleEvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(true);
    });

    it('should allow passthrough for custom fields', () => {
      const evidence = {
        customField: 'custom value',
        anotherCustom: 123,
      };
      const result = RuleEvidenceSchema.safeParse(evidence);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customField).toBe('custom value');
      }
    });
  });

  describe('PlaybookRuleSchema', () => {
    const validRule = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      rule_type: 'threshold',
      category: 'capacity',
      rule: 'Cap active pursuits at 4 simultaneously',
      evidence: { threshold: 4, sample_size: 10 },
      confidence: 0.75,
      proposed_by: 'patricia',
      status: 'active',
      adopted_at: '2024-01-15T00:00:00Z',
      retired_at: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
      supporting_outcomes: [],
      contradicting_outcomes: [],
      times_applied: 5,
      times_overridden: 1,
      override_history: [],
    };

    it('should validate a complete rule', () => {
      const result = PlaybookRuleSchema.safeParse(validRule);
      expect(result.success).toBe(true);
    });

    it('should validate with override history', () => {
      const ruleWithHistory = {
        ...validRule,
        override_history: [
          {
            overridden_at: '2024-01-10T00:00:00Z',
            reason: 'Strategic priority opportunity',
            by: 'human',
            opportunity_id: 'abc123',
          },
        ],
      };
      const result = PlaybookRuleSchema.safeParse(ruleWithHistory);
      expect(result.success).toBe(true);
    });

    it('should reject invalid rule type', () => {
      const invalidRule = { ...validRule, rule_type: 'invalid' };
      const result = PlaybookRuleSchema.safeParse(invalidRule);
      expect(result.success).toBe(false);
    });

    it('should reject invalid category', () => {
      const invalidRule = { ...validRule, category: 'invalid_category' };
      const result = PlaybookRuleSchema.safeParse(invalidRule);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const invalidRule = { ...validRule, status: 'invalid_status' };
      const result = PlaybookRuleSchema.safeParse(invalidRule);
      expect(result.success).toBe(false);
    });

    it('should reject confidence out of range', () => {
      const invalidRule = { ...validRule, confidence: 1.5 };
      const result = PlaybookRuleSchema.safeParse(invalidRule);
      expect(result.success).toBe(false);
    });

    it('should reject negative confidence', () => {
      const invalidRule = { ...validRule, confidence: -0.5 };
      const result = PlaybookRuleSchema.safeParse(invalidRule);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID', () => {
      const invalidRule = { ...validRule, id: 'not-a-uuid' };
      const result = PlaybookRuleSchema.safeParse(invalidRule);
      expect(result.success).toBe(false);
    });

    it('should accept all valid rule types', () => {
      const types = ['process_rule', 'threshold', 'preference', 'sop', 'lesson_learned'];
      for (const type of types) {
        const rule = { ...validRule, rule_type: type };
        const result = PlaybookRuleSchema.safeParse(rule);
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid categories', () => {
      const categories = [
        'pursuit_criteria',
        'timeline',
        'teaming',
        'tech_assessment',
        'proposal_process',
        'agency_preference',
        'capacity',
      ];
      for (const category of categories) {
        const rule = { ...validRule, category: category };
        const result = PlaybookRuleSchema.safeParse(rule);
        expect(result.success).toBe(true);
      }
    });
  });
});
