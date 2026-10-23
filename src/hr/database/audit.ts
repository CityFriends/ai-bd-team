/**
 * HR Audit Event Logger
 *
 * Append-only audit trail for HR operations.
 * Does not record salary values, raw Slack messages, tokens, or
 * other sensitive payloads.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEvent {
  eventType: string;
  actorType: 'human' | 'system' | 'ai';
  actorId: string;
  targetType?: string;
  targetId?: string;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  correlationId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Record an audit event. Returns the event ID or null on failure.
 * Audit failures are logged but do not block the calling operation.
 */
export async function recordAuditEvent(
  db: SupabaseClient,
  event: AuditEvent
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('hr_audit_events')
      .insert({
        event_type: event.eventType,
        actor_type: event.actorType,
        actor_id: event.actorId,
        target_type: event.targetType || null,
        target_id: event.targetId || null,
        action: event.action,
        outcome: event.outcome,
        correlation_id: event.correlationId || null,
        idempotency_key: event.idempotencyKey || null,
        metadata: event.metadata || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[HR Audit] Failed to record event:', error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[HR Audit] Unexpected error:', err instanceof Error ? err.message : err);
    return null;
  }
}
