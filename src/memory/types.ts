/**
 * Agent Memory System Types
 *
 * Defines types for the persistent memory system that enables
 * agents to remember past experiences and form insights.
 */

export type AgentName = 'maya' | 'david' | 'rosa' | 'james' | 'patricia' | 'jodie' | 'marcus';

export type MemoryType =
  | 'observation' // Something the agent noticed
  | 'reflection' // Thinking about past events
  | 'insight' // Pattern or conclusion
  | 'outcome' // Result of a bid/decision
  | 'conversation'; // Notable exchange

export interface AgentMemory {
  id: string;
  agent: AgentName;
  memory_type: MemoryType;
  content: string;
  related_opportunity_id: string | null;
  related_event_id: string | null;
  importance: number;
  embedding: number[] | null;
  tags: string[] | null;
  created_at: string;
  last_accessed_at: string | null;
  expires_at: string | null;
}

export interface StoreMemoryOptions {
  relatedOpportunityId?: string;
  relatedEventId?: string;
  importance?: number;
  tags?: string[];
  expiresAt?: Date;
}

export interface MemoryQueryOptions {
  limit?: number;
  minImportance?: number;
  includeExpired?: boolean;
}
