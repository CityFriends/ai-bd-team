/**
 * Maya Production — Domain Event Vocabulary
 *
 * Typed durable events for opportunity lifecycle.
 * Events are the communication mechanism between pipeline stages.
 */

export const MAYA_EVENT_TYPES = {
  OPPORTUNITY_DISCOVERED: 'OPPORTUNITY_DISCOVERED',
  OPPORTUNITY_UPDATED: 'OPPORTUNITY_UPDATED',
  OPPORTUNITY_MATERIAL_CHANGE: 'OPPORTUNITY_MATERIAL_CHANGE',
  MAYA_REVIEW_REQUIRED: 'MAYA_REVIEW_REQUIRED',
  MAYA_REVIEW_COMPLETED: 'MAYA_REVIEW_COMPLETED',
  MAYA_EVALUATE: 'MAYA_EVALUATE',
  MAYA_WATCH: 'MAYA_WATCH',
  MAYA_PASS: 'MAYA_PASS',
  SLACK_OPPORTUNITY_BRIEF_POSTED: 'SLACK_OPPORTUNITY_BRIEF_POSTED',
  SLACK_PROJECTION_FAILED: 'SLACK_PROJECTION_FAILED',
  SEND_TO_CAPTURE: 'SEND_TO_CAPTURE',
  MAYA_MORE_RESEARCH_REQUESTED: 'MAYA_MORE_RESEARCH_REQUESTED',
  CANDIDATE_DISMISSED: 'CANDIDATE_DISMISSED',
} as const;

export type MayaEventType = (typeof MAYA_EVENT_TYPES)[keyof typeof MAYA_EVENT_TYPES];

export interface DomainEvent {
  eventType: MayaEventType;
  aggregateType: string;
  aggregateId: string;
  workflowId?: string;
  opportunityId?: string;
  actorType: 'HUMAN' | 'AGENT' | 'SYSTEM' | 'SOURCE';
  actorId?: string;
  source: string;
  correlationId: string;
  causationId?: string;
  idempotencyKey: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
}

/**
 * Emit a domain event to the opportunity_events table.
 * Idempotent: duplicate idempotency_key is silently ignored.
 */
export async function emitEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: DomainEvent
): Promise<string | null> {
  const { data, error } = await supabase
    .from('opportunity_events')
    .upsert(
      {
        event_type: event.eventType,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        workflow_id: event.workflowId,
        opportunity_id: event.opportunityId,
        actor_type: event.actorType,
        actor_id: event.actorId,
        source: event.source,
        correlation_id: event.correlationId,
        causation_id: event.causationId,
        idempotency_key: event.idempotencyKey,
        schema_version: event.schemaVersion,
        payload: event.payload,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    )
    .select('id')
    .single();

  if (error) {
    // Duplicate idempotency key — expected, not an error
    if (error.code === '23505' || error.message?.includes('duplicate')) return null;
    console.error(`[Events] Failed to emit ${event.eventType}:`, error.message);
    return null;
  }

  return data?.id || null;
}
