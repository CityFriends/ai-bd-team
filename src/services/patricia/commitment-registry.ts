/**
 * Patricia Commitment Registry
 *
 * Durable commitment/deadline management. All operations are
 * idempotent via database constraints. Zero LLM calls.
 */

import type {
  SupabaseClient,
  Commitment,
  CommitmentType,
  OwnerType,
  SourceType,
  HardOrSoft,
  CommitmentStatus,
  EscalationLevel,
} from './types.js';

export interface CreateCommitmentInput {
  idempotencyKey: string;
  opportunityId?: string;
  captureId?: string;
  proposalWorkspaceId?: string;
  title: string;
  commitmentType: CommitmentType;
  ownerType: OwnerType;
  ownerId: string;
  sourceType: SourceType;
  sourceId: string;
  sourceVersionId?: string;
  dueAt: string;
  timezone?: string;
  hardOrSoft?: HardOrSoft;
  provenance?: Record<string, unknown>;
}

/**
 * Create a commitment idempotently via RPC.
 * Returns the commitment ID (existing or new).
 */
export async function createCommitment(
  supabase: SupabaseClient,
  input: CreateCommitmentInput
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_patricia_commitment', {
    p_idempotency_key: input.idempotencyKey,
    p_opportunity_id: input.opportunityId || null,
    p_capture_id: input.captureId || null,
    p_proposal_workspace_id: input.proposalWorkspaceId || null,
    p_title: input.title,
    p_commitment_type: input.commitmentType,
    p_owner_type: input.ownerType,
    p_owner_id: input.ownerId,
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_source_version_id: input.sourceVersionId || null,
    p_due_at: input.dueAt,
    p_timezone: input.timezone || 'America/New_York',
    p_hard_or_soft: input.hardOrSoft || 'HARD',
    p_provenance: input.provenance || {},
  });

  if (error) {
    throw new Error(`[Patricia] Failed to create commitment: ${error.message}`);
  }

  return data as string;
}

/**
 * Update commitment status. Idempotent — same status transition is a no-op.
 */
export async function updateCommitmentStatus(
  supabase: SupabaseClient,
  commitmentId: string,
  status: CommitmentStatus,
  extra?: {
    completedAt?: string;
    cancelledAt?: string;
    cancellationReason?: string;
    cancellationEventId?: string;
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (extra?.completedAt) update.completed_at = extra.completedAt;
  if (extra?.cancelledAt) update.cancelled_at = extra.cancelledAt;
  if (extra?.cancellationReason) update.cancellation_reason = extra.cancellationReason;
  if (extra?.cancellationEventId) update.cancellation_event_id = extra.cancellationEventId;

  const { error } = await supabase
    .from('patricia_commitments')
    .update(update)
    .eq('id', commitmentId);

  if (error) {
    throw new Error(`[Patricia] Failed to update commitment ${commitmentId}: ${error.message}`);
  }
}

/**
 * Update commitment escalation level.
 */
export async function updateCommitmentEscalation(
  supabase: SupabaseClient,
  commitmentId: string,
  escalationLevel: EscalationLevel
): Promise<void> {
  const { error } = await supabase
    .from('patricia_commitments')
    .update({
      escalation_level: escalationLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', commitmentId);

  if (error) {
    throw new Error(`[Patricia] Failed to update escalation for ${commitmentId}: ${error.message}`);
  }
}

/**
 * Get active commitments for an opportunity.
 */
export async function getCommitmentsForOpportunity(
  supabase: SupabaseClient,
  opportunityId: string
): Promise<Commitment[]> {
  const { data, error } = await supabase
    .from('patricia_commitments')
    .select('*')
    .eq('opportunity_id', opportunityId)
    .in('status', ['PENDING', 'IN_PROGRESS', 'OVERDUE']);

  if (error) {
    throw new Error(`[Patricia] Failed to get commitments: ${error.message}`);
  }

  return (data || []) as Commitment[];
}

/**
 * Get overdue commitments across the portfolio.
 */
export async function getOverdueCommitments(
  supabase: SupabaseClient
): Promise<Commitment[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('patricia_commitments')
    .select('*')
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .lt('due_at', now);

  if (error) {
    throw new Error(`[Patricia] Failed to get overdue commitments: ${error.message}`);
  }

  return (data || []) as Commitment[];
}

/**
 * Get commitments approaching deadline within a window.
 */
export async function getUpcomingCommitments(
  supabase: SupabaseClient,
  withinDays: number
): Promise<Commitment[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('patricia_commitments')
    .select('*')
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .gte('due_at', now.toISOString())
    .lte('due_at', cutoff)
    .order('due_at', { ascending: true });

  if (error) {
    throw new Error(`[Patricia] Failed to get upcoming commitments: ${error.message}`);
  }

  return (data || []) as Commitment[];
}

/**
 * Cancel commitments associated with an opportunity/capture.
 * Used for NO_GO, dismissed, etc. Returns count cancelled.
 */
export async function cancelCommitmentsForCapture(
  supabase: SupabaseClient,
  captureId: string,
  reason: string,
  triggeringEventId: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('patricia_commitments')
    .update({
      status: 'CANCELLED',
      cancelled_at: now,
      cancellation_reason: reason,
      cancellation_event_id: triggeringEventId,
      updated_at: now,
    })
    .eq('capture_id', captureId)
    .in('status', ['PENDING', 'IN_PROGRESS', 'OVERDUE'])
    .select('id');

  if (error) {
    throw new Error(`[Patricia] Failed to cancel commitments for capture ${captureId}: ${error.message}`);
  }

  return data?.length || 0;
}
