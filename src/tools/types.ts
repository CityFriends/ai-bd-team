/**
 * Tool Types for Live Agent Tool Use
 *
 * Defines interfaces for Claude tool use integration,
 * allowing agents to call data sources during conversation.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { LiveAgentName } from '../live/types.js';

/**
 * Result returned from executing a tool
 */
export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  /** Source name for citation (e.g., "SAM.gov", "USASpending FY2025") */
  sourceCitation: string;
}

/**
 * A tool that can be used by agents
 */
export interface AgentTool {
  /** The Claude API tool definition */
  definition: Tool;

  /** Which agents can use this tool */
  allowedAgents: LiveAgentName[];

  /** Human-readable source name for citations */
  sourceName: string;

  /** Execute the tool with given parameters */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Result from executing a tool call (includes the tool_use_id for Claude)
 */
export interface ToolCallResult {
  tool_use_id: string;
  content: string;
  sourceCitation: string;
  isError: boolean;
}

/**
 * Formatted tool result for display
 */
export interface FormattedToolData {
  summary: string;
  details: string;
  count?: number;
}

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
  /** Timeout in milliseconds (default 15000) */
  timeout?: number;
  /** Whether to include debug info in result */
  debug?: boolean;
  /** Skip cache and force fresh API call (default false) */
  skipCache?: boolean;
}
