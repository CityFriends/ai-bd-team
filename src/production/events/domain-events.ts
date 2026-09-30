/**
 * Shared Domain Event Infrastructure
 *
 * Typed durable events for all production workflows.
 * Events are the communication mechanism between pipeline stages.
 * All events persist to the shared `opportunity_events` table.
 */

export interface DomainEvent {
  eventType: string;
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
    if (error.code === '23505' || error.message?.includes('duplicate')) return null;
    console.error(`[Events] Failed to emit ${event.eventType}:`, error.message);
    return null;
  }

  return data?.id || null;
}
