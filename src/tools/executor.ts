/**
 * Tool Executor
 *
 * Executes tool calls from Claude's response and returns results
 * with proper source citations for agent responses.
 */

import type { ContentBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { AgentTool, ToolCallResult, ToolExecutionOptions } from './types.js';

const DEFAULT_TIMEOUT = 15000; // 15 seconds

/**
 * Execute all tool calls from a Claude response
 */
export async function executeToolCalls(
  content: ContentBlock[],
  availableTools: AgentTool[],
  options: ToolExecutionOptions = {}
): Promise<ToolCallResult[]> {
  const { timeout = DEFAULT_TIMEOUT } = options;
  const results: ToolCallResult[] = [];

  // Find tool_use blocks in the response
  const toolUseBlocks = content.filter((block): block is ToolUseBlock => block.type === 'tool_use');

  if (toolUseBlocks.length === 0) {
    return results;
  }

  // Execute tools in parallel for better performance
  const promises = toolUseBlocks.map(async (toolUse) => {
    return executeToolCall(toolUse, availableTools, timeout);
  });

  const executedResults = await Promise.all(promises);
  results.push(...executedResults);

  return results;
}

/**
 * Execute a single tool call
 */
async function executeToolCall(
  toolUse: ToolUseBlock,
  availableTools: AgentTool[],
  timeout: number
): Promise<ToolCallResult> {
  const tool = availableTools.find((t) => t.definition.name === toolUse.name);

  if (!tool) {
    console.warn(`[ToolExecutor] Unknown tool: ${toolUse.name}`);
    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify({
        error: `Unknown tool: ${toolUse.name}`,
        available: availableTools.map((t) => t.definition.name),
      }),
      sourceCitation: '',
      isError: true,
    };
  }

  try {
    console.log(`[ToolExecutor] Executing: ${toolUse.name}`, toolUse.input);

    // Execute with timeout
    const result = await Promise.race([
      tool.execute(toolUse.input as Record<string, unknown>),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
      ),
    ]);

    if (!result.success) {
      console.warn(`[ToolExecutor] Tool failed: ${toolUse.name}`, result.error);
      return {
        tool_use_id: toolUse.id,
        content: JSON.stringify({
          error: result.error || 'Tool execution failed',
          data: null,
        }),
        sourceCitation: result.sourceCitation || tool.sourceName,
        isError: true,
      };
    }

    console.log(`[ToolExecutor] Success: ${toolUse.name} (source: ${result.sourceCitation})`);

    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify(result.data),
      sourceCitation: result.sourceCitation,
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ToolExecutor] Error: ${toolUse.name}`, errorMessage);

    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify({
        error: `Tool execution failed: ${errorMessage}`,
        data: null,
      }),
      sourceCitation: tool.sourceName,
      isError: true,
    };
  }
}

/**
 * Format tool results for Claude's tool_result message
 */
export function formatToolResultsForClaude(
  results: ToolCallResult[]
): Array<{ type: 'tool_result'; tool_use_id: string; content: string }> {
  return results.map((result) => ({
    type: 'tool_result' as const,
    tool_use_id: result.tool_use_id,
    content: result.content,
  }));
}

/**
 * Extract unique source citations from tool results
 */
export function extractSourceCitations(results: ToolCallResult[]): string[] {
  const sources = new Set<string>();

  for (const result of results) {
    if (result.sourceCitation && !result.isError) {
      sources.add(result.sourceCitation);
    }
  }

  return Array.from(sources);
}
