// Maya Event Handlers
// Maya listens for: PURSUIT_DECISION_FEEDBACK, OUTCOME_RECORDED
// Maya publishes: NEW_OPPORTUNITY (from scanner, handled separately)

import {
  EventType,
  EventTypes,
  PursuitDecisionFeedbackPayload,
  OutcomeRecordedPayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';

// ============================================================
// PURSUIT_DECISION_FEEDBACK Handler
// Learn from outcomes to refine future scoring
// ============================================================
const handlePursuitDecisionFeedback: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as PursuitDecisionFeedbackPayload;

  console.log(`[Maya:Handler] Processing feedback for "${payload.title}"`);
  console.log(`  Original score: ${payload.originalScore}`);
  console.log(`  Outcome: ${payload.outcome}`);

  // In a real implementation, this would:
  // 1. Store the feedback in a learning database
  // 2. Adjust scoring weights based on patterns
  // 3. Update keyword relevance scores

  // For now, log the lessons learned
  if (payload.lessonsLearned && payload.lessonsLearned.length > 0) {
    console.log(`  Lessons learned:`);
    payload.lessonsLearned.forEach((lesson, i) => {
      console.log(`    ${i + 1}. ${lesson}`);
    });
  }

  // Store scoring adjustments if provided
  if (payload.scoringAdjustments && payload.scoringAdjustments.length > 0) {
    console.log(`  Suggested scoring adjustments:`);
    payload.scoringAdjustments.forEach((adj) => {
      console.log(
        `    - ${adj.factor}: ${adj.currentWeight} -> ${adj.suggestedWeight} (${adj.reason})`
      );
    });
  }

  // TODO: Persist learning data to database
  // await saveLearningFeedback(payload);

  return {
    success: true,
    result: {
      processed: true,
      noticeId: payload.noticeId,
      outcome: payload.outcome,
      adjustmentsCount: payload.scoringAdjustments?.length || 0,
    },
  };
};

// ============================================================
// OUTCOME_RECORDED Handler
// Track final outcomes for long-term learning
// ============================================================
const handleOutcomeRecorded: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as OutcomeRecordedPayload;

  console.log(`[Maya:Handler] Recording outcome for "${payload.title}"`);
  console.log(`  Outcome: ${payload.outcome}`);

  if (payload.jamesRecommendation && payload.wasCorrect !== undefined) {
    const accuracy = payload.wasCorrect ? 'correct' : 'incorrect';
    console.log(`  James recommended: ${payload.jamesRecommendation} (${accuracy})`);
  }

  if (payload.outcome === 'won') {
    console.log(`  Award amount: $${payload.awardAmount?.toLocaleString() || 'unknown'}`);
    // This is good feedback - whatever scoring led here was right
  } else if (payload.outcome === 'lost') {
    console.log(`  Winner: ${payload.winner || 'unknown'}`);
    // Analyze why we lost - was the initial scoring too optimistic?
  }

  // TODO: Feed this back into scoring model
  // await updateScoringModel(payload);

  return {
    success: true,
    result: {
      processed: true,
      noticeId: payload.noticeId,
      outcome: payload.outcome,
    },
  };
};

// ============================================================
// Export Handler Map
// ============================================================
export const mayaHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.PURSUIT_DECISION_FEEDBACK, handlePursuitDecisionFeedback],
  [EventTypes.OUTCOME_RECORDED, handleOutcomeRecorded],
]);
