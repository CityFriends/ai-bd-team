/**
 * Workflow Module
 *
 * Exports workflow definitions, instance management, and timeout processing.
 */

// Definitions
export {
  type WorkflowType,
  type WorkflowState,
  type EscalationAction,
  type WorkflowStateDefinition,
  type WorkflowDefinition,
  OPPORTUNITY_PURSUIT_WORKFLOW,
  PARTNER_SEARCH_WORKFLOW,
  getWorkflowDefinition,
  getStateDefinition,
  isValidTransition,
  getResponsibleAgent,
  getStateSLA,
  isTerminalState,
  getEscalationActions,
} from './definitions.js';

// Instance Management
export {
  type WorkflowInstance,
  type StateHistoryEntry,
  createWorkflowInstance,
  transitionWorkflow,
  getWorkflowInstance,
  getWorkflowByReference,
  getActiveWorkflows,
  getBreachedWorkflows,
  escalateWorkflow,
  getWorkflowHistory,
  getWorkflowMetrics,
  cancelWorkflow,
  completeWorkflow,
} from './instance-manager.js';

// Timeout Processing
export { processTimeouts, runTimeoutProcessor } from './timeout-processor.js';
