/**
 * Workflow Definitions
 *
 * Formal state machine definitions for autonomous workflows.
 * Defines states, transitions, timeouts, SLAs, and escalation rules.
 */

import type { LiveAgentName } from '../live/types.js';

/**
 * Workflow types supported by the system
 */
export type WorkflowType = 'opportunity_pursuit' | 'partner_search' | 'proposal_development';

/**
 * Valid workflow states
 */
export type WorkflowState =
  | 'created'
  | 'found'
  | 'researching'
  | 'tech_review'
  | 'partner_search'
  | 'strategy'
  | 'decision_pending'
  | 'pursuing'
  | 'proposal_drafting'
  | 'proposal_review'
  | 'submitted'
  | 'passed'
  | 'cancelled'
  | 'completed';

/**
 * Escalation actions when SLA is breached
 */
export type EscalationAction =
  | 'notify_patricia' // Alert Patricia to coordinate
  | 'notify_channel' // Post to channel
  | 'auto_advance' // Skip to next state with available data
  | 'assign_backup' // Assign to backup agent
  | 'escalate_human' // Escalate to Lapedra/Tamara
  | 'timeout_fail'; // Mark workflow as timed out

/**
 * State definition within a workflow
 */
export interface WorkflowStateDefinition {
  /** Human-readable name */
  name: string;

  /** Description of what happens in this state */
  description: string;

  /** Agent responsible for this state (null = system or human) */
  responsibleAgent: LiveAgentName | null;

  /** Valid transitions from this state */
  transitions: WorkflowState[];

  /** Expected time to complete this state (minutes) */
  expectedDurationMinutes: number;

  /** SLA threshold before escalation (minutes) */
  slaMinutes: number;

  /** Actions to take when SLA is breached (in order) */
  escalationActions: EscalationAction[];

  /** Is this a terminal state? */
  isTerminal: boolean;

  /** Can this state be skipped? */
  canSkip: boolean;

  /** Required inputs to enter this state */
  requiredInputs?: string[];

  /** Outputs produced by this state */
  outputs?: string[];

  /** Auto-advance conditions (if met, skip human approval) */
  autoAdvanceConditions?: {
    field: string;
    operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
    value: unknown;
  }[];
}

/**
 * Complete workflow definition
 */
export interface WorkflowDefinition {
  /** Workflow type identifier */
  type: WorkflowType;

  /** Human-readable name */
  name: string;

  /** Description */
  description: string;

  /** Initial state */
  initialState: WorkflowState;

  /** State definitions */
  states: Record<WorkflowState, WorkflowStateDefinition>;

  /** Global timeout for entire workflow (hours) */
  globalTimeoutHours: number;

  /** Priority (1-10, 1 = highest) */
  defaultPriority: number;
}

/**
 * Opportunity Pursuit Workflow
 * Flow: found → researching → tech_review → partner_search → strategy → decision_pending → pursuing/passed
 */
export const OPPORTUNITY_PURSUIT_WORKFLOW: WorkflowDefinition = {
  type: 'opportunity_pursuit',
  name: 'Opportunity Pursuit',
  description: 'End-to-end workflow for evaluating and pursuing federal contract opportunities',
  initialState: 'found',
  globalTimeoutHours: 168, // 1 week
  defaultPriority: 3,

  states: {
    created: {
      name: 'Created',
      description: 'Workflow initialized but not yet started',
      responsibleAgent: null,
      transitions: ['found'],
      expectedDurationMinutes: 0,
      slaMinutes: 5,
      escalationActions: ['auto_advance'],
      isTerminal: false,
      canSkip: true,
    },

    found: {
      name: 'Opportunity Found',
      description: 'Maya discovered a new opportunity, awaiting initial review',
      responsibleAgent: 'maya',
      transitions: ['researching', 'passed'],
      expectedDurationMinutes: 30,
      slaMinutes: 60, // 1 hour to acknowledge
      escalationActions: ['notify_patricia', 'auto_advance'],
      isTerminal: false,
      canSkip: false,
      outputs: ['notice_id', 'title', 'agency', 'score'],
      autoAdvanceConditions: [
        { field: 'score', operator: 'gte', value: 70 }, // Auto-advance if score >= 70
      ],
    },

    researching: {
      name: 'Research & Analysis',
      description: 'David researches incumbent, agency history, and red/green flags',
      responsibleAgent: 'david',
      transitions: ['tech_review', 'partner_search', 'strategy', 'passed'],
      expectedDurationMinutes: 45,
      slaMinutes: 120, // 2 hours
      escalationActions: ['notify_patricia', 'notify_channel', 'auto_advance'],
      isTerminal: false,
      canSkip: false,
      requiredInputs: ['notice_id'],
      outputs: ['incumbent', 'incumbent_contract_value', 'red_flags', 'green_flags'],
    },

    tech_review: {
      name: 'Technical Review',
      description: 'Marcus assesses technical requirements, FedRAMP, and architecture fit',
      responsibleAgent: 'marcus',
      transitions: ['partner_search', 'strategy'],
      expectedDurationMinutes: 30,
      slaMinutes: 90, // 1.5 hours
      escalationActions: ['notify_patricia', 'auto_advance'],
      isTerminal: false,
      canSkip: true, // Can skip if not technically complex
      requiredInputs: ['notice_id', 'incumbent'],
      outputs: ['tech_fit_score', 'tech_gaps', 'compliance_requirements'],
    },

    partner_search: {
      name: 'Partner Search',
      description: 'Rosa evaluates teaming opportunities and potential partners',
      responsibleAgent: 'rosa',
      transitions: ['strategy'],
      expectedDurationMinutes: 30,
      slaMinutes: 90, // 1.5 hours
      escalationActions: ['notify_patricia', 'auto_advance'],
      isTerminal: false,
      canSkip: true, // Can skip if teaming not needed
      requiredInputs: ['notice_id', 'red_flags'],
      outputs: ['teaming_recommended', 'teaming_partners', 'partnership_notes'],
    },

    strategy: {
      name: 'Strategic Assessment',
      description: 'James synthesizes inputs and makes go/no-go recommendation',
      responsibleAgent: 'james',
      transitions: ['decision_pending', 'pursuing', 'passed'],
      expectedDurationMinutes: 30,
      slaMinutes: 60, // 1 hour
      escalationActions: ['notify_patricia', 'escalate_human'],
      isTerminal: false,
      canSkip: false,
      requiredInputs: ['notice_id', 'incumbent', 'red_flags'],
      outputs: ['james_recommendation', 'win_probability', 'decision_rationale'],
    },

    decision_pending: {
      name: 'Awaiting Decision',
      description: 'Human override window - waiting for approval or rejection',
      responsibleAgent: null, // Human decision
      transitions: ['pursuing', 'passed'],
      expectedDurationMinutes: 120, // 2 hour override window
      slaMinutes: 240, // 4 hours max
      escalationActions: ['notify_channel', 'escalate_human'],
      isTerminal: false,
      canSkip: false,
      requiredInputs: ['james_recommendation'],
      autoAdvanceConditions: [
        { field: 'score', operator: 'gte', value: 85 },
        { field: 'red_flags_count', operator: 'lte', value: 1 },
      ],
    },

    pursuing: {
      name: 'Actively Pursuing',
      description: 'Team is actively working on this opportunity',
      responsibleAgent: 'patricia',
      transitions: ['proposal_drafting', 'completed', 'cancelled'],
      expectedDurationMinutes: 0, // Variable
      slaMinutes: 10080, // 1 week
      escalationActions: ['notify_channel'],
      isTerminal: false,
      canSkip: false,
      requiredInputs: ['decision'],
    },

    proposal_drafting: {
      name: 'Proposal Drafting',
      description: 'Jodie drafting proposal response',
      responsibleAgent: 'jodie',
      transitions: ['proposal_review', 'cancelled'],
      expectedDurationMinutes: 480, // 8 hours
      slaMinutes: 2880, // 48 hours
      escalationActions: ['notify_patricia', 'escalate_human'],
      isTerminal: false,
      canSkip: false,
    },

    proposal_review: {
      name: 'Proposal Review',
      description: 'Team reviewing draft proposal',
      responsibleAgent: 'patricia',
      transitions: ['submitted', 'proposal_drafting', 'cancelled'],
      expectedDurationMinutes: 120,
      slaMinutes: 480, // 8 hours
      escalationActions: ['notify_channel', 'escalate_human'],
      isTerminal: false,
      canSkip: false,
    },

    submitted: {
      name: 'Proposal Submitted',
      description: 'Proposal has been submitted, awaiting outcome',
      responsibleAgent: null,
      transitions: ['completed'],
      expectedDurationMinutes: 0,
      slaMinutes: 43200, // 30 days
      escalationActions: ['notify_patricia'],
      isTerminal: false,
      canSkip: false,
    },

    passed: {
      name: 'Passed',
      description: 'Decided not to pursue this opportunity',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: true,
      canSkip: false,
    },

    cancelled: {
      name: 'Cancelled',
      description: 'Workflow cancelled (opportunity withdrawn, etc.)',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: true,
      canSkip: false,
    },

    completed: {
      name: 'Completed',
      description: 'Workflow completed (win or loss recorded)',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: true,
      canSkip: false,
    },
  },
};

/**
 * Partner Search Workflow (standalone)
 * For when Rosa needs to do a deep partner search outside opportunity context
 */
export const PARTNER_SEARCH_WORKFLOW: WorkflowDefinition = {
  type: 'partner_search',
  name: 'Partner Search',
  description: 'Standalone workflow for finding and vetting potential teaming partners',
  initialState: 'created',
  globalTimeoutHours: 72, // 3 days
  defaultPriority: 5,

  states: {
    created: {
      name: 'Created',
      description: 'Partner search request received',
      responsibleAgent: null,
      transitions: ['researching'],
      expectedDurationMinutes: 0,
      slaMinutes: 5,
      escalationActions: ['auto_advance'],
      isTerminal: false,
      canSkip: true,
    },

    found: {
      name: 'Found',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    researching: {
      name: 'Researching Partners',
      description: 'Rosa researching potential partners based on requirements',
      responsibleAgent: 'rosa',
      transitions: ['strategy'],
      expectedDurationMinutes: 60,
      slaMinutes: 180, // 3 hours
      escalationActions: ['notify_patricia', 'notify_channel'],
      isTerminal: false,
      canSkip: false,
      outputs: ['partner_candidates', 'partner_analysis'],
    },

    tech_review: {
      name: 'Tech Review',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    partner_search: {
      name: 'Partner Search',
      description: 'N/A - this is the main workflow',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    strategy: {
      name: 'Partner Recommendation',
      description: 'Rosa presents partner recommendations for review',
      responsibleAgent: 'rosa',
      transitions: ['completed', 'cancelled'],
      expectedDurationMinutes: 30,
      slaMinutes: 60,
      escalationActions: ['notify_patricia'],
      isTerminal: false,
      canSkip: false,
    },

    decision_pending: {
      name: 'Decision Pending',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    pursuing: {
      name: 'Pursuing',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    proposal_drafting: {
      name: 'Proposal Drafting',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    proposal_review: {
      name: 'Proposal Review',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    submitted: {
      name: 'Submitted',
      description: 'N/A for partner search',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: false,
      canSkip: true,
    },

    passed: {
      name: 'Passed',
      description: 'Partner search concluded without selection',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: true,
      canSkip: false,
    },

    cancelled: {
      name: 'Cancelled',
      description: 'Partner search cancelled',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: true,
      canSkip: false,
    },

    completed: {
      name: 'Completed',
      description: 'Partner search completed with recommendations',
      responsibleAgent: null,
      transitions: [],
      expectedDurationMinutes: 0,
      slaMinutes: 0,
      escalationActions: [],
      isTerminal: true,
      canSkip: false,
    },
  },
};

/**
 * Get workflow definition by type
 */
export function getWorkflowDefinition(type: WorkflowType): WorkflowDefinition {
  const definitions: Record<WorkflowType, WorkflowDefinition> = {
    opportunity_pursuit: OPPORTUNITY_PURSUIT_WORKFLOW,
    partner_search: PARTNER_SEARCH_WORKFLOW,
    proposal_development: OPPORTUNITY_PURSUIT_WORKFLOW, // Reuse for now
  };

  return definitions[type];
}

/**
 * Get state definition for a workflow state
 */
export function getStateDefinition(
  workflowType: WorkflowType,
  state: WorkflowState
): WorkflowStateDefinition | null {
  const workflow = getWorkflowDefinition(workflowType);
  return workflow.states[state] || null;
}

/**
 * Check if a transition is valid
 */
export function isValidTransition(
  workflowType: WorkflowType,
  fromState: WorkflowState,
  toState: WorkflowState
): boolean {
  const stateDefinition = getStateDefinition(workflowType, fromState);
  if (!stateDefinition) return false;
  return stateDefinition.transitions.includes(toState);
}

/**
 * Get the responsible agent for a state
 */
export function getResponsibleAgent(
  workflowType: WorkflowType,
  state: WorkflowState
): LiveAgentName | null {
  const stateDefinition = getStateDefinition(workflowType, state);
  return stateDefinition?.responsibleAgent || null;
}

/**
 * Get SLA in minutes for a state
 */
export function getStateSLA(workflowType: WorkflowType, state: WorkflowState): number {
  const stateDefinition = getStateDefinition(workflowType, state);
  return stateDefinition?.slaMinutes || 0;
}

/**
 * Check if state is terminal
 */
export function isTerminalState(workflowType: WorkflowType, state: WorkflowState): boolean {
  const stateDefinition = getStateDefinition(workflowType, state);
  return stateDefinition?.isTerminal ?? false;
}

/**
 * Get escalation actions for a state
 */
export function getEscalationActions(
  workflowType: WorkflowType,
  state: WorkflowState
): EscalationAction[] {
  const stateDefinition = getStateDefinition(workflowType, state);
  return stateDefinition?.escalationActions || [];
}
