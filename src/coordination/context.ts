import { getThreadBySlackTs, updateThread, getOpportunity } from '../integrations/supabase.js';
import { getThreadMessages as getSlackThreadMessages } from '../integrations/slack.js';
import type { ConversationThread, Opportunity } from '../types/index.js';

export interface ConversationContext {
  thread?: ConversationThread;
  opportunity?: Opportunity;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  summary?: string;
}

// Build context for an agent responding in a thread
export async function buildConversationContext(threadTs: string): Promise<ConversationContext> {
  const context: ConversationContext = {
    recentMessages: [],
  };

  // Get thread metadata from DB
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    context.thread = thread;
    context.summary = thread.context_summary || undefined;

    // Get associated opportunity if any
    if (thread.opportunity_id) {
      const opp = await getOpportunity(thread.opportunity_id);
      if (opp) {
        context.opportunity = opp;
      }
    }
  }

  // Get recent messages from Slack
  try {
    const slackMessages = await getSlackThreadMessages(threadTs);

    // Convert to conversation format (last 10 messages)
    const recentSlackMessages = slackMessages.slice(-10);
    for (const msg of recentSlackMessages) {
      if (msg.text) {
        // Determine if this is from the user or an agent
        const isAgent =
          msg.text.includes('*Scout*') ||
          msg.text.includes('*Analyst*') ||
          msg.text.includes('*Connector*') ||
          msg.text.includes('*Strategist*');

        context.recentMessages.push({
          role: isAgent ? 'assistant' : 'user',
          content: msg.text,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching Slack messages:', error);
  }

  return context;
}

// Update thread context summary (for long-running conversations)
export async function updateContextSummary(threadTs: string, summary: string): Promise<void> {
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    await updateThread(thread.id, {
      context_summary: summary,
    });
  }
}

// Record a key decision in the thread
export async function recordDecision(
  threadTs: string,
  decision: {
    type: string;
    outcome: string;
    timestamp: string;
    details?: string;
  }
): Promise<void> {
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    const currentDecisions = (thread.key_decisions as unknown[]) || [];
    await updateThread(thread.id, {
      key_decisions: [...currentDecisions, decision],
    });
  }
}

// Mark who the thread is waiting for
export async function setAwaitingResponse(threadTs: string, awaitingFrom: string): Promise<void> {
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    await updateThread(thread.id, {
      awaiting_response_from: awaitingFrom,
    });
  }
}

// Clear the awaiting response status
export async function clearAwaitingResponse(threadTs: string): Promise<void> {
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    await updateThread(thread.id, {
      awaiting_response_from: null,
    });
  }
}

// Mark thread as resolved
export async function resolveThread(threadTs: string): Promise<void> {
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    await updateThread(thread.id, {
      status: 'resolved',
    });
  }
}

// Track which agents have participated
export async function addAgentToThread(threadTs: string, agent: string): Promise<void> {
  const thread = await getThreadBySlackTs(threadTs);
  if (thread) {
    const currentAgents = thread.agents_involved || [];
    if (!currentAgents.includes(agent)) {
      await updateThread(thread.id, {
        agents_involved: [...currentAgents, agent],
      });
    }
  }
}
