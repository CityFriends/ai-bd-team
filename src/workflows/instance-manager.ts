/**
 * Workflow Instance Manager
 *
 * Manages active workflow instances with persistent tracking of:
 * - Current state and state history
 * - Time spent in each state (SLA tracking)
 * - Escalation status
 * - Timeout handling
 */

import { getSupabase } from '../integrations/database/client.js';
import {
  type WorkflowType,
  type WorkflowState,
  getWorkflowDefinition,
  getStateDefinition,
  isValidTransition,
  getStateSLA,
} from './definitions.js';
import type { LiveAgentName } from '../live/types.js';

/**
 * Workflow instance stored in database
 */
export interface WorkflowInstance {
  id: string;
  workflow_type: WorkflowType;
  reference_id: string; // e.g., notice_id for opportunities
  reference_title?: string;
  current_state: WorkflowState;
  previous_state?: WorkflowState;
  state_entered_at: string;
  workflow_started_at: string;
  responsible_agent?: LiveAgentName;
  channel_id?: string;
  thread_ts?: string;
  priority: number;
  metadata: Record<string, unknown>;
  sla_deadline?: string;
  escalation_level: number;
  is_escalated: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * State history entry
 */
export interface StateHistoryEntry {
  id: string;
  workflow_instance_id: string;
  from_state: WorkflowState | null;
  to_state: WorkflowState;
  transitioned_at: string;
  duration_minutes?: number;
  triggered_by: 'agent' | 'auto' | 'human' | 'escalation';
  agent?: LiveAgentName;
  notes?: string;
}

/**
 * Create a new workflow instance
 */
export async function createWorkflowInstance(params: {
  workflowType: WorkflowType;
  referenceId: string;
  referenceTitle?: string;
  channelId?: string;
  threadTs?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}): Promise<WorkflowInstance | null> {
  const {
    workflowType,
    referenceId,
    referenceTitle,
    channelId,
    threadTs,
    priority,
    metadata = {},
  } = params;

  const definition = getWorkflowDefinition(workflowType);
  const initialState = definition.initialState;
  const stateDefinition = getStateDefinition(workflowType, initialState);

  // Calculate SLA deadline
  const slaMinutes = getStateSLA(workflowType, initialState);
  const slaDeadline = slaMinutes > 0 ? new Date(Date.now() + slaMinutes * 60 * 1000) : null;

  try {
    const { data, error } = await getSupabase()
      .from('workflow_instances')
      .insert({
        workflow_type: workflowType,
        reference_id: referenceId,
        reference_title: referenceTitle,
        current_state: initialState,
        state_entered_at: new Date().toISOString(),
        workflow_started_at: new Date().toISOString(),
        responsible_agent: stateDefinition?.responsibleAgent || null,
        channel_id: channelId,
        thread_ts: threadTs,
        priority: priority ?? definition.defaultPriority,
        metadata,
        sla_deadline: slaDeadline?.toISOString() || null,
        escalation_level: 0,
        is_escalated: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[WorkflowManager] Failed to create instance:', error.message);
      return null;
    }

    // Record initial state in history
    await recordStateTransition({
      workflowInstanceId: data.id,
      fromState: null,
      toState: initialState,
      triggeredBy: 'auto',
      notes: 'Workflow created',
    });

    console.log(
      `[WorkflowManager] Created ${workflowType} instance for ${referenceId} (state: ${initialState})`
    );
    return data;
  } catch (err) {
    console.error('[WorkflowManager] Error creating instance:', err);
    return null;
  }
}

/**
 * Transition workflow to a new state
 */
export async function transitionWorkflow(params: {
  instanceId: string;
  toState: WorkflowState;
  triggeredBy: 'agent' | 'auto' | 'human' | 'escalation';
  agent?: LiveAgentName;
  notes?: string;
  metadata?: Record<string, unknown>;
}): Promise<WorkflowInstance | null> {
  const { instanceId, toState, triggeredBy, agent, notes, metadata } = params;

  // Get current instance
  const { data: instance, error: fetchError } = await getSupabase()
    .from('workflow_instances')
    .select('*')
    .eq('id', instanceId)
    .single();

  if (fetchError || !instance) {
    console.error('[WorkflowManager] Instance not found:', instanceId);
    return null;
  }

  const workflowType = instance.workflow_type as WorkflowType;
  const fromState = instance.current_state as WorkflowState;

  // Validate transition
  if (!isValidTransition(workflowType, fromState, toState)) {
    console.error(
      `[WorkflowManager] Invalid transition: ${fromState} → ${toState} for ${workflowType}`
    );
    return null;
  }

  // Calculate time spent in previous state
  const stateEnteredAt = new Date(instance.state_entered_at);
  const durationMinutes = Math.round((Date.now() - stateEnteredAt.getTime()) / 60000);

  // Get new state definition
  const stateDefinition = getStateDefinition(workflowType, toState);
  const newSlaMinutes = getStateSLA(workflowType, toState);
  const newSlaDeadline =
    newSlaMinutes > 0 ? new Date(Date.now() + newSlaMinutes * 60 * 1000) : null;

  // Merge metadata
  const updatedMetadata = { ...instance.metadata, ...(metadata || {}) };

  try {
    const { data, error } = await getSupabase()
      .from('workflow_instances')
      .update({
        current_state: toState,
        previous_state: fromState,
        state_entered_at: new Date().toISOString(),
        responsible_agent: stateDefinition?.responsibleAgent || null,
        sla_deadline: newSlaDeadline?.toISOString() || null,
        escalation_level: 0, // Reset escalation on state change
        is_escalated: false,
        metadata: updatedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', instanceId)
      .select()
      .single();

    if (error) {
      console.error('[WorkflowManager] Failed to transition:', error.message);
      return null;
    }

    // Record state transition
    await recordStateTransition({
      workflowInstanceId: instanceId,
      fromState,
      toState,
      triggeredBy,
      agent,
      durationMinutes,
      notes,
    });

    console.log(
      `[WorkflowManager] Transitioned ${instance.reference_id}: ${fromState} → ${toState} (${durationMinutes} min in previous state)`
    );
    return data;
  } catch (err) {
    console.error('[WorkflowManager] Error transitioning:', err);
    return null;
  }
}

/**
 * Record a state transition in history
 */
async function recordStateTransition(params: {
  workflowInstanceId: string;
  fromState: WorkflowState | null;
  toState: WorkflowState;
  triggeredBy: 'agent' | 'auto' | 'human' | 'escalation';
  agent?: LiveAgentName;
  durationMinutes?: number;
  notes?: string;
}): Promise<void> {
  try {
    await getSupabase().from('workflow_state_history').insert({
      workflow_instance_id: params.workflowInstanceId,
      from_state: params.fromState,
      to_state: params.toState,
      transitioned_at: new Date().toISOString(),
      duration_minutes: params.durationMinutes,
      triggered_by: params.triggeredBy,
      agent: params.agent,
      notes: params.notes,
    });
  } catch (err) {
    console.warn('[WorkflowManager] Failed to record state history:', err);
  }
}

/**
 * Get workflow instance by ID
 */
export async function getWorkflowInstance(instanceId: string): Promise<WorkflowInstance | null> {
  const { data, error } = await getSupabase()
    .from('workflow_instances')
    .select('*')
    .eq('id', instanceId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get workflow instance by reference ID
 */
export async function getWorkflowByReference(
  referenceId: string,
  workflowType?: WorkflowType
): Promise<WorkflowInstance | null> {
  let query = getSupabase()
    .from('workflow_instances')
    .select('*')
    .eq('reference_id', referenceId)
    .order('created_at', { ascending: false });

  if (workflowType) {
    query = query.eq('workflow_type', workflowType);
  }

  const { data, error } = await query.limit(1).single();
  if (error) return null;
  return data;
}

/**
 * Get all active (non-terminal) workflow instances
 */
export async function getActiveWorkflows(options?: {
  workflowType?: WorkflowType;
  responsibleAgent?: LiveAgentName;
  limit?: number;
}): Promise<WorkflowInstance[]> {
  const terminalStates: WorkflowState[] = ['passed', 'cancelled', 'completed'];

  let query = getSupabase()
    .from('workflow_instances')
    .select('*')
    .not('current_state', 'in', `(${terminalStates.join(',')})`)
    .order('priority', { ascending: true })
    .order('sla_deadline', { ascending: true });

  if (options?.workflowType) {
    query = query.eq('workflow_type', options.workflowType);
  }
  if (options?.responsibleAgent) {
    query = query.eq('responsible_agent', options.responsibleAgent);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[WorkflowManager] Error fetching active workflows:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Get workflows that have breached their SLA
 */
export async function getBreachedWorkflows(): Promise<WorkflowInstance[]> {
  const terminalStates: WorkflowState[] = ['passed', 'cancelled', 'completed'];

  const { data, error } = await getSupabase()
    .from('workflow_instances')
    .select('*')
    .not('current_state', 'in', `(${terminalStates.join(',')})`)
    .not('sla_deadline', 'is', null)
    .lt('sla_deadline', new Date().toISOString())
    .order('sla_deadline', { ascending: true });

  if (error) {
    console.warn('[WorkflowManager] Error fetching breached workflows:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Escalate a workflow
 */
export async function escalateWorkflow(
  instanceId: string,
  escalationLevel: number,
  notes?: string
): Promise<WorkflowInstance | null> {
  const instance = await getWorkflowInstance(instanceId);
  if (!instance) return null;

  const { data, error } = await getSupabase()
    .from('workflow_instances')
    .update({
      escalation_level: escalationLevel,
      is_escalated: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', instanceId)
    .select()
    .single();

  if (error) {
    console.error('[WorkflowManager] Failed to escalate:', error.message);
    return null;
  }

  // Record escalation in history
  await recordStateTransition({
    workflowInstanceId: instanceId,
    fromState: instance.current_state as WorkflowState,
    toState: instance.current_state as WorkflowState, // Same state
    triggeredBy: 'escalation',
    notes: notes || `Escalated to level ${escalationLevel}`,
  });

  console.log(`[WorkflowManager] Escalated ${instance.reference_id} to level ${escalationLevel}`);
  return data;
}

/**
 * Get state history for a workflow
 */
export async function getWorkflowHistory(instanceId: string): Promise<StateHistoryEntry[]> {
  const { data, error } = await getSupabase()
    .from('workflow_state_history')
    .select('*')
    .eq('workflow_instance_id', instanceId)
    .order('transitioned_at', { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Get SLA metrics for a workflow
 */
export async function getWorkflowMetrics(instanceId: string): Promise<{
  totalDurationMinutes: number;
  stateMetrics: Record<string, { count: number; totalMinutes: number; avgMinutes: number }>;
  slaBreaches: number;
}> {
  const history = await getWorkflowHistory(instanceId);
  const instance = await getWorkflowInstance(instanceId);

  if (!instance) {
    return { totalDurationMinutes: 0, stateMetrics: {}, slaBreaches: 0 };
  }

  const workflowType = instance.workflow_type as WorkflowType;
  const stateMetrics: Record<string, { count: number; totalMinutes: number; avgMinutes: number }> =
    {};
  let slaBreaches = 0;

  for (const entry of history) {
    if (entry.from_state && entry.duration_minutes !== undefined) {
      if (!stateMetrics[entry.from_state]) {
        stateMetrics[entry.from_state] = { count: 0, totalMinutes: 0, avgMinutes: 0 };
      }
      stateMetrics[entry.from_state].count++;
      stateMetrics[entry.from_state].totalMinutes += entry.duration_minutes;

      // Check if SLA was breached
      const slaMinutes = getStateSLA(workflowType, entry.from_state as WorkflowState);
      if (slaMinutes > 0 && entry.duration_minutes > slaMinutes) {
        slaBreaches++;
      }
    }
  }

  // Calculate averages
  for (const state of Object.keys(stateMetrics)) {
    stateMetrics[state].avgMinutes = Math.round(
      stateMetrics[state].totalMinutes / stateMetrics[state].count
    );
  }

  const startTime = new Date(instance.workflow_started_at).getTime();
  const totalDurationMinutes = Math.round((Date.now() - startTime) / 60000);

  return { totalDurationMinutes, stateMetrics, slaBreaches };
}

/**
 * Cancel a workflow
 */
export async function cancelWorkflow(
  instanceId: string,
  reason?: string
): Promise<WorkflowInstance | null> {
  return transitionWorkflow({
    instanceId,
    toState: 'cancelled',
    triggeredBy: 'human',
    notes: reason || 'Workflow cancelled',
  });
}

/**
 * Complete a workflow
 */
export async function completeWorkflow(
  instanceId: string,
  outcome?: Record<string, unknown>
): Promise<WorkflowInstance | null> {
  const instance = await getWorkflowInstance(instanceId);
  if (!instance) return null;

  return transitionWorkflow({
    instanceId,
    toState: 'completed',
    triggeredBy: 'human',
    notes: 'Workflow completed',
    metadata: { outcome, completed_at: new Date().toISOString() },
  });
}
