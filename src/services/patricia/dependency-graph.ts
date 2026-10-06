/**
 * Patricia Dependency Graph
 *
 * Manages dependency relationships between commitments, tasks,
 * decisions, and artifacts. Dependency satisfaction is atomic —
 * when all blockers are cleared, downstream work becomes READY.
 *
 * Zero LLM calls.
 */

import type {
  SupabaseClient,
  Dependency,
  DependencyTargetType,
} from './types.js';

export interface CreateDependencyInput {
  idempotencyKey: string;
  commitmentId: string;
  dependsOnType: DependencyTargetType;
  dependsOnId: string;
}

/**
 * Create a dependency idempotently via RPC.
 */
export async function createDependency(
  supabase: SupabaseClient,
  input: CreateDependencyInput
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_patricia_dependency', {
    p_idempotency_key: input.idempotencyKey,
    p_commitment_id: input.commitmentId,
    p_depends_on_type: input.dependsOnType,
    p_depends_on_id: input.dependsOnId,
  });

  if (error) {
    throw new Error(`[Patricia] Failed to create dependency: ${error.message}`);
  }

  return data as string;
}

/**
 * Satisfy all dependencies matching a given target.
 * Returns which commitments are now fully unblocked.
 *
 * Uses atomic SQL function to prevent race conditions.
 */
export async function satisfyDependency(
  supabase: SupabaseClient,
  dependsOnType: DependencyTargetType,
  dependsOnId: string,
  satisfiedBy: string
): Promise<Array<{ dependencyId: string; commitmentId: string; fullyUnblocked: boolean }>> {
  const { data, error } = await supabase.rpc('satisfy_patricia_dependency', {
    p_depends_on_type: dependsOnType,
    p_depends_on_id: dependsOnId,
    p_satisfied_by: satisfiedBy,
  });

  if (error) {
    throw new Error(`[Patricia] Failed to satisfy dependency: ${error.message}`);
  }

  return ((data || []) as Array<{
    dependency_id: string;
    commitment_id: string;
    remaining_blocked: number;
  }>).map(row => ({
    dependencyId: row.dependency_id,
    commitmentId: row.commitment_id,
    fullyUnblocked: row.remaining_blocked === 0,
  }));
}

/**
 * Cancel dependencies for a commitment.
 */
export async function cancelDependenciesForCommitment(
  supabase: SupabaseClient,
  commitmentId: string,
  reason: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('patricia_dependencies')
    .update({
      status: 'CANCELLED',
      cancelled_at: now,
      cancellation_reason: reason,
      updated_at: now,
    })
    .eq('commitment_id', commitmentId)
    .eq('status', 'BLOCKED')
    .select('id');

  if (error) {
    throw new Error(`[Patricia] Failed to cancel dependencies: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Get blocked dependencies for a commitment.
 */
export async function getBlockedDependencies(
  supabase: SupabaseClient,
  commitmentId: string
): Promise<Dependency[]> {
  const { data, error } = await supabase
    .from('patricia_dependencies')
    .select('*')
    .eq('commitment_id', commitmentId)
    .eq('status', 'BLOCKED');

  if (error) {
    throw new Error(`[Patricia] Failed to get blocked dependencies: ${error.message}`);
  }

  return (data || []) as Dependency[];
}

/**
 * Get all blocked work across the portfolio (for reconciliation).
 */
export async function getAllBlockedDependencies(
  supabase: SupabaseClient
): Promise<Dependency[]> {
  const { data, error } = await supabase
    .from('patricia_dependencies')
    .select('*')
    .eq('status', 'BLOCKED');

  if (error) {
    throw new Error(`[Patricia] Failed to get all blocked dependencies: ${error.message}`);
  }

  return (data || []) as Dependency[];
}
