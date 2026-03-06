// Three-Tier Memory Manager
// Orchestrates Short-term (working), Long-term (facts), and Episodic (history) memory
//
// Features:
// - Context size limits to prevent overflow
// - Recency weighting for memories (newer = higher priority)
// - Multi-user support via userId parameter
// - Optimized formatting (skips empty sections)

import { getConversationalContext, getUserContext, getExtractedFacts } from './supabase.js';
import {
  searchUserContext,
  searchConversationMemory,
  searchDecisionPatterns,
  searchExtractedFacts,
} from './semantic-search.js';
import {
  searchMemoriesBySimilarity,
  getRecentMemories,
  type AgentMemory,
  type AgentName,
} from '../memory/index.js';
import type {
  UserContext,
  ConversationMemory,
  DecisionPattern,
  ExtractedFact,
} from './supabase.js';

// ============================================================
// Configuration
// ============================================================

/** Maximum thread messages to include in context (prevents overflow) */
const MAX_THREAD_MESSAGES = 30;

/** Maximum characters per thread message (truncate long messages) */
const MAX_MESSAGE_LENGTH = 500;

/** Default user ID when none provided */
const DEFAULT_USER_ID = 'lapedra';

/** Recency decay half-life in days (memories older than this are weighted 50%) */
const RECENCY_HALF_LIFE_DAYS = 7;

export interface ShortTermMemory {
  // Current conversation thread context
  threadMessages: Array<{ author: string; text: string; ts: string }>;
  // Recent 24-hour interactions across all threads
  recentInteractions: Array<{ threadTs: string; summary: string; timestamp: string }>;
  // Current user mood/state
  userMood?: string;
  // Active topics being discussed
  activeTopics: string[];
}

export interface LongTermMemory {
  // User preferences (e.g., "Lapedra prefers concise responses")
  userPreferences: UserContext[];
  // Company patterns (e.g., "We always team with small businesses for VA work")
  companyPatterns: ExtractedFact[];
  // Relationship knowledge
  relationships: ExtractedFact[];
  // Team-wide announcements (e.g., "Marcus is offline this week")
  teamAnnouncements: ExtractedFact[];
}

export interface EpisodicMemory {
  // Past experiences and outcomes (e.g., "Last time we looked at GSA BPA, we passed because...")
  pastExperiences: ConversationMemory[];
  // Decision history with outcomes
  decisionHistory: DecisionPattern[];
  // Relevant thread summaries
  relatedThreads: Array<{ threadTs: string; summary: string; relevance: number }>;
  // Agent-specific memories from recent interactions
  agentMemories: AgentMemory[];
}

export interface FullMemoryContext {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  episodic: EpisodicMemory;
}

export interface MemoryContextOptions {
  useSemanticSearch?: boolean;
  userId?: string;
  maxThreadMessages?: number;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Calculate recency weight for a memory based on its age.
 * Uses exponential decay: weight = 0.5 ^ (age_days / half_life)
 * Returns a value between 0 and 1, where 1 is most recent.
 */
function calculateRecencyWeight(createdAt: string | Date): number {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const ageMs = Date.now() - created.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: half-life of RECENCY_HALF_LIFE_DAYS days
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Sort memories by recency-weighted relevance.
 * Combines similarity score with recency weight.
 */
function sortByRecencyWeightedRelevance<T extends { created_at: string }>(
  items: T[],
  similarityScores?: Map<T, number>
): T[] {
  return items.sort((a, b) => {
    const aWeight = calculateRecencyWeight(a.created_at);
    const bWeight = calculateRecencyWeight(b.created_at);

    // If we have similarity scores, combine them with recency
    if (similarityScores) {
      const aSim = similarityScores.get(a) || 0.5;
      const bSim = similarityScores.get(b) || 0.5;
      // Combined score: 60% similarity, 40% recency
      const aScore = aSim * 0.6 + aWeight * 0.4;
      const bScore = bSim * 0.6 + bWeight * 0.4;
      return bScore - aScore;
    }

    // Otherwise just sort by recency
    return bWeight - aWeight;
  });
}

/**
 * Truncate thread messages to fit within limits.
 * Keeps most recent messages, summarizes older ones if needed.
 */
function truncateThreadMessages(
  messages: Array<{ author: string; text: string; ts: string }>,
  maxMessages: number = MAX_THREAD_MESSAGES
): Array<{ author: string; text: string; ts: string }> {
  if (messages.length <= maxMessages) {
    // Just truncate individual messages if too long
    return messages.map((m) => ({
      ...m,
      text:
        m.text.length > MAX_MESSAGE_LENGTH ? m.text.slice(0, MAX_MESSAGE_LENGTH) + '...' : m.text,
    }));
  }

  // Keep most recent messages
  const recentMessages = messages.slice(-maxMessages);
  const droppedCount = messages.length - maxMessages;

  // Add a summary note about dropped messages
  const summaryMessage = {
    author: 'system',
    text: `[${droppedCount} earlier messages omitted for context limits]`,
    ts: recentMessages[0]?.ts || '',
  };

  return [
    summaryMessage,
    ...recentMessages.map((m) => ({
      ...m,
      text:
        m.text.length > MAX_MESSAGE_LENGTH ? m.text.slice(0, MAX_MESSAGE_LENGTH) + '...' : m.text,
    })),
  ];
}

/**
 * Memory Manager class - orchestrates all three memory tiers
 */
export class MemoryManager {
  // Agent name stored for future use in agent-specific memory filtering
  private _agentName: string;

  constructor(agentName: string) {
    this._agentName = agentName;
  }

  /** Get the agent name for this memory manager */
  get name(): string {
    return this._agentName;
  }

  /**
   * Build complete memory context for a response
   * This is the main entry point - call this before generating a response
   *
   * @param message - The current user message
   * @param threadMessages - Previous messages in the thread
   * @param options - Configuration options
   * @param options.useSemanticSearch - Use semantic search for memory retrieval (default: true)
   * @param options.userId - User ID for personalization (default: 'lapedra')
   * @param options.maxThreadMessages - Max thread messages to include (default: 30)
   */
  async buildMemoryContext(
    message: string,
    threadMessages: Array<{ author: string; text: string; ts: string }> = [],
    options: MemoryContextOptions = {}
  ): Promise<FullMemoryContext> {
    const {
      useSemanticSearch = true,
      userId = DEFAULT_USER_ID,
      maxThreadMessages = MAX_THREAD_MESSAGES,
    } = options;

    // Truncate thread messages to prevent context overflow
    const truncatedMessages = truncateThreadMessages(threadMessages, maxThreadMessages);

    // Build all three tiers in parallel
    const [shortTerm, longTerm, episodic] = await Promise.all([
      this.buildShortTermMemory(message, truncatedMessages),
      this.buildLongTermMemory(message, useSemanticSearch, userId),
      this.buildEpisodicMemory(message, useSemanticSearch),
    ]);

    return { shortTerm, longTerm, episodic };
  }

  /**
   * Short-Term Memory: Current conversation and recent interactions
   */
  private async buildShortTermMemory(
    message: string,
    threadMessages: Array<{ author: string; text: string; ts: string }>
  ): Promise<ShortTermMemory> {
    // Extract active topics from thread
    const activeTopics = this.extractTopics(message, threadMessages);

    return {
      threadMessages,
      recentInteractions: [], // Could be populated from agent_memory table
      userMood: this.detectMoodFromMessage(message),
      activeTopics,
    };
  }

  /**
   * Long-Term Memory: Persistent facts and preferences
   */
  private async buildLongTermMemory(
    message: string,
    useSemanticSearch: boolean,
    userId: string = DEFAULT_USER_ID
  ): Promise<LongTermMemory> {
    // ALWAYS fetch team announcements regardless of semantic search
    // These are important team-wide facts that all agents need to know
    const teamAnnouncementsPromise = getExtractedFacts({ subject: 'team', limit: 10 });

    if (useSemanticSearch) {
      // Use semantic search to find relevant preferences and patterns
      const [userContextResults, factsResults, teamAnnouncements] = await Promise.all([
        searchUserContext(message, { threshold: 0.6, limit: 5 }),
        searchExtractedFacts(message, { threshold: 0.6, limit: 10 }),
        teamAnnouncementsPromise,
      ]);

      const userPreferences = userContextResults.map((r) => r.data as UserContext);
      const allFacts = factsResults.map((r) => r.data as ExtractedFact);

      // Separate company patterns from relationships
      const companyPatterns = allFacts.filter(
        (f) => f.fact_type === 'pattern' || f.subject === 'company'
      );
      const relationships = allFacts.filter(
        (f) => f.fact_type === 'context' && f.subject !== 'company' && f.subject !== 'team'
      );

      return { userPreferences, companyPatterns, relationships, teamAnnouncements };
    } else {
      // Fallback to keyword-based retrieval using provided userId
      const [userContext, facts, teamAnnouncements] = await Promise.all([
        getUserContext(userId, 5),
        getExtractedFacts({ limit: 10 }),
        teamAnnouncementsPromise,
      ]);

      return {
        userPreferences: userContext,
        companyPatterns: facts.filter((f) => f.fact_type === 'pattern'),
        relationships: facts.filter((f) => f.fact_type === 'context' && f.subject !== 'team'),
        teamAnnouncements,
      };
    }
  }

  /**
   * Episodic Memory: What happened before
   * Applies recency weighting to prioritize recent memories.
   */
  private async buildEpisodicMemory(
    message: string,
    useSemanticSearch: boolean
  ): Promise<EpisodicMemory> {
    if (useSemanticSearch) {
      // Use semantic search to find relevant past experiences
      // Include agent-specific memories from the agent_memories table
      const [memoryResults, decisionResults, agentMemoryResults] = await Promise.all([
        searchConversationMemory(message, { threshold: 0.6, limit: 8 }), // Fetch more, then filter
        searchDecisionPatterns(message, { threshold: 0.6, limit: 8 }),
        searchMemoriesBySimilarity(message, {
          agent: this._agentName as AgentName,
          minSimilarity: 0.65,
          limit: 10, // Fetch more for recency filtering
        }).catch(() => [] as AgentMemory[]), // Graceful fallback if embedding fails
      ]);

      // Apply recency weighting to agent memories and take top 5
      const weightedMemories = sortByRecencyWeightedRelevance(agentMemoryResults).slice(0, 5);

      return {
        pastExperiences: memoryResults.map((r) => r.data as ConversationMemory).slice(0, 5),
        decisionHistory: decisionResults.map((r) => r.data as DecisionPattern).slice(0, 5),
        relatedThreads: [], // Could be populated from thread_summaries
        agentMemories: weightedMemories,
      };
    } else {
      // Fallback to keyword-based retrieval
      const context = await getConversationalContext();

      // Still try to get recent agent memories even without semantic search
      const recentMemories = await getRecentMemories(this._agentName as AgentName, 10).catch(
        () => []
      );

      // Apply recency weighting
      const weightedMemories = sortByRecencyWeightedRelevance(recentMemories).slice(0, 5);

      return {
        pastExperiences: context.memories,
        decisionHistory: context.decisionPatterns,
        relatedThreads: [],
        agentMemories: weightedMemories,
      };
    }
  }

  /**
   * Format memory context for inclusion in a prompt.
   * Skips empty sections to minimize token usage.
   * Adds recency indicators for agent memories.
   */
  formatForPrompt(memory: FullMemoryContext): string {
    const sections: string[] = [];

    // Team announcements - ALWAYS show these first (important context for all agents)
    if (memory.longTerm.teamAnnouncements.length > 0) {
      sections.push('TEAM UPDATES (important - act on these):');
      memory.longTerm.teamAnnouncements.forEach((announcement) => {
        sections.push(`- ${announcement.content}`);
      });
    }

    // Short-term memory section (combine into one block if present)
    const shortTermParts: string[] = [];
    if (memory.shortTerm.activeTopics.length > 0) {
      shortTermParts.push(`Topics: ${memory.shortTerm.activeTopics.join(', ')}`);
    }
    if (memory.shortTerm.userMood) {
      shortTermParts.push(`Mood: ${memory.shortTerm.userMood}`);
    }
    if (shortTermParts.length > 0) {
      sections.push(`\nCURRENT CONTEXT: ${shortTermParts.join(' | ')}`);
    }

    // Long-term memory section
    if (memory.longTerm.userPreferences.length > 0) {
      sections.push('\nTHINGS YOU KNOW ABOUT THE USER:');
      memory.longTerm.userPreferences.forEach((pref) => {
        sections.push(`- ${pref.content} (${pref.context_type})`);
      });
    }

    if (memory.longTerm.companyPatterns.length > 0) {
      sections.push('\nCOMPANY PATTERNS & PREFERENCES:');
      memory.longTerm.companyPatterns.forEach((pattern) => {
        sections.push(`- ${pattern.content}`);
      });
    }

    // Episodic memory section
    if (memory.episodic.pastExperiences.length > 0) {
      sections.push('\nRELEVANT PAST EXPERIENCES:');
      memory.episodic.pastExperiences.forEach((exp) => {
        sections.push(`- ${exp.summary}`);
      });
    }

    if (memory.episodic.decisionHistory.length > 0) {
      sections.push('\nPAST DECISION PATTERNS:');
      memory.episodic.decisionHistory.forEach((dec) => {
        sections.push(`- ${dec.decision.toUpperCase()}: ${dec.reasoning || 'no reason given'}`);
        if (dec.agency) sections.push(`  Agency: ${dec.agency}`);
      });
    }

    // Agent-specific memories with recency indicators
    if (memory.episodic.agentMemories.length > 0) {
      sections.push('\nYOUR PAST OBSERVATIONS & LEARNINGS:');
      memory.episodic.agentMemories.forEach((mem) => {
        const recency = this.formatRecency(mem.created_at);
        sections.push(`- [${recency}] ${mem.content}`);
      });
    }

    // Return empty string if no sections (avoid unnecessary prompt padding)
    if (sections.length === 0) {
      return '';
    }

    return sections.join('\n');
  }

  /**
   * Format a timestamp as a human-readable recency indicator
   */
  private formatRecency(createdAt: string): string {
    const created = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'today';
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else {
      return created.toLocaleDateString();
    }
  }

  /**
   * Extract topics from message and thread context
   */
  private extractTopics(message: string, threadMessages: Array<{ text: string }>): string[] {
    const topics: Set<string> = new Set();
    const allText = [message, ...threadMessages.map((m) => m.text)].join(' ').toLowerCase();

    // Business development topics
    const bdTopics = [
      { keyword: 'rfp', topic: 'RFP' },
      { keyword: 'rfi', topic: 'RFI' },
      { keyword: 'solicitation', topic: 'Solicitation' },
      { keyword: 'opportunity', topic: 'Opportunity' },
      { keyword: 'sam.gov', topic: 'SAM.gov' },
      { keyword: 'incumbent', topic: 'Incumbent Analysis' },
      { keyword: 'teaming', topic: 'Teaming' },
      { keyword: 'partner', topic: 'Partner Search' },
      { keyword: 'go/no-go', topic: 'Go/No-Go Decision' },
      { keyword: 'capture', topic: 'Capture Strategy' },
      { keyword: 'proposal', topic: 'Proposal' },
      { keyword: 'naics', topic: 'NAICS Codes' },
      { keyword: 'set-aside', topic: 'Set-Aside' },
      { keyword: 'far', topic: 'FAR Compliance' },
    ];

    for (const { keyword, topic } of bdTopics) {
      if (allText.includes(keyword)) {
        topics.add(topic);
      }
    }

    // Agency mentions
    const agencies = ['va', 'dhs', 'dod', 'hhs', 'gsa', 'irs', 'cms', 'fema', 'doj', 'fbi'];
    for (const agency of agencies) {
      if (allText.includes(agency)) {
        topics.add(agency.toUpperCase());
      }
    }

    return Array.from(topics);
  }

  /**
   * Simple mood detection from message
   */
  private detectMoodFromMessage(message: string): string | undefined {
    const lower = message.toLowerCase();

    if (lower.includes('urgent') || lower.includes('asap') || lower.includes('deadline')) {
      return 'urgent';
    }
    if (lower.includes('frustrated') || lower.includes('ugh') || lower.includes('annoyed')) {
      return 'frustrated';
    }
    if (lower.includes('excited') || lower.includes('!') || lower.includes('great news')) {
      return 'excited';
    }
    if (
      lower.includes('confused') ||
      lower.includes("don't understand") ||
      lower.includes('what do you mean')
    ) {
      return 'confused';
    }
    if (lower.includes('thanks') || lower.includes('appreciate')) {
      return 'grateful';
    }

    return undefined;
  }
}

/**
 * Create a memory manager instance for an agent
 */
export function createMemoryManager(agentName: string): MemoryManager {
  return new MemoryManager(agentName);
}
