/**
 * James Capture Orchestrator — Multi-Round Coordination
 *
 * Called by cron. Finds eligible captures and advances them through
 * the capture lifecycle: assessment → research → resynthesis → recommendation.
 *
 * Does NOT execute inside Slack callbacks.
 */

import { transitionCapture, getRemainingCaptureBudget } from './capture-manager.js';
import { processInitialAssessment, processResynthesis } from './task-processor.js';
import {
  dispatchResearchNeeds,
  areAllTasksTerminal,
  markTimedOutTasks,
} from './specialist-router.js';
import { emitEvent, CAPTURE_EVENT_TYPES } from './events.js';
// Budget constants used indirectly via task-processor

const MAX_CAPTURES_PER_CYCLE = 3;

export interface OrchestratorResult {
  processed: number;
  initialAssessments: number;
  resyntheses: number;
  recommendationsReady: number;
  immediateGoNoGo: number;
  researchDispatched: number;
  budgetExhausted: number;
  errors: number;
}

/**
 * Process pending captures through the orchestration lifecycle.
 * Called by cron every 5 minutes when autonomous AI is enabled.
 */
export async function processPendingCaptures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<OrchestratorResult> {
  const result: OrchestratorResult = {
    processed: 0,
    initialAssessments: 0,
    resyntheses: 0,
    recommendationsReady: 0,
    immediateGoNoGo: 0,
    researchDispatched: 0,
    budgetExhausted: 0,
    errors: 0,
  };

  // Process captures in status order: pending → researching
  await processPendingAssessments(supabase, result);
  await processResearchingCaptures(supabase, result);

  return result;
}

async function processPendingAssessments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  result: OrchestratorResult
): Promise<void> {
  const { data: captures } = await supabase
    .from('captures')
    .select('id, opportunity_id, research_round, max_rounds')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_CAPTURES_PER_CYCLE);

  if (!captures?.length) return;

  for (const capture of captures) {
    result.processed++;

    // Transition to initial_assessment
    const transitioned = await transitionCapture(
      supabase,
      capture.id,
      'pending',
      'initial_assessment'
    );
    if (!transitioned) continue;

    // Run James initial assessment
    const decision = await processInitialAssessment(supabase, capture.id);
    result.initialAssessments++;

    if (!decision) {
      // Assessment failed — leave in initial_assessment for retry or manual intervention
      result.errors++;
      continue;
    }

    if (decision.recommendation === 'GO' || decision.recommendation === 'NO_GO') {
      // Immediate recommendation — no specialist research needed
      await transitionCapture(supabase, capture.id, 'initial_assessment', 'recommendation_ready');
      result.immediateGoNoGo++;
      result.recommendationsReady++;

      await emitEvent(supabase, {
        eventType: CAPTURE_EVENT_TYPES.CAPTURE_RECOMMENDATION_READY,
        aggregateType: 'capture',
        aggregateId: capture.id,
        opportunityId: capture.opportunity_id,
        actorType: 'AGENT',
        actorId: 'james',
        source: 'orchestrator',
        correlationId: `capture:${capture.id}`,
        idempotencyKey: `rec-ready:${capture.id}:r0`,
        schemaVersion: 1,
        payload: { recommendation: decision.recommendation, confidence: decision.confidence },
      });
    } else {
      // MORE_RESEARCH_REQUIRED — dispatch specialist tasks
      const requiredNeeds = decision.requestedResearch.filter((r) => r.priority === 'REQUIRED');
      if (requiredNeeds.length === 0) {
        // No REQUIRED research but MORE_RESEARCH — treat as recommendation ready
        await transitionCapture(supabase, capture.id, 'initial_assessment', 'recommendation_ready');
        result.recommendationsReady++;
      } else {
        // Check budget before dispatching
        const remaining = await getRemainingCaptureBudget(supabase, capture.id);
        if (remaining < 0.01) {
          result.budgetExhausted++;
          await transitionCapture(
            supabase,
            capture.id,
            'initial_assessment',
            'recommendation_ready'
          );
          result.recommendationsReady++;
          continue;
        }

        await emitEvent(supabase, {
          eventType: CAPTURE_EVENT_TYPES.JAMES_RESEARCH_REQUIRED,
          aggregateType: 'capture',
          aggregateId: capture.id,
          opportunityId: capture.opportunity_id,
          actorType: 'AGENT',
          actorId: 'james',
          source: 'orchestrator',
          correlationId: `capture:${capture.id}`,
          idempotencyKey: `research-req:${capture.id}:r1`,
          schemaVersion: 1,
          payload: { round: 1, needCount: requiredNeeds.length },
        });

        const taskIds = await dispatchResearchNeeds(
          supabase,
          capture.id,
          capture.opportunity_id,
          requiredNeeds,
          1,
          'AUTONOMOUS'
        );
        result.researchDispatched += taskIds.length;

        // Update round and transition to researching
        await transitionCapture(supabase, capture.id, 'initial_assessment', 'researching', {
          research_round: 1,
        });
      }
    }
  }
}

async function processResearchingCaptures(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  result: OrchestratorResult
): Promise<void> {
  const { data: captures } = await supabase
    .from('captures')
    .select('id, opportunity_id, research_round, max_rounds')
    .eq('status', 'researching')
    .order('created_at', { ascending: true })
    .limit(MAX_CAPTURES_PER_CYCLE);

  if (!captures?.length) return;

  for (const capture of captures) {
    // Mark timed-out specialist tasks first
    await markTimedOutTasks(supabase, capture.id);

    // Check if all tasks for current round are terminal
    const allTerminal = await areAllTasksTerminal(supabase, capture.id, capture.research_round);
    if (!allTerminal) continue; // Still waiting for specialist results

    result.processed++;

    // All specialist tasks complete — run resynthesis
    const decision = await processResynthesis(supabase, capture.id, capture.research_round);
    result.resyntheses++;

    if (!decision) {
      result.errors++;
      continue;
    }

    if (decision.recommendation === 'GO' || decision.recommendation === 'NO_GO') {
      // Final recommendation
      await transitionCapture(supabase, capture.id, 'researching', 'recommendation_ready');
      result.recommendationsReady++;

      await emitEvent(supabase, {
        eventType: CAPTURE_EVENT_TYPES.CAPTURE_RECOMMENDATION_READY,
        aggregateType: 'capture',
        aggregateId: capture.id,
        opportunityId: capture.opportunity_id,
        actorType: 'AGENT',
        actorId: 'james',
        source: 'orchestrator',
        correlationId: `capture:${capture.id}`,
        idempotencyKey: `rec-ready:${capture.id}:r${capture.research_round}`,
        schemaVersion: 1,
        payload: { recommendation: decision.recommendation, round: capture.research_round },
      });
    } else if (capture.research_round < capture.max_rounds) {
      // MORE_RESEARCH and rounds remain — dispatch Round 2
      const requiredNeeds = decision.requestedResearch.filter((r) => r.priority === 'REQUIRED');
      if (requiredNeeds.length === 0) {
        await transitionCapture(supabase, capture.id, 'researching', 'recommendation_ready');
        result.recommendationsReady++;
      } else {
        const remaining = await getRemainingCaptureBudget(supabase, capture.id);
        if (remaining < 0.01) {
          result.budgetExhausted++;
          await transitionCapture(supabase, capture.id, 'researching', 'recommendation_ready');
          result.recommendationsReady++;
          continue;
        }

        const nextRound = capture.research_round + 1;
        const taskIds = await dispatchResearchNeeds(
          supabase,
          capture.id,
          capture.opportunity_id,
          requiredNeeds,
          nextRound,
          'AUTONOMOUS'
        );
        result.researchDispatched += taskIds.length;

        await supabase
          .from('captures')
          .update({
            research_round: nextRound,
            updated_at: new Date().toISOString(),
          })
          .eq('id', capture.id);
      }
    } else {
      // Max autonomous rounds exhausted — must produce recommendation
      await transitionCapture(supabase, capture.id, 'researching', 'recommendation_ready');
      result.recommendationsReady++;

      await emitEvent(supabase, {
        eventType: CAPTURE_EVENT_TYPES.CAPTURE_RECOMMENDATION_READY,
        aggregateType: 'capture',
        aggregateId: capture.id,
        opportunityId: capture.opportunity_id,
        actorType: 'AGENT',
        actorId: 'james',
        source: 'orchestrator',
        correlationId: `capture:${capture.id}`,
        idempotencyKey: `rec-ready:${capture.id}:r${capture.research_round}:max`,
        schemaVersion: 1,
        payload: { recommendation: decision.recommendation, maxRoundsReached: true },
      });
    }
  }
}
