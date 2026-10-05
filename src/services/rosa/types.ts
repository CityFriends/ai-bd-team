/**
 * Rosa Teaming & Partner Intelligence — Type Definitions
 *
 * All types, Zod schemas, and contracts for Rosa's partner
 * intelligence capabilities. Rosa produces partner briefs and
 * outreach drafts. She operates in multiple modes:
 *
 *   CAPTURE_REQUEST        — reactive, dispatched by James during capture
 *   DAVID_PARTNER_CANDIDATE — follow-up from David's partner signal
 *   COMPANY_SIGNAL         — proactive company monitoring
 *   RELATIONSHIP_SIGNAL    — proactive relationship change
 *   HUMAN_REQUEST          — direct request from a human operator
 *
 * Rosa does NOT initiate outreach. She provides partner briefs
 * and draft communications for James and human approval.
 */

import { z } from 'zod';

// ============================================================
// Trigger Types
// ============================================================

/**
 * How a Rosa intelligence task was initiated.
 *
 * CAPTURE_REQUEST        — James requests partner research during capture
 * DAVID_PARTNER_CANDIDATE — David identified a potential teaming partner
 * COMPANY_SIGNAL         — Proactive company monitoring detected change
 * RELATIONSHIP_SIGNAL    — Proactive relationship change detected
 * HUMAN_REQUEST          — Direct request from a human operator
 */
export const RosaTriggerType = {
  CAPTURE_REQUEST: 'CAPTURE_REQUEST',
  DAVID_PARTNER_CANDIDATE: 'DAVID_PARTNER_CANDIDATE',
  COMPANY_SIGNAL: 'COMPANY_SIGNAL',
  RELATIONSHIP_SIGNAL: 'RELATIONSHIP_SIGNAL',
  HUMAN_REQUEST: 'HUMAN_REQUEST',
} as const;

export type RosaTriggerTypeValue =
  (typeof RosaTriggerType)[keyof typeof RosaTriggerType];

// ============================================================
// Task Status
// ============================================================

/**
 * Rosa task lifecycle: pending -> in_progress -> completed / failed / skipped
 */
export const RosaTaskStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export type RosaTaskStatusValue =
  (typeof RosaTaskStatus)[keyof typeof RosaTaskStatus];

// ============================================================
// Teaming Needs (James Integration)
// ============================================================

/**
 * Types of teaming needs James can request Rosa to investigate.
 * Each maps to specific G2X research patterns and partner evaluation criteria.
 */
export const RosaTeamingNeed = {
  CAPABILITY_GAP: 'CAPABILITY_GAP',
  CUSTOMER_ACCESS: 'CUSTOMER_ACCESS',
  VEHICLE_ACCESS: 'VEHICLE_ACCESS',
  PAST_PERFORMANCE: 'PAST_PERFORMANCE',
  SCALE_STAFFING: 'SCALE_STAFFING',
  SOCIOECONOMIC_STRATEGY: 'SOCIOECONOMIC_STRATEGY',
  INCUMBENT_TEAMING: 'INCUMBENT_TEAMING',
  PRIME_SUB_POSTURE: 'PRIME_SUB_POSTURE',
  OTHER_BOUNDED_TEAMING_NEED: 'OTHER_BOUNDED_TEAMING_NEED',
} as const;

export type RosaTeamingNeedValue =
  (typeof RosaTeamingNeed)[keyof typeof RosaTeamingNeed];

// ============================================================
// Relationship Directions
// ============================================================

/**
 * Rosa's recommended teaming relationship direction.
 * Advisory — Rosa does not initiate teaming arrangements.
 */
export const RosaRelationshipDirection = {
  PRIME_PARTNER: 'PRIME_PARTNER',
  SUB_TO_PARTNER: 'SUB_TO_PARTNER',
  JV: 'JV',
  EXPLORE: 'EXPLORE',
  NOT_RECOMMENDED: 'NOT_RECOMMENDED',
} as const;

export type RosaRelationshipDirectionValue =
  (typeof RosaRelationshipDirection)[keyof typeof RosaRelationshipDirection];

// ============================================================
// Artifact Types
// ============================================================

/**
 * Types of intelligence artifacts Rosa produces.
 */
export const RosaArtifactType = {
  PARTNER_BRIEF: 'PARTNER_BRIEF',
  OUTREACH_DRAFT: 'OUTREACH_DRAFT',
} as const;

export type RosaArtifactTypeValue =
  (typeof RosaArtifactType)[keyof typeof RosaArtifactType];

// ============================================================
// Outreach Status
// ============================================================

/**
 * Status lifecycle for outreach drafts.
 * Drafts require James and/or human approval before sending.
 */
export const RosaOutreachStatus = {
  DRAFT: 'DRAFT',
  JAMES_APPROVED: 'JAMES_APPROVED',
  HUMAN_APPROVED: 'HUMAN_APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type RosaOutreachStatusValue =
  (typeof RosaOutreachStatus)[keyof typeof RosaOutreachStatus];

// ============================================================
// Confidence Levels
// ============================================================

export const ConfidenceLevel = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export type ConfidenceLevelValue =
  (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];

// ============================================================
// Research Request (from James)
// ============================================================

/**
 * Research request schema — sent by James to Rosa during capture.
 * Rosa uses this to scope G2X research and produce partner briefs.
 */
export const RosaResearchRequestSchema = z.object({
  /** Capture aggregate ID */
  captureId: z.string().uuid(),
  /** Opportunity being evaluated */
  opportunityId: z.string().max(200),
  /** Specific research question */
  question: z.string().max(500),
  /** Type of teaming need driving the request */
  teamingNeed: z.enum([
    'CAPABILITY_GAP',
    'CUSTOMER_ACCESS',
    'VEHICLE_ACCESS',
    'PAST_PERFORMANCE',
    'SCALE_STAFFING',
    'SOCIOECONOMIC_STRATEGY',
    'INCUMBENT_TEAMING',
    'PRIME_SUB_POSTURE',
    'OTHER_BOUNDED_TEAMING_NEED',
  ]),
  /** Expected artifact output type */
  expectedArtifact: z.enum([
    'PARTNER_BRIEF',
    'OUTREACH_DRAFT',
  ]),
  /** Supporting evidence references from James */
  evidenceRefs: z.array(z.string().max(500)).max(5),
});

export type RosaResearchRequest = z.infer<typeof RosaResearchRequestSchema>;

// ============================================================
// Research Result (to James)
// ============================================================

/**
 * Research result schema — returned by Rosa to James after
 * completing a research task. Contains findings, relationship
 * recommendation, and any unresolved questions.
 */
export const RosaResearchResultSchema = z.object({
  /** Rosa task ID */
  taskId: z.string().uuid(),
  /** Partner brief ID produced */
  partnerBriefId: z.string().uuid(),
  /** Recommended teaming relationship direction */
  recommendedRelationship: z.enum([
    'PRIME_PARTNER',
    'SUB_TO_PARTNER',
    'JV',
    'EXPLORE',
    'NOT_RECOMMENDED',
  ]),
  /** Executive summary of findings */
  summary: z.string().max(1000),
  /** Individual findings with detail */
  findings: z.array(z.string().max(500)).max(10),
  /** Evidence references supporting findings */
  evidenceRefs: z.array(z.string().max(500)).max(10),
  /** Questions Rosa could not resolve — may prompt further research */
  unresolvedQuestions: z.array(z.string().max(300)).max(5),
  /** Recommended next actions */
  recommendedActions: z.array(z.string().max(300)).max(5),
  /** Overall confidence in the research result */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type RosaResearchResult = z.infer<typeof RosaResearchResultSchema>;

// ============================================================
// Partner Brief
// ============================================================

/**
 * Partner brief — structured analysis of a potential teaming
 * partner for a given opportunity or proactive assessment.
 */
export const PartnerBriefSchema = z.object({
  /** Company under analysis */
  company: z.string().max(200),
  /** Company identifiers */
  companyIdentifiers: z.object({
    uei: z.string().max(20).nullable(),
    cage: z.string().max(10).nullable(),
    sam: z.string().max(200).nullable(),
  }),
  /** Context that triggered this brief */
  contextType: z.enum(['CAPTURE', 'PROACTIVE', 'HUMAN_REQUEST']),
  /** Related capture ID if applicable */
  captureId: z.string().uuid().optional(),
  /** Related opportunity ID if applicable */
  opportunityId: z.string().max(200).optional(),
  /** Recommended teaming relationship direction */
  recommendedRelationship: z.enum([
    'PRIME_PARTNER',
    'SUB_TO_PARTNER',
    'JV',
    'EXPLORE',
    'NOT_RECOMMENDED',
  ]),
  /** How capabilities complement FFTC's */
  capabilityComplementarity: z.string().max(500),
  /** Customer access and relationships */
  customerAccess: z.string().max(500),
  /** Contract vehicle position */
  vehiclePosition: z.string().max(500),
  /** Past performance complementarity */
  pastPerformanceComplementarity: z.string().max(500),
  /** Socioeconomic strategy fit */
  socioeconomicStrategy: z.string().max(500),
  /** Relationship and competitive risk assessment */
  relationshipAndCompetitiveRisk: z.string().max(500),
  /** Known existing FFTC relationships with this company */
  knownFFTCRelationships: z.array(z.string().max(200)).max(5),
  /** Individual findings with detail */
  findings: z.array(z.string().max(500)).max(10),
  /** Evidence references supporting the brief */
  evidenceRefs: z.array(z.string().max(500)).max(10),
  /** Unresolved questions for follow-up */
  unresolvedQuestions: z.array(z.string().max(300)).max(5),
  /** Recommended next actions */
  recommendedActions: z.array(z.string().max(300)).max(5),
  /** Overall confidence in the assessment */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type PartnerBrief = z.infer<typeof PartnerBriefSchema>;

// ============================================================
// Outreach Draft
// ============================================================

/**
 * Outreach draft — structured draft communication for a
 * potential teaming partner. Requires approval before sending.
 */
export const OutreachDraftSchema = z.object({
  /** Target company */
  company: z.string().max(200),
  /** Contact name if known */
  contactName: z.string().max(200).optional(),
  /** Contact role if known */
  contactRole: z.string().max(200).optional(),
  /** Context for this outreach */
  context: z.string().max(500),
  /** Existing relationship context */
  relationshipContext: z.string().max(300),
  /** Outreach objective */
  objective: z.string().max(300),
  /** Email subject if applicable */
  subject: z.string().max(200).optional(),
  /** Draft message body */
  messageBody: z.string().max(2000),
  /** Supporting evidence references */
  supportingEvidenceRefs: z.array(z.string().max(500)).max(5),
  /** Related capture ID if applicable */
  captureId: z.string().uuid().optional(),
  /** Whether James must approve before human review */
  requiresJamesApproval: z.boolean(),
  /** Current approval status */
  status: z.enum(['DRAFT', 'JAMES_APPROVED', 'HUMAN_APPROVED', 'REJECTED']),
});

export type OutreachDraft = z.infer<typeof OutreachDraftSchema>;

// ============================================================
// Proactive Relevance Scoring
// ============================================================

/**
 * Relevance scoring for proactive partner signals.
 * Determines whether a signal is worth Rosa investigating.
 *
 * Wake thresholds:
 *   0-39  STORE_ONLY  — persist but take no action
 *   40-59 WATCH       — add to watched partners
 *   60-79 ROSA_QUICK  — quick partner assessment
 *   80-100 ROSA_FULL  — full partner brief
 */
export const RosaProactiveRelevanceScoreSchema = z.object({
  /** Overall relevance score (0-100) */
  totalScore: z.number().int().min(0).max(100),
  /** Scoring dimensions with individual weights */
  dimensions: z.array(z.object({
    name: z.string().max(100),
    score: z.number().int().min(0).max(100),
    weight: z.number().min(0).max(1),
    reason: z.string().max(300),
  })).max(10),
  /** Minimum score to trigger proactive action */
  wakeThreshold: z.number().int().min(0).max(100),
  /** Signals that contributed to the score */
  signalsMatched: z.array(z.string().max(200)).max(10),
  /** Whether there is an active related pursuit */
  activeRelatedPursuit: z.boolean(),
});

export type RosaProactiveRelevanceScore = z.infer<typeof RosaProactiveRelevanceScoreSchema>;

/**
 * Wake threshold action mappings for proactive relevance scores.
 */
export const RosaWakeThreshold = {
  STORE_ONLY: 'STORE_ONLY',
  WATCH: 'WATCH',
  ROSA_QUICK: 'ROSA_QUICK',
  ROSA_FULL: 'ROSA_FULL',
} as const;

export type RosaWakeThresholdValue =
  (typeof RosaWakeThreshold)[keyof typeof RosaWakeThreshold];

/**
 * Map a relevance score to a wake threshold action.
 */
export function rosaWakeAction(score: number): RosaWakeThresholdValue {
  if (score >= 80) return RosaWakeThreshold.ROSA_FULL;
  if (score >= 60) return RosaWakeThreshold.ROSA_QUICK;
  if (score >= 40) return RosaWakeThreshold.WATCH;
  return RosaWakeThreshold.STORE_ONLY;
}

// ============================================================
// Rosa G2X Allowed Tools
// ============================================================

/**
 * G2X tools Rosa is authorized to invoke.
 * Any tool not in this list is DENIED regardless of
 * remote availability via tools/list.
 */
export const ROSA_G2X_ALLOWED_TOOLS = [
  'g2x_search_companies',
  'g2x_company_contract_history',
  'g2x_search_records',
  'g2x_teaming_partners',
  'g2x_get_record',
] as const;

export type RosaG2XAllowedTool = (typeof ROSA_G2X_ALLOWED_TOOLS)[number];

// ============================================================
// Research Envelope Constants
// ============================================================

/**
 * Per-task G2X call budget.
 * Rosa is bounded per task to prevent runaway research.
 */
export const MAX_G2X_CALLS_PER_TASK = 8;

/**
 * Per-task record retrieval budget.
 * Prevents excessive data ingestion per research task.
 */
export const MAX_RECORDS_PER_TASK = 100;

/**
 * Maximum LLM reasoning calls Rosa may make per task.
 * Rosa's LLM usage is tightly constrained — most work
 * is structured G2X data retrieval, not free-form reasoning.
 */
export const MAX_ROSA_REASONING_CALLS = 1;

// ============================================================
// Budget Constants
// ============================================================

/**
 * Shared capture budget ceiling (USD).
 * Shared across James, David, and Rosa per capture.
 */
export const CAPTURE_BUDGET_CEILING = 0.25;

/**
 * Cost per Rosa capture task (USD).
 * Deducted from the shared capture budget.
 */
export const ROSA_CAPTURE_TASK_COST = 0.05;
