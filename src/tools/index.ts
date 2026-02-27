/**
 * Tools Module
 *
 * Exports all tool-related functionality for agent tool use.
 */

// Types
export type { AgentTool, ToolResult, ToolCallResult, ToolExecutionOptions } from './types.js';

// Registry
export {
  getToolsForAgent,
  getToolDefinitionsForAgent,
  agentCanUseTool,
  getToolByName,
  getToolNamesForAgent,
  formatToolDescriptionsForAgent,
  logRegistryStatus,
} from './registry.js';

// Executor
export {
  executeToolCalls,
  formatToolResultsForClaude,
  extractSourceCitations,
} from './executor.js';

// Cache
export {
  getCachedToolResult,
  cacheToolResult,
  getStaleCachedResult,
  cleanupToolCache,
  getToolCacheStats,
} from './cache.js';
