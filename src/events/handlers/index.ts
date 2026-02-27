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

// Import system handlers (non-agent)
import { workflowHandlers } from './workflow-auto-create.js';

// ============================================================
// Handler Registry
// ============================================================
export type AgentHandlerMap = Map<EventType, EventHandler>;

const handlersByAgent: Record<LiveAgentName, AgentHandlerMap> = {
  maya: mayaHandlers,
  david: davidHandlers,
  marcus: marcusHandlers,
  rosa: rosaHandlers,
  james: jamesHandlers,
  patricia: patriciaHandlers,
  // Jodie is the strategic advisor - she responds to direct questions in Slack
  // rather than reacting to events. Event handlers are intentionally empty.
  // If Jodie needs to react to events in the future, create jodie.handlers.ts
  jodie: new Map(),
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
