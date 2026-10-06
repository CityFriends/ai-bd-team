/**
 * Patricia Operational Actions
 *
 * Every action Patricia takes is auditable. This module provides
 * the recording layer for the audit trail.
 *
 * Zero LLM calls.
 */

import type { SupabaseClient, ActionType } from './types.js';

export interface RecordActionInput {
  idempotencyKey: string;
  actionType: ActionType;
  targetType: string;
  targetId: string;
  triggeringEventType?: string;
  triggeringEventId?: string;
  evidence?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/**
 * Record an operational action idempotently.
 */
export async function recordAction(
  supabase: SupabaseClient,
  input: RecordActionInput
): Promise<string | null> {
  const { data, error } = await supabase
    .from('patricia_operational_actions')
    .upsert(
      {
        idempotency_key: input.idempotencyKey,
        action_type: input.actionType,
        target_type: input.targetType,
        target_id: input.targetId,
        triggering_event_type: input.triggeringEventType || null,
        triggering_event_id: input.triggeringEventId || null,
        evidence: input.evidence || {},
        result: input.result || {},
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    )
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.includes('duplicate')) return null;
    console.error(`[Patricia] Failed to record action: ${error.message}`);
    return null;
  }

  return data?.id || null;
}
