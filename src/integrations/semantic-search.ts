// Semantic search integration using pgvector
// Enables similarity-based retrieval across memory tables

import { getSupabase } from './supabase.js';
import { embed, formatForPgVector, cosineSimilarity } from './embeddings.js';

export interface SemanticSearchResult<T = any> {
  id: string;
  similarity: number;
  data: T;
}

export interface SearchOptions {
  threshold?: number;  // Minimum similarity (0-1), default 0.7
  limit?: number;      // Max results, default 5
  filter?: Record<string, any>;  // Additional WHERE conditions
}

/**
 * Search user_context by semantic similarity
 */
export async function searchUserContext(
  query: string,
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { threshold = 0.7, limit = 5 } = options;

  try {
    const queryEmbedding = await embed(query);
    const embeddingStr = formatForPgVector(queryEmbedding);

    const { data, error } = await getSupabase()
      .rpc('match_user_context', {
        query_embedding: embeddingStr,
        match_threshold: threshold,
        match_count: limit,
      });

    if (error) {
      // Fallback to manual query if RPC doesn't exist
      console.warn('RPC match_user_context not found, using manual query');
      return await manualSemanticSearch('user_context', queryEmbedding, options);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      similarity: row.similarity,
      data: row,
    }));
  } catch (err) {
    console.error('searchUserContext failed:', err);
    return [];
  }
}

/**
 * Search conversation_memory by semantic similarity
 */
export async function searchConversationMemory(
  query: string,
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { threshold = 0.7, limit = 5 } = options;

  try {
    const queryEmbedding = await embed(query);
    return await manualSemanticSearch('conversation_memory', queryEmbedding, { ...options, threshold, limit });
  } catch (err) {
    console.error('searchConversationMemory failed:', err);
    return [];
  }
}

/**
 * Search decision_patterns by semantic similarity
 */
export async function searchDecisionPatterns(
  query: string,
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { threshold = 0.7, limit = 5 } = options;

  try {
    const queryEmbedding = await embed(query);
    return await manualSemanticSearch('decision_patterns', queryEmbedding, { ...options, threshold, limit });
  } catch (err) {
    console.error('searchDecisionPatterns failed:', err);
    return [];
  }
}

/**
 * Search extracted_facts by semantic similarity
 */
export async function searchExtractedFacts(
  query: string,
  options: SearchOptions & { factType?: string; subject?: string } = {}
): Promise<SemanticSearchResult[]> {
  const { threshold = 0.7, limit = 5, factType, subject } = options;

  try {
    const queryEmbedding = await embed(query);

    // Build filter for fact type and subject
    const filter: Record<string, any> = { still_relevant: true };
    if (factType) filter.fact_type = factType;
    if (subject) filter.subject = subject;

    return await manualSemanticSearch('extracted_facts', queryEmbedding, {
      threshold,
      limit,
      filter,
    });
  } catch (err) {
    console.error('searchExtractedFacts failed:', err);
    return [];
  }
}

/**
 * Search thread_summaries by semantic similarity
 */
export async function searchThreadSummaries(
  query: string,
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { threshold = 0.7, limit = 5 } = options;

  try {
    const queryEmbedding = await embed(query);
    return await manualSemanticSearch('thread_summaries', queryEmbedding, { ...options, threshold, limit });
  } catch (err) {
    console.error('searchThreadSummaries failed:', err);
    return [];
  }
}

/**
 * Manual semantic search using raw SQL
 * Used as fallback when RPC functions aren't available
 */
async function manualSemanticSearch(
  tableName: string,
  queryEmbedding: number[],
  options: SearchOptions = {}
): Promise<SemanticSearchResult[]> {
  const { threshold = 0.7, limit = 5, filter = {} } = options;

  try {
    // First get all rows with embeddings from the table
    let query = getSupabase()
      .from(tableName)
      .select('*')
      .not('embedding', 'is', null);

    // Apply additional filters
    for (const [key, value] of Object.entries(filter)) {
      query = query.eq(key, value);
    }

    const { data, error } = await query.limit(100); // Get more than needed for filtering

    if (error) {
      console.error(`Manual search on ${tableName} failed:`, error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Compute similarities locally
    const results: SemanticSearchResult[] = [];

    for (const row of data) {
      if (!row.embedding) continue;

      // Parse the embedding from the database
      let rowEmbedding: number[];
      if (typeof row.embedding === 'string') {
        // Parse string format [0.1,0.2,...]
        rowEmbedding = row.embedding
          .replace(/[\[\]]/g, '')
          .split(',')
          .map(Number);
      } else if (Array.isArray(row.embedding)) {
        rowEmbedding = row.embedding;
      } else {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, rowEmbedding);

      if (similarity >= threshold) {
        results.push({
          id: row.id,
          similarity,
          data: row,
        });
      }
    }

    // Sort by similarity descending and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  } catch (err) {
    console.error(`Manual semantic search on ${tableName} failed:`, err);
    return [];
  }
}

/**
 * Unified semantic search across all memory tables
 * Returns combined, deduplicated results ranked by similarity
 */
export async function searchAllMemory(
  query: string,
  options: SearchOptions = {}
): Promise<{
  userContext: SemanticSearchResult[];
  conversationMemory: SemanticSearchResult[];
  decisionPatterns: SemanticSearchResult[];
  extractedFacts: SemanticSearchResult[];
}> {
  const [userContext, conversationMemory, decisionPatterns, extractedFacts] = await Promise.all([
    searchUserContext(query, options),
    searchConversationMemory(query, options),
    searchDecisionPatterns(query, options),
    searchExtractedFacts(query, options),
  ]);

  return {
    userContext,
    conversationMemory,
    decisionPatterns,
    extractedFacts,
  };
}

/**
 * Find similar past queries in the semantic cache
 */
export async function findSimilarCachedQuery(
  query: string,
  cacheType: string,
  threshold: number = 0.92
): Promise<{ query: string; result: any; similarity: number } | null> {
  try {
    const queryEmbedding = await embed(query);

    // Get non-expired cache entries of this type
    const { data, error } = await getSupabase()
      .from('semantic_cache')
      .select('*')
      .eq('cache_type', cacheType)
      .gt('expires_at', new Date().toISOString())
      .not('query_embedding', 'is', null)
      .limit(50);

    if (error || !data || data.length === 0) {
      return null;
    }

    // Find the most similar cached query
    let bestMatch: { query: string; result: any; similarity: number } | null = null;

    for (const row of data) {
      if (!row.query_embedding) continue;

      let cachedEmbedding: number[];
      if (typeof row.query_embedding === 'string') {
        cachedEmbedding = row.query_embedding
          .replace(/[\[\]]/g, '')
          .split(',')
          .map(Number);
      } else if (Array.isArray(row.query_embedding)) {
        cachedEmbedding = row.query_embedding;
      } else {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, cachedEmbedding);

      if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = {
          query: row.query_text,
          result: row.result,
          similarity,
        };
      }
    }

    // Update hit count if we found a match
    if (bestMatch) {
      // Find the matching row to update
      const { data: matchData } = await getSupabase()
        .from('semantic_cache')
        .select('id, hit_count')
        .eq('query_text', bestMatch.query)
        .eq('cache_type', cacheType)
        .single();

      if (matchData) {
        await getSupabase()
          .from('semantic_cache')
          .update({
            hit_count: (matchData.hit_count || 0) + 1,
            last_hit_at: new Date().toISOString(),
          })
          .eq('id', matchData.id);
      }
    }

    return bestMatch;
  } catch (err) {
    console.error('findSimilarCachedQuery failed:', err);
    return null;
  }
}

/**
 * Store a query result in the semantic cache
 */
export async function storeCachedQuery(
  query: string,
  result: any,
  cacheType: string,
  ttlHours: number = 24
): Promise<void> {
  try {
    const queryEmbedding = await embed(query);
    const embeddingStr = formatForPgVector(queryEmbedding);

    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    await getSupabase()
      .from('semantic_cache')
      .insert({
        query_text: query,
        query_embedding: embeddingStr,
        result,
        cache_type: cacheType,
        expires_at: expiresAt,
        hit_count: 0,
      });
  } catch (err) {
    console.error('storeCachedQuery failed:', err);
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache(): Promise<number> {
  try {
    const { data, error } = await getSupabase()
      .from('semantic_cache')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('Cache cleanup failed:', error);
      return 0;
    }

    return data?.length || 0;
  } catch (err) {
    console.error('Cache cleanup failed:', err);
    return 0;
  }
}
