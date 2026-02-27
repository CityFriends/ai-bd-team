/**
 * Tool Registry
 *
 * Central registry for all agent tools.
 * Manages tool registration and agent access permissions.
 */

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import type { AgentTool } from './types.js';
import type { LiveAgentName } from '../live/types.js';

// Import tool definitions
import { samGovTools } from './definitions/sam-gov.tools.js';
import { contractDataTools } from './definitions/contract-data.tools.js';
import { usaspendingTools } from './definitions/usaspending.tools.js';
import { newsSearchTools } from './definitions/news-search.tools.js';
import { farSearchTools } from './definitions/far-search.tools.js';
import { samEntityTools } from './definitions/sam-entity.tools.js';
import { proposalTools } from './definitions/proposal.tools.js';
import { githubTools } from './definitions/github.tools.js';

/**
 * All registered tools
 */
const ALL_TOOLS: AgentTool[] = [
  // SAM.gov opportunity tools (Maya, Marcus)
  ...samGovTools,

  // Contract data tools (David)
  ...contractDataTools,

  // USASpending tools (David)
  ...usaspendingTools,

  // News search tools (David)
  ...newsSearchTools,

  // FAR search tools (David, James)
  ...farSearchTools,

  // SAM entity tools (Rosa)
  ...samEntityTools,

  // Proposal tools (Jodie)
  ...proposalTools,

  // GitHub tools (Marcus)
  ...githubTools,
];

/**
 * Get all tools available to a specific agent
 */
export function getToolsForAgent(agentName: LiveAgentName): AgentTool[] {
  return ALL_TOOLS.filter((tool) => tool.allowedAgents.includes(agentName));
}

/**
 * Get Claude API tool definitions for an agent
 */
export function getToolDefinitionsForAgent(agentName: LiveAgentName): Tool[] {
  return getToolsForAgent(agentName).map((tool) => tool.definition);
}

/**
 * Check if an agent has access to a specific tool
 */
export function agentCanUseTool(agentName: LiveAgentName, toolName: string): boolean {
  const tool = ALL_TOOLS.find((t) => t.definition.name === toolName);
  return tool ? tool.allowedAgents.includes(agentName) : false;
}

/**
 * Get a tool by name
 */
export function getToolByName(toolName: string): AgentTool | undefined {
  return ALL_TOOLS.find((t) => t.definition.name === toolName);
}

/**
 * Get all tool names available to an agent
 */
export function getToolNamesForAgent(agentName: LiveAgentName): string[] {
  return getToolsForAgent(agentName).map((tool) => tool.definition.name);
}

/**
 * Format tool descriptions for inclusion in agent context
 */
export function formatToolDescriptionsForAgent(agentName: LiveAgentName): string {
  const tools = getToolsForAgent(agentName);

  if (tools.length === 0) {
    return '';
  }

  const descriptions = tools
    .map((tool) => `- ${tool.definition.name}: ${tool.definition.description}`)
    .join('\n');

  return `
LIVE DATA TOOLS:
You have access to these tools to fetch real-time data during our conversation:

${descriptions}

WHEN TO USE TOOLS:
- Use tools when you need current data that isn't in your pre-loaded context
- Use tools when the user explicitly asks you to "search", "look up", or "find" something
- Don't use tools if your pre-loaded research data already has what you need

CITATION REQUIREMENT:
When you use a tool, you MUST cite the source in your response.
Example: "According to SAM.gov..." or include "_Sources: SAM.gov_" at the end.
Never state facts from tool results without attribution.
`;
}

/**
 * Log registry status (for debugging)
 */
export function logRegistryStatus(): void {
  console.log('[ToolRegistry] Registered tools:');
  for (const tool of ALL_TOOLS) {
    console.log(`  - ${tool.definition.name}: ${tool.allowedAgents.join(', ')}`);
  }
}
