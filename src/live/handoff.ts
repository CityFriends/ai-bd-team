// Structured Agent Handoffs
// Enables agents to transfer context to each other when tagging

import { createHandoff, getPendingHandoffs, acknowledgeHandoff } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import type { AgentHandoff } from '../integrations/supabase.js';

export interface HandoffContext {
  summary: string; // What we've discussed
  userIntent: string; // What user is trying to accomplish
  relevantFacts: string[]; // Key info discovered
  openQuestions: string[]; // What still needs answering
  recommendedAction: string; // What the next agent should do
}

export interface ThreadMessage {
  author: string;
  text: string;
  ts: string;
}

/**
 * Build handoff context from a thread
 */
export async function buildHandoffContext(
  messages: ThreadMessage[],
  fromAgent: string
): Promise<HandoffContext> {
  const client = getAnthropic();

  // Format thread for analysis
  const threadText = messages.map((m) => `${m.author}: ${m.text}`).join('\n');

  const prompt = `Analyze this conversation and extract a structured handoff context for the next agent.

CONVERSATION:
${threadText}

Current agent (me): ${fromAgent}

Extract:
1. SUMMARY: Brief summary of what's been discussed (2-3 sentences)
2. USER_INTENT: What is the user trying to accomplish?
3. RELEVANT_FACTS: List of key facts discovered (as JSON array of strings)
4. OPEN_QUESTIONS: What still needs to be answered? (as JSON array of strings)
5. RECOMMENDED_ACTION: What should the next agent do first?

Respond in JSON format:
{
  "summary": "...",
  "userIntent": "...",
  "relevantFacts": ["fact1", "fact2"],
  "openQuestions": ["question1", "question2"],
  "recommendedAction": "..."
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response');
    }

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      summary: parsed.summary || 'No summary available',
      userIntent: parsed.userIntent || 'Unknown intent',
      relevantFacts: parsed.relevantFacts || [],
      openQuestions: parsed.openQuestions || [],
      recommendedAction: parsed.recommendedAction || 'Review the thread and respond',
    };
  } catch (error) {
    console.error('Error building handoff context:', error);

    // Fallback: basic context
    const lastMessages = messages.slice(-5);
    return {
      summary: `Discussion in thread with ${[...new Set(messages.map((m) => m.author))].join(', ')}`,
      userIntent: 'Continue the conversation',
      relevantFacts: lastMessages.map((m) => `${m.author} said: "${m.text.slice(0, 100)}"`),
      openQuestions: [],
      recommendedAction: 'Review recent messages and respond appropriately',
    };
  }
}

/**
 * Create a handoff from one agent to another
 */
export async function handoffToAgent(
  fromAgent: string,
  toAgent: string,
  threadTs: string,
  messages: ThreadMessage[]
): Promise<AgentHandoff | null> {
  console.log(`${fromAgent}: Creating handoff to ${toAgent} for thread ${threadTs}`);

  try {
    const context = await buildHandoffContext(messages, fromAgent);

    const handoff = await createHandoff({
      from_agent: fromAgent,
      to_agent: toAgent,
      thread_ts: threadTs,
      context_summary: context.summary,
      user_intent: context.userIntent,
      relevant_facts: context.relevantFacts,
      open_questions: context.openQuestions,
      recommended_action: context.recommendedAction,
    });

    if (handoff) {
      console.log(`${fromAgent}: Handoff created successfully`);
    }

    return handoff;
  } catch (error) {
    console.error(`${fromAgent}: Error creating handoff:`, error);
    return null;
  }
}

/**
 * Check for pending handoffs for an agent in a thread
 */
export async function checkForHandoff(
  agentName: string,
  threadTs: string
): Promise<AgentHandoff | null> {
  try {
    const handoffs = await getPendingHandoffs(agentName, threadTs);
    return handoffs.length > 0 ? handoffs[0] : null;
  } catch (error) {
    console.error('Error checking for handoff:', error);
    return null;
  }
}

/**
 * Get all pending handoffs for an agent
 */
export async function getAllPendingHandoffs(agentName: string): Promise<AgentHandoff[]> {
  try {
    return await getPendingHandoffs(agentName);
  } catch (error) {
    console.error('Error getting pending handoffs:', error);
    return [];
  }
}

/**
 * Format handoff context for inclusion in an agent's prompt
 */
export function formatHandoffForPrompt(handoff: AgentHandoff): string {
  const parts: string[] = [
    `\n=== HANDOFF FROM ${handoff.from_agent.toUpperCase()} ===`,
    `Summary: ${handoff.context_summary}`,
    `User Intent: ${handoff.user_intent || 'Not specified'}`,
  ];

  if (handoff.relevant_facts && handoff.relevant_facts.length > 0) {
    parts.push('Key Facts:');
    handoff.relevant_facts.forEach((fact) => {
      parts.push(`  • ${fact}`);
    });
  }

  if (handoff.open_questions && handoff.open_questions.length > 0) {
    parts.push('Open Questions:');
    handoff.open_questions.forEach((q) => {
      parts.push(`  • ${q}`);
    });
  }

  if (handoff.recommended_action) {
    parts.push(`Recommended Action: ${handoff.recommended_action}`);
  }

  parts.push('=== END HANDOFF ===\n');

  return parts.join('\n');
}

/**
 * Mark a handoff as acknowledged
 */
export async function acknowledgeHandoffById(handoffId: string): Promise<void> {
  await acknowledgeHandoff(handoffId);
}

/**
 * Detect if an agent is being tagged in a message
 */
export function detectAgentTag(text: string, agentSlackIds: Record<string, string>): string | null {
  for (const [slackId, agentName] of Object.entries(agentSlackIds)) {
    if (text.includes(`<@${slackId}>`)) {
      return agentName;
    }
  }
  return null;
}

/**
 * Create handoff when tagging another agent
 */
export async function createHandoffOnTag(
  fromAgent: string,
  _taggedAgentId: string,
  taggedAgentName: string,
  threadTs: string,
  messages: ThreadMessage[]
): Promise<void> {
  try {
    await handoffToAgent(fromAgent, taggedAgentName, threadTs, messages);
    console.log(`${fromAgent}: Created handoff to ${taggedAgentName} on @mention`);
  } catch (error) {
    console.error(`${fromAgent}: Failed to create handoff on tag:`, error);
  }
}
