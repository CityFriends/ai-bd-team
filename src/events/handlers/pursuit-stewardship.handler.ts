/**
 * Pursuit Technical Stewardship Event Handler
 *
 * Wires PURSUIT_AUTHORIZED → initializePursuitStewardship.
 * The authoritative database event triggers stewardship initialization.
 * No direct call from Slack button handler.
 *
 * This handler is deterministic — 0 LLM calls.
 */

import type { EventHandler, EventHandlerResult, EventHandlerContext } from '../eventProcessor.js';
import { initializePursuitStewardship } from '../../services/marcus/pursuit-stewardship.js';

export const handlePursuitAuthorized: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const event = context.event;
  const payload = event.payload as { captureId?: string; opportunityId?: string; capture_id?: string; opportunity_id?: string };

  const captureId = payload.captureId || payload.capture_id || (event as Record<string, unknown>).aggregate_id as string;
  const opportunityId = payload.opportunityId || payload.opportunity_id || '';

  if (!captureId) {
    return {
      success: false,
      error: 'PURSUIT_AUTHORIZED event missing captureId',
    };
  }

  try {
    const result = await initializePursuitStewardship(captureId, opportunityId);

    return {
      success: true,
      result: {
        artifactId: result.artifactId,
        fromExisting: result.fromExisting,
        pendingTaskId: result.pendingTaskId,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * System handler map for pursuit stewardship events.
 */
export const pursuitStewardshipHandlers = new Map([
  ['PURSUIT_AUTHORIZED' as import('../eventTypes.js').EventType, handlePursuitAuthorized],
]);
