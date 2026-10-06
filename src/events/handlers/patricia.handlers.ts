/**
 * Patricia Event Handlers — Deterministic Foundation
 *
 * Patricia listens for authoritative events and reacts by updating
 * the commitment registry, dependency graph, proposal readiness,
 * and escalation engine. Zero LLM calls.
 *
 * Patricia does not invent business events. She observes durable
 * system state and operationalizes authoritative decisions.
 */

import {
  EventType,
  EventTypes,
  GoNoGoDecisionPayload,
  DeadlineWarningPayload,
  PipelineHealthCheckPayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';

// ============================================================
// GO_NO_GO_DECISION Handler
// React to authoritative GO/NO_GO decisions
// ============================================================
const handleGoNoGoDecision: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as GoNoGoDecisionPayload;

  console.log(`[Patricia:Deterministic] GO_NO_GO_DECISION for "${payload.title}" → ${payload.decision}`);

  if (payload.decision === 'GO' || payload.decision === 'CONDITIONAL_GO') {
    // Pursuit authorized — Patricia will handle via reconciler
    // The pursuit-stewardship handler (system handler) creates the workspace
    // Patricia's reconciler will detect and initialize readiness state
    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'pursuit_noted',
        decision: payload.decision,
        note: 'Patricia reconciler will initialize readiness state',
      },
    };
  }

  if (payload.decision === 'NO_GO') {
    // NO_GO — Patricia will clean up via reconciler (WH-007)
    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'no_go_noted',
        decision: payload.decision,
        note: 'Patricia reconciler will cancel obsolete work',
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
// DEADLINE_WARNING Handler
// Deterministic deadline tracking
// ============================================================
const handleDeadlineWarning: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as DeadlineWarningPayload;

  console.log(`[Patricia:Deterministic] DEADLINE_WARNING for "${payload.title}" — ${payload.hoursRemaining}h remaining`);

  // Patricia notes the warning. The reconciler handles escalation.
  // No Slack posting yet (PATRICIA_SLACK_ENABLED=false).
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

  // Publish deadline warnings for critical items
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
]);
