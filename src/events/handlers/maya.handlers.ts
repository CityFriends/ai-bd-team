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
import { storeMemory } from '../../memory/index.js';

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

  // Store outcome as memory for team learning
  await storeOutcomeMemory(payload, event.id);

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
// Memory Storage
// ============================================================
async function storeOutcomeMemory(payload: OutcomeRecordedPayload, eventId: string): Promise<void> {
  try {
    // Build descriptive memory content
    const outcomeVerb =
      payload.outcome === 'won' ? 'Won' : payload.outcome === 'lost' ? 'Lost' : 'Withdrew from';
    const awardNote =
      payload.outcome === 'won' && payload.awardAmount
        ? ` Award: $${payload.awardAmount.toLocaleString()}.`
        : '';
    const winnerNote =
      payload.outcome === 'lost' && payload.winner ? ` Winner: ${payload.winner}.` : '';
    const jamesNote = payload.jamesRecommendation
      ? ` James recommended ${payload.jamesRecommendation} (${payload.wasCorrect ? 'correct' : 'incorrect'}).`
      : '';

    const content = `${outcomeVerb} "${payload.title}".${awardNote}${winnerNote}${jamesNote}`;

    // Build tags for querying
    const tags: string[] = [`outcome-${payload.outcome}`];

    // Track prediction accuracy
    if (payload.wasCorrect !== undefined) {
      tags.push(payload.wasCorrect ? 'prediction-correct' : 'prediction-incorrect');
    }

    // Add agency if available (from related memories)
    // Note: OutcomeRecordedPayload doesn't have agency, but we could look it up

    // Higher importance for outcomes - these are valuable learning signals
    const importance = payload.outcome === 'won' ? 9 : payload.outcome === 'lost' ? 8 : 6;

    await storeMemory('maya', 'outcome', content, {
      relatedOpportunityId: payload.noticeId,
      relatedEventId: eventId,
      importance,
      tags,
    });

    console.log(`[Maya:Handler] Stored outcome memory for ${payload.noticeId}`);
  } catch (err) {
    console.warn(`[Maya:Handler] Failed to store outcome memory:`, err);
  }
}

// ============================================================
// Export Handler Map
// ============================================================
export const mayaHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.PURSUIT_DECISION_FEEDBACK, handlePursuitDecisionFeedback],
  [EventTypes.OUTCOME_RECORDED, handleOutcomeRecorded],
]);
