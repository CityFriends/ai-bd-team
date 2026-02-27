/**
 * Core Module
 *
 * Shared components used by both live agents and scheduled actions.
 */

export {
  executeAgentTask,
  executeSimpleTask,
  type ExecutionContext,
  type ExecutionOptions,
  type ExecutionResult,
} from './agent-executor.js';
