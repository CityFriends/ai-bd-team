// Hierarchical Thread Summarization
// Uses Claude to summarize older messages while keeping recent ones verbatim

import { getAnthropic } from './claude.js';
import { getThreadSummary, saveThreadSummary } from './supabase.js';
import { embed } from './embeddings.js';

export interface ThreadMessage {
  author: string;
  text: string;
  ts: string;
}

export interface HierarchicalContext {
  // Summary of older messages
  olderSummary: string | null;
  // Recent messages kept verbatim
  recentMessages: ThreadMessage[];
  // Total message count
  totalMessages: number;
  // Key participants
  participants: string[];
  // Key topics discussed
  keyTopics: string[];
}

// Configuration
const RECENT_MESSAGE_COUNT = 10; // Keep last N messages verbatim
const SUMMARY_THRESHOLD = 15; // Only summarize if more than N messages

/**
 * Build hierarchical context for a thread
 * Keeps recent messages verbatim, summarizes older ones
 */
export async function buildHierarchicalContext(
  messages: ThreadMessage[],
  threadTs: string,
  options: { forceRefresh?: boolean } = {}
): Promise<HierarchicalContext> {
  const { forceRefresh = false } = options;

  const participants = extractParticipants(messages);
  const keyTopics = extractKeyTopics(messages);

  // Short thread - include everything
  if (messages.length <= SUMMARY_THRESHOLD) {
    return {
      olderSummary: null,
      recentMessages: messages,
      totalMessages: messages.length,
      participants,
      keyTopics,
    };
  }

  // Long thread - summarize older, keep recent verbatim
  const recentMessages = messages.slice(-RECENT_MESSAGE_COUNT);
  const olderMessages = messages.slice(0, -RECENT_MESSAGE_COUNT);

  // Check if we have a cached summary
  if (!forceRefresh) {
    const cachedSummary = await getThreadSummary(threadTs);
    if (cachedSummary) {
      // Check if the summary is still valid (covers the older messages we need)
      const lastSummarizedTs = cachedSummary.summarized_up_to_ts;
      const oldestRecentTs = recentMessages[0]?.ts;

      if (
        lastSummarizedTs &&
        oldestRecentTs &&
        lastSummarizedTs >= olderMessages[olderMessages.length - 1]?.ts
      ) {
        // Cached summary is still valid
        return {
          olderSummary: cachedSummary.summary,
          recentMessages,
          totalMessages: messages.length,
          participants,
          keyTopics,
        };
      }
    }
  }

  // Generate new summary
  const olderSummary = await summarizeMessages(olderMessages);

  // Cache the summary
  try {
    const summaryEmbedding = await embed(olderSummary);
    await saveThreadSummary(
      {
        thread_ts: threadTs,
        summary: olderSummary,
        message_count: olderMessages.length,
        summarized_up_to_ts: olderMessages[olderMessages.length - 1]?.ts,
        participants,
        key_topics: keyTopics,
      },
      summaryEmbedding
    );
  } catch (err) {
    console.warn('Could not cache thread summary:', err);
  }

  return {
    olderSummary,
    recentMessages,
    totalMessages: messages.length,
    participants,
    keyTopics,
  };
}

/**
 * Summarize a set of messages using Claude
 */
export async function summarizeMessages(messages: ThreadMessage[]): Promise<string> {
  if (messages.length === 0) {
    return '';
  }

  const client = getAnthropic();

  // Format messages for summarization
  const messagesText = messages.map((m) => `${m.author}: ${m.text}`).join('\n');

  const prompt = `Summarize this conversation thread concisely, capturing:
1. The main topic(s) being discussed
2. Key decisions or conclusions reached
3. Important facts or data mentioned
4. Any open questions or action items
5. The overall sentiment/tone

Keep the summary under 200 words. Focus on information that would be useful context for someone joining the conversation.

CONVERSATION:
${messagesText}

SUMMARY:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return 'Could not summarize conversation.';
    }

    return textBlock.text.trim();
  } catch (error) {
    console.error('Summarization failed:', error);
    // Fallback: just list the main points
    return `Discussion involving ${extractParticipants(messages).join(', ')} about: ${extractKeyTopics(messages).join(', ')}`;
  }
}

// Agent names for identity labeling
const AGENT_NAMES = ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'];

/**
 * Format hierarchical context for inclusion in a prompt
 *
 * IMPORTANT: Agent messages are labeled with [AGENT: Name said] to prevent
 * identity bleeding. Without these labels, agents may adopt the distinctive
 * voice of other agents (especially Jodie's writing style).
 */
export function formatHierarchicalContext(context: HierarchicalContext): string {
  const parts: string[] = [];

  // Add summary of older messages
  if (context.olderSummary) {
    parts.push(
      `EARLIER IN THREAD (${context.totalMessages - context.recentMessages.length} messages summarized):`
    );
    parts.push(context.olderSummary);
    parts.push('');
  }

  // Add recent messages with identity labels for agent messages
  if (context.recentMessages.length > 0) {
    parts.push("RECENT MESSAGES (do NOT adopt other agents' voices - respond only as yourself):");
    context.recentMessages.forEach((m) => {
      const authorLower = m.author.toLowerCase();
      const isAgent = AGENT_NAMES.includes(authorLower);

      if (isAgent) {
        // Label agent messages clearly to prevent voice adoption
        parts.push(`[AGENT ${m.author} said]: "${m.text}"`);
      } else {
        // Human messages - include normally
        parts.push(`${m.author}: ${m.text}`);
      }
    });
  }

  return parts.join('\n');
}

/**
 * Extract unique participants from messages
 */
function extractParticipants(messages: ThreadMessage[]): string[] {
  const participants = new Set<string>();
  for (const msg of messages) {
    if (msg.author && msg.author !== 'unknown') {
      participants.add(msg.author);
    }
  }
  return Array.from(participants);
}

/**
 * Extract key topics from messages
 */
function extractKeyTopics(messages: ThreadMessage[]): string[] {
  const topics = new Set<string>();
  const allText = messages
    .map((m) => m.text)
    .join(' ')
    .toLowerCase();

  // Business development topics
  const topicKeywords: Record<string, string[]> = {
    Opportunity: ['opportunity', 'opp', 'rfp', 'rfi', 'solicitation'],
    'SAM.gov': ['sam.gov', 'sam gov'],
    Incumbent: ['incumbent', 'current contractor'],
    Teaming: ['teaming', 'partner', 'subcontractor'],
    'Go/No-Go': ['go/no-go', 'go no go', 'should we pursue', 'bid decision'],
    Capture: ['capture', 'win strategy'],
    Proposal: ['proposal', 'response', 'submission'],
    'Agency Intel': ['agency', 'contract history', 'spending'],
    Risk: ['risk', 'red flag', 'concern'],
    Timeline: ['deadline', 'due date', 'timeline'],
  };

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => allText.includes(kw))) {
      topics.add(topic);
    }
  }

  return Array.from(topics);
}

/**
 * Quick summarize for a single exchange (used for fact extraction)
 */
export async function summarizeExchange(
  userMessage: string,
  agentResponse: string
): Promise<string> {
  const client = getAnthropic();

  const prompt = `In one sentence, summarize what was discussed in this exchange:

User: ${userMessage}
Agent: ${agentResponse}

One-sentence summary:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return 'Brief exchange.';
    }

    return textBlock.text.trim();
  } catch (error) {
    console.error('Exchange summarization failed:', error);
    return 'Brief exchange.';
  }
}
