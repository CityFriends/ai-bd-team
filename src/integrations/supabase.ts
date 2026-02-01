import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  Opportunity,
  Agency,
  Company,
  Outreach,
  ConversationThread,
  AgentQueueItem,
  AgentName,
  OpportunityStatus,
  Decision,
  QueueStatus,
} from '../types/index.js';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY');
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

// Opportunity operations
export async function createOpportunity(opportunity: Partial<Opportunity>): Promise<Opportunity> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .insert(opportunity)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOpportunity(id: string): Promise<Opportunity | null> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getOpportunityBySamId(samId: string): Promise<Opportunity | null> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .eq('sam_id', samId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateOpportunity(id: string, updates: Partial<Opportunity>): Promise<Opportunity> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOpportunitiesByStatus(status: OpportunityStatus): Promise<Opportunity[]> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getActiveOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await getSupabase()
    .from('opportunities')
    .select()
    .in('status', ['new', 'researching', 'pursuing'])
    .order('due_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function setOpportunityDecision(
  id: string,
  decision: Decision
): Promise<Opportunity> {
  return updateOpportunity(id, {
    decision,
    decision_date: new Date().toISOString(),
    status: decision === 'go' ? 'pursuing' : decision === 'no_go' ? 'passed' : 'researching',
  });
}

// Agency operations
export async function getAgency(abbreviation: string): Promise<Agency | null> {
  const { data, error } = await getSupabase()
    .from('agencies')
    .select()
    .eq('abbreviation', abbreviation)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function upsertAgency(agency: Partial<Agency>): Promise<Agency> {
  const { data, error } = await getSupabase()
    .from('agencies')
    .upsert(agency, { onConflict: 'abbreviation' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Company operations
export async function createCompany(company: Partial<Company>): Promise<Company> {
  const { data, error } = await getSupabase()
    .from('companies')
    .insert(company)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getCompany(id: string): Promise<Company | null> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function searchCompaniesByCapabilities(keywords: string[]): Promise<Company[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .or(keywords.map(k => `capabilities.ilike.%${k}%`).join(','));

  if (error) throw error;
  return data || [];
}

export async function searchCompaniesByNaics(naicsCodes: string[]): Promise<Company[]> {
  const { data, error } = await getSupabase()
    .from('companies')
    .select()
    .overlaps('naics_codes', naicsCodes);

  if (error) throw error;
  return data || [];
}

export async function updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
  const { data, error } = await getSupabase()
    .from('companies')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Outreach operations
export async function createOutreach(outreach: Partial<Outreach>): Promise<Outreach> {
  const { data, error } = await getSupabase()
    .from('outreach')
    .insert(outreach)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateOutreach(id: string, updates: Partial<Outreach>): Promise<Outreach> {
  const { data, error } = await getSupabase()
    .from('outreach')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getOutreachByOpportunity(opportunityId: string): Promise<Outreach[]> {
  const { data, error } = await getSupabase()
    .from('outreach')
    .select()
    .eq('opportunity_id', opportunityId);

  if (error) throw error;
  return data || [];
}

// Conversation thread operations
export async function createThread(thread: Partial<ConversationThread>): Promise<ConversationThread> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .insert(thread)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getThreadBySlackTs(threadTs: string): Promise<ConversationThread | null> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .select()
    .eq('slack_thread_ts', threadTs)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateThread(id: string, updates: Partial<ConversationThread>): Promise<ConversationThread> {
  const { data, error } = await getSupabase()
    .from('conversation_threads')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Agent queue operations
export async function queueAgentTask(
  agent: AgentName,
  action: string,
  scheduledFor: Date,
  payload: Record<string, unknown> = {},
  opportunityId?: string,
  threadTs?: string
): Promise<AgentQueueItem> {
  const { data, error } = await getSupabase()
    .from('agent_queue')
    .insert({
      agent,
      action,
      scheduled_for: scheduledFor.toISOString(),
      payload,
      opportunity_id: opportunityId,
      thread_ts: threadTs,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPendingTasks(): Promise<AgentQueueItem[]> {
  const now = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from('agent_queue')
    .select()
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function updateTaskStatus(
  id: string,
  status: QueueStatus,
  result?: unknown
): Promise<AgentQueueItem> {
  const updates: Partial<AgentQueueItem> = { status };

  if (status === 'running') {
    updates.started_at = new Date().toISOString();
  } else if (status === 'completed' || status === 'failed') {
    updates.completed_at = new Date().toISOString();
    if (result !== undefined) {
      updates.result = result;
    }
  }

  const { data, error } = await getSupabase()
    .from('agent_queue')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function cancelTask(id: string): Promise<AgentQueueItem> {
  return updateTaskStatus(id, 'cancelled');
}

// Agent memory operations - for logging sources and confidence
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

// Message coordination - prevent multiple agents responding to same message
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
    const { error } = await getSupabase()
      .from('message_claims')
      .insert({
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
// CONVERSATIONAL MEMORY FUNCTIONS
// ============================================

// User context (personal info about Lapedra/Tamara)
export interface UserContext {
  id?: string;
  user_name: string;
  context_type: 'personal' | 'preference' | 'pattern' | 'family' | 'mood';
  content: string;
  mentioned_by?: string;
  still_relevant?: boolean;
}

export async function saveUserContext(context: UserContext): Promise<void> {
  try {
    await getSupabase().from('user_context').insert({
      ...context,
      mentioned_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not save user context:', err);
  }
}

export async function getUserContext(userName: string, limit: number = 10): Promise<UserContext[]> {
  try {
    const { data, error } = await getSupabase()
      .from('user_context')
      .select()
      .eq('user_name', userName)
      .eq('still_relevant', true)
      .order('mentioned_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Conversation memory (key moments)
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
    await getSupabase().from('conversation_memory').insert({
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

// Inside jokes
export interface InsideJoke {
  id?: string;
  reference: string;
  full_context: string;
  origin_story?: string;
  times_used?: number;
}

export async function saveInsideJoke(joke: InsideJoke): Promise<void> {
  try {
    await getSupabase().from('inside_jokes').insert({
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

// Decision patterns
export interface DecisionPattern {
  decision: 'go' | 'no_go' | 'passed';
  reasoning?: string;
  agency?: string;
  opportunity_type?: string;
  key_factors?: string[];
}

export async function saveDecisionPattern(pattern: DecisionPattern): Promise<void> {
  try {
    await getSupabase().from('decision_patterns').insert({
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

// Get all context for conversation (combines everything)
export async function getConversationalContext(): Promise<{
  userContext: UserContext[];
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

// ============================================
// COMPETITOR INTEL FUNCTIONS
// ============================================

export interface CompetitorIntel {
  id?: string;
  company_name: string;
  agency_code?: string;
  intel_type: 'protest' | 'performance' | 'award' | 'debarment' | 'general';
  summary: string;
  source_url?: string;
  source_name?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  discovered_by?: string;
  still_relevant?: boolean;
  discovered_at?: string;
}

// Save competitor intel
export async function saveCompetitorIntel(intel: CompetitorIntel): Promise<void> {
  try {
    await getSupabase().from('competitor_intel').insert({
      ...intel,
      discovered_at: new Date().toISOString(),
      still_relevant: true,
    });
    console.log(`Saved competitor intel: ${intel.company_name} - ${intel.intel_type}`);
  } catch (err) {
    console.warn('Could not save competitor intel:', err);
  }
}

// Get intel for a specific company
export async function getCompetitorIntel(
  companyName: string,
  limit: number = 10
): Promise<CompetitorIntel[]> {
  try {
    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select()
      .ilike('company_name', `%${companyName}%`)
      .eq('still_relevant', true)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get intel for companies at a specific agency
export async function getCompetitorIntelByAgency(
  agencyCode: string,
  limit: number = 20
): Promise<CompetitorIntel[]> {
  try {
    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select()
      .eq('agency_code', agencyCode)
      .eq('still_relevant', true)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Check if we already have recent intel on a company
export async function hasRecentIntel(companyName: string, daysBack: number = 7): Promise<boolean> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select('id')
      .ilike('company_name', `%${companyName}%`)
      .gte('discovered_at', since)
      .limit(1);

    if (error) return false;
    return (data || []).length > 0;
  } catch {
    return false;
  }
}

// Mark intel as no longer relevant
export async function markIntelStale(intelId: string): Promise<void> {
  try {
    await getSupabase()
      .from('competitor_intel')
      .update({ still_relevant: false })
      .eq('id', intelId);
  } catch (err) {
    console.warn('Could not mark intel stale:', err);
  }
}

// Get recent intel across all competitors (for proactive monitoring)
export async function getRecentCompetitorIntel(
  daysBack: number = 7,
  limit: number = 20
): Promise<CompetitorIntel[]> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('competitor_intel')
      .select()
      .gte('discovered_at', since)
      .eq('still_relevant', true)
      .order('discovered_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// ============================================
// System Feedback
// ============================================

export interface SystemFeedback {
  id?: string;
  date?: string;
  agent: string;
  feedback_type: 'bug' | 'wrong_answer' | 'great_catch' | 'suggestion' | 'annoying' | 'missing_info';
  what_happened: string;
  what_should_happen?: string;
  severity?: 'minor' | 'medium' | 'major';
  resolved?: boolean;
  resolution?: string;
  slack_ts?: string;
  created_at?: string;
}

export async function logFeedback(feedback: Omit<SystemFeedback, 'id' | 'created_at'>): Promise<SystemFeedback | null> {
  try {
    const { data, error } = await getSupabase()
      .from('system_feedback')
      .insert({
        ...feedback,
        date: new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to log feedback:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Feedback logging error:', err);
    return null;
  }
}

export async function getUnresolvedFeedback(): Promise<SystemFeedback[]> {
  try {
    const { data, error } = await getSupabase()
      .from('system_feedback')
      .select()
      .eq('resolved', false)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function getFeedbackSummary(daysBack: number = 7): Promise<{
  total: number;
  byType: Record<string, number>;
  byAgent: Record<string, number>;
  unresolved: number;
}> {
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data, error } = await getSupabase()
      .from('system_feedback')
      .select()
      .gte('date', since);

    if (error || !data) {
      return { total: 0, byType: {}, byAgent: {}, unresolved: 0 };
    }

    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let unresolved = 0;

    for (const fb of data) {
      byType[fb.feedback_type] = (byType[fb.feedback_type] || 0) + 1;
      if (fb.agent) {
        byAgent[fb.agent] = (byAgent[fb.agent] || 0) + 1;
      }
      if (!fb.resolved) unresolved++;
    }

    return { total: data.length, byType, byAgent, unresolved };
  } catch {
    return { total: 0, byType: {}, byAgent: {}, unresolved: 0 };
  }
}

export async function resolveFeedback(id: string, resolution: string): Promise<boolean> {
  try {
    const { error } = await getSupabase()
      .from('system_feedback')
      .update({ resolved: true, resolution })
      .eq('id', id);

    return !error;
  } catch {
    return false;
  }
}
