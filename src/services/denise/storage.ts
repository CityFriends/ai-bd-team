/**
 * Denise — Acquisition Intelligence: Storage Layer
 *
 * CRUD operations for acquisition analyses, evaluation models,
 * clause register, risks, clarifications, conflicts, and tasks.
 *
 * All writes use idempotency keys. Analyses are immutable (new versions).
 * Zero LLM calls. Zero provider imports.
 */

import type {
  AcquisitionResearchRequest,
  AcquisitionResearchType,
  AcquisitionTaskType,
  TaskPriority,
  SupabaseClient,
} from './types.js';

// ============================================================
// ACQUISITION TASKS
// ============================================================

export interface CreateTaskParams {
  captureId?: string;
  opportunityId?: string;
  proposalWorkspaceId?: string;
  taskType: AcquisitionTaskType;
  requester: string;
  question?: string;
  researchType: AcquisitionResearchType;
  expectedArtifact?: string;
  evidenceRefs?: unknown[];
  priority?: TaskPriority;
  budgetUsd?: number;
  idempotencyKey: string;
}

export async function createAcquisitionTask(
  supabase: SupabaseClient,
  params: CreateTaskParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_tasks')
    .insert({
      capture_id: params.captureId || null,
      opportunity_id: params.opportunityId || null,
      proposal_workspace_id: params.proposalWorkspaceId || null,
      task_type: params.taskType,
      requester: params.requester,
      question: params.question || null,
      research_type: params.researchType,
      expected_artifact: params.expectedArtifact || null,
      evidence_refs: params.evidenceRefs || [],
      priority: params.priority || 'NORMAL',
      budget_usd: params.budgetUsd || null,
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create acquisition task: ${error.message}`);
  return data.id;
}

export async function createTaskFromRequest(
  supabase: SupabaseClient,
  request: AcquisitionResearchRequest
): Promise<string> {
  return createAcquisitionTask(supabase, {
    captureId: request.captureId,
    opportunityId: request.opportunityId,
    taskType: request.researchType,
    requester: request.requester,
    question: request.question,
    researchType: request.researchType,
    expectedArtifact: request.expectedArtifact,
    evidenceRefs: request.evidenceRefs,
    idempotencyKey: request.idempotencyKey,
  });
}

// ============================================================
// ACQUISITION ANALYSES (immutable, versioned)
// ============================================================

export interface CreateAnalysisParams {
  opportunityId: string;
  captureId?: string;
  proposalWorkspaceId?: string;
  solicitationVersion?: string;
  amendmentVersion?: number;
  contractType?: string;
  competitionType?: string;
  setAside?: string;
  naics?: string;
  sizeStandard?: string;
  vehicle?: string;
  periodOfPerformance?: string;
  optionStructure?: Record<string, unknown>;
  submissionMethod?: string;
  proposalDueDate?: string;
  questionsDueDate?: string;
  sourceRefs?: unknown[];
  interpretation?: Record<string, unknown>;
  acquisitionImplications?: unknown[];
  unresolvedIssues?: unknown[];
  version?: number;
  supersedesId?: string;
  createdBy?: string;
  idempotencyKey: string;
}

export async function createAcquisitionAnalysis(
  supabase: SupabaseClient,
  params: CreateAnalysisParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_analyses')
    .insert({
      opportunity_id: params.opportunityId,
      capture_id: params.captureId || null,
      proposal_workspace_id: params.proposalWorkspaceId || null,
      solicitation_version: params.solicitationVersion || null,
      amendment_version: params.amendmentVersion ?? 0,
      contract_type: params.contractType || null,
      competition_type: params.competitionType || null,
      set_aside: params.setAside || null,
      naics: params.naics || null,
      size_standard: params.sizeStandard || null,
      vehicle: params.vehicle || null,
      period_of_performance: params.periodOfPerformance || null,
      option_structure: params.optionStructure || null,
      submission_method: params.submissionMethod || null,
      proposal_due_date: params.proposalDueDate || null,
      questions_due_date: params.questionsDueDate || null,
      source_refs: params.sourceRefs || [],
      interpretation: params.interpretation || {},
      acquisition_implications: params.acquisitionImplications || [],
      unresolved_issues: params.unresolvedIssues || [],
      version: params.version ?? 1,
      supersedes_id: params.supersedesId || null,
      created_by: params.createdBy || 'denise',
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create acquisition analysis: ${error.message}`);
  return data.id;
}

export async function getLatestAnalysis(
  supabase: SupabaseClient,
  opportunityId: string
): Promise<{ id: string; version: number } | null> {
  const { data } = await supabase
    .from('acquisition_analyses')
    .select('id, version')
    .eq('opportunity_id', opportunityId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  return data || null;
}

// ============================================================
// EVALUATION MODELS
// ============================================================

export interface CreateEvaluationModelParams {
  acquisitionAnalysisId: string;
  opportunityId: string;
  evaluationMethod?: string;
  factors?: unknown[];
  subfactors?: unknown[];
  relativeImportance?: Record<string, unknown>;
  explicitWeighting?: Record<string, unknown>;
  pastPerformanceTreatment?: string;
  priceTreatment?: string;
  sourceRefs?: unknown[];
  acquisitionImplications?: unknown[];
  uncertainty?: unknown[];
  idempotencyKey: string;
}

export async function createEvaluationModel(
  supabase: SupabaseClient,
  params: CreateEvaluationModelParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_evaluation_models')
    .insert({
      acquisition_analysis_id: params.acquisitionAnalysisId,
      opportunity_id: params.opportunityId,
      evaluation_method: params.evaluationMethod || null,
      factors: params.factors || [],
      subfactors: params.subfactors || [],
      relative_importance: params.relativeImportance || {},
      explicit_weighting: params.explicitWeighting || null,
      past_performance_treatment: params.pastPerformanceTreatment || null,
      price_treatment: params.priceTreatment || null,
      source_refs: params.sourceRefs || [],
      acquisition_implications: params.acquisitionImplications || [],
      uncertainty: params.uncertainty || [],
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create evaluation model: ${error.message}`);
  return data.id;
}

// ============================================================
// CLAUSE REGISTER
// ============================================================

export interface CreateClauseParams {
  acquisitionAnalysisId: string;
  opportunityId: string;
  clauseNumber: string;
  authority: string;
  sourceVersion?: string;
  applicability?: string;
  requirement: string;
  operationalImpact?: string;
  recommendedOwner?: string;
  riskSeverity?: string;
  evidenceRefs?: unknown[];
  legalReviewRequired?: boolean;
  actionRequired?: boolean;
  actionType?: string;
  actionDescription?: string;
  actionOwner?: string;
  idempotencyKey: string;
}

export async function createClauseRegisterEntry(
  supabase: SupabaseClient,
  params: CreateClauseParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_clause_register')
    .insert({
      acquisition_analysis_id: params.acquisitionAnalysisId,
      opportunity_id: params.opportunityId,
      clause_number: params.clauseNumber,
      authority: params.authority,
      source_version: params.sourceVersion || null,
      applicability: params.applicability || null,
      requirement: params.requirement,
      operational_impact: params.operationalImpact || null,
      recommended_owner: params.recommendedOwner || null,
      risk_severity: params.riskSeverity || 'LOW',
      evidence_refs: params.evidenceRefs || [],
      legal_review_required: params.legalReviewRequired ?? false,
      action_required: params.actionRequired ?? false,
      action_type: params.actionType || null,
      action_description: params.actionDescription || null,
      action_owner: params.actionOwner || null,
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create clause register entry: ${error.message}`);
  return data.id;
}

// ============================================================
// ACQUISITION RISKS
// ============================================================

export interface CreateRiskParams {
  acquisitionAnalysisId: string;
  opportunityId: string;
  riskType: string;
  severity: string;
  sourceRefs?: unknown[];
  sourceFact: string;
  interpretation: string;
  operationalImpact: string;
  affectedOwner?: string;
  affectedWorkflow?: string;
  potentiallyDisqualifying?: boolean;
  legalReviewRequired?: boolean;
  idempotencyKey: string;
}

export async function createAcquisitionRisk(
  supabase: SupabaseClient,
  params: CreateRiskParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_risks')
    .insert({
      acquisition_analysis_id: params.acquisitionAnalysisId,
      opportunity_id: params.opportunityId,
      risk_type: params.riskType,
      severity: params.severity,
      source_refs: params.sourceRefs || [],
      source_fact: params.sourceFact,
      interpretation: params.interpretation,
      operational_impact: params.operationalImpact,
      affected_owner: params.affectedOwner || null,
      affected_workflow: params.affectedWorkflow || null,
      potentially_disqualifying: params.potentiallyDisqualifying ?? false,
      legal_review_required: params.legalReviewRequired ?? false,
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create acquisition risk: ${error.message}`);
  return data.id;
}

// ============================================================
// CLARIFICATION QUESTIONS
// ============================================================

export interface CreateClarificationParams {
  acquisitionAnalysisId: string;
  opportunityId: string;
  sourceSection: string;
  evidenceRefs?: unknown[];
  ambiguity: string;
  conflictingLanguage?: string;
  operationalImpact: string;
  affectedArea?: string;
  proposedQuestion: string;
  priority?: string;
  questionDeadline?: string;
  classification: string;
  idempotencyKey: string;
}

export async function createClarificationQuestion(
  supabase: SupabaseClient,
  params: CreateClarificationParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_clarification_questions')
    .insert({
      acquisition_analysis_id: params.acquisitionAnalysisId,
      opportunity_id: params.opportunityId,
      source_section: params.sourceSection,
      evidence_refs: params.evidenceRefs || [],
      ambiguity: params.ambiguity,
      conflicting_language: params.conflictingLanguage || null,
      operational_impact: params.operationalImpact,
      affected_area: params.affectedArea || null,
      proposed_question: params.proposedQuestion,
      priority: params.priority || 'NORMAL',
      question_deadline: params.questionDeadline || null,
      classification: params.classification,
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create clarification question: ${error.message}`);
  return data.id;
}

// ============================================================
// ACQUISITION CONFLICTS
// ============================================================

export interface CreateConflictParams {
  acquisitionAnalysisId?: string;
  opportunityId: string;
  acquisitionArtifactId: string;
  conflictingArtifactType: string;
  conflictingArtifactId: string;
  sourceRefs?: unknown[];
  conflictDescription: string;
  affectedOwners: string[];
  decisionOwner?: string;
  idempotencyKey: string;
}

export async function createAcquisitionConflict(
  supabase: SupabaseClient,
  params: CreateConflictParams
): Promise<string> {
  const { data, error } = await supabase
    .from('acquisition_conflicts')
    .insert({
      acquisition_analysis_id: params.acquisitionAnalysisId || null,
      opportunity_id: params.opportunityId,
      acquisition_artifact_id: params.acquisitionArtifactId,
      conflicting_artifact_type: params.conflictingArtifactType,
      conflicting_artifact_id: params.conflictingArtifactId,
      source_refs: params.sourceRefs || [],
      conflict_description: params.conflictDescription,
      affected_owners: params.affectedOwners,
      decision_owner: params.decisionOwner || null,
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create acquisition conflict: ${error.message}`);
  return data.id;
}
