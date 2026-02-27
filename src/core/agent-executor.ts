/**
 * Unified Agent Executor
 *
 * Provides common execution logic for both live agents and scheduled actions.
 * This ensures consistent behavior for tool use, context loading, and response generation.
 */

import { getAnthropic } from '../integrations/claude.js';
import {
  getToolsForAgent,
  getToolDefinitionsForAgent,
  executeToolCalls,
  formatToolResultsForClaude,
  extractSourceCitations,
} from '../tools/index.js';
import type { MessageParam, ContentBlock, Tool } from '@anthropic-ai/sdk/resources/messages';
import type { LiveAgentName } from '../live/types.js';
import type { AgentTool } from '../tools/types.js';

// All agent names for identity checking
const ALL_AGENT_NAMES: LiveAgentName[] = [
  'maya',
  'david',
  'rosa',
  'james',
  'patricia',
  'jodie',
  'marcus',
];

export interface ExecutionContext {
  agentName: LiveAgentName;
  displayName: string;
  systemPrompt: string;
  additionalContext?: string;
  threadContext?: string;
  sourceThreadTs?: string;
}

export interface ExecutionOptions {
  maxToolIterations?: number;
  maxTokens?: number;
  model?: string;
  requireToolUse?: boolean;
  temperature?: number;
}

export interface ExecutionResult {
  success: boolean;
  response: string;
  toolsUsed: string[];
  sourceCitations: string[];
  wasIdentityCorrected: boolean;
  error?: string;
}

const DEFAULT_OPTIONS: Required<ExecutionOptions> = {
  maxToolIterations: 5,
  maxTokens: 1000,
  model: 'claude-sonnet-4-20250514',
  requireToolUse: false,
  temperature: 0.7,
};

/**
 * Identity enforcement: Check if a response contains another agent's identity claim
 * Returns the corrected response if leakage detected, or null if clean
 */
function detectAndCorrectIdentityLeakage(
  response: string,
  correctAgentName: LiveAgentName
): { corrected: string; leaked: string } | null {
  const correctDisplayName = correctAgentName.charAt(0).toUpperCase() + correctAgentName.slice(1);

  // Patterns that indicate identity confusion
  const identityPatterns = ALL_AGENT_NAMES.filter((name) => name !== correctAgentName).flatMap(
    (wrongName) => {
      const displayName = wrongName.charAt(0).toUpperCase() + wrongName.slice(1);
      return [
        // "David here" or "This is David"
        new RegExp(`\\b${displayName}\\s+here\\b`, 'gi'),
        new RegExp(`\\bThis\\s+is\\s+${displayName}\\b`, 'gi'),
        new RegExp(`\\bIt's\\s+${displayName}\\b`, 'gi'),
        new RegExp(`\\bI'm\\s+${displayName}\\b`, 'gi'),
        // Starting with just the name as greeting
        new RegExp(`^${displayName}[,:.!]\\s`, 'i'),
      ];
    }
  );

  for (const pattern of identityPatterns) {
    if (pattern.test(response)) {
      const match = response.match(pattern);
      if (match) {
        // Replace wrong identity with correct one
        let corrected = response;

        // Replace patterns one by one
        for (const wrongName of ALL_AGENT_NAMES.filter((n) => n !== correctAgentName)) {
          const wrongDisplay = wrongName.charAt(0).toUpperCase() + wrongName.slice(1);
          corrected = corrected
            .replace(
              new RegExp(`\\b${wrongDisplay}\\s+here\\b`, 'gi'),
              `${correctDisplayName} here`
            )
            .replace(
              new RegExp(`\\bThis\\s+is\\s+${wrongDisplay}\\b`, 'gi'),
              `This is ${correctDisplayName}`
            )
            .replace(
              new RegExp(`\\bIt's\\s+${wrongDisplay}\\b`, 'gi'),
              `It's ${correctDisplayName}`
            )
            .replace(new RegExp(`\\bI'm\\s+${wrongDisplay}\\b`, 'gi'), `I'm ${correctDisplayName}`)
            .replace(new RegExp(`^${wrongDisplay}([,:.!])\\s`, 'i'), `${correctDisplayName}$1 `);
        }

        return { corrected, leaked: match[0] };
      }
    }
  }

  return null;
}

/**
 * Check if a response claims data without having used tools
 */
function detectDataClaimsWithoutTools(response: string, toolsUsed: string[]): boolean {
  if (toolsUsed.length > 0) return false;

  // Patterns that suggest data claims
  const dataClaimPatterns = [
    /According to (SAM\.gov|USASpending|FPDS)/i,
    /The incumbent is/i,
    /The contract (value|amount) is \$/i,
    /awarded \$[\d,.]+/i,
    /recent(ly)? awarded/i,
    /contract worth \$/i,
    /fiscal year 20\d{2}/i,
    /\$[\d,.]+\s*(million|billion|M|B)/i,
  ];

  return dataClaimPatterns.some((pattern) => pattern.test(response));
}

/**
 * Execute an agent task with tools, context, and identity enforcement.
 * This is the unified execution layer for both live agents and scheduled actions.
 */
export async function executeAgentTask(
  userMessage: string,
  context: ExecutionContext,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const client = getAnthropic();

  // Get tools for this agent
  const tools: AgentTool[] = getToolsForAgent(context.agentName);
  const toolDefinitions: Tool[] = getToolDefinitionsForAgent(context.agentName);

  console.log(`[AgentExecutor] ${context.displayName} executing with ${tools.length} tools`);

  // Build system prompt with context
  let fullSystemPrompt = context.systemPrompt;

  if (context.additionalContext) {
    fullSystemPrompt += `\n\n${context.additionalContext}`;
  }

  // Add tool instructions if agent has tools
  if (tools.length > 0) {
    fullSystemPrompt += `\n\nYou have access to real-time data tools. USE THEM when you need current information.
DO NOT make up data - if you cite facts, they must come from tool results.
After using tools, cite your sources (e.g., "According to USASpending.gov...").`;

    if (opts.requireToolUse) {
      fullSystemPrompt += `\n\nIMPORTANT: You MUST use at least one tool to gather data before responding.`;
    }
  }

  // Build initial message with thread context
  let userContent = userMessage;
  if (context.threadContext) {
    userContent = `${context.threadContext}\n\nCurrent message: ${userMessage}`;
  }

  const messages: MessageParam[] = [{ role: 'user', content: userContent }];
  const allSourceCitations: string[] = [];
  const toolsUsed: string[] = [];
  let finalResponse = '';
  let iterations = 0;

  try {
    // Tool use loop
    while (iterations < opts.maxToolIterations) {
      iterations++;

      const response = await client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: fullSystemPrompt,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        messages,
      });

      // Check if there are tool calls
      const hasToolUse = response.content.some((block) => block.type === 'tool_use');

      if (hasToolUse) {
        // Execute tool calls
        const toolResults = await executeToolCalls(response.content, tools);
        const citations = extractSourceCitations(toolResults);
        allSourceCitations.push(...citations);

        // Track which tools were used
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolsUsed.push(block.name);
          }
        }

        console.log(`[AgentExecutor] ${context.displayName} used tools: ${toolsUsed.join(', ')}`);

        // Add assistant response and tool results to messages
        messages.push({
          role: 'assistant',
          content: response.content as ContentBlock[],
        });
        messages.push({
          role: 'user',
          content: formatToolResultsForClaude(toolResults),
        });
      } else {
        // No more tool calls - extract final text response
        const textBlock = response.content.find((b) => b.type === 'text');
        finalResponse = textBlock?.type === 'text' ? textBlock.text : '';
        break;
      }

      // If stop reason is end_turn without tool_use, we're done
      if (response.stop_reason === 'end_turn' && !hasToolUse) {
        const textBlock = response.content.find((b) => b.type === 'text');
        finalResponse = textBlock?.type === 'text' ? textBlock.text : '';
        break;
      }
    }

    if (!finalResponse) {
      return {
        success: false,
        response: '',
        toolsUsed,
        sourceCitations: allSourceCitations,
        wasIdentityCorrected: false,
        error: 'Failed to generate response',
      };
    }

    // Check for data claims without tool use (potential hallucination)
    if (detectDataClaimsWithoutTools(finalResponse, toolsUsed)) {
      console.warn(
        `[AgentExecutor] ${context.displayName}: Response claims data but no tools were used - potential hallucination`
      );
      // Add disclaimer
      finalResponse +=
        '\n\n_Note: Some information above may be from training data rather than live lookup._';
    }

    // Identity enforcement
    let wasIdentityCorrected = false;
    const leakage = detectAndCorrectIdentityLeakage(finalResponse, context.agentName);
    if (leakage) {
      console.warn(
        `[AgentExecutor] ${context.displayName}: Corrected identity leakage "${leakage.leaked}"`
      );
      finalResponse = leakage.corrected;
      wasIdentityCorrected = true;
    }

    // Add source citations if we have them and they're not mentioned
    const uniqueSources = [...new Set(allSourceCitations)];
    if (uniqueSources.length > 0 && !finalResponse.toLowerCase().includes('source')) {
      finalResponse += `\n\n_Sources: ${uniqueSources.join(', ')}_`;
    }

    return {
      success: true,
      response: finalResponse,
      toolsUsed: [...new Set(toolsUsed)],
      sourceCitations: uniqueSources,
      wasIdentityCorrected,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AgentExecutor] ${context.displayName} error:`, errorMsg);
    return {
      success: false,
      response: '',
      toolsUsed,
      sourceCitations: allSourceCitations,
      wasIdentityCorrected: false,
      error: errorMsg,
    };
  }
}

/**
 * Execute a simple task without tools (for agents that don't need data lookup)
 */
export async function executeSimpleTask(
  userMessage: string,
  context: ExecutionContext,
  options: Omit<ExecutionOptions, 'requireToolUse'> = {}
): Promise<ExecutionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options, requireToolUse: false };
  const client = getAnthropic();

  let fullSystemPrompt = context.systemPrompt;
  if (context.additionalContext) {
    fullSystemPrompt += `\n\n${context.additionalContext}`;
  }

  try {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: fullSystemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    let finalResponse = textBlock?.type === 'text' ? textBlock.text : '';

    if (!finalResponse) {
      return {
        success: false,
        response: '',
        toolsUsed: [],
        sourceCitations: [],
        wasIdentityCorrected: false,
        error: 'Failed to generate response',
      };
    }

    // Identity enforcement
    let wasIdentityCorrected = false;
    const leakage = detectAndCorrectIdentityLeakage(finalResponse, context.agentName);
    if (leakage) {
      console.warn(
        `[AgentExecutor] ${context.displayName}: Corrected identity leakage "${leakage.leaked}"`
      );
      finalResponse = leakage.corrected;
      wasIdentityCorrected = true;
    }

    return {
      success: true,
      response: finalResponse,
      toolsUsed: [],
      sourceCitations: [],
      wasIdentityCorrected,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[AgentExecutor] ${context.displayName} error:`, errorMsg);
    return {
      success: false,
      response: '',
      toolsUsed: [],
      sourceCitations: [],
      wasIdentityCorrected: false,
      error: errorMsg,
    };
  }
}
