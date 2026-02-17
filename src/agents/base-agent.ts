import { generateAgentResponse, type AgentContext } from '../integrations/claude.js';
import {
  postAsAgent,
  postWithMentions,
  postDecisionRequest,
  replyInThread,
} from '../integrations/slack.js';
import { queueAgentTask } from '../integrations/supabase.js';
import type { AgentName } from '../types/index.js';

export abstract class BaseAgent {
  abstract name: AgentName;
  abstract displayName: string;
  abstract systemPrompt: string;

  // Get a random delay within a range for natural timing
  protected getRandomDelay(range: [number, number]): number {
    const [min, max] = range;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Generate a response using Claude
  async generateResponse(userMessage: string, context?: AgentContext): Promise<string> {
    return generateAgentResponse(this.name, this.systemPrompt, userMessage, context);
  }

  // Post to Slack as this agent
  async post(text: string, threadTs?: string): Promise<{ ts: string; channel: string }> {
    return postAsAgent(this.name, text, threadTs);
  }

  // Post with @mentions to other agents
  async postWithMentions(
    text: string,
    mentions: AgentName[],
    threadTs?: string
  ): Promise<{ ts: string; channel: string }> {
    return postWithMentions(this.name, text, mentions, threadTs);
  }

  // Reply in a thread
  async reply(text: string, threadTs: string): Promise<{ ts: string; channel: string }> {
    return replyInThread(this.name, text, threadTs);
  }

  // Post a decision request (mentions Lapedra)
  async requestDecision(text: string, threadTs?: string): Promise<{ ts: string; channel: string }> {
    return postDecisionRequest(this.name, text, threadTs);
  }

  // Schedule a task for later (with delay for natural timing)
  async scheduleTask(
    action: string,
    delayMs: number,
    payload: Record<string, unknown> = {},
    opportunityId?: string,
    threadTs?: string
  ): Promise<void> {
    const scheduledFor = new Date(Date.now() + delayMs);
    await queueAgentTask(this.name, action, scheduledFor, payload, opportunityId, threadTs);
  }

  // Schedule with a random delay from a range
  async scheduleTaskWithRandomDelay(
    action: string,
    delayRange: [number, number],
    payload: Record<string, unknown> = {},
    opportunityId?: string,
    threadTs?: string
  ): Promise<void> {
    const delay = this.getRandomDelay(delayRange);
    await this.scheduleTask(action, delay, payload, opportunityId, threadTs);
  }

  // Abstract methods that each agent must implement
  abstract handleAction(action: string, payload: Record<string, unknown>): Promise<void>;
}

// Helper to extract @mentions from text
export function extractMentions(text: string): AgentName[] {
  const mentions: AgentName[] = [];
  const agentNames: AgentName[] = ['scout', 'analyst', 'connector', 'strategist', 'pm'];

  // Also check for name mentions
  const nameToAgent: Record<string, AgentName> = {
    maya: 'scout',
    david: 'analyst',
    rosa: 'connector',
    james: 'strategist',
    patricia: 'pm',
  };

  for (const agent of agentNames) {
    const regex = new RegExp(`@${agent}`, 'gi');
    if (regex.test(text)) {
      mentions.push(agent);
    }
  }

  // Check for @Name mentions too
  for (const [name, agent] of Object.entries(nameToAgent)) {
    const regex = new RegExp(`@${name}`, 'gi');
    if (regex.test(text) && !mentions.includes(agent)) {
      mentions.push(agent);
    }
  }

  return mentions;
}

// Check if Lapedra is mentioned
export function mentionsLapedra(text: string): boolean {
  return /@lapedra/i.test(text);
}
