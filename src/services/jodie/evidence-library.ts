/**
 * Jodie Evidence Library
 *
 * Manages approved evidence items that Jodie may reference in proposal
 * content. Every claim in a proposal must trace to an approved evidence
 * item. Evidence requires human verification before use.
 *
 * Authority:
 *   Jodie MAY register and query evidence.
 *   Jodie MAY NOT invent evidence, past performance, resumes,
 *   certifications, metrics, or pricing.
 *   Jodie MAY NOT use evidence that is not proposal_usable=true.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  EvidenceType,
  Sensitivity,
  ProposalEvidenceItem,
} from './types.js';

// ============================================================
// Input Types
// ============================================================

export interface RegisterEvidenceInput {
  idempotencyKey: string;
  proposalWorkspaceId: string;
  evidenceType: EvidenceType;
  sourceType: string;
  sourceId: string;
  sourceVersionId?: string;
  title: string;
  value?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  effectiveFrom?: string;
  effectiveTo?: string;
  sensitivity?: Sensitivity;
  allowedUseScope?: string;
}

// ============================================================
// Operations
// ============================================================

/**
 * Register an evidence item idempotently via UNIQUE(idempotency_key).
 * New evidence is NOT usable until explicitly approved.
 */
export async function registerEvidence(
  supabase: SupabaseClient,
  input: RegisterEvidenceInput
): Promise<string> {
  // Check for existing record first (idempotency)
  const { data: existing } = await supabase
    .from('proposal_evidence_items')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from('proposal_evidence_items')
    .insert({
      proposal_workspace_id: input.proposalWorkspaceId,
      evidence_type: input.evidenceType,
      source_type: input.sourceType,
      source_id: input.sourceId,
      source_version_id: input.sourceVersionId || null,
      title: input.title,
      value: input.value || {},
      provenance: input.provenance || {},
      effective_from: input.effectiveFrom || null,
      effective_to: input.effectiveTo || null,
      human_verified: false,
      proposal_usable: false,
      sensitivity: input.sensitivity || 'INTERNAL',
      allowed_use_scope: input.allowedUseScope || null,
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_evidence_items')
        .select('id')
        .eq('idempotency_key', input.idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to register evidence: ${error.message}`);
  }

  return data.id;
}

/**
 * Approve an evidence item for proposal use.
 * Sets proposal_usable=true and human_verified=true.
 */
export async function approveEvidence(
  supabase: SupabaseClient,
  evidenceId: string,
  approvedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('proposal_evidence_items')
    .update({
      proposal_usable: true,
      human_verified: true,
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', evidenceId);

  if (error) {
    throw new Error(`[Jodie] Failed to approve evidence ${evidenceId}: ${error.message}`);
  }
}

/**
 * Get all usable evidence for a workspace, optionally filtered by type.
 * Only returns evidence where proposal_usable=true.
 */
export async function getUsableEvidence(
  supabase: SupabaseClient,
  workspaceId: string,
  evidenceType?: EvidenceType
): Promise<ProposalEvidenceItem[]> {
  let query = supabase
    .from('proposal_evidence_items')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .eq('proposal_usable', true);

  if (evidenceType) {
    query = query.eq('evidence_type', evidenceType);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[Jodie] Failed to get usable evidence for workspace ${workspaceId}: ${error.message}`);
  }

  return (data || []) as ProposalEvidenceItem[];
}

/**
 * Check if a specific evidence item is approved (human_verified + proposal_usable).
 * Used as a gate for past_performance and resume evidence.
 */
export async function isEvidenceApproved(
  supabase: SupabaseClient,
  evidenceId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('proposal_evidence_items')
    .select('human_verified, proposal_usable')
    .eq('id', evidenceId)
    .maybeSingle();

  if (error) {
    throw new Error(`[Jodie] Failed to check evidence approval ${evidenceId}: ${error.message}`);
  }

  if (!data) return false;
  return data.human_verified === true && data.proposal_usable === true;
}
