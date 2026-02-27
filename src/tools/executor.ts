/**
 * Tool Executor
 *
 * Executes tool calls from Claude's response and returns results
 * with proper source citations for agent responses.
 *
 * Includes caching layer to reduce API calls.
 */

import type { ContentBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { AgentTool, ToolCallResult, ToolExecutionOptions } from './types.js';
import { getCachedToolResult, cacheToolResult, getStaleCachedResult } from './cache.js';

const DEFAULT_TIMEOUT = 15000; // 15 seconds

/**
 * Execute all tool calls from a Claude response
 */
export async function executeToolCalls(
  content: ContentBlock[],
  availableTools: AgentTool[],
  options: ToolExecutionOptions = {}
): Promise<ToolCallResult[]> {
  const { timeout = DEFAULT_TIMEOUT, skipCache = false } = options;
  const results: ToolCallResult[] = [];

  // Find tool_use blocks in the response
  const toolUseBlocks = content.filter((block): block is ToolUseBlock => block.type === 'tool_use');

  if (toolUseBlocks.length === 0) {
    return results;
  }

  // Execute tools in parallel for better performance
  const promises = toolUseBlocks.map(async (toolUse) => {
    return executeToolCall(toolUse, availableTools, timeout, !skipCache);
  });

  const executedResults = await Promise.all(promises);
  results.push(...executedResults);

  return results;
}

/**
 * Execute a single tool call with caching
 */
async function executeToolCall(
  toolUse: ToolUseBlock,
  availableTools: AgentTool[],
  timeout: number,
  useCache: boolean = true
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

  const params = toolUse.input as Record<string, unknown>;

  // Check cache first (if enabled)
  if (useCache) {
    try {
      const cached = await getCachedToolResult(toolUse.name, params);
      if (cached) {
        return {
          tool_use_id: toolUse.id,
          content: JSON.stringify(cached.data),
          sourceCitation: cached.sourceCitation,
          isError: false,
        };
      }
    } catch {
      // Cache check failed, proceed with execution
    }
  }

  try {
    console.log(`[ToolExecutor] Executing: ${toolUse.name}`, params);

    // Execute with timeout
    const result = await Promise.race([
      tool.execute(params),
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

    // Store in cache (don't await - fire and forget)
    if (useCache && result.data) {
      cacheToolResult(
        toolUse.name,
        params,
        result.data,
        result.sourceCitation || tool.sourceName
      ).catch(() => {
        // Ignore cache store failures
      });
    }

    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify(result.data),
      sourceCitation: result.sourceCitation,
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ToolExecutor] Error: ${toolUse.name}`, errorMessage);

    // Try stale cache as fallback
    if (useCache) {
      try {
        const stale = await getStaleCachedResult(toolUse.name, params);
        if (stale) {
          console.log(`[ToolExecutor] Using stale cache fallback for ${toolUse.name}`);
          return {
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              data: stale.data,
              note: `API was unavailable, showing cached data from ${stale.age} ago`,
            }),
            sourceCitation: stale.sourceCitation,
            isError: false, // Not an error since we have data
          };
        }
      } catch {
        // Stale cache lookup failed, proceed with error
      }
    }

    // No fallback available - return clear error message
    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify({
        error: `Unable to reach ${tool.sourceName}`,
        details: errorMessage.includes('timeout')
          ? 'The service is taking too long to respond.'
          : 'The service may be temporarily unavailable.',
        suggestion: 'Try again in a few minutes or proceed without this data.',
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
