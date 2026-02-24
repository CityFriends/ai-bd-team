// Three-Tier Memory Manager
// Orchestrates Short-term (working), Long-term (facts), and Episodic (history) memory

import { getConversationalContext, getUserContext, getExtractedFacts } from './supabase.js';
import {
  searchUserContext,
  searchConversationMemory,
  searchDecisionPatterns,
  searchExtractedFacts,
} from './semantic-search.js';
import type {
  UserContext,
  ConversationMemory,
  DecisionPattern,
  ExtractedFact,
} from './supabase.js';

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
}

export interface FullMemoryContext {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  episodic: EpisodicMemory;
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
   */
  async buildMemoryContext(
    message: string,
    threadMessages: Array<{ author: string; text: string; ts: string }> = [],
    options: { useSemanticSearch?: boolean } = {}
  ): Promise<FullMemoryContext> {
    const { useSemanticSearch = true } = options;

    // Build all three tiers in parallel
    const [shortTerm, longTerm, episodic] = await Promise.all([
      this.buildShortTermMemory(message, threadMessages),
      this.buildLongTermMemory(message, useSemanticSearch),
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
    useSemanticSearch: boolean
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
      // Fallback to keyword-based retrieval
      const [userContext, facts, teamAnnouncements] = await Promise.all([
        getUserContext('lapedra', 5),
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
   */
  private async buildEpisodicMemory(
    message: string,
    useSemanticSearch: boolean
  ): Promise<EpisodicMemory> {
    if (useSemanticSearch) {
      // Use semantic search to find relevant past experiences
      const [memoryResults, decisionResults] = await Promise.all([
        searchConversationMemory(message, { threshold: 0.6, limit: 5 }),
        searchDecisionPatterns(message, { threshold: 0.6, limit: 5 }),
      ]);

      return {
        pastExperiences: memoryResults.map((r) => r.data as ConversationMemory),
        decisionHistory: decisionResults.map((r) => r.data as DecisionPattern),
        relatedThreads: [], // Could be populated from thread_summaries
      };
    } else {
      // Fallback to keyword-based retrieval
      const context = await getConversationalContext();

      return {
        pastExperiences: context.memories,
        decisionHistory: context.decisionPatterns,
        relatedThreads: [],
      };
    }
  }

  /**
   * Format memory context for inclusion in a prompt
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

    // Short-term memory section
    if (memory.shortTerm.activeTopics.length > 0) {
      sections.push(`\nCURRENT TOPICS: ${memory.shortTerm.activeTopics.join(', ')}`);
    }
    if (memory.shortTerm.userMood) {
      sections.push(`USER MOOD: ${memory.shortTerm.userMood}`);
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

    return sections.join('\n');
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
