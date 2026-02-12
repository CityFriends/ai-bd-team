// Event Bus - Core functions for publishing and claiming events
import { getSupabase } from '../integrations/database/client.js';
import {
  EventType,
  EventTypes,
  ClaimedEvent,
  AgentEvent,
  validatePayload,
  isValidEventType,
} from './eventTypes.js';
import type { LiveAgentName } from '../live/types.js';

// ============================================================
// Types
// ============================================================
export type AgentOrSystem = LiveAgentName | 'system';

export interface PublishEventOptions {
  eventType: EventType;
  sourceAgent: AgentOrSystem;
  payload: Record<string, unknown>;
  targetAgent?: LiveAgentName;
  parentEventId?: string;
  priority?: number; // 1-10, default 5
  channelId?: string;
  threadTs?: string;
  processAfter?: Date;
  expiresAt?: Date;
}

export interface PublishResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

export interface CompleteEventOptions {
  eventId: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

// ============================================================
// Publish Event
// ============================================================
export async function publishEvent(options: PublishEventOptions): Promise<PublishResult> {
  const {
    eventType,
    sourceAgent,
    payload,
    targetAgent,
    parentEventId,
    priority = 5,
    channelId,
    threadTs,
    processAfter,
    expiresAt,
  } = options;

  // Validate event type
  if (!isValidEventType(eventType)) {
    return { success: false, error: `Invalid event type: ${eventType}` };
  }

  // Validate payload
  const validation = validatePayload(eventType, payload);
  if (!validation.success) {
    const zodError = validation.error;
    console.error(`[EventBus] Invalid payload for ${eventType}:`, zodError.errors);
    return {
      success: false,
      error: `Invalid payload: ${zodError.errors.map((e) => e.message).join(', ')}`,
    };
  }

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('publish_event', {
      p_event_type: eventType,
      p_source_agent: sourceAgent,
      p_payload: payload,
      p_target_agent: targetAgent || null,
      p_parent_event_id: parentEventId || null,
      p_priority: priority,
      p_channel_id: channelId || null,
      p_thread_ts: threadTs || null,
      p_process_after: processAfter?.toISOString() || null,
      p_expires_at: expiresAt?.toISOString() || null,
    });

    if (error) {
      console.error(`[EventBus] Failed to publish ${eventType}:`, error);
      return { success: false, error: error.message };
    }

    const eventId = data as string;
    console.log(`[EventBus] Published ${eventType} from ${sourceAgent} (id: ${eventId})`);

    return { success: true, eventId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[EventBus] Exception publishing ${eventType}:`, err);
    return { success: false, error: errorMessage };
  }
}

// ============================================================
// Claim Events
// ============================================================
export async function claimEvents(
  agent: LiveAgentName,
  limit: number = 10
): Promise<ClaimedEvent[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('claim_events', {
      p_agent: agent,
      p_limit: limit,
    });

    if (error) {
      console.error(`[EventBus] Failed to claim events for ${agent}:`, error);
      return [];
    }

    const events = (data || []) as ClaimedEvent[];

    if (events.length > 0) {
      console.log(
        `[EventBus] ${agent} claimed ${events.length} event(s): ${events.map((e) => e.event_type).join(', ')}`
      );
    }

    return events;
  } catch (err) {
    console.error(`[EventBus] Exception claiming events for ${agent}:`, err);
    return [];
  }
}

// ============================================================
// Complete Event
// ============================================================
export async function completeEvent(options: CompleteEventOptions): Promise<boolean> {
  const { eventId, success, result, error } = options;

  try {
    const supabase = getSupabase();

    const { data, error: rpcError } = await supabase.rpc('complete_event', {
      p_event_id: eventId,
      p_success: success,
      p_result: result || null,
      p_error: error || null,
    });

    if (rpcError) {
      console.error(`[EventBus] Failed to complete event ${eventId}:`, rpcError);
      return false;
    }

    const status = success ? 'completed' : 'failed';
    console.log(`[EventBus] Event ${eventId} marked as ${status}`);

    return true;
  } catch (err) {
    console.error(`[EventBus] Exception completing event ${eventId}:`, err);
    return false;
  }
}

// ============================================================
// Get Pending Events (read-only, for monitoring)
// ============================================================
export async function getPendingEvents(
  eventType?: EventType,
  limit: number = 100
): Promise<AgentEvent[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_pending_events', {
      p_event_type: eventType || null,
      p_limit: limit,
    });

    if (error) {
      console.error('[EventBus] Failed to get pending events:', error);
      return [];
    }

    return (data || []) as AgentEvent[];
  } catch (err) {
    console.error('[EventBus] Exception getting pending events:', err);
    return [];
  }
}

// ============================================================
// Get Event Chain (for visualization)
// ============================================================
export interface EventChainItem {
  id: string;
  event_type: string;
  source_agent: string;
  status: string;
  chain_depth: number;
  created_at: string;
  completed_at: string | null;
}

export async function getEventChain(eventId: string): Promise<EventChainItem[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_event_chain', {
      p_event_id: eventId,
    });

    if (error) {
      console.error(`[EventBus] Failed to get event chain for ${eventId}:`, error);
      return [];
    }

    return (data || []) as EventChainItem[];
  } catch (err) {
    console.error(`[EventBus] Exception getting event chain for ${eventId}:`, err);
    return [];
  }
}

// ============================================================
// Expire Stale Events (for cron cleanup)
// ============================================================
export async function expireStaleEvents(): Promise<number> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('expire_stale_events');

    if (error) {
      console.error('[EventBus] Failed to expire stale events:', error);
      return 0;
    }

    const count = data as number;
    if (count > 0) {
      console.log(`[EventBus] Expired ${count} stale event(s)`);
    }

    return count;
  } catch (err) {
    console.error('[EventBus] Exception expiring stale events:', err);
    return 0;
  }
}

// ============================================================
// Get Event by ID
// ============================================================
export async function getEventById(eventId: string): Promise<AgentEvent | null> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('agent_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      console.error(`[EventBus] Failed to get event ${eventId}:`, error);
      return null;
    }

    return data as AgentEvent;
  } catch (err) {
    console.error(`[EventBus] Exception getting event ${eventId}:`, err);
    return null;
  }
}

// ============================================================
// Get Events by Thread (for thread context)
// ============================================================
export async function getEventsByThread(
  threadTs: string,
  channelId?: string
): Promise<AgentEvent[]> {
  try {
    const supabase = getSupabase();

    let query = supabase
      .from('agent_events')
      .select('*')
      .eq('thread_ts', threadTs)
      .order('created_at', { ascending: true });

    if (channelId) {
      query = query.eq('channel_id', channelId);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`[EventBus] Failed to get events for thread ${threadTs}:`, error);
      return [];
    }

    return (data || []) as AgentEvent[];
  } catch (err) {
    console.error(`[EventBus] Exception getting events for thread ${threadTs}:`, err);
    return [];
  }
}

// ============================================================
// Update Agent Subscription
// ============================================================
export interface SubscriptionUpdate {
  agent: LiveAgentName;
  eventType: EventType;
  enabled?: boolean;
  priorityOverride?: number | null;
  filterConditions?: Record<string, unknown>;
}

export async function updateSubscription(update: SubscriptionUpdate): Promise<boolean> {
  const { agent, eventType, enabled, priorityOverride, filterConditions } = update;

  try {
    const supabase = getSupabase();

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (enabled !== undefined) {
      updates.enabled = enabled;
    }
    if (priorityOverride !== undefined) {
      updates.priority_override = priorityOverride;
    }
    if (filterConditions !== undefined) {
      updates.filter_conditions = filterConditions;
    }

    const { error } = await supabase
      .from('agent_subscriptions')
      .update(updates)
      .eq('agent', agent)
      .eq('event_type', eventType);

    if (error) {
      console.error(`[EventBus] Failed to update subscription for ${agent}/${eventType}:`, error);
      return false;
    }

    console.log(`[EventBus] Updated subscription for ${agent}/${eventType}`);
    return true;
  } catch (err) {
    console.error(`[EventBus] Exception updating subscription:`, err);
    return false;
  }
}

// ============================================================
// Get Agent Subscriptions
// ============================================================
export interface AgentSubscription {
  id: string;
  agent: string;
  event_type: string;
  priority_override: number | null;
  filter_conditions: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function getAgentSubscriptions(agent: LiveAgentName): Promise<AgentSubscription[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('agent_subscriptions')
      .select('*')
      .eq('agent', agent);

    if (error) {
      console.error(`[EventBus] Failed to get subscriptions for ${agent}:`, error);
      return [];
    }

    return (data || []) as AgentSubscription[];
  } catch (err) {
    console.error(`[EventBus] Exception getting subscriptions for ${agent}:`, err);
    return [];
  }
}

// ============================================================
// Convenience Publishers
// ============================================================

/**
 * Publish a NEW_OPPORTUNITY event
 */
export async function publishNewOpportunity(
  sourceAgent: AgentOrSystem,
  payload: Record<string, unknown>,
  slackContext?: { channelId: string; threadTs: string }
): Promise<PublishResult> {
  return publishEvent({
    eventType: EventTypes.NEW_OPPORTUNITY,
    sourceAgent,
    payload,
    priority: 3, // High priority for new opportunities
    channelId: slackContext?.channelId,
    threadTs: slackContext?.threadTs,
  });
}

/**
 * Publish a chain event (inherits parent context)
 */
export async function publishChainEvent(
  eventType: EventType,
  sourceAgent: AgentOrSystem,
  payload: Record<string, unknown>,
  parentEvent: ClaimedEvent,
  priority?: number
): Promise<PublishResult> {
  return publishEvent({
    eventType,
    sourceAgent,
    payload,
    parentEventId: parentEvent.id,
    priority: priority || parentEvent.priority,
    channelId: parentEvent.channel_id || undefined,
    threadTs: parentEvent.thread_ts || undefined,
  });
}

/**
 * Publish a targeted event to a specific agent
 */
export async function publishTargetedEvent(
  eventType: EventType,
  sourceAgent: AgentOrSystem,
  targetAgent: LiveAgentName,
  payload: Record<string, unknown>,
  slackContext?: { channelId: string; threadTs: string }
): Promise<PublishResult> {
  return publishEvent({
    eventType,
    sourceAgent,
    targetAgent,
    payload,
    channelId: slackContext?.channelId,
    threadTs: slackContext?.threadTs,
  });
}
