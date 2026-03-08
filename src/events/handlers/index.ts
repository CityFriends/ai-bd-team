// Event Handler Registry
// Maps agents to their event handlers

import { EventType } from '../eventTypes.js';
import { EventHandler } from '../eventProcessor.js';
import type { LiveAgentName } from '../../live/types.js';

// Import agent handlers
import { mayaHandlers } from './maya.handlers.js';
import { davidHandlers } from './david.handlers.js';
import { marcusHandlers } from './marcus.handlers.js';
import { rosaHandlers } from './rosa.handlers.js';
import { jamesHandlers } from './james.handlers.js';
import { patriciaHandlers } from './patricia.handlers.js';

// Import feed handlers (for agent-to-agent interaction)
import { feedHandlersByAgent } from './feed.handlers.js';

// Import system handlers (non-agent)
import { workflowHandlers } from './workflow-auto-create.js';

// ============================================================
// Handler Registry
// ============================================================
export type AgentHandlerMap = Map<EventType, EventHandler>;

/**
 * Merge multiple handler maps into one
 */
function mergeHandlerMaps(...maps: AgentHandlerMap[]): AgentHandlerMap {
  const merged = new Map<EventType, EventHandler>();
  for (const map of maps) {
    for (const [eventType, handler] of map) {
      merged.set(eventType, handler);
    }
  }
  return merged;
}

// Core handlers + feed handlers merged together
const handlersByAgent: Record<LiveAgentName, AgentHandlerMap> = {
  maya: mergeHandlerMaps(mayaHandlers, feedHandlersByAgent.maya),
  david: mergeHandlerMaps(davidHandlers, feedHandlersByAgent.david),
  marcus: mergeHandlerMaps(marcusHandlers, feedHandlersByAgent.marcus),
  rosa: mergeHandlerMaps(rosaHandlers, feedHandlersByAgent.rosa),
  james: mergeHandlerMaps(jamesHandlers, feedHandlersByAgent.james),
  patricia: mergeHandlerMaps(patriciaHandlers, feedHandlersByAgent.patricia),
  jodie: feedHandlersByAgent.jodie, // Jodie now has feed handlers
};

/**
 * Get all handlers for a specific agent
 */
export function getHandlersForAgent(agent: LiveAgentName): AgentHandlerMap {
  return handlersByAgent[agent] || new Map();
}

/**
 * Get a specific handler for an agent and event type
 */
export function getHandler(agent: LiveAgentName, eventType: EventType): EventHandler | undefined {
  return handlersByAgent[agent]?.get(eventType);
}

/**
 * Check if an agent has a handler for an event type
 */
export function hasHandler(agent: LiveAgentName, eventType: EventType): boolean {
  return handlersByAgent[agent]?.has(eventType) ?? false;
}

/**
 * Get all event types an agent handles
 */
export function getHandledEventTypes(agent: LiveAgentName): EventType[] {
  const handlers = handlersByAgent[agent];
  if (!handlers) return [];
  return Array.from(handlers.keys());
}

/**
 * Get all agents that handle a specific event type
 */
export function getAgentsForEventType(eventType: EventType): LiveAgentName[] {
  const agents: LiveAgentName[] = [];
  for (const [agent, handlers] of Object.entries(handlersByAgent)) {
    if (handlers.has(eventType)) {
      agents.push(agent as LiveAgentName);
    }
  }
  return agents;
}

// Re-export individual handler maps for direct access
export {
  mayaHandlers,
  davidHandlers,
  marcusHandlers,
  rosaHandlers,
  jamesHandlers,
  patriciaHandlers,
  workflowHandlers,
};

/**
 * Get system-level handlers (not agent-specific)
 * These handle events that need system-wide processing
 */
export function getSystemHandlers(): AgentHandlerMap {
  return workflowHandlers;
}
