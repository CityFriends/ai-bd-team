/**
 * Jodie Compliance Matrix
 *
 * Manages proposal requirements and compliance state. Every solicitation
 * requirement is a durable structured record with status, risk level,
 * evidence linkage, and amendment versioning.
 *
 * Authority:
 *   Jodie MAY create, update, and query requirements.
 *   Jodie MAY NOT invent requirements not sourced from solicitation documents.
 *   Jodie MAY NOT waive mandatory requirements.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  RequirementType,
  RequirementStatus,
  ComplianceRisk,
  InterpretationStatus,
  ProposalRequirement,
} from './types.js';

// ============================================================
// Input Types
// ============================================================

export interface CreateRequirementInput {
  idempotencyKey: string;
  proposalWorkspaceId: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  sourcePage?: string;
  sourceSection?: string;
  requirementText: string;
  requirementType: RequirementType;
  mandatory?: boolean;
  evaluationFactor?: string;
  responseLocation?: string;
  ownerType?: string;
  ownerId?: string;
  complianceRisk?: ComplianceRisk;
  interpretationStatus?: InterpretationStatus;
  amendmentVersion?: number;
}

// ============================================================
// Operations
// ============================================================

/**
 * Create a requirement idempotently via UNIQUE(idempotency_key).
 * If the key already exists, returns the existing record.
 */
export async function createRequirement(
  supabase: SupabaseClient,
  input: CreateRequirementInput
): Promise<string> {
  // Check for existing record first (idempotency)
  const { data: existing } = await supabase
    .from('proposal_requirements')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from('proposal_requirements')
    .insert({
      proposal_workspace_id: input.proposalWorkspaceId,
      source_document_id: input.sourceDocumentId || null,
      source_version_id: input.sourceVersionId || null,
      source_page: input.sourcePage || null,
      source_section: input.sourceSection || null,
      requirement_text: input.requirementText,
      requirement_type: input.requirementType,
      mandatory: input.mandatory ?? true,
      evaluation_factor: input.evaluationFactor || null,
      response_location: input.responseLocation || null,
      owner_type: input.ownerType || null,
      owner_id: input.ownerId || null,
      compliance_risk: input.complianceRisk || 'NONE',
      interpretation_status: input.interpretationStatus || 'PENDING',
      amendment_version: input.amendmentVersion ?? 0,
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    // Handle race condition: another process may have inserted between check and insert
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_requirements')
        .select('id')
        .eq('idempotency_key', input.idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to create requirement: ${error.message}`);
  }

  return data.id;
}

/**
 * Update requirement status with optional extra fields.
 * Idempotent — same status transition is a no-op.
 */
export async function updateRequirementStatus(
  supabase: SupabaseClient,
  requirementId: string,
  status: RequirementStatus,
  extra?: {
    complianceRisk?: ComplianceRisk;
    evidenceRefs?: string[];
    interpretationStatus?: InterpretationStatus;
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (extra?.complianceRisk !== undefined) update.compliance_risk = extra.complianceRisk;
  if (extra?.evidenceRefs !== undefined) update.evidence_refs = extra.evidenceRefs;
  if (extra?.interpretationStatus !== undefined) update.interpretation_status = extra.interpretationStatus;

  const { error } = await supabase
    .from('proposal_requirements')
    .update(update)
    .eq('id', requirementId);

  if (error) {
    throw new Error(`[Jodie] Failed to update requirement ${requirementId}: ${error.message}`);
  }
}

/**
 * Get all requirements for a proposal workspace.
 */
export async function getRequirementsForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ProposalRequirement[]> {
  const { data, error } = await supabase
    .from('proposal_requirements')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[Jodie] Failed to get requirements for workspace ${workspaceId}: ${error.message}`);
  }

  return (data || []) as ProposalRequirement[];
}

/**
 * Get compliance risks: mandatory requirements with GAP or COMPLIANCE_RISK status.
 * These are blockers for submission readiness.
 */
export async function getComplianceRisks(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ProposalRequirement[]> {
  const { data, error } = await supabase
    .from('proposal_requirements')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .eq('mandatory', true)
    .in('status', ['GAP', 'COMPLIANCE_RISK'])
    .order('compliance_risk', { ascending: false });

  if (error) {
    throw new Error(`[Jodie] Failed to get compliance risks for workspace ${workspaceId}: ${error.message}`);
  }

  return (data || []) as ProposalRequirement[];
}

/**
 * Mark requirements as superseded by an amendment.
 * Sets status to SUPERSEDED for the given requirement IDs.
 */
export async function supersededByAmendment(
  supabase: SupabaseClient,
  workspaceId: string,
  amendmentVersion: number,
  affectedIds: string[]
): Promise<void> {
  if (affectedIds.length === 0) return;

  const { error } = await supabase
    .from('proposal_requirements')
    .update({
      status: 'SUPERSEDED',
      amendment_version: amendmentVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('proposal_workspace_id', workspaceId)
    .in('id', affectedIds);

  if (error) {
    throw new Error(`[Jodie] Failed to supersede requirements for amendment ${amendmentVersion}: ${error.message}`);
  }
}
