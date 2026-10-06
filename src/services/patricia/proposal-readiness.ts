/**
 * Patricia Proposal Readiness
 *
 * Operational stage management for proposals.
 * Patricia owns operational stage management.
 * Actual external submission requires explicit human confirmation.
 * Patricia cannot infer SUBMITTED from silence or elapsed time.
 *
 * Zero LLM calls.
 */

import type { SupabaseClient, ProposalStage, ProposalReadiness } from './types.js';
import { recordAction } from './operational-actions.js';

/**
 * Initialize proposal readiness for a newly created workspace.
 * Idempotent via proposal_workspace_id UNIQUE constraint.
 */
export async function initializeProposalReadiness(
  supabase: SupabaseClient,
  input: {
    proposalWorkspaceId: string;
    captureId: string;
    opportunityId: string;
    hasActionableSolicitation?: boolean;
    governmentDeadline?: string;
  }
): Promise<{ id: string; isNew: boolean }> {
  const stage: ProposalStage = input.hasActionableSolicitation ? 'INTAKE' : 'PRE_SOLICITATION';

  const { data: rows, error } = await supabase
    .from('patricia_proposal_readiness')
    .upsert(
      {
        proposal_workspace_id: input.proposalWorkspaceId,
        capture_id: input.captureId,
        opportunity_id: input.opportunityId,
        stage,
        has_actionable_solicitation: input.hasActionableSolicitation || false,
        solicitation_received_at: input.hasActionableSolicitation ? new Date().toISOString() : null,
        government_deadline: input.governmentDeadline || null,
        idempotency_key: `readiness-${input.proposalWorkspaceId}`,
      },
      { onConflict: 'proposal_workspace_id', ignoreDuplicates: true }
    )
    .select('id');

  if (error && !error.message?.includes('duplicate') && !error.message?.includes('coerce')) {
    throw new Error(`[Patricia] Failed to initialize readiness: ${error.message}`);
  }

  const newRow = rows?.[0];
  const isNew = !!newRow;

  if (isNew && newRow) {
    await recordAction(supabase, {
      idempotencyKey: `action-readiness-init-${input.proposalWorkspaceId}`,
      actionType: 'PROPOSAL_STAGE_CHANGED',
      targetType: 'patricia_proposal_readiness',
      targetId: newRow.id,
      evidence: { stage, hasActionableSolicitation: input.hasActionableSolicitation },
      result: { readinessId: newRow.id, stage },
    });
    return { id: newRow.id, isNew: true };
  }

  // Not new — fetch existing
  const { data: existing } = await supabase
    .from('patricia_proposal_readiness')
    .select('id')
    .eq('proposal_workspace_id', input.proposalWorkspaceId)
    .single();
  return { id: existing?.id || '', isNew: false };
}

/**
 * Advance proposal stage. Only forward transitions permitted.
 * SUBMITTED requires explicit human confirmation.
 */
export async function advanceProposalStage(
  supabase: SupabaseClient,
  proposalWorkspaceId: string,
  newStage: ProposalStage,
  confirmedBy?: string
): Promise<boolean> {
  const { data: current } = await supabase
    .from('patricia_proposal_readiness')
    .select('id, stage')
    .eq('proposal_workspace_id', proposalWorkspaceId)
    .single();

  if (!current) return false;

  // SUBMITTED requires human confirmation
  if (newStage === 'SUBMITTED' && !confirmedBy) {
    console.warn('[Patricia] Cannot advance to SUBMITTED without human confirmation');
    return false;
  }

  const stageOrder: Record<ProposalStage, number> = {
    PRE_SOLICITATION: 0,
    INTAKE: 1,
    REQUIREMENTS_ANALYSIS: 2,
    DRAFTING: 3,
    REVIEW: 4,
    FINALIZATION: 5,
    READY_TO_SUBMIT: 6,
    SUBMITTED: 7,
  };

  // Only forward transitions
  if (stageOrder[newStage] <= stageOrder[current.stage as ProposalStage]) {
    return false;
  }

  const update: Record<string, unknown> = {
    stage: newStage,
    stage_entered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (newStage === 'SUBMITTED' && confirmedBy) {
    update.submission_confirmed_by = confirmedBy;
    update.submission_confirmed_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('patricia_proposal_readiness')
    .update(update)
    .eq('id', current.id);

  if (error) {
    throw new Error(`[Patricia] Failed to advance stage: ${error.message}`);
  }

  await recordAction(supabase, {
    idempotencyKey: `action-stage-${proposalWorkspaceId}-${newStage}`,
    actionType: 'PROPOSAL_STAGE_CHANGED',
    targetType: 'patricia_proposal_readiness',
    targetId: current.id,
    evidence: { previousStage: current.stage, newStage, confirmedBy },
    result: { stage: newStage },
  });

  return true;
}

/**
 * Record actionable solicitation received.
 * Advances from PRE_SOLICITATION to INTAKE if appropriate.
 */
export async function recordSolicitationReceived(
  supabase: SupabaseClient,
  proposalWorkspaceId: string,
  governmentDeadline?: string
): Promise<boolean> {
  const { data: current } = await supabase
    .from('patricia_proposal_readiness')
    .select('id, stage, has_actionable_solicitation')
    .eq('proposal_workspace_id', proposalWorkspaceId)
    .single();

  if (!current) return false;

  // Already has solicitation
  if (current.has_actionable_solicitation) return false;

  const update: Record<string, unknown> = {
    has_actionable_solicitation: true,
    solicitation_received_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (governmentDeadline) {
    update.government_deadline = governmentDeadline;
  }

  // Advance from PRE_SOLICITATION to INTAKE
  if (current.stage === 'PRE_SOLICITATION') {
    update.stage = 'INTAKE';
    update.stage_entered_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('patricia_proposal_readiness')
    .update(update)
    .eq('id', current.id);

  if (error) {
    throw new Error(`[Patricia] Failed to record solicitation: ${error.message}`);
  }

  return true;
}

/**
 * Get proposal readiness state.
 */
export async function getProposalReadiness(
  supabase: SupabaseClient,
  proposalWorkspaceId: string
): Promise<ProposalReadiness | null> {
  const { data, error } = await supabase
    .from('patricia_proposal_readiness')
    .select('*')
    .eq('proposal_workspace_id', proposalWorkspaceId)
    .single();

  if (error || !data) return null;
  return data as ProposalReadiness;
}

/**
 * Get all active proposals (not yet submitted).
 */
export async function getActiveProposals(
  supabase: SupabaseClient
): Promise<ProposalReadiness[]> {
  const { data, error } = await supabase
    .from('patricia_proposal_readiness')
    .select('*')
    .neq('stage', 'SUBMITTED');

  if (error) {
    throw new Error(`[Patricia] Failed to get active proposals: ${error.message}`);
  }

  return (data || []) as ProposalReadiness[];
}
