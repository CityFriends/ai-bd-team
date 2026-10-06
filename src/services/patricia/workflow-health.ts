/**
 * Patricia Workflow Health Reconciler
 *
 * Deterministic detection of workflow inconsistencies.
 * Each rule has a stable ID, evidence/state references,
 * severity, recommended action, and auto-repair flag.
 *
 * No LLM classification. Zero provider calls.
 */

import type {
  SupabaseClient,
  HealthRule,
  HealthRuleContext,
  HealthRuleResult,
  FindingSeverity,
} from './types.js';

// ============================================================
// RULE: WH-001 — PURSUIT_AUTHORIZED but no Proposal Workspace
// ============================================================
const RULE_WH001: HealthRule = {
  ruleId: 'WH-001',
  title: 'Pursuit authorized but no Proposal Workspace',
  severity: 'ACTION_REQUIRED',
  autoRepairPermitted: true,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    // Use a raw query approach — find captures with pursuit_authorized but no workspace
    const { data: orphaned, error: err } = await ctx.supabase
      .rpc('get_pursuit_authorized_without_workspace');

    // Fallback: manual query
    if (err || !orphaned) {
      const { data: pursuits } = await ctx.supabase
        .from('captures')
        .select('id, opportunity_id')
        .eq('status', 'pursuit_authorized');

      if (!pursuits || pursuits.length === 0) return [];

      const results: HealthRuleResult[] = [];
      for (const capture of pursuits) {
        const { data: ws } = await ctx.supabase
          .from('proposal_workspaces')
          .select('id')
          .eq('capture_id', capture.id)
          .limit(1);

        if (!ws || ws.length === 0) {
          results.push({
            captureId: capture.id,
            opportunityId: capture.opportunity_id,
            title: 'Pursuit authorized but no Proposal Workspace',
            description: `Capture ${capture.id} has status pursuit_authorized but no proposal_workspaces record exists.`,
            evidence: { captureId: capture.id, captureStatus: 'pursuit_authorized' },
            recommendedAction: 'Create Proposal Workspace idempotently',
            idempotencyKeySuffix: `wh001-${capture.id}`,
          });
        }
      }
      return results;
    }

    return ((orphaned || []) as Array<{ id: string; opportunity_id: string }>).map(c => ({
      captureId: c.id,
      opportunityId: c.opportunity_id,
      title: 'Pursuit authorized but no Proposal Workspace',
      description: `Capture ${c.id} has status pursuit_authorized but no proposal_workspaces record exists.`,
      evidence: { captureId: c.id, captureStatus: 'pursuit_authorized' },
      recommendedAction: 'Create Proposal Workspace idempotently',
      idempotencyKeySuffix: `wh001-${c.id}`,
    }));
  },
};

// ============================================================
// RULE: WH-002 — Actionable solicitation + Pursuit Authorized but no Jodie analysis task
// ============================================================
const RULE_WH002: HealthRule = {
  ruleId: 'WH-002',
  title: 'Pursuit authorized with solicitation but no Jodie analysis task',
  severity: 'ACTION_REQUIRED',
  autoRepairPermitted: true,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    const { data: readiness } = await ctx.supabase
      .from('patricia_proposal_readiness')
      .select('*')
      .eq('has_actionable_solicitation', true)
      .is('jodie_analysis_task_id', null)
      .neq('stage', 'PRE_SOLICITATION');

    if (!readiness || readiness.length === 0) return [];

    return readiness.map((r: Record<string, unknown>) => ({
      captureId: r.capture_id as string,
      opportunityId: r.opportunity_id as string,
      proposalWorkspaceId: r.proposal_workspace_id as string,
      title: 'Pursuit authorized with solicitation but no Jodie analysis task',
      description: `Proposal readiness ${r.id} has actionable solicitation but no Jodie analysis task created.`,
      evidence: {
        readinessId: r.id,
        stage: r.stage,
        hasSolicitation: true,
        jodieTaskMissing: true,
      },
      recommendedAction: 'Create pending Jodie analysis task',
      idempotencyKeySuffix: `wh002-${r.proposal_workspace_id}`,
    }));
  },
};

// ============================================================
// RULE: WH-003 — Proposal deadline approaching with required work incomplete
// ============================================================
const RULE_WH003: HealthRule = {
  ruleId: 'WH-003',
  title: 'Proposal deadline approaching with incomplete required work',
  severity: 'AT_RISK',
  autoRepairPermitted: false,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: atRisk } = await ctx.supabase
      .from('patricia_commitments')
      .select('*')
      .eq('commitment_type', 'GOVERNMENT_DEADLINE')
      .in('status', ['PENDING', 'IN_PROGRESS'])
      .gte('due_at', now)
      .lte('due_at', sevenDaysFromNow);

    if (!atRisk || atRisk.length === 0) return [];

    const results: HealthRuleResult[] = [];
    for (const commitment of atRisk) {
      // Check for blocked dependencies
      const { data: blocked } = await ctx.supabase
        .from('patricia_dependencies')
        .select('id, depends_on_type, depends_on_id')
        .eq('commitment_id', commitment.id)
        .eq('status', 'BLOCKED');

      if (blocked && blocked.length > 0) {
        results.push({
          opportunityId: commitment.opportunity_id,
          captureId: commitment.capture_id,
          proposalWorkspaceId: commitment.proposal_workspace_id,
          title: `Deadline approaching with ${blocked.length} blocker(s)`,
          description: `Government deadline ${commitment.due_at} approaching with ${blocked.length} blocked dependencies.`,
          evidence: {
            commitmentId: commitment.id,
            dueAt: commitment.due_at,
            blockedDependencies: blocked,
          },
          idempotencyKeySuffix: `wh003-${commitment.id}`,
        });
      }
    }
    return results;
  },
};

// ============================================================
// RULE: WH-004 — Overdue specialist task blocking capture/pursuit/proposal
// ============================================================
const RULE_WH004: HealthRule = {
  ruleId: 'WH-004',
  title: 'Overdue specialist task blocking work',
  severity: 'ACTION_REQUIRED',
  autoRepairPermitted: false,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    // Check specialist_tasks that are pending/in_progress for active captures
    const { data: stalled } = await ctx.supabase
      .from('specialist_tasks')
      .select('id, capture_id, task_type, status, created_at')
      .in('status', ['pending', 'in_progress'])
      .lt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

    if (!stalled || stalled.length === 0) return [];

    return stalled.map((task: Record<string, unknown>) => {
      const hoursOld = Math.floor(
        (Date.now() - new Date(task.created_at as string).getTime()) / (60 * 60 * 1000)
      );
      return {
        captureId: task.capture_id as string,
        title: `Specialist task overdue (${hoursOld}h)`,
        description: `Specialist task ${task.id} (${task.task_type}) has been ${task.status} for ${hoursOld} hours.`,
        evidence: {
          taskId: task.id,
          taskType: task.task_type,
          status: task.status,
          createdAt: task.created_at,
          hoursOld,
        },
        idempotencyKeySuffix: `wh004-${task.id}`,
      };
    });
  },
};

// ============================================================
// RULE: WH-005 — SUBMITTED pursuit with obsolete drafting tasks still pending
// ============================================================
const RULE_WH005: HealthRule = {
  ruleId: 'WH-005',
  title: 'Submitted pursuit with obsolete pending tasks',
  severity: 'NOTICE',
  autoRepairPermitted: true,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    const { data: submitted } = await ctx.supabase
      .from('patricia_proposal_readiness')
      .select('proposal_workspace_id, capture_id, opportunity_id')
      .eq('stage', 'SUBMITTED');

    if (!submitted || submitted.length === 0) return [];

    const results: HealthRuleResult[] = [];
    for (const sub of submitted) {
      // Check for still-pending commitments (non-post-submission type)
      const { data: obsolete } = await ctx.supabase
        .from('patricia_commitments')
        .select('id, title, commitment_type')
        .eq('capture_id', sub.capture_id)
        .in('status', ['PENDING', 'IN_PROGRESS'])
        .neq('commitment_type', 'POST_SUBMISSION');

      if (obsolete && obsolete.length > 0) {
        results.push({
          captureId: sub.capture_id,
          opportunityId: sub.opportunity_id,
          proposalWorkspaceId: sub.proposal_workspace_id,
          title: `${obsolete.length} obsolete task(s) after submission`,
          description: `Proposal submitted but ${obsolete.length} pre-submission commitments still pending.`,
          evidence: {
            submittedWorkspace: sub.proposal_workspace_id,
            obsoleteTasks: obsolete,
          },
          recommendedAction: 'Cancel obsolete pre-submission commitments',
          idempotencyKeySuffix: `wh005-${sub.proposal_workspace_id}`,
        });
      }
    }
    return results;
  },
};

// ============================================================
// RULE: WH-006 — Dependency marked satisfied but downstream still blocked
// ============================================================
const RULE_WH006: HealthRule = {
  ruleId: 'WH-006',
  title: 'Satisfied dependency with still-blocked downstream',
  severity: 'ACTION_REQUIRED',
  autoRepairPermitted: true,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    // Find commitments where ALL dependencies are SATISFIED but commitment is still PENDING
    const { data: commitments } = await ctx.supabase
      .from('patricia_commitments')
      .select('id, title, opportunity_id, capture_id, proposal_workspace_id')
      .in('status', ['PENDING']);

    if (!commitments || commitments.length === 0) return [];

    const results: HealthRuleResult[] = [];
    for (const c of commitments) {
      const { data: deps } = await ctx.supabase
        .from('patricia_dependencies')
        .select('id, status')
        .eq('commitment_id', c.id);

      if (!deps || deps.length === 0) continue;

      const allSatisfied = deps.every((d: { status: string }) =>
        d.status === 'SATISFIED' || d.status === 'CANCELLED'
      );
      const hasBlocked = deps.some((d: { status: string }) => d.status === 'BLOCKED');

      if (allSatisfied && !hasBlocked) {
        results.push({
          opportunityId: c.opportunity_id,
          captureId: c.capture_id,
          proposalWorkspaceId: c.proposal_workspace_id,
          title: `All dependencies satisfied but commitment still PENDING`,
          description: `Commitment "${c.title}" (${c.id}) has all dependencies satisfied but is still in PENDING status.`,
          evidence: {
            commitmentId: c.id,
            commitmentTitle: c.title,
            dependencyCount: deps.length,
            allSatisfied: true,
          },
          recommendedAction: 'Advance commitment to IN_PROGRESS',
          idempotencyKeySuffix: `wh006-${c.id}`,
        });
      }
    }
    return results;
  },
};

// ============================================================
// RULE: WH-007 — Cancelled/no-go/dismissed pursuit with obsolete pending work
// ============================================================
const RULE_WH007: HealthRule = {
  ruleId: 'WH-007',
  title: 'Cancelled pursuit with obsolete pending work',
  severity: 'NOTICE',
  autoRepairPermitted: true,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    const { data: cancelled } = await ctx.supabase
      .from('captures')
      .select('id, opportunity_id, status')
      .in('status', ['no_go', 'abandoned']);

    if (!cancelled || cancelled.length === 0) return [];

    const results: HealthRuleResult[] = [];
    for (const capture of cancelled) {
      const { data: pending } = await ctx.supabase
        .from('patricia_commitments')
        .select('id, title')
        .eq('capture_id', capture.id)
        .in('status', ['PENDING', 'IN_PROGRESS']);

      if (pending && pending.length > 0) {
        results.push({
          captureId: capture.id,
          opportunityId: capture.opportunity_id,
          title: `${pending.length} pending task(s) for cancelled capture`,
          description: `Capture ${capture.id} is ${capture.status} but has ${pending.length} pending commitments.`,
          evidence: {
            captureId: capture.id,
            captureStatus: capture.status,
            pendingCommitments: pending,
          },
          recommendedAction: 'Cancel obsolete commitments',
          idempotencyKeySuffix: `wh007-${capture.id}`,
        });
      }
    }
    return results;
  },
};

// ============================================================
// RULE: WH-008 — Material amendment requiring review but review task missing
// ============================================================
const RULE_WH008: HealthRule = {
  ruleId: 'WH-008',
  title: 'Material amendment without review task',
  severity: 'ACTION_REQUIRED',
  autoRepairPermitted: false,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    // Check for material technical_change_events without a corresponding marcus task
    const { data: changes } = await ctx.supabase
      .from('technical_change_events')
      .select('id, capture_id, created_at')
      .eq('material', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!changes || changes.length === 0) return [];

    const results: HealthRuleResult[] = [];
    for (const change of changes) {
      const { data: tasks } = await ctx.supabase
        .from('marcus_technical_tasks')
        .select('id')
        .eq('capture_id', change.capture_id)
        .eq('trigger_type', 'PURSUIT_CHANGE')
        .in('status', ['pending', 'in_progress', 'completed'])
        .gte('created_at', change.created_at)
        .limit(1);

      if (!tasks || tasks.length === 0) {
        results.push({
          captureId: change.capture_id,
          title: 'Material amendment without review task',
          description: `Material change event ${change.id} has no corresponding Marcus stewardship task.`,
          evidence: { changeEventId: change.id, captureId: change.capture_id },
          recommendedAction: 'Create Marcus stewardship task for material amendment',
          idempotencyKeySuffix: `wh008-${change.id}`,
        });
      }
    }
    return results;
  },
};

// ============================================================
// RULE: WH-009 — READY_TO_SUBMIT with incomplete deterministic prerequisites
// ============================================================
const RULE_WH009: HealthRule = {
  ruleId: 'WH-009',
  title: 'Ready to submit with incomplete prerequisites',
  severity: 'AT_RISK',
  autoRepairPermitted: false,
  evaluate: async (ctx: HealthRuleContext): Promise<HealthRuleResult[]> => {
    const { data: readyToSubmit } = await ctx.supabase
      .from('patricia_proposal_readiness')
      .select('*')
      .eq('stage', 'READY_TO_SUBMIT');

    if (!readyToSubmit || readyToSubmit.length === 0) return [];

    const results: HealthRuleResult[] = [];
    for (const r of readyToSubmit) {
      // Check for incomplete milestones
      const { data: incomplete } = await ctx.supabase
        .from('patricia_internal_milestones')
        .select('id, title, milestone_type, status')
        .eq('proposal_workspace_id', r.proposal_workspace_id)
        .in('status', ['PLANNED', 'IN_PROGRESS', 'OVERDUE']);

      if (incomplete && incomplete.length > 0) {
        results.push({
          proposalWorkspaceId: r.proposal_workspace_id,
          captureId: r.capture_id,
          opportunityId: r.opportunity_id,
          title: `Ready to submit but ${incomplete.length} milestone(s) incomplete`,
          description: `Proposal marked READY_TO_SUBMIT but ${incomplete.length} milestones not completed.`,
          evidence: {
            readinessId: r.id,
            incompleteMilestones: incomplete,
          },
          idempotencyKeySuffix: `wh009-${r.proposal_workspace_id}`,
        });
      }
    }
    return results;
  },
};

// ============================================================
// ALL RULES
// ============================================================

export const WORKFLOW_HEALTH_RULES: HealthRule[] = [
  RULE_WH001,
  RULE_WH002,
  RULE_WH003,
  RULE_WH004,
  RULE_WH005,
  RULE_WH006,
  RULE_WH007,
  RULE_WH008,
  RULE_WH009,
];

/**
 * Evaluate all workflow health rules against current state.
 * Returns findings (not yet persisted).
 */
export async function evaluateWorkflowHealth(
  supabase: SupabaseClient
): Promise<Array<HealthRuleResult & { ruleId: string; severity: FindingSeverity; autoRepairPermitted: boolean }>> {
  const allFindings: Array<HealthRuleResult & { ruleId: string; severity: FindingSeverity; autoRepairPermitted: boolean }> = [];

  for (const rule of WORKFLOW_HEALTH_RULES) {
    try {
      const results = await rule.evaluate({ supabase });
      for (const result of results) {
        allFindings.push({
          ...result,
          ruleId: rule.ruleId,
          severity: rule.severity,
          autoRepairPermitted: rule.autoRepairPermitted,
        });
      }
    } catch (err) {
      console.error(`[Patricia] Health rule ${rule.ruleId} failed:`, err);
    }
  }

  return allFindings;
}
