/**
 * Patricia Event Handlers — Deterministic Foundation
 *
 * Patricia listens for authoritative events and reacts by updating
 * the commitment registry, dependency graph, proposal readiness,
 * and escalation engine. Zero LLM calls.
 *
 * Patricia does not invent business events. She observes durable
 * system state and operationalizes authoritative decisions.
 *
 * Durable Event Routing Matrix:
 *   GO_NO_GO_DECISION  → handleGoNoGoDecision (existing EventTypes)
 *   DEADLINE_WARNING    → handleDeadlineWarning (existing EventTypes)
 *   PIPELINE_HEALTH_CHECK → handlePipelineHealthCheck (existing EventTypes)
 *   PURSUIT_AUTHORIZED  → handlePursuitAuthorizedEvent (system handler, string cast)
 *   OUTCOME_RECORDED    → handleOutcomeRecorded (existing EventTypes)
 *   TECH_ASSESSMENT_COMPLETE → handleTechAssessmentComplete (existing EventTypes)
 *
 * Events consumed via domain events (opportunity_events) — not agent_events bus:
 *   PURSUIT_AUTHORIZED  → also available via system handler
 *   PURSUIT_NO_GO       → via domain event processor (future)
 *
 * Events NOT yet emitted by any upstream producer:
 *   SOLICITATION_RECEIVED    — no upstream emitter; Patricia reacts via reconciler state
 *   SUBMISSION_CONFIRMED     — no upstream emitter; requires human Slack action (future)
 *   SPECIALIST_CONFLICT      — no upstream emitter; detected by reconciler comparing state
 *   AWARD / LOSS / CLOSED    — no upstream emitter; requires OUTCOME_RECORDED or human action
 */

import {
  EventType,
  EventTypes,
  GoNoGoDecisionPayload,
  DeadlineWarningPayload,
  PipelineHealthCheckPayload,
  OutcomeRecordedPayload,
  TechAssessmentCompletePayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getSupabase } from '../../integrations/database/client.js';
import {
  handlePursuitAuthorized as reactPursuitAuthorized,
  handleNoGo as reactNoGo,
  handleArtifactCompleted as reactArtifactCompleted,
} from '../../services/patricia/event-reactor.js';

// ============================================================
// GO_NO_GO_DECISION Handler
// React to authoritative GO/NO_GO decisions
// ============================================================
const handleGoNoGoDecision: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as GoNoGoDecisionPayload;
  const supabase = getSupabase();

  console.log(`[Patricia:Deterministic] GO_NO_GO_DECISION for "${payload.title}" → ${payload.decision}`);

  if (payload.decision === 'GO' || payload.decision === 'CONDITIONAL_GO') {
    try {
      await reactPursuitAuthorized(supabase, {
        captureId: (event.payload as Record<string, string>).captureId || '',
        opportunityId: payload.noticeId,
        governmentDeadline: (event.payload as Record<string, string>).deadline,
        eventId: event.id,
      });
    } catch (err) {
      console.error('[Patricia:Deterministic] Pursuit authorized reaction failed:', err);
      // Non-fatal — reconciler will catch missing state
    }

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'pursuit_initialized',
        decision: payload.decision,
      },
    };
  }

  if (payload.decision === 'NO_GO') {
    try {
      const captureId = (event.payload as Record<string, string>).captureId || '';
      if (captureId) {
        await reactNoGo(supabase, {
          captureId,
          opportunityId: payload.noticeId,
          eventId: event.id,
          reason: `James NO_GO: ${payload.rationale?.slice(0, 200) || 'No rationale'}`,
        });
      }
    } catch (err) {
      console.error('[Patricia:Deterministic] NO_GO reaction failed:', err);
    }

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'no_go_processed',
        decision: payload.decision,
      },
    };
  }

  return {
    success: true,
    result: {
      noticeId: payload.noticeId,
      action: 'observed',
      decision: payload.decision,
    },
  };
};

// ============================================================
// PURSUIT_AUTHORIZED Handler (durable event bus)
// Called when PURSUIT_AUTHORIZED arrives via agent_events or
// system handler dispatch. Initializes Patricia state.
// ============================================================
const handlePursuitAuthorizedEvent: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as Record<string, string>;
  const supabase = getSupabase();

  const captureId = payload.captureId || payload.capture_id ||
    (event as Record<string, unknown>).aggregate_id as string;
  const opportunityId = payload.opportunityId || payload.opportunity_id || '';

  if (!captureId) {
    return { success: false, error: 'PURSUIT_AUTHORIZED event missing captureId' };
  }

  console.log(`[Patricia:Deterministic] PURSUIT_AUTHORIZED for capture ${captureId}`);

  try {
    await reactPursuitAuthorized(supabase, {
      captureId,
      opportunityId,
      governmentDeadline: payload.governmentDeadline || payload.government_deadline,
      hasActionableSolicitation: payload.hasActionableSolicitation === 'true',
      eventId: event.id,
    });

    return {
      success: true,
      result: { captureId, action: 'pursuit_state_initialized' },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ============================================================
// OUTCOME_RECORDED Handler
// Handles AWARD / LOSS / CANCELLED outcomes
// ============================================================
const handleOutcomeRecorded: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as OutcomeRecordedPayload;
  const supabase = getSupabase();

  console.log(`[Patricia:Deterministic] OUTCOME_RECORDED for "${payload.title}" → ${payload.outcome}`);

  if (payload.outcome === 'lost' || payload.outcome === 'no_bid' ||
      payload.outcome === 'cancelled' || payload.outcome === 'withdrawn') {
    // Record post-submission event if applicable
    const captureId = (event.payload as Record<string, string>).captureId || '';
    if (captureId) {
      const eventType = payload.outcome === 'lost' ? 'LOSS' :
                        payload.outcome === 'cancelled' ? 'CANCELLATION' : 'CLOSEOUT';

      await supabase
        .from('patricia_post_submission_events')
        .upsert(
          {
            proposal_workspace_id: (event.payload as Record<string, string>).proposalWorkspaceId || '00000000-0000-0000-0000-000000000000',
            capture_id: captureId,
            opportunity_id: payload.noticeId,
            event_type: eventType,
            title: `${payload.outcome}: ${payload.title}`,
            description: payload.postMortem || `Outcome: ${payload.outcome}`,
            actor_type: 'SYSTEM' as const,
            idempotency_key: `post-sub-${payload.outcome}-${payload.noticeId}`,
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        );
    }
  }

  return {
    success: true,
    result: {
      noticeId: payload.noticeId,
      outcome: payload.outcome,
      action: 'outcome_recorded',
    },
  };
};

// ============================================================
// TECH_ASSESSMENT_COMPLETE Handler
// Satisfies dependencies when Marcus completes assessment
// ============================================================
const handleTechAssessmentComplete: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as TechAssessmentCompletePayload;
  const supabase = getSupabase();

  console.log(`[Patricia:Deterministic] TECH_ASSESSMENT_COMPLETE for "${payload.title}" → ${payload.recommendation}`);

  try {
    const artifactId = (event.payload as Record<string, string>).assessmentId || event.id;
    const result = await reactArtifactCompleted(supabase, {
      artifactType: 'technical_assessment',
      artifactId,
      satisfiedBy: 'marcus',
    });

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        unblockedCount: result.unblockedCommitments.length,
        action: 'artifact_dependency_satisfied',
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ============================================================
// DEADLINE_WARNING Handler
// Deterministic deadline tracking
// ============================================================
const handleDeadlineWarning: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as DeadlineWarningPayload;

  console.log(`[Patricia:Deterministic] DEADLINE_WARNING for "${payload.title}" — ${payload.hoursRemaining}h remaining`);

  return {
    success: true,
    result: {
      noticeId: payload.noticeId,
      hoursRemaining: payload.hoursRemaining,
      blockersCount: payload.blockers.length,
      action: 'deadline_noted',
    },
  };
};

// ============================================================
// PIPELINE_HEALTH_CHECK Handler
// Deterministic pipeline health observation
// ============================================================
const handlePipelineHealthCheck: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as PipelineHealthCheckPayload;

  console.log(`[Patricia:Deterministic] PIPELINE_HEALTH_CHECK — ${payload.totalOpportunities} opportunities, health ${payload.healthScore}%`);

  const criticalDeadlines = payload.upcomingDeadlines.filter((opp) => opp.daysRemaining <= 1);
  const chainEvents = criticalDeadlines.map((opp) => ({
    eventType: EventTypes.DEADLINE_WARNING as EventType,
    payload: {
      noticeId: opp.noticeId,
      title: opp.title,
      deadline: opp.deadline,
      hoursRemaining: opp.daysRemaining * 24,
      currentStage: 'unknown',
      blockers: [],
      urgentActions: ['Review and finalize submission'],
    },
    priority: 1,
  }));

  return {
    success: true,
    result: {
      healthScore: payload.healthScore,
      totalOpportunities: payload.totalOpportunities,
      stuckCount: payload.stuckOpportunities.length,
      action: 'health_noted',
    },
    chainEvents,
  };
};

// ============================================================
// Export Handler Map
// ============================================================
export const patriciaHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.GO_NO_GO_DECISION, handleGoNoGoDecision],
  [EventTypes.DEADLINE_WARNING, handleDeadlineWarning],
  [EventTypes.PIPELINE_HEALTH_CHECK, handlePipelineHealthCheck],
  [EventTypes.OUTCOME_RECORDED, handleOutcomeRecorded],
  [EventTypes.TECH_ASSESSMENT_COMPLETE, handleTechAssessmentComplete],
  // PURSUIT_AUTHORIZED uses string cast — not in EventTypes const
  ['PURSUIT_AUTHORIZED' as EventType, handlePursuitAuthorizedEvent],
]);
