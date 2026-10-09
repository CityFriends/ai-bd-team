/**
 * Denise — Acquisition Intelligence Lead: Types & Constants
 *
 * All types, enums, and constants for Denise's deterministic
 * acquisition intelligence foundation. Denise interprets how
 * the government intends to buy, evaluate, and administer work.
 *
 * Authority:
 *   Denise MAY NOT: authorize Pursue, issue GO/NO_GO, submit
 *   proposals, contact agency, send clarification questions,
 *   approve spending, provide legal advice, act as CO,
 *   overwrite another employee's artifact, invent regulatory authority.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

// ============================================================
// EVIDENCE MODEL — every material conclusion must distinguish
// ============================================================

export const EVIDENCE_CATEGORIES = [
  'SOURCE_FACT',
  'REGULATORY_CONTEXT',
  'INTERPRETATION',
  'OPERATIONAL_IMPLICATION',
  'UNCERTAINTY',
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

// ============================================================
// AUTHORITY HIERARCHY
// ============================================================

export const AUTHORITY_LEVELS = [
  'SOLICITATION',
  'AMENDMENT',
  'QA_RESPONSE',
  'AGENCY_GUIDANCE',
  'FAR_DFARS',
  'SAM_SBA_OFFICIAL',
  'GAO_CONTEXTUAL',
  'DENISE_INTERPRETATION',
] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

// ============================================================
// ACQUISITION TASK TYPES
// ============================================================

export const ACQUISITION_RESEARCH_TYPES = [
  'ACQUISITION_STRUCTURE',
  'EVALUATION_MODEL',
  'CLAUSE_ANALYSIS',
  'SUBMISSION_REQUIREMENTS',
  'ELIGIBILITY',
  'ACQUISITION_RISK',
  'CLARIFICATION',
  'REGULATORY_INTERPRETATION',
] as const;
export type AcquisitionResearchType = (typeof ACQUISITION_RESEARCH_TYPES)[number];

export const ACQUISITION_TASK_TYPES = [
  ...ACQUISITION_RESEARCH_TYPES,
  'AMENDMENT_ANALYSIS',
] as const;
export type AcquisitionTaskType = (typeof ACQUISITION_TASK_TYPES)[number];

export const TASK_STATUSES = [
  'pending', 'in_progress', 'completed', 'failed', 'skipped', 'timed_out',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = [
  'CRITICAL', 'HIGH', 'NORMAL', 'LOW',
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface AcquisitionTask {
  id: string;
  capture_id: string | null;
  opportunity_id: string | null;
  proposal_workspace_id: string | null;
  task_type: AcquisitionTaskType;
  requester: string;
  question: string | null;
  research_type: AcquisitionResearchType;
  expected_artifact: string | null;
  evidence_refs: unknown[];
  priority: TaskPriority;
  status: TaskStatus;
  inference_ledger_id: string | null;
  execution_mode: 'REAL' | 'TEST_FIXTURE';
  budget_usd: number | null;
  budget_scope_id: string | null;
  timeout_seconds: number;
  timeout_at: string | null;
  idempotency_key: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  error_message: string | null;
}

// ============================================================
// ACQUISITION RESEARCH REQUEST (cross-employee contract)
// ============================================================

export interface AcquisitionResearchRequest {
  captureId: string;
  opportunityId: string;
  requester: string;
  question: string;
  researchType: AcquisitionResearchType;
  expectedArtifact?: string;
  evidenceRefs?: string[];
  idempotencyKey: string;
}

// ============================================================
// ACQUISITION ANALYSIS
// ============================================================

export interface AcquisitionAnalysis {
  id: string;
  opportunity_id: string;
  capture_id: string | null;
  proposal_workspace_id: string | null;
  solicitation_version: string | null;
  amendment_version: number;
  contract_type: string | null;
  competition_type: string | null;
  set_aside: string | null;
  naics: string | null;
  size_standard: string | null;
  vehicle: string | null;
  period_of_performance: string | null;
  option_structure: Record<string, unknown> | null;
  submission_method: string | null;
  proposal_due_date: string | null;
  questions_due_date: string | null;
  source_refs: unknown[];
  interpretation: Record<string, unknown>;
  acquisition_implications: unknown[];
  unresolved_issues: unknown[];
  version: number;
  supersedes_id: string | null;
  created_at: string;
  created_by: string;
  idempotency_key: string;
}

// ============================================================
// EVALUATION MODEL
// ============================================================

export const EVALUATION_METHODS = [
  'LPTA', 'TRADEOFF', 'BEST_VALUE', 'NOT_STATED', 'OTHER',
] as const;
export type EvaluationMethod = (typeof EVALUATION_METHODS)[number];

export const RELATIVE_IMPORTANCE_VALUES = [
  'MOST_IMPORTANT', 'MORE_IMPORTANT', 'APPROX_EQUAL',
  'LESS_IMPORTANT', 'PASS_FAIL', 'NOT_STATED',
] as const;
export type RelativeImportance = (typeof RELATIVE_IMPORTANCE_VALUES)[number];

export interface EvaluationFactor {
  name: string;
  relativeImportance: RelativeImportance;
  sourceRef: string;
  sourceText: string;
}

export interface AcquisitionEvaluationModel {
  id: string;
  acquisition_analysis_id: string;
  opportunity_id: string;
  evaluation_method: EvaluationMethod | null;
  factors: EvaluationFactor[];
  subfactors: unknown[];
  relative_importance: Record<string, unknown>;
  explicit_weighting: Record<string, unknown> | null;
  past_performance_treatment: string | null;
  price_treatment: string | null;
  source_refs: unknown[];
  acquisition_implications: unknown[];
  uncertainty: unknown[];
  created_at: string;
  idempotency_key: string;
}

// ============================================================
// CLAUSE REGISTER
// ============================================================

export const RISK_SEVERITIES = [
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL',
] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const CLAUSE_ACTION_TYPES = [
  'REPS_CERTS', 'OCI_MITIGATION', 'LIMITATION_ON_SUBCONTRACTING',
  'SUBCONTRACTING_PLAN', 'SECURITY_DOCUMENTATION', 'KEY_PERSONNEL_EVIDENCE',
  'MANDATORY_FORM', 'SUBMISSION_PREREQUISITE', 'OTHER',
] as const;
export type ClauseActionType = (typeof CLAUSE_ACTION_TYPES)[number];

export interface AcquisitionClauseRegisterEntry {
  id: string;
  acquisition_analysis_id: string;
  opportunity_id: string;
  clause_number: string;
  authority: string;
  source_version: string | null;
  applicability: string | null;
  requirement: string;
  operational_impact: string | null;
  recommended_owner: string | null;
  risk_severity: RiskSeverity;
  evidence_refs: unknown[];
  legal_review_required: boolean;
  action_required: boolean;
  action_type: ClauseActionType | null;
  action_description: string | null;
  action_owner: string | null;
  created_at: string;
  idempotency_key: string;
}

// ============================================================
// ACQUISITION RISKS
// ============================================================

export const RISK_TYPES = [
  'ELIGIBILITY', 'CERTIFICATION', 'CLEARANCE', 'OCI',
  'SET_ASIDE_MISMATCH', 'VEHICLE_ACCESS', 'EXPERIENCE_REQUIREMENT',
  'SUBCONTRACTING', 'EVALUATION', 'SUBMISSION', 'CONTRACTUAL',
  'REGULATORY', 'OTHER',
] as const;
export type AcquisitionRiskType = (typeof RISK_TYPES)[number];

export const RISK_SEVERITIES_RISK = [
  'CRITICAL', 'HIGH', 'MEDIUM', 'LOW',
] as const;

export const RISK_STATUSES = [
  'OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED', 'SUPERSEDED',
] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export interface AcquisitionRisk {
  id: string;
  acquisition_analysis_id: string;
  opportunity_id: string;
  risk_type: AcquisitionRiskType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  source_refs: unknown[];
  source_fact: string;
  interpretation: string;
  operational_impact: string;
  affected_owner: string | null;
  affected_workflow: string | null;
  potentially_disqualifying: boolean;
  legal_review_required: boolean;
  status: RiskStatus;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
}

// ============================================================
// CLARIFICATION QUESTIONS
// ============================================================

export const CLARIFICATION_CLASSIFICATIONS = [
  'CLARIFICATION_NEEDED', 'INTERPRETATION_REQUIRED', 'LEGAL_REVIEW_REQUIRED',
] as const;
export type ClarificationClassification = (typeof CLARIFICATION_CLASSIFICATIONS)[number];

export const HUMAN_APPROVAL_STATUSES = [
  'PENDING', 'APPROVED', 'REJECTED', 'DEFERRED',
] as const;
export type HumanApprovalStatus = (typeof HUMAN_APPROVAL_STATUSES)[number];

export const EXTERNAL_SEND_STATUSES = [
  'NOT_SENT', 'DRAFT_ONLY',
] as const;
export type ExternalSendStatus = (typeof EXTERNAL_SEND_STATUSES)[number];

export interface AcquisitionClarificationQuestion {
  id: string;
  acquisition_analysis_id: string;
  opportunity_id: string;
  source_section: string;
  evidence_refs: unknown[];
  ambiguity: string;
  conflicting_language: string | null;
  operational_impact: string;
  affected_area: string | null;
  proposed_question: string;
  priority: TaskPriority;
  question_deadline: string | null;
  classification: ClarificationClassification;
  human_approval_status: HumanApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  external_send_status: ExternalSendStatus;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
}

// ============================================================
// ACQUISITION CONFLICTS
// ============================================================

export const CONFLICT_STATUSES = ['OPEN', 'RESOLVED', 'SUPERSEDED'] as const;
export type AcquisitionConflictStatus = (typeof CONFLICT_STATUSES)[number];

export interface AcquisitionConflict {
  id: string;
  acquisition_analysis_id: string | null;
  opportunity_id: string;
  acquisition_artifact_id: string;
  conflicting_artifact_type: string;
  conflicting_artifact_id: string;
  source_refs: unknown[];
  conflict_description: string;
  affected_owners: string[];
  status: AcquisitionConflictStatus;
  decision_owner: string | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
}

// ============================================================
// REGULATORY EVIDENCE
// ============================================================

export const FRESHNESS_STATUSES = [
  'CURRENT', 'REVALIDATION_REQUIRED', 'SUPERSEDED', 'UNKNOWN',
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export interface RegulatoryEvidence {
  id: string;
  authority: string;
  citation: string;
  provision: string | null;
  source_url: string | null;
  title: string | null;
  version: string | null;
  effective_date: string | null;
  retrieved_at: string;
  content_hash: string;
  bounded_relevant_text: string;
  freshness_status: FreshnessStatus;
  superseded_by_id: string | null;
  created_at: string;
  idempotency_key: string;
}

// ============================================================
// REGULATORY SOURCE CACHE
// ============================================================

export const CACHE_FRESHNESS_STATUSES = [
  'CURRENT', 'REVALIDATION_REQUIRED', 'SUPERSEDED', 'EXPIRED',
] as const;
export type CacheFreshnessStatus = (typeof CACHE_FRESHNESS_STATUSES)[number];

export interface RegulatorySourceCache {
  id: string;
  authority: string;
  citation: string;
  version: string | null;
  effective_date: string | null;
  source_url: string | null;
  content_hash: string;
  cached_text: string;
  freshness_status: CacheFreshnessStatus;
  last_validated_at: string;
  superseding_version: string | null;
  superseding_hash: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// AMENDMENT IMPACT MODEL
// ============================================================

export const AMENDMENT_IMPACT_CLASSES = [
  'ADMINISTRATIVE_ONLY',
  'ACQUISITION_MATERIAL',
  'EVALUATION_MATERIAL',
  'SUBMISSION_MATERIAL',
  'CLAUSE_MATERIAL',
  'LEGAL_REVIEW_REQUIRED',
] as const;
export type AmendmentImpactClass = (typeof AMENDMENT_IMPACT_CLASSES)[number];

// ============================================================
// TRIGGER MODEL — deterministic, no polling
// ============================================================

export const DENISE_TRIGGER_TYPES = [
  'JAMES_STRUCTURED_REQUEST',
  'PURSUIT_AUTHORIZED_SOLICITATION',
  'MATERIAL_AMENDMENT_DETECTED',
  'EMPLOYEE_STRUCTURED_QUESTION',
  'HUMAN_MENTION_REQUEST',
] as const;
export type DeniseTriggerType = (typeof DENISE_TRIGGER_TYPES)[number];

// ============================================================
// CROSS-EMPLOYEE OUTPUTS
// ============================================================

export const CAPTURE_REASSESSMENT_REASONS = [
  'EVALUATION_CHANGE', 'COMPETITION_CHANGE', 'SET_ASIDE_CHANGE',
  'ACQUISITION_STRUCTURE_CHANGE', 'SCOPE_CHANGE', 'CONTRACTUAL_CHANGE',
  'SUBMISSION_STRUCTURE_CHANGE', 'CAPTURE_ASSUMPTION_INVALIDATED',
] as const;
export type CaptureReassessmentReason = (typeof CAPTURE_REASSESSMENT_REASONS)[number];

// ============================================================
// G2X BOUNDARY — exactly 3 document-oriented tools
// ============================================================

export const DENISE_G2X_ALLOWLIST = [
  'g2x_get_record',
  'g2x_opportunity_documents',
  'g2x_opportunity_attachment_text',
] as const;
export type DeniseG2XTool = (typeof DENISE_G2X_ALLOWLIST)[number];

/** Denise G2X tools that are explicitly DENIED */
export const DENISE_G2X_DENYLIST = [
  'g2x_search_opportunities',
  'g2x_search_supplementary',
  'g2x_search_companies',
  'g2x_company_contract_history',
  'g2x_search_records',
  'g2x_forecast_scan',
  'g2x_teaming_partners',
  'g2x_get_graph_neighborhood',
  'g2x_search_events',
  'g2x_get_event',
  'g2x_usage',
  // Metered AI — absolutely denied
  'analyze_document',
  'analyze_opportunity',
  'lumen_query',
  'lumen_analyze',
  'qualify_opportunity',
  'ai_document_analysis',
  'deep_research',
  'provider_lookup',
] as const;

// ============================================================
// GATEWAY ROUTES (all disabled)
// ============================================================

export const DENISE_GATEWAY_ROUTES = [
  'denise_capture_acquisition',
  'denise_clause_analysis',
  'denise_amendment_impact',
  'denise_clarification_draft',
  'denise_evaluation_analysis',
] as const;
export type DeniseGatewayRoute = (typeof DENISE_GATEWAY_ROUTES)[number];

// ============================================================
// FEATURE FLAGS (all disabled)
// ============================================================

/** Denise capture acquisition intelligence — DISABLED */
export const DENISE_CAPTURE_ENABLED = false;

/** Denise pursuit acquisition intelligence — DISABLED */
export const DENISE_PURSUIT_ENABLED = false;

/** Denise Slack surface — DISABLED */
export const DENISE_SLACK_ENABLED = false;

/** Denise regulatory research adapter — DISABLED */
export const DENISE_REGULATORY_RESEARCH_ENABLED = false;

// ============================================================
// CONSTANTS
// ============================================================

/** Denise never makes provider calls in foundation mode */
export const DENISE_PROVIDER_CALLS = 0;

/** Denise never makes G2X calls in foundation mode */
export const DENISE_G2X_CALLS = 0;

/** Capture parent budget (James's envelope) */
export const CAPTURE_PARENT_BUDGET_USD = 0.25;

/** Denise subordinate task ceiling during capture */
export const DENISE_CAPTURE_TASK_CEILING_USD = 0.05;

/** Pursuit observation: max reasoning calls */
export const DENISE_PURSUIT_MAX_CALLS = 10;

/** Pursuit observation: max cumulative spend */
export const DENISE_PURSUIT_MAX_SPEND_USD = 0.25;

/** Per-task budget ceilings (USD) — all disabled */
export const DENISE_TASK_BUDGET_CEILINGS = {
  denise_capture_acquisition: 0.05,
  denise_clause_analysis: 0.05,
  denise_amendment_impact: 0.05,
  denise_clarification_draft: 0.03,
  denise_evaluation_analysis: 0.05,
} as const;

// ============================================================
// AI TASK TYPES (disabled)
// ============================================================

export const DENISE_AI_TASK_TYPES = [
  'denise_capture_acquisition',
  'denise_clause_analysis',
  'denise_amendment_impact',
  'denise_clarification_draft',
  'denise_evaluation_analysis',
] as const;
export type DeniseAITaskType = (typeof DENISE_AI_TASK_TYPES)[number];

// ============================================================
// REGULATORY RESEARCH ADAPTER — authority classes
// ============================================================

export const REGULATORY_AUTHORITY_CLASSES = [
  'ACQUISITION_GOV_FAR',
  'DFARS_DOD',
  'AGENCY_FAR_SUPPLEMENT',
  'SAM_GOV',
  'SBA_GOV',
  'AGENCY_ACQUISITION_GUIDANCE',
  'GAO_CONTEXTUAL',
] as const;
export type RegulatoryAuthorityClass = (typeof REGULATORY_AUTHORITY_CLASSES)[number];

// ============================================================
// SLACK SEVERITY LEVELS for proactive notification
// ============================================================

export const SLACK_NOTIFICATION_SEVERITIES = [
  'CRITICAL', 'HIGH',
] as const;
export type SlackNotificationSeverity = (typeof SLACK_NOTIFICATION_SEVERITIES)[number];

export const SLACK_NOTIFICATION_TYPES = [
  'ACQUISITION_RISK_HIGH',
  'POTENTIALLY_DISQUALIFYING',
  'CAPTURE_REASSESSMENT_REQUIRED',
  'HIGH_PRIORITY_CLARIFICATION',
  'LEGAL_REVIEW_REQUIRED',
  'EVALUATION_MATERIAL_CHANGE',
  'SUBMISSION_MATERIAL_CHANGE',
] as const;
export type SlackNotificationType = (typeof SLACK_NOTIFICATION_TYPES)[number];

// ============================================================
// GAO BOUNDARY
// ============================================================

export const GAO_CLASSIFICATION = 'CONTEXTUAL_PRECEDENT' as const;
// GAO is NEVER: 'LEGAL_ADVICE' | 'BINDING_CONCLUSION'

// ============================================================
// SUPABASE CLIENT TYPE ALIAS
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;
