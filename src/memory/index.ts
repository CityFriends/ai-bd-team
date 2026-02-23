/**
 * Agent Memory System
 *
 * Persistent memory for agent experiences, insights, and learned patterns.
 * This enables emergent, autonomous behavior by letting agents reference
 * past experiences in their decisions.
 */

import { getSupabase } from '../integrations/database/client.js';
import { embed, formatForPgVector } from '../integrations/embeddings.js';
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

/**
 * Search memories by semantic similarity
 * Requires embeddings to be stored on memories
 */
export async function searchMemoriesBySimilarity(
  query: string,
  options: {
    agent?: AgentName;
    limit?: number;
    minSimilarity?: number;
  } = {}
): Promise<Array<AgentMemory & { similarity: number }>> {
  const { agent, limit = 10, minSimilarity = 0.7 } = options;

  try {
    // Generate embedding for query
    const queryEmbedding = await embed(query);
    const embeddingStr = formatForPgVector(queryEmbedding);

    // Use Supabase's vector similarity search
    // This requires the pgvector extension and a similarity function
    const queryBuilder = getSupabase().rpc('match_agent_memories', {
      query_embedding: embeddingStr,
      match_threshold: minSimilarity,
      match_count: limit,
    });

    if (agent) {
      // Note: The RPC function would need to support agent filtering
      // For now, we filter after the fact
    }

    const { data, error } = await queryBuilder;

    if (error) {
      // If the RPC doesn't exist, fall back to manual search
      if (error.code === '42883') {
        console.warn('[Memory] match_agent_memories function not found, using fallback');
        return await fallbackSemanticSearch(query, { agent, limit });
      }
      console.warn('[Memory] Semantic search failed:', error.message);
      return [];
    }

    // Filter by agent if needed
    let results = data || [];
    if (agent) {
      results = results.filter((m: AgentMemory) => m.agent === agent);
    }

    return results.slice(0, limit);
  } catch (err) {
    console.warn('[Memory] Error in semantic search:', err);
    return [];
  }
}

/**
 * Fallback semantic search when RPC is not available
 * Less efficient but works without custom SQL functions
 */
async function fallbackSemanticSearch(
  query: string,
  options: { agent?: AgentName; limit?: number }
): Promise<Array<AgentMemory & { similarity: number }>> {
  const { agent, limit = 10 } = options;

  try {
    // Get recent memories with embeddings
    let queryBuilder = getSupabase()
      .from('agent_memories')
      .select()
      .not('embedding', 'is', null)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('created_at', { ascending: false })
      .limit(100); // Get more to filter

    if (agent) {
      queryBuilder = queryBuilder.eq('agent', agent);
    }

    const { data, error } = await queryBuilder;

    if (error || !data) {
      return [];
    }

    // Generate query embedding
    const queryEmbedding = await embed(query);

    // Calculate similarities manually
    const { cosineSimilarity, parseFromPgVector } = await import('../integrations/embeddings.js');

    const withSimilarity = data
      .filter((m) => m.embedding)
      .map((m) => {
        const memoryEmbedding = parseFromPgVector(m.embedding);
        const similarity = cosineSimilarity(queryEmbedding, memoryEmbedding);
        return { ...m, similarity };
      })
      .filter((m) => m.similarity >= 0.7)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return withSimilarity;
  } catch (err) {
    console.warn('[Memory] Fallback semantic search failed:', err);
    return [];
  }
}

/**
 * Add embedding to an existing memory (for batch processing)
 */
export async function addEmbeddingToMemory(memoryId: string): Promise<boolean> {
  try {
    // Get the memory content
    const { data: memory, error: fetchError } = await getSupabase()
      .from('agent_memories')
      .select('content')
      .eq('id', memoryId)
      .single();

    if (fetchError || !memory) {
      console.warn('[Memory] Could not fetch memory for embedding:', fetchError?.message);
      return false;
    }

    // Generate embedding
    const embedding = await embed(memory.content);
    const embeddingStr = formatForPgVector(embedding);

    // Update the memory
    const { error: updateError } = await getSupabase()
      .from('agent_memories')
      .update({ embedding: embeddingStr })
      .eq('id', memoryId);

    if (updateError) {
      console.warn('[Memory] Could not update embedding:', updateError.message);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[Memory] Error adding embedding:', err);
    return false;
  }
}

/**
 * Store memory with embedding (for high-importance memories)
 */
export async function storeMemoryWithEmbedding(
  agent: AgentName,
  type: MemoryType,
  content: string,
  options: StoreMemoryOptions = {}
): Promise<AgentMemory | null> {
  try {
    // Generate embedding
    const embedding = await embed(content);
    const embeddingStr = formatForPgVector(embedding);

    const { relatedOpportunityId, relatedEventId, importance = 5, tags, expiresAt } = options;

    const { data, error } = await getSupabase()
      .from('agent_memories')
      .insert({
        agent,
        memory_type: type,
        content,
        related_opportunity_id: relatedOpportunityId || null,
        related_event_id: relatedEventId || null,
        importance,
        embedding: embeddingStr,
        tags: tags || null,
        expires_at: expiresAt?.toISOString() || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[Memory] Failed to store memory with embedding:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[Memory] Error storing memory with embedding:', err);
    return null;
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
