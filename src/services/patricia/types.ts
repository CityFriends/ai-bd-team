/**
 * Patricia — Program/Pipeline Management: Types & Constants
 *
 * All types, enums, and constants for Patricia's deterministic foundation.
 * Patricia observes durable system state, not agent chatter.
 * Zero LLM calls. Zero provider imports.
 */

// ============================================================
// COMMITMENT TYPES
// ============================================================

export const COMMITMENT_TYPES = [
  'GOVERNMENT_DEADLINE',
  'INTERNAL_MILESTONE',
  'SPECIALIST_DELIVERABLE',
  'REVIEW_GATE',
  'HUMAN_DECISION',
  'POST_SUBMISSION',
  'CUSTOM',
] as const;
export type CommitmentType = (typeof COMMITMENT_TYPES)[number];

export const OWNER_TYPES = ['AGENT', 'HUMAN', 'SYSTEM', 'TEAM'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const SOURCE_TYPES = [
  'SOLICITATION', 'SYSTEM_RULE', 'HUMAN_OVERRIDE',
  'MILESTONE_PLAN', 'EVENT', 'MANUAL',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const COMMITMENT_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE',
  'CANCELLED', 'SUPERSEDED',
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const HARD_OR_SOFT = ['HARD', 'SOFT'] as const;
export type HardOrSoft = (typeof HARD_OR_SOFT)[number];

export interface Commitment {
  id: string;
  opportunity_id: string | null;
  capture_id: string | null;
  proposal_workspace_id: string | null;
  title: string;
  commitment_type: CommitmentType;
  owner_type: OwnerType;
  owner_id: string;
  source_type: SourceType;
  source_id: string;
  source_version_id: string | null;
  due_at: string;
  timezone: string;
  hard_or_soft: HardOrSoft;
  status: CommitmentStatus;
  escalation_level: EscalationLevel;
  provenance: Record<string, unknown>;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancellation_event_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// DEPENDENCY TYPES
// ============================================================

export const DEPENDENCY_TARGET_TYPES = [
  'COMMITMENT', 'TASK', 'DECISION', 'ARTIFACT', 'EXTERNAL',
] as const;
export type DependencyTargetType = (typeof DEPENDENCY_TARGET_TYPES)[number];

export const DEPENDENCY_STATUSES = [
  'BLOCKED', 'READY', 'SATISFIED', 'CANCELLED',
] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export interface Dependency {
  id: string;
  commitment_id: string;
  depends_on_type: DependencyTargetType;
  depends_on_id: string;
  status: DependencyStatus;
  satisfied_at: string | null;
  satisfied_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ESCALATION TYPES
// ============================================================

export const ESCALATION_LEVELS = [
  'NONE', 'NOTICE', 'ACTION_REQUIRED', 'AT_RISK',
] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export const ESCALATION_TYPES = [
  'DECISION_REQUIRED',
  'DEADLINE_THREAT',
  'BLOCKER',
  'AUTHORITATIVE_CONFLICT',
  'MISSING_PREREQUISITE',
  'STALLED_WORK',
] as const;
export type EscalationType = (typeof ESCALATION_TYPES)[number];

export const ESCALATION_STATUSES = [
  'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED', 'EXPIRED',
] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export interface Escalation {
  id: string;
  escalation_type: EscalationType;
  opportunity_id: string | null;
  capture_id: string | null;
  proposal_workspace_id: string | null;
  title: string;
  description: string;
  severity: FindingSeverity;
  decision_owner: string | null;
  evidence: Record<string, unknown>;
  conflicting_inputs: Record<string, unknown> | null;
  status: EscalationStatus;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// WORKFLOW HEALTH TYPES
// ============================================================

export const FINDING_SEVERITIES = [
  'NOTICE', 'ACTION_REQUIRED', 'AT_RISK',
] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_STATUSES = [
  'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export interface WorkflowFinding {
  id: string;
  rule_id: string;
  opportunity_id: string | null;
  capture_id: string | null;
  proposal_workspace_id: string | null;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  recommended_action: string | null;
  auto_repair_permitted: boolean;
  auto_repair_executed: boolean;
  auto_repair_action_id: string | null;
  status: FindingStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// WORKFLOW HEALTH RULES
// ============================================================

export interface HealthRule {
  ruleId: string;
  title: string;
  severity: FindingSeverity;
  autoRepairPermitted: boolean;
  evaluate: (context: HealthRuleContext) => Promise<HealthRuleResult[]>;
}

export interface HealthRuleContext {
  supabase: SupabaseClient;
}

export interface HealthRuleResult {
  opportunityId?: string;
  captureId?: string;
  proposalWorkspaceId?: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  recommendedAction?: string;
  idempotencyKeySuffix: string;
}

// ============================================================
// PROPOSAL READINESS TYPES
// ============================================================

export const PROPOSAL_STAGES = [
  'PRE_SOLICITATION',
  'INTAKE',
  'REQUIREMENTS_ANALYSIS',
  'DRAFTING',
  'REVIEW',
  'FINALIZATION',
  'READY_TO_SUBMIT',
  'SUBMITTED',
] as const;
export type ProposalStage = (typeof PROPOSAL_STAGES)[number];

export interface ProposalReadiness {
  id: string;
  proposal_workspace_id: string;
  capture_id: string;
  opportunity_id: string;
  stage: ProposalStage;
  has_actionable_solicitation: boolean;
  solicitation_received_at: string | null;
  government_deadline: string | null;
  jodie_analysis_task_id: string | null;
  submission_confirmed_by: string | null;
  submission_confirmed_at: string | null;
  stage_entered_at: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// INTERNAL MILESTONE TYPES
// ============================================================

export const MILESTONE_TYPES = [
  'REQUIREMENTS_ANALYSIS_COMPLETE',
  'FIRST_DRAFT',
  'TECHNICAL_INPUTS_COMPLETE',
  'COMPLIANCE_REVIEW',
  'MANAGEMENT_REVIEW',
  'FINAL_CONTENT_FREEZE',
  'FINAL_PRODUCTION_QA',
  'READY_TO_SUBMIT',
  'CUSTOM',
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const MILESTONE_STATUSES = [
  'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE',
  'CANCELLED', 'SUPERSEDED',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export interface InternalMilestone {
  id: string;
  proposal_workspace_id: string;
  capture_id: string | null;
  opportunity_id: string | null;
  milestone_type: MilestoneType;
  title: string;
  planned_date: string;
  actual_date: string | null;
  status: MilestoneStatus;
  commitment_id: string | null;
  offset_days_before_deadline: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

/** Default milestone schedule: offset days before government deadline */
export const DEFAULT_MILESTONE_SCHEDULE: Array<{
  type: MilestoneType;
  title: string;
  offsetDays: number;
}> = [
  { type: 'REQUIREMENTS_ANALYSIS_COMPLETE', title: 'Requirements Analysis Complete', offsetDays: 28 },
  { type: 'FIRST_DRAFT', title: 'First Draft Complete', offsetDays: 21 },
  { type: 'TECHNICAL_INPUTS_COMPLETE', title: 'Technical Inputs Complete', offsetDays: 18 },
  { type: 'COMPLIANCE_REVIEW', title: 'Compliance Review', offsetDays: 14 },
  { type: 'MANAGEMENT_REVIEW', title: 'Management Review', offsetDays: 10 },
  { type: 'FINAL_CONTENT_FREEZE', title: 'Final Content Freeze', offsetDays: 7 },
  { type: 'FINAL_PRODUCTION_QA', title: 'Final Production/QA', offsetDays: 3 },
  { type: 'READY_TO_SUBMIT', title: 'Ready to Submit', offsetDays: 1 },
];

// ============================================================
// OPERATIONAL ACTION TYPES
// ============================================================

export const ACTION_TYPES = [
  'SAFE_REPAIR',
  'TASK_CREATED',
  'TASK_ADVANCED',
  'TASK_CANCELLED',
  'COMMITMENT_CREATED',
  'COMMITMENT_UPDATED',
  'DEPENDENCY_SATISFIED',
  'DEPENDENCY_CANCELLED',
  'ESCALATION_CREATED',
  'FINDING_CREATED',
  'MILESTONE_CREATED',
  'MILESTONE_UPDATED',
  'SNAPSHOT_CREATED',
  'PROPOSAL_STAGE_CHANGED',
  'POST_SUBMISSION_EVENT',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface OperationalAction {
  id: string;
  action_type: ActionType;
  target_type: string;
  target_id: string;
  triggering_event_type: string | null;
  triggering_event_id: string | null;
  evidence: Record<string, unknown>;
  result: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
}

// ============================================================
// POST-SUBMISSION TYPES
// ============================================================

export const POST_SUBMISSION_EVENT_TYPES = [
  'SUBMITTED',
  'CLARIFICATION_REQUEST',
  'ORAL_PRESENTATION',
  'REVISED_PROPOSAL_REQUEST',
  'EVALUATION_UPDATE',
  'AWARD',
  'LOSS',
  'CANCELLATION',
  'RETROSPECTIVE',
  'CLOSEOUT',
] as const;
export type PostSubmissionEventType = (typeof POST_SUBMISSION_EVENT_TYPES)[number];

// ============================================================
// PORTFOLIO SNAPSHOT TYPES
// ============================================================

export interface PortfolioSnapshot {
  id: string;
  snapshot_type: 'WEEKLY' | 'DAILY' | 'ON_DEMAND';
  snapshot_data: PortfolioSnapshotData;
  active_watches: number;
  active_captures: number;
  active_pursuits: number;
  active_proposals: number;
  deadlines_next_7d: number;
  deadlines_next_14d: number;
  deadlines_next_30d: number;
  overdue_commitments: number;
  blocked_work_items: number;
  at_risk_pursuits: number;
  human_decisions_needed: number;
  recently_submitted: number;
  awards: number;
  losses: number;
  idempotency_key: string;
  created_at: string;
}

export interface PortfolioSnapshotData {
  watches: Array<{ opportunity_id: string; title: string }>;
  captures: Array<{ id: string; opportunity_id: string; status: string }>;
  pursuits: Array<{ capture_id: string; opportunity_id: string; status: string }>;
  proposals: Array<{ workspace_id: string; stage: string }>;
  upcomingDeadlines: Array<{
    commitment_id: string;
    title: string;
    due_at: string;
    days_remaining: number;
  }>;
  overdueCommitments: Array<{
    commitment_id: string;
    title: string;
    due_at: string;
    days_overdue: number;
  }>;
  blockedWork: Array<{
    commitment_id: string;
    title: string;
    blocked_by: string[];
  }>;
  atRiskItems: Array<{
    escalation_id: string;
    title: string;
    severity: string;
  }>;
  humanDecisionsNeeded: Array<{
    escalation_id: string;
    title: string;
    decision_owner: string | null;
  }>;
  recentSubmissions: Array<{
    workspace_id: string;
    opportunity_id: string;
    submitted_at: string;
  }>;
  awardsAndLosses: Array<{
    workspace_id: string;
    event_type: string;
    created_at: string;
  }>;
}

// ============================================================
// SAFE REPAIR TYPES
// ============================================================

export interface SafeRepairRule {
  ruleId: string;
  description: string;
  execute: (context: SafeRepairContext) => Promise<SafeRepairResult>;
}

export interface SafeRepairContext {
  supabase: SupabaseClient;
  finding: WorkflowFinding;
}

export interface SafeRepairResult {
  repaired: boolean;
  actionId?: string;
  description: string;
}

// ============================================================
// SLACK SURFACE TYPES
// ============================================================

export interface PatriciaSlackPayload {
  type: 'PORTFOLIO_BRIEF' | 'AT_RISK_ESCALATION' | 'NOTICE';
  text: string;
  blocks?: SlackBlock[];
  actions?: SlackAction[];
}

export interface SlackBlock {
  type: 'section' | 'header' | 'divider' | 'actions' | 'context';
  text?: { type: 'mrkdwn' | 'plain_text'; text: string };
  elements?: Array<{ type: string; text?: { type: string; text: string }; action_id?: string; value?: string }>;
}

export interface SlackAction {
  action_id: string;
  label: string;
  value: string;
}

// ============================================================
// RECONCILER TYPES
// ============================================================

export interface ReconciliationResult {
  checkpointId: string;
  itemsInspected: number;
  findingsCount: number;
  repairsCount: number;
  escalationsCount: number;
  status: 'COMPLETED' | 'FAILED';
  error?: string;
}

// ============================================================
// AI BOUNDARY TYPES (future, disabled)
// ============================================================

export const PATRICIA_AI_TASK_TYPES = [
  'patricia_risk_synthesis',
  'patricia_portfolio_brief',
] as const;
export type PatriciaAITaskType = (typeof PATRICIA_AI_TASK_TYPES)[number];

/** Future observation envelope: 10 reasoning calls OR $0.15 */
export const PATRICIA_OBSERVATION_LIMITS = {
  MAX_TASKS: 10,
  MAX_CUMULATIVE_SPEND_USD: 0.15,
} as const;

// ============================================================
// CONSTANTS
// ============================================================

/** Patricia never makes provider calls in deterministic mode */
export const PATRICIA_PROVIDER_CALLS = 0;

/** Patricia never makes G2X calls */
export const PATRICIA_G2X_CALLS = 0;

// Supabase client type alias (avoids importing @supabase/supabase-js in every file)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;
