/**
 * Agent Memory System
 *
 * Persistent memory for agent experiences, insights, and learned patterns.
 * This enables emergent, autonomous behavior by letting agents reference
 * past experiences in their decisions.
 */

import { getSupabase } from '../integrations/database/client.js';
import type { AgentMemory, AgentName, MemoryType, StoreMemoryOptions } from './types.js';

/**
 * Store a new memory for an agent
 */
export async function storeMemory(
  agent: AgentName,
  type: MemoryType,
  content: string,
  options: StoreMemoryOptions = {}
): Promise<AgentMemory | null> {
  const { relatedOpportunityId, relatedEventId, importance = 5, tags, expiresAt } = options;

  try {
    const { data, error } = await getSupabase()
      .from('agent_memories')
      .insert({
        agent,
        memory_type: type,
        content,
        related_opportunity_id: relatedOpportunityId || null,
        related_event_id: relatedEventId || null,
        importance,
        tags: tags || null,
        expires_at: expiresAt?.toISOString() || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[Memory] Failed to store memory:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[Memory] Error storing memory:', err);
    return null;
  }
}

/**
 * Query recent memories for an agent
 */
export async function getRecentMemories(
  agent: AgentName,
  limit: number = 10
): Promise<AgentMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_memories')
      .select()
      .eq('agent', agent)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Memory] Could not get recent memories:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[Memory] Error getting recent memories:', err);
    return [];
  }
}

/**
 * Query memories by type for an agent
 */
export async function getMemoriesByType(
  agent: AgentName,
  type: MemoryType,
  limit: number = 10
): Promise<AgentMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_memories')
      .select()
      .eq('agent', agent)
      .eq('memory_type', type)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Memory] Could not get memories by type:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[Memory] Error getting memories by type:', err);
    return [];
  }
}

/**
 * Query memories related to a specific opportunity
 */
export async function getMemoriesForOpportunity(opportunityId: string): Promise<AgentMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_memories')
      .select()
      .eq('related_opportunity_id', opportunityId)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Memory] Could not get memories for opportunity:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[Memory] Error getting memories for opportunity:', err);
    return [];
  }
}

/**
 * Search memories by tags for an agent
 */
export async function searchMemoriesByTags(
  agent: AgentName,
  tags: string[],
  limit: number = 10
): Promise<AgentMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_memories')
      .select()
      .eq('agent', agent)
      .overlaps('tags', tags)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Memory] Could not search memories by tags:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[Memory] Error searching memories by tags:', err);
    return [];
  }
}

/**
 * Get high-importance memories for an agent (useful for reflection prompts)
 */
export async function getImportantMemories(
  agent: AgentName,
  minImportance: number = 7,
  limit: number = 10
): Promise<AgentMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_memories')
      .select()
      .eq('agent', agent)
      .gte('importance', minImportance)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[Memory] Could not get important memories:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('[Memory] Error getting important memories:', err);
    return [];
  }
}

/**
 * Mark a memory as accessed (for relevance tracking)
 */
export async function touchMemory(memoryId: string): Promise<boolean> {
  try {
    const { error } = await getSupabase()
      .from('agent_memories')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('id', memoryId);

    if (error) {
      console.warn('[Memory] Could not touch memory:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[Memory] Error touching memory:', err);
    return false;
  }
}

// Re-export types for convenience
export type {
  AgentMemory,
  AgentName,
  MemoryType,
  StoreMemoryOptions,
  MemoryQueryOptions,
} from './types.js';
