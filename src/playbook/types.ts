// Playbook Types - Self-Organizing Process Evolution

import { z } from 'zod';
import type { LiveAgentName } from '../live/types.js';

// ============================================================
// Rule Types
// ============================================================
export const RuleType = {
  PROCESS_RULE: 'process_rule',
  THRESHOLD: 'threshold',
  PREFERENCE: 'preference',
  SOP: 'sop',
  LESSON_LEARNED: 'lesson_learned',
} as const;

export type RuleTypeValue = (typeof RuleType)[keyof typeof RuleType];

// ============================================================
// Rule Categories
// ============================================================
export const RuleCategory = {
  PURSUIT_CRITERIA: 'pursuit_criteria',
  TIMELINE: 'timeline',
  TEAMING: 'teaming',
  TECH_ASSESSMENT: 'tech_assessment',
  PROPOSAL_PROCESS: 'proposal_process',
  AGENCY_PREFERENCE: 'agency_preference',
  CAPACITY: 'capacity',
} as const;

export type RuleCategoryValue = (typeof RuleCategory)[keyof typeof RuleCategory];

// ============================================================
// Rule Status
// ============================================================
export const RuleStatus = {
  PROPOSED: 'proposed',
  ACTIVE: 'active',
  RETIRED: 'retired',
  OVERRIDDEN_BY_HUMAN: 'overridden_by_human',
} as const;

export type RuleStatusValue = (typeof RuleStatus)[keyof typeof RuleStatus];

// ============================================================
// Zod Schemas
// ============================================================
export const RuleEvidenceSchema = z
  .object({
    // Timeline evidence
    avgWinDiscoveryToGo: z.number().optional(),
    avgLossDiscoveryToGo: z.number().optional(),

    // Win rate evidence
    winRate: z.number().optional(),
    winRateWithout: z.number().optional(),
    shortDeadlineWinRate: z.number().optional(),

    // Sample size
    sample_size: z.number().optional(),

    // Threshold data
    threshold: z.number().optional(),
    overloadWinRate: z.number().optional(),
    normalWinRate: z.number().optional(),

    // Agent involvement
    winRateWithAgent: z.number().optional(),
    winRateWithoutAgent: z.number().optional(),
    agent: z.string().optional(),

    // Override tracking
    override_reason: z.string().optional(),
    retirement_reason: z.string().optional(),

    // Custom fields
  })
  .passthrough();

export type RuleEvidence = z.infer<typeof RuleEvidenceSchema>;

export const PlaybookRuleSchema = z.object({
  id: z.string().uuid(),
  rule_type: z.enum(['process_rule', 'threshold', 'preference', 'sop', 'lesson_learned']),
  category: z.enum([
    'pursuit_criteria',
    'timeline',
    'teaming',
    'tech_assessment',
    'proposal_process',
    'agency_preference',
    'capacity',
  ]),
  rule: z.string(),
  evidence: RuleEvidenceSchema,
  confidence: z.number().min(0).max(1),
  proposed_by: z.string(),
  status: z.enum(['proposed', 'active', 'retired', 'overridden_by_human']),
  adopted_at: z.string().nullable(),
  retired_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  supporting_outcomes: z.array(z.string().uuid()),
  contradicting_outcomes: z.array(z.string().uuid()),
  times_applied: z.number(),
  times_overridden: z.number(),
  override_history: z.array(
    z.object({
      overridden_at: z.string(),
      reason: z.string(),
      by: z.string(),
      opportunity_id: z.string().optional(),
    })
  ),
});

export type PlaybookRule = z.infer<typeof PlaybookRuleSchema>;

// ============================================================
// Active Rule (subset returned by get_active_rules)
// ============================================================
export interface ActiveRule {
  id: string;
  rule_type: RuleTypeValue;
  category: RuleCategoryValue;
  rule: string;
  evidence: RuleEvidence;
  confidence: number;
  proposed_by: string;
  adopted_at: string | null;
  times_applied: number;
  times_overridden: number;
}

// ============================================================
// Rule Violation
// ============================================================
export interface RuleViolation {
  rule: PlaybookRule | ActiveRule;
  violation: string;
  recommendation: string;
  overrideable: boolean;
}

// ============================================================
// Propose Rule Input
// ============================================================
export interface ProposeRuleInput {
  rule_type: RuleTypeValue;
  category: RuleCategoryValue;
  rule: string;
  evidence: RuleEvidence;
  proposed_by: LiveAgentName | 'system';
  confidence?: number;
}

// ============================================================
// Playbook Application
// ============================================================
export interface PlaybookApplication {
  id: string;
  rule_id: string;
  opportunity_id: string | null;
  opportunity_title: string | null;
  action: 'applied' | 'overridden' | 'ignored';
  applied_by: string;
  override_reason: string | null;
  context: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// Retrospective Run
// ============================================================
export interface RetrospectiveRun {
  id: string;
  period_start: string;
  period_end: string;
  outcomes_analyzed: number;
  chains_analyzed: number;
  rules_proposed: number;
  rules_adopted: number;
  findings: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at: string | null;
}

// ============================================================
// Outcome Data (for retrospective analysis)
// ============================================================
export interface OutcomeData {
  opportunity_id: string;
  notice_id: string;
  title: string;
  outcome: 'won' | 'lost' | 'no_bid' | 'cancelled' | 'withdrawn';
  discovery_to_go_days: number;
  days_from_discovery_to_due: number;
  agents_involved: string[];
  value: number | null;
  agency: string | null;
  created_at: string;
}

// ============================================================
// Chain Data (for retrospective analysis)
// ============================================================
export interface ChainData {
  root_event_id: string;
  opportunity_id: string;
  title: string;
  agents_involved: string[];
  events_count: number;
  chain_duration_hours: number;
  outcome: string | null;
  created_at: string;
  completed_at: string | null;
}

// ============================================================
// Rule Health Check Result
// ============================================================
export interface RuleHealthCheck {
  rule_id: string;
  rule_text: string;
  override_rate: number;
  should_retire: boolean;
  should_boost: boolean;
}
