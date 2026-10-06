/**
 * Patricia Event Reactor
 *
 * Reacts to authoritative events by updating the commitment
 * registry, dependency graph, escalations, and proposal readiness.
 * Patricia does not invent business events.
 *
 * Zero LLM calls.
 */

import type { SupabaseClient } from './types.js';
import { createCommitment, cancelCommitmentsForCapture } from './commitment-registry.js';
import { satisfyDependency } from './dependency-graph.js';
import { createConflictEscalation, supersedeEscalationsForCapture } from './escalation-engine.js';
import { initializeProposalReadiness, advanceProposalStage, recordSolicitationReceived } from './proposal-readiness.js';
import { generateMilestonePlan, cancelMilestones } from './internal-milestones.js';
import { recordAction } from './operational-actions.js';

/**
 * React to PURSUIT_AUTHORIZED event.
 * Creates proposal readiness, initializes milestones if deadline known.
 */
export async function handlePursuitAuthorized(
  supabase: SupabaseClient,
  payload: {
    captureId: string;
    opportunityId: string;
    proposalWorkspaceId?: string;
    governmentDeadline?: string;
    hasActionableSolicitation?: boolean;
    eventId?: string;
  }
): Promise<void> {
  // Find or use provided workspace
  let workspaceId = payload.proposalWorkspaceId;
  if (!workspaceId) {
    const { data: ws } = await supabase
      .from('proposal_workspaces')
      .select('id')
      .eq('capture_id', payload.captureId)
      .limit(1);
    workspaceId = ws?.[0]?.id;
  }

  if (!workspaceId) {
    // WH-001 will detect and repair this
    return;
  }

  // Initialize proposal readiness
  await initializeProposalReadiness(supabase, {
    proposalWorkspaceId: workspaceId,
    captureId: payload.captureId,
    opportunityId: payload.opportunityId,
    hasActionableSolicitation: payload.hasActionableSolicitation,
    governmentDeadline: payload.governmentDeadline,
  });

  // If government deadline known, create milestone plan + commitment
  if (payload.governmentDeadline) {
    await createCommitment(supabase, {
      idempotencyKey: `govt-deadline-${payload.captureId}`,
      opportunityId: payload.opportunityId,
      captureId: payload.captureId,
      proposalWorkspaceId: workspaceId,
      title: 'Government Submission Deadline',
      commitmentType: 'GOVERNMENT_DEADLINE',
      ownerType: 'SYSTEM',
      ownerId: 'government',
      sourceType: 'SOLICITATION',
      sourceId: payload.opportunityId,
      dueAt: payload.governmentDeadline,
      hardOrSoft: 'HARD',
      provenance: { source: 'PURSUIT_AUTHORIZED', eventId: payload.eventId },
    });

    await generateMilestonePlan(supabase, {
      proposalWorkspaceId: workspaceId,
      captureId: payload.captureId,
      opportunityId: payload.opportunityId,
      governmentDeadline: payload.governmentDeadline,
    });
  }

  // If actionable solicitation, may create Jodie analysis task placeholder
  if (payload.hasActionableSolicitation) {
    await createJodieAnalysisTaskPlaceholder(supabase, {
      proposalWorkspaceId: workspaceId,
      captureId: payload.captureId,
      opportunityId: payload.opportunityId,
    });
  }
}

/**
 * React to NO_GO event.
 * Cancels all pending work, supersedes escalations.
 */
export async function handleNoGo(
  supabase: SupabaseClient,
  payload: {
    captureId: string;
    opportunityId: string;
    eventId: string;
    reason?: string;
  }
): Promise<{ cancelledCommitments: number; supersededEscalations: number; cancelledMilestones: number }> {
  const reason = payload.reason || 'Authoritative NO_GO';

  // Cancel commitments
  const cancelledCommitments = await cancelCommitmentsForCapture(
    supabase, payload.captureId, reason, payload.eventId
  );

  // Supersede escalations
  const supersededEscalations = await supersedeEscalationsForCapture(
    supabase, payload.captureId, reason
  );

  // Cancel milestones
  const { data: ws } = await supabase
    .from('proposal_workspaces')
    .select('id')
    .eq('capture_id', payload.captureId)
    .limit(1);

  let cancelledMilestones = 0;
  if (ws?.[0]?.id) {
    cancelledMilestones = await cancelMilestones(supabase, ws[0].id);
  }

  await recordAction(supabase, {
    idempotencyKey: `action-nogo-${payload.captureId}-${payload.eventId}`,
    actionType: 'TASK_CANCELLED',
    targetType: 'capture',
    targetId: payload.captureId,
    triggeringEventType: 'NO_GO',
    triggeringEventId: payload.eventId,
    evidence: { reason },
    result: { cancelledCommitments, supersededEscalations, cancelledMilestones },
  });

  return { cancelledCommitments, supersededEscalations, cancelledMilestones };
}

/**
 * React to SUBMISSION_CONFIRMED event.
 * Advances to SUBMITTED, cancels obsolete drafting tasks.
 */
export async function handleSubmissionConfirmed(
  supabase: SupabaseClient,
  payload: {
    proposalWorkspaceId: string;
    captureId: string;
    opportunityId: string;
    confirmedBy: string;
    eventId: string;
  }
): Promise<void> {
  // Advance to SUBMITTED
  await advanceProposalStage(supabase, payload.proposalWorkspaceId, 'SUBMITTED', payload.confirmedBy);

  // Record post-submission event
  await supabase
    .from('patricia_post_submission_events')
    .upsert(
      {
        proposal_workspace_id: payload.proposalWorkspaceId,
        capture_id: payload.captureId,
        opportunity_id: payload.opportunityId,
        event_type: 'SUBMITTED',
        title: 'Proposal Submitted',
        description: `Proposal submitted by ${payload.confirmedBy}`,
        actor_type: 'HUMAN',
        actor_id: payload.confirmedBy,
        idempotency_key: `post-sub-submitted-${payload.proposalWorkspaceId}`,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    );

  // Cancel obsolete pre-submission commitments
  const now = new Date().toISOString();
  await supabase
    .from('patricia_commitments')
    .update({
      status: 'CANCELLED',
      cancelled_at: now,
      cancellation_reason: 'Proposal submitted',
      cancellation_event_id: payload.eventId,
      updated_at: now,
    })
    .eq('capture_id', payload.captureId)
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .neq('commitment_type', 'POST_SUBMISSION');

  await recordAction(supabase, {
    idempotencyKey: `action-submitted-${payload.proposalWorkspaceId}`,
    actionType: 'POST_SUBMISSION_EVENT',
    targetType: 'proposal_workspace',
    targetId: payload.proposalWorkspaceId,
    triggeringEventType: 'SUBMISSION_CONFIRMED',
    triggeringEventId: payload.eventId,
    evidence: { confirmedBy: payload.confirmedBy },
    result: { stage: 'SUBMITTED' },
  });
}

/**
 * React to solicitation/package received.
 */
export async function handleSolicitationReceived(
  supabase: SupabaseClient,
  payload: {
    proposalWorkspaceId: string;
    captureId: string;
    opportunityId: string;
    governmentDeadline?: string;
  }
): Promise<void> {
  await recordSolicitationReceived(supabase, payload.proposalWorkspaceId, payload.governmentDeadline);

  // If deadline just became known, create milestone plan
  if (payload.governmentDeadline) {
    await generateMilestonePlan(supabase, {
      proposalWorkspaceId: payload.proposalWorkspaceId,
      captureId: payload.captureId,
      opportunityId: payload.opportunityId,
      governmentDeadline: payload.governmentDeadline,
    });
  }

  // Create Jodie analysis task placeholder
  await createJodieAnalysisTaskPlaceholder(supabase, {
    proposalWorkspaceId: payload.proposalWorkspaceId,
    captureId: payload.captureId,
    opportunityId: payload.opportunityId,
  });
}

/**
 * React to specialist artifact completion.
 * Satisfies dependencies, may advance downstream work.
 */
export async function handleArtifactCompleted(
  supabase: SupabaseClient,
  payload: {
    artifactType: string;
    artifactId: string;
    captureId?: string;
    satisfiedBy: string;
  }
): Promise<{ unblockedCommitments: string[] }> {
  const results = await satisfyDependency(
    supabase, 'ARTIFACT', payload.artifactId, payload.satisfiedBy
  );

  const unblockedCommitments = results
    .filter(r => r.fullyUnblocked)
    .map(r => r.commitmentId);

  for (const commitmentId of unblockedCommitments) {
    await recordAction(supabase, {
      idempotencyKey: `action-unblocked-${commitmentId}-${payload.artifactId}`,
      actionType: 'TASK_ADVANCED',
      targetType: 'patricia_commitments',
      targetId: commitmentId,
      evidence: { artifactType: payload.artifactType, artifactId: payload.artifactId },
      result: { fullyUnblocked: true },
    });
  }

  return { unblockedCommitments };
}

/**
 * React to specialist conflict (e.g., Marcus TECHNICALLY_UNSUITABLE vs James GO).
 * Patricia persists the conflict, does NOT resolve it.
 */
export async function handleSpecialistConflict(
  supabase: SupabaseClient,
  payload: {
    opportunityId: string;
    captureId: string;
    inputA: { agent: string; conclusion: string; evidence: Record<string, unknown> };
    inputB: { agent: string; conclusion: string; evidence: Record<string, unknown> };
    decisionOwner: string;
  }
): Promise<string> {
  return createConflictEscalation(supabase, {
    opportunityId: payload.opportunityId,
    captureId: payload.captureId,
    conflictTitle: `Specialist conflict: ${payload.inputA.agent} vs ${payload.inputB.agent}`,
    inputA: payload.inputA,
    inputB: payload.inputB,
    decisionOwner: payload.decisionOwner,
    idempotencyKey: `conflict-${payload.captureId}-${payload.inputA.agent}-${payload.inputB.agent}`,
  });
}

/**
 * Create a pending Jodie analysis task with full handoff contract.
 *
 * This is the durable work item that the future Jodie executor will
 * consume. It is NOT merely a PM reminder — it contains the complete
 * context needed to reconstruct the analysis scope:
 *
 * Jodie Durable Work Contract (provenance field):
 *   - opportunityId: canonical opportunity reference
 *   - captureId: capture/pursuit UUID
 *   - proposalWorkspaceId: workspace where Jodie writes
 *   - source: 'patricia-proposal-readiness' (originating subsystem)
 *   - governmentDeadline: if known at creation time
 *   - solicitationReceived: whether actionable solicitation exists
 *   - readinessStage: proposal stage when task was created
 *   - createdAt: timestamp for provenance
 *
 * The future Jodie executor can:
 *   1. Query `captures` by captureId for full capture context
 *   2. Query `proposal_workspaces` by proposalWorkspaceId for workspace
 *   3. Query `pipeline_opportunities` by opportunityId for solicitation data
 *   4. Query `patricia_proposal_readiness` for current stage/deadline
 *   5. Query `patricia_internal_milestones` for deadline schedule
 *   6. Query `patricia_dependencies` for known blockers
 *
 * Jodie is not commissioned yet — the task remains PENDING.
 * Idempotent via commitment idempotency_key.
 */
async function createJodieAnalysisTaskPlaceholder(
  supabase: SupabaseClient,
  input: {
    proposalWorkspaceId: string;
    captureId: string;
    opportunityId: string;
    governmentDeadline?: string;
  }
): Promise<void> {
  // Gather readiness context for provenance
  const { data: readiness } = await supabase
    .from('patricia_proposal_readiness')
    .select('stage, government_deadline, has_actionable_solicitation')
    .eq('proposal_workspace_id', input.proposalWorkspaceId)
    .limit(1);

  const readinessRecord = readiness?.[0] || {};
  const deadline = input.governmentDeadline ||
    readinessRecord.government_deadline ||
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // Create commitment for Jodie analysis — full handoff contract in provenance
  const commitmentId = await createCommitment(supabase, {
    idempotencyKey: `jodie-analysis-${input.proposalWorkspaceId}`,
    opportunityId: input.opportunityId,
    captureId: input.captureId,
    proposalWorkspaceId: input.proposalWorkspaceId,
    title: 'Jodie Proposal Analysis',
    commitmentType: 'SPECIALIST_DELIVERABLE',
    ownerType: 'AGENT',
    ownerId: 'jodie',
    sourceType: 'SYSTEM_RULE',
    sourceId: 'patricia-proposal-readiness',
    dueAt: deadline,
    hardOrSoft: 'SOFT',
    provenance: {
      // --- Jodie Durable Work Contract ---
      source: 'patricia-proposal-readiness',
      opportunityId: input.opportunityId,
      captureId: input.captureId,
      proposalWorkspaceId: input.proposalWorkspaceId,
      governmentDeadline: deadline,
      solicitationReceived: readinessRecord.has_actionable_solicitation || false,
      readinessStage: readinessRecord.stage || 'INTAKE',
      createdAt: new Date().toISOString(),
      // --- Resolution pointers ---
      resolveOpportunity: `SELECT * FROM pipeline_opportunities WHERE source_id = '${input.opportunityId}'`,
      resolveCapture: `SELECT * FROM captures WHERE id = '${input.captureId}'`,
      resolveWorkspace: `SELECT * FROM proposal_workspaces WHERE id = '${input.proposalWorkspaceId}'`,
      resolveMilestones: `SELECT * FROM patricia_internal_milestones WHERE proposal_workspace_id = '${input.proposalWorkspaceId}'`,
      resolveDependencies: `SELECT * FROM patricia_dependencies WHERE commitment_id = '<this_commitment_id>'`,
    },
  });

  // Update proposal readiness with task reference
  await supabase
    .from('patricia_proposal_readiness')
    .update({
      jodie_analysis_task_id: commitmentId,
      updated_at: new Date().toISOString(),
    })
    .eq('proposal_workspace_id', input.proposalWorkspaceId)
    .is('jodie_analysis_task_id', null);

  await recordAction(supabase, {
    idempotencyKey: `action-jodie-task-${input.proposalWorkspaceId}`,
    actionType: 'TASK_CREATED',
    targetType: 'patricia_commitments',
    targetId: commitmentId,
    evidence: {
      proposalWorkspaceId: input.proposalWorkspaceId,
      captureId: input.captureId,
      opportunityId: input.opportunityId,
      jodieCommissioned: false,
    },
    result: { commitmentId, status: 'pending_jodie_commissioning' },
  });
}
