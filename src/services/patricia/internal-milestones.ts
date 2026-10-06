/**
 * Patricia Internal Milestone Planning
 *
 * Configurable deterministic backward planning from the government
 * submission deadline. Human overrides are authoritative and
 * persisted with full audit trail.
 *
 * Zero LLM calls.
 */

import type {
  SupabaseClient,
  MilestoneType,
  InternalMilestone,
  MilestoneStatus,
} from './types.js';
import { DEFAULT_MILESTONE_SCHEDULE } from './types.js';
import { recordAction } from './operational-actions.js';

/**
 * Generate milestone plan for a proposal workspace.
 * Backward-plans from the government deadline.
 * Idempotent — skips milestones that already exist.
 */
export async function generateMilestonePlan(
  supabase: SupabaseClient,
  input: {
    proposalWorkspaceId: string;
    captureId?: string;
    opportunityId?: string;
    governmentDeadline: string;
    schedule?: Array<{ type: MilestoneType; title: string; offsetDays: number }>;
  }
): Promise<{ created: number; skipped: number }> {
  const schedule = input.schedule || DEFAULT_MILESTONE_SCHEDULE;
  const deadline = new Date(input.governmentDeadline);

  let created = 0;
  let skipped = 0;

  for (const milestone of schedule) {
    const plannedDate = new Date(deadline.getTime() - milestone.offsetDays * 24 * 60 * 60 * 1000);
    const idempotencyKey = `milestone-${input.proposalWorkspaceId}-${milestone.type}`;

    const { data, error } = await supabase
      .from('patricia_internal_milestones')
      .upsert(
        {
          proposal_workspace_id: input.proposalWorkspaceId,
          capture_id: input.captureId || null,
          opportunity_id: input.opportunityId || null,
          milestone_type: milestone.type,
          title: milestone.title,
          planned_date: plannedDate.toISOString(),
          offset_days_before_deadline: milestone.offsetDays,
          idempotency_key: idempotencyKey,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true }
      )
      .select('id')
      .single();

    if (error && !error.message?.includes('duplicate')) {
      console.error(`[Patricia] Failed to create milestone ${milestone.type}:`, error.message);
      continue;
    }

    if (data) {
      created++;
      await recordAction(supabase, {
        idempotencyKey: `action-milestone-${idempotencyKey}`,
        actionType: 'MILESTONE_CREATED',
        targetType: 'patricia_internal_milestones',
        targetId: data.id,
        evidence: {
          milestoneType: milestone.type,
          governmentDeadline: input.governmentDeadline,
          offsetDays: milestone.offsetDays,
        },
        result: { milestoneId: data.id, plannedDate: plannedDate.toISOString() },
      });
    } else {
      skipped++;
    }
  }

  return { created, skipped };
}

/**
 * Override a milestone date. The override is persisted with
 * previous value, new value, actor, timestamp, and reason.
 * Human override is authoritative.
 */
export async function overrideMilestoneDate(
  supabase: SupabaseClient,
  milestoneId: string,
  newDate: string,
  actor: string,
  reason: string
): Promise<boolean> {
  // Get current milestone
  const { data: current } = await supabase
    .from('patricia_internal_milestones')
    .select('planned_date')
    .eq('id', milestoneId)
    .single();

  if (!current) return false;

  // Record the override (immutable)
  const { error: overrideErr } = await supabase
    .from('patricia_milestone_overrides')
    .insert({
      milestone_id: milestoneId,
      previous_date: current.planned_date,
      new_date: newDate,
      actor,
      reason,
    });

  if (overrideErr) {
    throw new Error(`[Patricia] Failed to record override: ${overrideErr.message}`);
  }

  // Update milestone
  const { error } = await supabase
    .from('patricia_internal_milestones')
    .update({
      planned_date: newDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', milestoneId);

  if (error) {
    throw new Error(`[Patricia] Failed to update milestone: ${error.message}`);
  }

  await recordAction(supabase, {
    idempotencyKey: `action-override-${milestoneId}-${new Date().toISOString()}`,
    actionType: 'MILESTONE_UPDATED',
    targetType: 'patricia_internal_milestones',
    targetId: milestoneId,
    evidence: {
      previousDate: current.planned_date,
      newDate,
      actor,
      reason,
      isHumanOverride: true,
    },
    result: { overrideApplied: true },
  });

  return true;
}

/**
 * Complete a milestone.
 */
export async function completeMilestone(
  supabase: SupabaseClient,
  milestoneId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('patricia_internal_milestones')
    .update({
      status: 'COMPLETED' as MilestoneStatus,
      actual_date: now,
      updated_at: now,
    })
    .eq('id', milestoneId)
    .in('status', ['PLANNED', 'IN_PROGRESS', 'OVERDUE']);

  if (error) {
    throw new Error(`[Patricia] Failed to complete milestone: ${error.message}`);
  }

  return true;
}

/**
 * Get milestones for a workspace.
 */
export async function getMilestones(
  supabase: SupabaseClient,
  proposalWorkspaceId: string
): Promise<InternalMilestone[]> {
  const { data, error } = await supabase
    .from('patricia_internal_milestones')
    .select('*')
    .eq('proposal_workspace_id', proposalWorkspaceId)
    .order('planned_date', { ascending: true });

  if (error) {
    throw new Error(`[Patricia] Failed to get milestones: ${error.message}`);
  }

  return (data || []) as InternalMilestone[];
}

/**
 * Detect overdue milestones and update their status.
 */
export async function detectOverdueMilestones(
  supabase: SupabaseClient
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('patricia_internal_milestones')
    .update({ status: 'OVERDUE' as MilestoneStatus, updated_at: now })
    .in('status', ['PLANNED', 'IN_PROGRESS'])
    .lt('planned_date', now)
    .select('id');

  if (error) {
    console.error(`[Patricia] Failed to detect overdue milestones:`, error.message);
    return 0;
  }

  return data?.length || 0;
}

/**
 * Cancel milestones for a workspace (on NO_GO, etc.)
 */
export async function cancelMilestones(
  supabase: SupabaseClient,
  proposalWorkspaceId: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('patricia_internal_milestones')
    .update({ status: 'CANCELLED' as MilestoneStatus, updated_at: now })
    .eq('proposal_workspace_id', proposalWorkspaceId)
    .in('status', ['PLANNED', 'IN_PROGRESS', 'OVERDUE'])
    .select('id');

  if (error) {
    console.error(`[Patricia] Failed to cancel milestones:`, error.message);
    return 0;
  }

  return data?.length || 0;
}
