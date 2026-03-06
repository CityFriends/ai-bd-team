/**
 * Tool Executor
 *
 * Executes tool calls from Claude's response and returns results
 * with proper source citations for agent responses.
 *
 * Features:
 * - Caching layer to reduce API calls
 * - Retry logic with exponential backoff for transient errors
 * - Stale cache fallback when APIs are unavailable
 * - Structured error logging
 */

import type { ContentBlock, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import type { AgentTool, ToolCallResult, ToolExecutionOptions } from './types.js';
import { getCachedToolResult, cacheToolResult, getStaleCachedResult } from './cache.js';
import {
  withRetry,
  logError,
  categorizeError,
  ErrorCategory,
  TimeoutError,
} from '../lib/errors.js';
import { metrics, MetricNames } from '../lib/metrics.js';

const DEFAULT_TIMEOUT = 15000; // 15 seconds
const MAX_RETRIES = 2; // Retry transient errors up to 2 times

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
 * Execute a single tool call with caching and retry logic
 */
async function executeToolCall(
  toolUse: ToolUseBlock,
  availableTools: AgentTool[],
  timeout: number,
  useCache: boolean = true
): Promise<ToolCallResult> {
  const startTime = Date.now();
  const tool = availableTools.find((t) => t.definition.name === toolUse.name);

  if (!tool) {
    console.warn(`[ToolExecutor] Unknown tool: ${toolUse.name}`);
    metrics.increment(MetricNames.TOOL_ERRORS, { tool: toolUse.name, error_type: 'unknown_tool' });
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
        metrics.increment(MetricNames.CACHE_HITS, { tool: toolUse.name });
        return {
          tool_use_id: toolUse.id,
          content: JSON.stringify(cached.data),
          sourceCitation: cached.sourceCitation,
          isError: false,
        };
      }
      metrics.increment(MetricNames.CACHE_MISSES, { tool: toolUse.name });
    } catch (cacheError) {
      // Log cache check failure but proceed
      logError(cacheError, { tool: toolUse.name }, 'cache_check');
    }
  }

  // Track this tool call
  metrics.increment(MetricNames.TOOL_CALLS, { tool: toolUse.name });

  try {
    console.log(`[ToolExecutor] Executing: ${toolUse.name}`, params);

    // Execute with retry for transient errors
    const result = await withRetry(
      async () => {
        // Execute with timeout
        const execResult = await Promise.race([
          tool.execute(params),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new TimeoutError(toolUse.name, timeout)), timeout)
          ),
        ]);

        // If tool returns success:false, don't retry - it's a logical failure
        if (!execResult.success) {
          const error = new Error(execResult.error || 'Tool execution failed');
          // Mark as permanent so we don't retry
          (error as unknown as Record<string, unknown>).statusCode = 400;
          throw error;
        }

        return execResult;
      },
      {
        maxRetries: MAX_RETRIES,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        operationName: `tool:${toolUse.name}`,
        retryOn: [ErrorCategory.TRANSIENT, ErrorCategory.UNKNOWN],
        onRetry: (error, attempt) => {
          console.log(
            `[ToolExecutor] Retrying ${toolUse.name} (attempt ${attempt}): ${error.message}`
          );
        },
      }
    );

    const durationMs = Date.now() - startTime;
    console.log(
      `[ToolExecutor] Success: ${toolUse.name} in ${durationMs}ms (source: ${result.sourceCitation})`
    );
    metrics.timing(MetricNames.TOOL_LATENCY, durationMs, { tool: toolUse.name });

    // Store in cache (don't await - fire and forget)
    if (useCache && result.data) {
      cacheToolResult(
        toolUse.name,
        params,
        result.data,
        result.sourceCitation || tool.sourceName
      ).catch((cacheErr) => {
        // Log cache store failure
        logError(cacheErr, { tool: toolUse.name }, 'cache_store');
      });
    }

    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify(result.data),
      sourceCitation: result.sourceCitation,
      isError: false,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const categorized = categorizeError(error);

    // Log the error with full context
    logError(
      error,
      {
        tool: toolUse.name,
        params: JSON.stringify(params).slice(0, 200),
        durationMs,
      },
      `tool:${toolUse.name}`
    );

    metrics.increment(MetricNames.TOOL_ERRORS, {
      tool: toolUse.name,
      error_type: categorized.category,
    });
    metrics.timing(MetricNames.TOOL_LATENCY, durationMs, { tool: toolUse.name, error: 'true' });

    // Try stale cache as fallback for transient errors
    if (useCache && categorized.category === ErrorCategory.TRANSIENT) {
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
      } catch (staleErr) {
        // Log stale cache lookup failure
        logError(staleErr, { tool: toolUse.name }, 'stale_cache_lookup');
      }
    }

    // Build user-friendly error message based on category
    const errorDetails = buildErrorDetails(categorized, tool.sourceName);

    return {
      tool_use_id: toolUse.id,
      content: JSON.stringify(errorDetails),
      sourceCitation: tool.sourceName,
      isError: true,
    };
  }
}

/**
 * Build user-friendly error details based on error category
 */
function buildErrorDetails(
  error: ReturnType<typeof categorizeError>,
  sourceName: string
): Record<string, unknown> {
  switch (error.category) {
    case ErrorCategory.TRANSIENT:
      return {
        error: `Unable to reach ${sourceName}`,
        details: error.message.includes('timeout')
          ? 'The service is taking too long to respond.'
          : 'The service may be temporarily unavailable.',
        suggestion: 'Try again in a few minutes or proceed without this data.',
        retryable: true,
        data: null,
      };

    case ErrorCategory.PERMANENT:
      return {
        error: `Request to ${sourceName} failed`,
        details:
          error.statusCode === 404
            ? 'The requested data was not found.'
            : error.statusCode === 403
              ? 'Access to this data is restricted.'
              : 'The request could not be completed.',
        suggestion: 'Check the parameters and try again.',
        retryable: false,
        data: null,
      };

    default:
      return {
        error: `Error accessing ${sourceName}`,
        details: 'An unexpected error occurred.',
        suggestion: 'Try again or proceed without this data.',
        data: null,
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
