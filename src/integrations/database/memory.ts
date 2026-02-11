import { getSupabase } from './client.js';

// ============================================
// AGENT MEMORY OPERATIONS
// ============================================

export interface AgentMemoryEntry {
  agent: string;
  message_ts: string;
  thread_ts?: string;
  response_text: string;
  sources: string[];
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export async function logAgentMemory(entry: AgentMemoryEntry): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from('agent_memory')
      .insert({
        ...entry,
        created_at: new Date().toISOString(),
      });

    if (error) {
      // Table might not exist yet, log but don't throw
      console.warn('Could not log to agent_memory:', error.message);
    }
  } catch (err) {
    console.warn('Could not log to agent_memory:', err);
  }
}

export async function getAgentMemory(
  agent: string,
  limit: number = 20
): Promise<AgentMemoryEntry[]> {
  const { data, error } = await getSupabase()
    .from('agent_memory')
    .select()
    .eq('agent', agent)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Could not read agent_memory:', error.message);
    return [];
  }
  return data || [];
}

// Get recent responses in a thread (to check if another agent just responded)
export async function getRecentThreadResponses(
  threadTs: string,
  withinSeconds: number = 30
): Promise<AgentMemoryEntry[]> {
  const since = new Date(Date.now() - withinSeconds * 1000).toISOString();

  try {
    const { data, error } = await getSupabase()
      .from('agent_memory')
      .select()
      .eq('thread_ts', threadTs)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ============================================
// MESSAGE COORDINATION
// ============================================

export interface MessageClaim {
  message_ts: string;
  thread_ts?: string;
  agent: string;
  claimed_at: string;
  responded: boolean;
}

export async function claimMessage(
  messageTs: string,
  agent: string,
  threadTs?: string
): Promise<boolean> {
  try {
    // Try to insert a claim - will fail if message already claimed
    const { error } = await getSupabase().from('message_claims').insert({
      message_ts: messageTs,
      thread_ts: threadTs,
      agent,
      claimed_at: new Date().toISOString(),
      responded: false,
    });

    if (error) {
      // Unique constraint violation = already claimed
      if (error.code === '23505') {
        return false;
      }
      // Table might not exist - allow response
      console.warn('Could not claim message:', error.message);
      return true;
    }
    return true;
  } catch (err) {
    console.warn('Could not claim message:', err);
    return true; // Allow response if claiming fails
  }
}

export async function getMessageClaim(messageTs: string): Promise<MessageClaim | null> {
  try {
    const { data, error } = await getSupabase()
      .from('message_claims')
      .select()
      .eq('message_ts', messageTs)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function markMessageResponded(messageTs: string, agent: string): Promise<void> {
  try {
    await getSupabase()
      .from('message_claims')
      .update({ responded: true })
      .eq('message_ts', messageTs)
      .eq('agent', agent);
  } catch (err) {
    console.warn('Could not mark message responded:', err);
  }
}

// ============================================
// CONVERSATION MEMORY (key moments)
// ============================================

export interface ConversationMemory {
  id?: string;
  memory_type: 'milestone' | 'decision' | 'joke' | 'frustration' | 'win' | 'loss';
  summary: string;
  full_context?: string;
  participants?: string[];
  importance?: number;
}

export async function saveConversationMemory(memory: ConversationMemory): Promise<void> {
  try {
    await getSupabase()
      .from('conversation_memory')
      .insert({
        ...memory,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not save conversation memory:', err);
  }
}

export async function getConversationMemories(limit: number = 10): Promise<ConversationMemory[]> {
  try {
    const { data, error } = await getSupabase()
      .from('conversation_memory')
      .select()
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Save conversation memory with embedding for semantic search
 */
export async function saveConversationMemoryWithEmbedding(
  memory: ConversationMemory,
  embedding?: number[]
): Promise<void> {
  try {
    const insertData: Record<string, unknown> = {
      ...memory,
      created_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    await getSupabase().from('conversation_memory').insert(insertData);
  } catch (err) {
    console.warn('Could not save conversation memory:', err);
  }
}

// ============================================
// INSIDE JOKES
// ============================================

export interface InsideJoke {
  id?: string;
  reference: string;
  full_context: string;
  origin_story?: string;
  times_used?: number;
}

export async function saveInsideJoke(joke: InsideJoke): Promise<void> {
  try {
    await getSupabase()
      .from('inside_jokes')
      .insert({
        ...joke,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not save inside joke:', err);
  }
}

export async function getInsideJokes(limit: number = 5): Promise<InsideJoke[]> {
  try {
    const { data, error } = await getSupabase()
      .from('inside_jokes')
      .select()
      .order('times_used', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function incrementJokeUsage(reference: string): Promise<void> {
  try {
    const { data } = await getSupabase()
      .from('inside_jokes')
      .select('times_used')
      .eq('reference', reference)
      .single();

    if (data) {
      await getSupabase()
        .from('inside_jokes')
        .update({ times_used: (data.times_used || 0) + 1, last_used: new Date().toISOString() })
        .eq('reference', reference);
    }
  } catch {
    // ignore
  }
}

// ============================================
// DECISION PATTERNS
// ============================================

export interface DecisionPattern {
  decision: 'go' | 'no_go' | 'passed';
  reasoning?: string;
  agency?: string;
  opportunity_type?: string;
  key_factors?: string[];
}

export async function saveDecisionPattern(pattern: DecisionPattern): Promise<void> {
  try {
    await getSupabase()
      .from('decision_patterns')
      .insert({
        ...pattern,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not save decision pattern:', err);
  }
}

export async function getDecisionPatterns(limit: number = 10): Promise<DecisionPattern[]> {
  try {
    const { data, error } = await getSupabase()
      .from('decision_patterns')
      .select()
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Save decision pattern with embedding for semantic search
 */
export async function saveDecisionPatternWithEmbedding(
  pattern: DecisionPattern,
  embedding?: number[]
): Promise<void> {
  try {
    const insertData: Record<string, unknown> = {
      ...pattern,
      created_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    await getSupabase().from('decision_patterns').insert(insertData);
  } catch (err) {
    console.warn('Could not save decision pattern:', err);
  }
}

// ============================================
// EXTRACTED FACTS
// ============================================

export interface ExtractedFact {
  id?: string;
  fact_type: 'preference' | 'decision' | 'context' | 'pattern';
  subject?: string;
  content: string;
  source_thread_ts?: string;
  source_message_ts?: string;
  extracted_by: string;
  confidence?: number;
  embedding?: string;
  verified?: boolean;
  still_relevant?: boolean;
  expires_at?: string;
  created_at?: string;
}

/**
 * Save an extracted fact with optional embedding
 */
export async function saveExtractedFact(
  fact: Omit<ExtractedFact, 'id' | 'created_at'>,
  embedding?: number[]
): Promise<ExtractedFact | null> {
  try {
    const insertData: Record<string, unknown> = {
      ...fact,
      created_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    const { data, error } = await getSupabase()
      .from('extracted_facts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Could not save extracted fact:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not save extracted fact:', err);
    return null;
  }
}

/**
 * Get extracted facts by type and subject
 */
export async function getExtractedFacts(
  options: { factType?: string; subject?: string; limit?: number } = {}
): Promise<ExtractedFact[]> {
  const { factType, subject, limit = 20 } = options;

  try {
    let query = getSupabase()
      .from('extracted_facts')
      .select('*')
      .eq('still_relevant', true)
      .order('created_at', { ascending: false });

    if (factType) {
      query = query.eq('fact_type', factType);
    }
    if (subject) {
      query = query.eq('subject', subject);
    }

    const { data, error } = await query.limit(limit);

    if (error) {
      console.warn('Could not get extracted facts:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Could not get extracted facts:', err);
    return [];
  }
}

// ============================================
// GET ALL CONVERSATIONAL CONTEXT
// ============================================

import { getUserContext } from './users.js';

export async function getConversationalContext(): Promise<{
  userContext: Awaited<ReturnType<typeof getUserContext>>;
  memories: ConversationMemory[];
  insideJokes: InsideJoke[];
  decisionPatterns: DecisionPattern[];
}> {
  const [userContext, memories, insideJokes, decisionPatterns] = await Promise.all([
    getUserContext('lapedra', 5),
    getConversationMemories(5),
    getInsideJokes(3),
    getDecisionPatterns(5),
  ]);

  return { userContext, memories, insideJokes, decisionPatterns };
}
