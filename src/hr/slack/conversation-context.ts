/**
 * Conversation Context Manager — Thread-Aware Follow-ups
 *
 * Manages bounded, isolated conversation state for HR bot follow-up questions.
 *
 * Security contract:
 *   - Context is isolated by: workspace + channel + thread + user
 *   - No context leakage between conversations or employees
 *   - Conversation history provides context, NOT authorization
 *   - Fresh retrieval required on EVERY turn
 *   - Citations from prior turns are NOT reusable
 *   - Bounded by turn count and age to minimize sensitive data retention
 *
 * Design decisions:
 *   - In-memory store with TTL eviction (no persistent storage)
 *   - Short-lived context (default: 30 minutes, max 10 turns)
 *   - Only stores question/answer text, not full retrieval results
 *   - Thread isolation via composite key
 */

// ── Types ───────────────────────────────────────────────────

/**
 * A single turn in a conversation.
 * Contains only the minimum needed for follow-up context.
 */
export interface ConversationTurn {
  /** Unix timestamp when the turn was created. */
  timestamp: number;
  /** The employee's question text. */
  question: string;
  /** The bot's answer text (truncated for context). */
  answer: string;
  /** Topic detected for this turn (for context hints). */
  topic?: string;
}

/**
 * Full conversation context for a thread.
 */
export interface ConversationContext {
  /** Composite key: workspace:channel:thread:user */
  contextKey: string;
  /** Slack workspace ID. */
  workspaceId: string;
  /** Slack channel ID. */
  channelId: string;
  /** Slack thread timestamp (or message ts for non-threaded). */
  threadTs: string;
  /** Slack user ID (the employee). */
  userId: string;
  /** Ordered list of turns (oldest first). */
  turns: ConversationTurn[];
  /** Unix timestamp of last activity. */
  lastActivityAt: number;
}

/**
 * Input for adding a new turn to a conversation.
 */
export interface AddTurnInput {
  workspaceId: string;
  channelId: string;
  threadTs: string;
  userId: string;
  question: string;
  answer: string;
  topic?: string;
}

/**
 * Input for retrieving conversation context.
 */
export interface GetContextInput {
  workspaceId: string;
  channelId: string;
  threadTs: string;
  userId: string;
}

// ── Configuration ───────────────────────────────────────────

/** Maximum turns to retain per conversation. */
export const MAX_CONVERSATION_TURNS = 10;

/** Maximum age of conversation context in milliseconds (30 minutes). */
export const MAX_CONTEXT_AGE_MS = 30 * 60 * 1000;

/** Maximum length of answer text to store (truncate for context). */
export const MAX_ANSWER_LENGTH = 500;

/** Maximum length of question text to store. */
export const MAX_QUESTION_LENGTH = 300;

/** Cleanup interval for expired contexts (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ── Context Key Generation ──────────────────────────────────

/**
 * Generate a composite key for conversation isolation.
 * Format: workspace:channel:thread:user
 *
 * This ensures complete isolation:
 *   - Different workspaces never share context
 *   - Different channels never share context
 *   - Different threads never share context
 *   - Different users in the same thread have separate context
 */
export function generateContextKey(
  workspaceId: string,
  channelId: string,
  threadTs: string,
  userId: string
): string {
  // Validate inputs to prevent key injection
  if (
    !workspaceId ||
    !channelId ||
    !threadTs ||
    !userId ||
    workspaceId.includes(':') ||
    channelId.includes(':') ||
    threadTs.includes(':') ||
    userId.includes(':')
  ) {
    throw new Error('Invalid context key components');
  }
  return `${workspaceId}:${channelId}:${threadTs}:${userId}`;
}

// ── Conversation Store ──────────────────────────────────────

/**
 * In-memory conversation context store with TTL eviction.
 *
 * Uses a Map for O(1) lookup and automatic cleanup via setInterval.
 * Stateless across process restarts (conversations reset on deploy).
 */
export class ConversationStore {
  private contexts: Map<string, ConversationContext> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Add a turn to a conversation.
   *
   * Creates the conversation context if it doesn't exist.
   * Enforces turn limits and age bounds.
   */
  addTurn(input: AddTurnInput): void {
    const { workspaceId, channelId, threadTs, userId, question, answer, topic } = input;

    const contextKey = generateContextKey(workspaceId, channelId, threadTs, userId);
    const now = Date.now();

    // Truncate answer and question for storage
    const truncatedAnswer =
      answer.length > MAX_ANSWER_LENGTH ? answer.slice(0, MAX_ANSWER_LENGTH) + '...' : answer;
    const truncatedQuestion =
      question.length > MAX_QUESTION_LENGTH
        ? question.slice(0, MAX_QUESTION_LENGTH) + '...'
        : question;

    const turn: ConversationTurn = {
      timestamp: now,
      question: truncatedQuestion,
      answer: truncatedAnswer,
      topic,
    };

    let context = this.contexts.get(contextKey);

    if (context) {
      // Add turn to existing context
      context.turns.push(turn);
      context.lastActivityAt = now;

      // Enforce turn limit (remove oldest if exceeded)
      while (context.turns.length > MAX_CONVERSATION_TURNS) {
        context.turns.shift();
      }
    } else {
      // Create new context
      context = {
        contextKey,
        workspaceId,
        channelId,
        threadTs,
        userId,
        turns: [turn],
        lastActivityAt: now,
      };
      this.contexts.set(contextKey, context);
    }
  }

  /**
   * Get conversation context for follow-up processing.
   *
   * Returns null if:
   *   - No context exists for this conversation
   *   - Context has expired (older than MAX_CONTEXT_AGE_MS)
   *   - User ID doesn't match (isolation enforcement)
   *
   * @param maxTurns Maximum number of recent turns to return (default: 5)
   */
  getContext(input: GetContextInput, maxTurns: number = 5): ConversationTurn[] | null {
    const { workspaceId, channelId, threadTs, userId } = input;

    const contextKey = generateContextKey(workspaceId, channelId, threadTs, userId);
    const context = this.contexts.get(contextKey);

    if (!context) {
      return null;
    }

    // Check if context has expired
    const age = Date.now() - context.lastActivityAt;
    if (age > MAX_CONTEXT_AGE_MS) {
      this.contexts.delete(contextKey);
      return null;
    }

    // Double-check user isolation (should never fail due to key generation)
    if (context.userId !== userId) {
      return null;
    }

    // Return most recent turns (up to maxTurns)
    const recentTurns = context.turns.slice(-maxTurns);
    return recentTurns;
  }

  /**
   * Check if a conversation has prior context.
   * Used to determine if this is a follow-up or new conversation.
   */
  hasContext(input: GetContextInput): boolean {
    const context = this.getContext(input, 1);
    return context !== null && context.length > 0;
  }

  /**
   * Clear context for a specific conversation.
   * Used for explicit resets or topic changes.
   */
  clearContext(input: GetContextInput): void {
    const { workspaceId, channelId, threadTs, userId } = input;
    const contextKey = generateContextKey(workspaceId, channelId, threadTs, userId);
    this.contexts.delete(contextKey);
  }

  /**
   * Remove all expired contexts.
   * Called periodically via cleanup timer.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, context] of this.contexts) {
      const age = now - context.lastActivityAt;
      if (age > MAX_CONTEXT_AGE_MS) {
        this.contexts.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get current store statistics (for monitoring/debugging).
   */
  getStats(): { activeContexts: number; totalTurns: number } {
    let totalTurns = 0;
    for (const context of this.contexts.values()) {
      totalTurns += context.turns.length;
    }
    return {
      activeContexts: this.contexts.size,
      totalTurns,
    };
  }

  /**
   * Destroy the store and stop cleanup timer.
   * Call when shutting down the application.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.contexts.clear();
  }
}

// ── Singleton Instance ──────────────────────────────────────

/**
 * Shared conversation store instance.
 * Created on first import, persists for process lifetime.
 */
let sharedStore: ConversationStore | null = null;

export function getConversationStore(): ConversationStore {
  if (!sharedStore) {
    sharedStore = new ConversationStore();
  }
  return sharedStore;
}

/**
 * Reset the shared store (for testing).
 */
export function resetConversationStore(): void {
  if (sharedStore) {
    sharedStore.destroy();
    sharedStore = null;
  }
}

// ── Context Formatting for LLM ──────────────────────────────

/**
 * Format conversation turns for inclusion in the LLM prompt.
 *
 * Produces a structured history section that helps the LLM understand:
 *   - What topics were discussed
 *   - What questions were asked
 *   - What answers were given
 *
 * Does NOT include citations from prior turns (must retrieve fresh).
 */
export function formatConversationForPrompt(turns: ConversationTurn[]): string {
  if (turns.length === 0) {
    return '';
  }

  const formatted = turns.map((turn, index) => {
    const topicHint = turn.topic ? ` [Topic: ${turn.topic}]` : '';
    return `Turn ${index + 1}${topicHint}:\nEmployee: ${turn.question}\nAssistant: ${turn.answer}`;
  });

  return formatted.join('\n\n');
}
