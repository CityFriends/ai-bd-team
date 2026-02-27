/**
 * Auto-Create Workflow Handler
 *
 * When a NEW_OPPORTUNITY event is published (by Maya's scanner),
 * automatically create a workflow instance to track it through
 * the pipeline.
 *
 * This enables the workflow orchestration system to monitor
 * SLAs and trigger escalations for stalled opportunities.
 */

import { EventTypes, type NewOpportunityPayload, type EventType } from '../eventTypes.js';
import { createWorkflowInstance } from '../../workflows/index.js';
import type { EventHandler, EventHandlerResult, EventHandlerContext } from '../eventProcessor.js';

/**
 * Handle NEW_OPPORTUNITY events by creating a workflow instance
 */
export const handleNewOpportunityWorkflow: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const event = context.event;
  const payload = event.payload as NewOpportunityPayload;

  console.log(`[WorkflowAutoCreate] Creating workflow for: ${payload.noticeId}`);

  try {
    // Create workflow instance for this opportunity
    const workflow = await createWorkflowInstance({
      workflowType: 'opportunity_pursuit',
      referenceId: payload.noticeId,
      referenceTitle: payload.title || 'Untitled Opportunity',
      channelId: event.channel_id || undefined,
      threadTs: event.thread_ts || undefined,
      metadata: {
        agency: payload.agency,
        dueDate: payload.deadline,
        score: payload.score,
        setAside: payload.setAside,
        sourceEvent: event.id,
        createdBy: 'maya',
      },
    });

    if (workflow) {
      console.log(`[WorkflowAutoCreate] Created instance ${workflow.id} for ${payload.noticeId}`);

      return {
        success: true,
        result: {
          workflowId: workflow.id,
          noticeId: payload.noticeId,
          initialState: workflow.current_state,
        },
      };
    } else {
      // Workflow may already exist (duplicate event)
      console.log(`[WorkflowAutoCreate] Workflow may already exist for ${payload.noticeId}`);
      return {
        success: true, // Still consider this a success - workflow exists
        result: {
          noticeId: payload.noticeId,
          note: 'Workflow may already exist',
        },
      };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[WorkflowAutoCreate] Failed: ${errorMessage}`);

    return {
      success: false,
      error: `Failed to create workflow: ${errorMessage}`,
    };
  }
};

/**
 * System handlers for workflow auto-creation
 * These run for system-level events (not agent-specific)
 */
export const workflowHandlers = new Map<EventType, EventHandler>([
  [EventTypes.NEW_OPPORTUNITY, handleNewOpportunityWorkflow],
]);
