/**
 * Jodie Claim Tracker
 *
 * Manages claim provenance — every material assertion in a proposal
 * must trace to approved evidence. Unsupported material claims block
 * submission readiness.
 *
 * Authority:
 *   Jodie MAY register and validate claims.
 *   Jodie MAY NOT fabricate evidence to support a claim.
 *   Jodie MAY NOT mark a claim as SUPPORTED without valid evidence refs.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  ClaimType,
  ProposalClaim,
} from './types.js';

// ============================================================
// Input Types
// ============================================================

export interface RegisterClaimInput {
  idempotencyKey: string;
  sectionVersionId: string;
  proposalWorkspaceId: string;
  claimText: string;
  claimType: ClaimType;
  material?: boolean;
  evidenceRefs?: string[];
}

// ============================================================
// Operations
// ============================================================

/**
 * Register a claim idempotently via UNIQUE(idempotency_key).
 * New claims start with validation_status=PENDING.
 */
export async function registerClaim(
  supabase: SupabaseClient,
  input: RegisterClaimInput
): Promise<string> {
  // Check for existing record first (idempotency)
  const { data: existing } = await supabase
    .from('proposal_claims')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from('proposal_claims')
    .insert({
      section_version_id: input.sectionVersionId,
      proposal_workspace_id: input.proposalWorkspaceId,
      claim_text: input.claimText,
      claim_type: input.claimType,
      material: input.material ?? true,
      evidence_refs: input.evidenceRefs || [],
      validation_status: 'PENDING',
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_claims')
        .select('id')
        .eq('idempotency_key', input.idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to register claim: ${error.message}`);
  }

  return data.id;
}

/**
 * Validate a claim by linking it to evidence.
 * Sets validation_status to SUPPORTED if evidence refs are non-empty,
 * UNSUPPORTED otherwise.
 */
export async function validateClaim(
  supabase: SupabaseClient,
  claimId: string,
  evidenceRefs: string[]
): Promise<void> {
  const validationStatus = evidenceRefs.length > 0 ? 'SUPPORTED' : 'UNSUPPORTED';

  const { error } = await supabase
    .from('proposal_claims')
    .update({
      evidence_refs: evidenceRefs,
      validation_status: validationStatus,
    })
    .eq('id', claimId);

  if (error) {
    throw new Error(`[Jodie] Failed to validate claim ${claimId}: ${error.message}`);
  }
}

/**
 * Get all unsupported material claims for a workspace.
 * These are submission blockers.
 */
export async function getUnsupportedClaims(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ProposalClaim[]> {
  const { data, error } = await supabase
    .from('proposal_claims')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .eq('material', true)
    .eq('validation_status', 'UNSUPPORTED')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[Jodie] Failed to get unsupported claims for workspace ${workspaceId}: ${error.message}`);
  }

  return (data || []) as ProposalClaim[];
}

/**
 * Check if there are any unsupported material claims.
 * Returns true if at least one exists — a submission blocker.
 */
export async function hasUnsupportedMaterialClaims(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('proposal_claims')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('material', true)
    .eq('validation_status', 'UNSUPPORTED');

  if (error) {
    throw new Error(`[Jodie] Failed to check unsupported claims for workspace ${workspaceId}: ${error.message}`);
  }

  return (count || 0) > 0;
}
