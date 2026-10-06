/**
 * Patricia Safe Repair Engine
 *
 * May automatically repair only mechanical states whose intended
 * outcome is unambiguous. All repairs are:
 * - explicitly allowlisted
 * - idempotent
 * - auditable
 * - reference triggering evidence
 * - never manufacture business authority
 *
 * If ambiguity exists: persist ACTION_REQUIRED or AT_RISK.
 * Do not guess.
 *
 * Zero LLM calls.
 */

import type { SupabaseClient, WorkflowFinding } from './types.js';
import { recordAction } from './operational-actions.js';

export interface RepairResult {
  repaired: boolean;
  actionId?: string;
  description: string;
}

// ============================================================
// REPAIR: WH-001 — Create missing Proposal Workspace
// ============================================================
async function repairMissingProposalWorkspace(
  supabase: SupabaseClient,
  finding: WorkflowFinding
): Promise<RepairResult> {
  const captureId = finding.capture_id;
  if (!captureId) {
    return { repaired: false, description: 'No capture_id in finding' };
  }

  // Check if workspace already exists (idempotent)
  const { data: existing } = await supabase
    .from('proposal_workspaces')
    .select('id')
    .eq('capture_id', captureId)
    .limit(1);

  if (existing && existing.length > 0) {
    return { repaired: false, description: 'Proposal workspace already exists (race condition resolved)' };
  }

  // Get opportunity_id from capture
  const { data: capture } = await supabase
    .from('captures')
    .select('opportunity_id')
    .eq('id', captureId)
    .single();

  if (!capture) {
    return { repaired: false, description: `Capture ${captureId} not found` };
  }

  // Create workspace idempotently
  const { data: ws, error } = await supabase
    .from('proposal_workspaces')
    .upsert(
      {
        capture_id: captureId,
        opportunity_id: capture.opportunity_id,
        status: 'active',
        jodie_ready: false,
      },
      { onConflict: 'capture_id', ignoreDuplicates: true }
    )
    .select('id')
    .single();

  if (error && !error.message?.includes('duplicate')) {
    return { repaired: false, description: `Failed to create workspace: ${error.message}` };
  }

  const actionId = await recordAction(supabase, {
    idempotencyKey: `repair-wh001-${captureId}`,
    actionType: 'SAFE_REPAIR',
    targetType: 'proposal_workspace',
    targetId: ws?.id || captureId,
    triggeringEventType: 'WORKFLOW_HEALTH_CHECK',
    triggeringEventId: finding.id,
    evidence: { ruleId: 'WH-001', captureId, findingId: finding.id },
    result: { workspaceId: ws?.id, created: !!ws },
  });

  return {
    repaired: true,
    actionId: actionId || undefined,
    description: `Created Proposal Workspace for capture ${captureId}`,
  };
}

// ============================================================
// REPAIR: WH-005 — Cancel obsolete post-submission tasks
// ============================================================
async function repairObsoletePostSubmissionTasks(
  supabase: SupabaseClient,
  finding: WorkflowFinding
): Promise<RepairResult> {
  const captureId = finding.capture_id;
  if (!captureId) {
    return { repaired: false, description: 'No capture_id in finding' };
  }

  const now = new Date().toISOString();
  const { data: cancelled, error } = await supabase
    .from('patricia_commitments')
    .update({
      status: 'CANCELLED',
      cancelled_at: now,
      cancellation_reason: 'Proposal submitted — pre-submission work obsolete',
      cancellation_event_id: finding.id,
      updated_at: now,
    })
    .eq('capture_id', captureId)
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .neq('commitment_type', 'POST_SUBMISSION')
    .select('id');

  if (error) {
    return { repaired: false, description: `Failed to cancel tasks: ${error.message}` };
  }

  const count = cancelled?.length || 0;
  if (count === 0) {
    return { repaired: false, description: 'No obsolete tasks found (already cleaned)' };
  }

  const actionId = await recordAction(supabase, {
    idempotencyKey: `repair-wh005-${captureId}-${finding.id}`,
    actionType: 'TASK_CANCELLED',
    targetType: 'patricia_commitments',
    targetId: captureId,
    triggeringEventType: 'WORKFLOW_HEALTH_CHECK',
    triggeringEventId: finding.id,
    evidence: { ruleId: 'WH-005', captureId, findingId: finding.id },
    result: { cancelledCount: count, cancelledIds: cancelled?.map((c: { id: string }) => c.id) },
  });

  return {
    repaired: true,
    actionId: actionId || undefined,
    description: `Cancelled ${count} obsolete pre-submission commitments`,
  };
}

// ============================================================
// REPAIR: WH-006 — Advance commitment with all dependencies satisfied
// ============================================================
async function repairSatisfiedButBlocked(
  supabase: SupabaseClient,
  finding: WorkflowFinding
): Promise<RepairResult> {
  const evidence = finding.evidence as { commitmentId?: string };
  const commitmentId = evidence?.commitmentId;
  if (!commitmentId) {
    return { repaired: false, description: 'No commitmentId in finding evidence' };
  }

  // Verify all deps still satisfied (guard against race)
  const { data: deps } = await supabase
    .from('patricia_dependencies')
    .select('status')
    .eq('commitment_id', commitmentId);

  if (!deps) {
    return { repaired: false, description: 'Could not check dependencies' };
  }

  const hasBlocked = deps.some((d: { status: string }) => d.status === 'BLOCKED');
  if (hasBlocked) {
    return { repaired: false, description: 'Dependencies no longer all satisfied (race resolved)' };
  }

  const { error } = await supabase
    .from('patricia_commitments')
    .update({ status: 'IN_PROGRESS', updated_at: new Date().toISOString() })
    .eq('id', commitmentId)
    .eq('status', 'PENDING');

  if (error) {
    return { repaired: false, description: `Failed to advance commitment: ${error.message}` };
  }

  const actionId = await recordAction(supabase, {
    idempotencyKey: `repair-wh006-${commitmentId}`,
    actionType: 'COMMITMENT_UPDATED',
    targetType: 'patricia_commitments',
    targetId: commitmentId,
    triggeringEventType: 'WORKFLOW_HEALTH_CHECK',
    triggeringEventId: finding.id,
    evidence: { ruleId: 'WH-006', commitmentId, findingId: finding.id },
    result: { newStatus: 'IN_PROGRESS' },
  });

  return {
    repaired: true,
    actionId: actionId || undefined,
    description: `Advanced commitment ${commitmentId} to IN_PROGRESS`,
  };
}

// ============================================================
// REPAIR: WH-007 — Cancel obsolete work for cancelled pursuits
// ============================================================
async function repairCancelledPursuitWork(
  supabase: SupabaseClient,
  finding: WorkflowFinding
): Promise<RepairResult> {
  const captureId = finding.capture_id;
  const evidence = finding.evidence as { captureStatus?: string };
  if (!captureId) {
    return { repaired: false, description: 'No capture_id in finding' };
  }

  const now = new Date().toISOString();
  const { data: cancelled, error } = await supabase
    .from('patricia_commitments')
    .update({
      status: 'CANCELLED',
      cancelled_at: now,
      cancellation_reason: `Capture ${evidence?.captureStatus || 'cancelled'} — work obsolete`,
      cancellation_event_id: finding.id,
      updated_at: now,
    })
    .eq('capture_id', captureId)
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .select('id');

  if (error) {
    return { repaired: false, description: `Failed to cancel: ${error.message}` };
  }

  const count = cancelled?.length || 0;
  if (count === 0) {
    return { repaired: false, description: 'No pending work found (already cleaned)' };
  }

  const actionId = await recordAction(supabase, {
    idempotencyKey: `repair-wh007-${captureId}-${finding.id}`,
    actionType: 'TASK_CANCELLED',
    targetType: 'patricia_commitments',
    targetId: captureId,
    triggeringEventType: 'WORKFLOW_HEALTH_CHECK',
    triggeringEventId: finding.id,
    evidence: { ruleId: 'WH-007', captureId, findingId: finding.id },
    result: { cancelledCount: count },
  });

  return {
    repaired: true,
    actionId: actionId || undefined,
    description: `Cancelled ${count} commitments for ${evidence?.captureStatus} capture`,
  };
}

// ============================================================
// SAFE REPAIR REGISTRY
// Explicitly allowlisted — only these rules may auto-repair
// ============================================================
const REPAIR_REGISTRY: Record<string, (supabase: SupabaseClient, finding: WorkflowFinding) => Promise<RepairResult>> = {
  'WH-001': repairMissingProposalWorkspace,
  'WH-005': repairObsoletePostSubmissionTasks,
  'WH-006': repairSatisfiedButBlocked,
  'WH-007': repairCancelledPursuitWork,
};

/**
 * Execute safe repair for a finding if the rule is allowlisted.
 * Returns repair result. Never repairs ambiguous states.
 */
export async function executeSafeRepair(
  supabase: SupabaseClient,
  finding: WorkflowFinding
): Promise<RepairResult> {
  if (!finding.auto_repair_permitted) {
    return { repaired: false, description: 'Auto-repair not permitted for this rule' };
  }

  const repairFn = REPAIR_REGISTRY[finding.rule_id];
  if (!repairFn) {
    return { repaired: false, description: `No repair implementation for rule ${finding.rule_id}` };
  }

  try {
    return await repairFn(supabase, finding);
  } catch (err) {
    console.error(`[Patricia] Safe repair failed for ${finding.rule_id}:`, err);
    return {
      repaired: false,
      description: `Repair failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
