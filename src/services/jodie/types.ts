/**
 * Jodie — Proposal Writer: Types & Constants
 *
 * All types, enums, and constants for Jodie's deterministic proposal
 * foundation. Jodie turns authoritative solicitation requirements,
 * capture strategy, technical inputs, teaming inputs, approved company
 * evidence, and pricing/form inputs into compliant proposal structure,
 * traceable content, and reviewable artifacts.
 *
 * Authority:
 *   Jodie MAY NOT: authorize Pursue, make GO/NO_GO, invent past
 *   performance/personnel/certifications/metrics/pricing, submit
 *   externally, sign forms, send email, contact government/partners.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

// ============================================================
// REQUIREMENT TYPES (Compliance Matrix)
// ============================================================

export const REQUIREMENT_TYPES = [
  'TECHNICAL', 'MANAGEMENT', 'PAST_PERFORMANCE', 'PERSONNEL',
  'SECURITY', 'CERTIFICATION', 'PRICING', 'ADMINISTRATIVE',
  'FORM', 'ATTACHMENT', 'SUBMISSION', 'OTHER',
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const REQUIREMENT_STATUSES = [
  'IDENTIFIED', 'ASSIGNED', 'COVERED', 'GAP',
  'COMPLIANCE_RISK', 'NOT_APPLICABLE', 'SUPERSEDED',
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const COMPLIANCE_RISKS = [
  'NONE', 'LOW', 'MEDIUM', 'HIGH', 'FATAL',
] as const;
export type ComplianceRisk = (typeof COMPLIANCE_RISKS)[number];

export const INTERPRETATION_STATUSES = [
  'PENDING', 'INTERPRETED', 'AMBIGUOUS', 'CLARIFICATION_NEEDED',
] as const;
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number];

export interface ProposalRequirement {
  id: string;
  proposal_workspace_id: string;
  source_document_id: string | null;
  source_version_id: string | null;
  source_page: string | null;
  source_section: string | null;
  requirement_text: string;
  requirement_type: RequirementType;
  mandatory: boolean;
  evaluation_factor: string | null;
  response_location: string | null;
  owner_type: string | null;
  owner_id: string | null;
  status: RequirementStatus;
  compliance_risk: ComplianceRisk | null;
  evidence_refs: string[];
  interpretation_status: InterpretationStatus;
  amendment_version: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// EVIDENCE TYPES
// ============================================================

export const EVIDENCE_TYPES = [
  'CORPORATE_CAPABILITY', 'PAST_PERFORMANCE', 'RESUME',
  'CERTIFICATION', 'SOCIOECONOMIC_STATUS', 'CONTRACT_VEHICLE',
  'METRIC', 'CUSTOMER_REFERENCE', 'TECHNICAL_ARTIFACT',
  'TEAMING_ARTIFACT', 'CAPTURE_STRATEGY', 'PRICING_INPUT',
  'COMPANY_IDENTIFIER', 'FORM_VALUE',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const SENSITIVITIES = [
  'PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED',
] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export interface ProposalEvidenceItem {
  id: string;
  proposal_workspace_id: string;
  evidence_type: EvidenceType;
  source_type: string;
  source_id: string;
  source_version_id: string | null;
  title: string;
  value: Record<string, unknown>;
  provenance: Record<string, unknown>;
  effective_from: string | null;
  effective_to: string | null;
  human_verified: boolean;
  proposal_usable: boolean;
  sensitivity: Sensitivity;
  allowed_use_scope: string | null;
  approved_by: string | null;
  approved_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// SECTION TYPES
// ============================================================

export const SECTION_STATUSES = [
  'NOT_STARTED', 'DRAFTING', 'DRAFTED', 'REVIEW_REQUIRED',
  'CHANGES_REQUESTED', 'REVISION_REQUIRED', 'APPROVED',
] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export const AUTHOR_TYPES = ['AI', 'HUMAN', 'HYBRID'] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

export interface ProposalSection {
  id: string;
  proposal_workspace_id: string;
  section_key: string;
  title: string;
  requirement_refs: string[];
  owner: string | null;
  current_version_id: string | null;
  status: SectionStatus;
  stale: boolean;
  locked: boolean;
  locked_by: string | null;
  locked_at: string | null;
  lock_reason: string | null;
  max_pages: number | null;
  max_words: number | null;
  pass_count: number;
  input_version_hash: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface ProposalSectionVersion {
  id: string;
  section_id: string;
  version_number: number;
  previous_version_id: string | null;
  content: string;
  content_hash: string;
  evidence_refs: string[];
  requirement_coverage: string[];
  upstream_artifact_versions: Record<string, unknown>;
  author_type: AuthorType;
  author_id: string | null;
  word_count: number | null;
  created_at: string;
}

// ============================================================
// CLAIM TYPES
// ============================================================

export const CLAIM_TYPES = [
  'PAST_PERFORMANCE', 'TECHNICAL_CAPABILITY', 'CERTIFICATION',
  'CONTRACT_VEHICLE', 'PERSONNEL_QUALIFICATION', 'METRIC',
  'CUSTOMER_RESULT', 'CORPORATE_STATUS', 'IMPLEMENTATION',
  'TECHNICAL_ASSERTION', 'COMMITMENT', 'OTHER',
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VALIDATION_STATUSES = [
  'PENDING', 'SUPPORTED', 'UNSUPPORTED', 'CANDIDATE_EVIDENCE',
] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export interface ProposalClaim {
  id: string;
  section_version_id: string;
  proposal_workspace_id: string;
  claim_text: string;
  claim_type: ClaimType;
  material: boolean;
  evidence_refs: string[];
  validation_status: ValidationStatus;
  idempotency_key: string;
  created_at: string;
}

// ============================================================
// REVIEW TYPES
// ============================================================

export const REVIEW_ROLES = [
  'CONTENT_CAPTURE', 'FINAL_MANAGEMENT', 'TECHNICAL', 'COMPLIANCE', 'EXECUTIVE',
] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

export const REVIEW_STATUSES = [
  'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'INVALIDATED',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface ProposalReview {
  id: string;
  proposal_workspace_id: string;
  target_type: 'SECTION' | 'PROPOSAL';
  target_id: string;
  target_version_id: string | null;
  review_role: ReviewRole;
  reviewer: string;
  status: ReviewStatus;
  comments: string | null;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// SPECIALIST REQUEST TYPES
// ============================================================

export const SPECIALIST_REQUEST_TYPES = [
  'CAPTURE_STRATEGY', 'TECHNICAL_SOLUTION', 'TECHNICAL_FEASIBILITY',
  'COMPETITIVE_INTELLIGENCE', 'PARTNER_INTELLIGENCE', 'TEAMING_INPUT',
  'OPERATIONAL_READINESS', 'ACQUISITION_INTERPRETATION', 'PRICING_INPUT',
] as const;
export type SpecialistRequestType = (typeof SPECIALIST_REQUEST_TYPES)[number];

export const SPECIALIST_REQUEST_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED',
] as const;
export type SpecialistRequestStatus = (typeof SPECIALIST_REQUEST_STATUSES)[number];

export interface ProposalSpecialistRequest {
  id: string;
  proposal_workspace_id: string;
  request_type: SpecialistRequestType;
  target_agent: string;
  request_description: string;
  context: Record<string, unknown>;
  dependency_refs: string[];
  status: SpecialistRequestStatus;
  response_artifact_id: string | null;
  response_artifact_version_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// CONFLICT TYPES
// ============================================================

export const CONFLICT_TYPES = [
  'STRATEGY_VS_TECHNICAL', 'STRATEGY_VS_TEAMING',
  'TECHNICAL_VS_COMPLIANCE', 'EVIDENCE_CONFLICT',
  'REQUIREMENT_CONFLICT', 'OTHER',
] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const CONFLICT_STATUSES = ['OPEN', 'RESOLVED', 'SUPERSEDED'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export interface ProposalConflict {
  id: string;
  proposal_workspace_id: string;
  conflict_type: ConflictType;
  affected_section_ids: string[];
  input_a: Record<string, unknown>;
  input_b: Record<string, unknown>;
  decision_owner: string | null;
  status: ConflictStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// FORM MAPPING TYPES
// ============================================================

export const FORM_MAPPING_STATUSES = [
  'PROPOSED', 'APPROVED', 'REJECTED',
] as const;
export type FormMappingStatus = (typeof FORM_MAPPING_STATUSES)[number];

export const FORM_VALUE_RESOLUTION_STATUSES = [
  'RESOLVED', 'UNRESOLVED', 'HUMAN_INPUT_REQUIRED', 'ERROR',
] as const;
export type FormValueResolutionStatus = (typeof FORM_VALUE_RESOLUTION_STATUSES)[number];

export interface ProposalFormMapping {
  id: string;
  proposal_workspace_id: string;
  form_type: string;
  form_version: string | null;
  field_identifier: string;
  target_data_path: string;
  mapping_status: FormMappingStatus;
  approved_by: string | null;
  approved_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface ProposalFormValue {
  id: string;
  proposal_workspace_id: string;
  form_mapping_id: string;
  resolved_value: Record<string, unknown> | null;
  resolution_status: FormValueResolutionStatus;
  source_evidence_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ARTIFACT TYPES
// ============================================================

export const ARTIFACT_TYPES = [
  'PROPOSAL_DOCX', 'PROPOSAL_PDF', 'PRICING_XLSX',
  'ATTACHMENT', 'FORM', 'PACKAGE',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const REVIEW_STATUS_ARTIFACT = [
  'DRAFT', 'REVIEW_READY', 'APPROVED', 'SUPERSEDED',
] as const;
export type ReviewStatusArtifact = (typeof REVIEW_STATUS_ARTIFACT)[number];

export interface ProposalRenderedArtifact {
  id: string;
  proposal_workspace_id: string;
  artifact_type: ArtifactType;
  version_number: number;
  storage_bucket: string;
  storage_path: string;
  content_hash: string;
  file_size_bytes: number | null;
  source_proposal_version: string | null;
  template_version: string | null;
  solicitation_version: string | null;
  amendment_version: number | null;
  review_status: ReviewStatusArtifact;
  generated_at: string;
  idempotency_key: string;
  created_at: string;
}

// ============================================================
// FILE VERSION TYPES
// ============================================================

export const UPLOAD_SOURCES = ['SYSTEM', 'HUMAN_EDIT'] as const;
export type UploadSource = (typeof UPLOAD_SOURCES)[number];

export const RECONCILIATION_STATUSES = [
  'CURRENT', 'RECONCILIATION_REQUIRED', 'RECONCILED', 'SUPERSEDED',
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface ProposalFileVersion {
  id: string;
  rendered_artifact_id: string;
  version_number: number;
  storage_path: string;
  content_hash: string;
  file_size_bytes: number | null;
  upload_source: UploadSource;
  uploaded_by: string | null;
  reconciliation_status: ReconciliationStatus;
  idempotency_key: string;
  created_at: string;
}

// ============================================================
// SUBMISSION CHECKLIST / GATE TYPES
// ============================================================

export const GATE_TYPES = ['COMPLIANCE', 'EVIDENCE', 'PRODUCTION'] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const CHECK_STATUSES = [
  'PENDING', 'PASSED', 'FAILED', 'WAIVED', 'NOT_APPLICABLE',
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface ProposalChecklistItem {
  id: string;
  proposal_workspace_id: string;
  gate_type: GateType;
  check_id: string;
  check_description: string;
  status: CheckStatus;
  blocking: boolean;
  evidence: Record<string, unknown>;
  last_evaluated_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// AMENDMENT IMPACT TYPES
// ============================================================

export const CHANGE_CLASSES = [
  'NON_MATERIAL', 'MATERIAL_LOCAL', 'MATERIAL_GLOBAL',
] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export const AMENDMENT_STATUSES = [
  'PENDING', 'PROCESSED', 'CAPTURE_REASSESSMENT_REQUIRED',
] as const;
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

export interface ProposalAmendmentImpact {
  id: string;
  proposal_workspace_id: string;
  amendment_version: number;
  source_document_id: string | null;
  source_version_id: string | null;
  change_class: ChangeClass;
  affected_requirement_ids: string[];
  affected_section_ids: string[];
  description: string;
  impact_assessment: Record<string, unknown>;
  status: AmendmentStatus;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// READINESS GATE RESULT TYPES
// ============================================================

export interface ReadinessBlocker {
  gate: GateType;
  check: string;
  reason: string;
}

export interface ReadinessResult {
  ready: boolean;
  blockers: ReadinessBlocker[];
}

// ============================================================
// CONSTANTS
// ============================================================

/** Jodie never makes provider calls in deterministic mode */
export const JODIE_PROVIDER_CALLS = 0;

/** Jodie never makes G2X calls */
export const JODIE_G2X_CALLS = 0;

/** Maximum autonomous revision passes per section before human required */
export const MAX_AUTONOMOUS_PASSES = 2;

/** Proposal observation window budget ceiling (USD) */
export const PROPOSAL_BUDGET_USD = 1.00;

/** Per-task budget ceilings (USD) — all disabled */
export const TASK_BUDGET_CEILINGS = {
  jodie_compliance_analysis: 0.20,
  jodie_outline: 0.10,
  jodie_section_draft: 0.15,
  jodie_section_revision: 0.10,
  jodie_coherence_review: 0.15,
} as const;

// ============================================================
// FEATURE FLAGS (all disabled)
// ============================================================

/** Compliance analysis AI — DISABLED until commissioning */
export const JODIE_COMPLIANCE_ENABLED = false;

/** Section drafting AI — DISABLED until commissioning */
export const JODIE_DRAFTING_ENABLED = false;

/** Document rendering — DISABLED until commissioning */
export const JODIE_DOCUMENT_RENDERING_ENABLED = false;

/** Slack surface — DISABLED until commissioning */
export const JODIE_SLACK_ENABLED = false;

// ============================================================
// AI TASK TYPES (disabled)
// ============================================================

export const JODIE_AI_TASK_TYPES = [
  'jodie_compliance_analysis',
  'jodie_outline',
  'jodie_section_draft',
  'jodie_section_revision',
  'jodie_coherence_review',
] as const;
export type JodieAITaskType = (typeof JODIE_AI_TASK_TYPES)[number];

// ============================================================
// SUPABASE CLIENT TYPE ALIAS
// ============================================================

// Avoids importing @supabase/supabase-js in every file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseClient = any;
