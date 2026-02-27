/**
 * Workflow Timeout Processor
 *
 * Monitors workflows for SLA breaches and executes escalation actions.
 * Designed to run as a cron job every 5 minutes.
 */

import { getSupabase } from '../integrations/database/client.js';
import {
  getBreachedWorkflows,
  escalateWorkflow,
  transitionWorkflow,
  type WorkflowInstance,
} from './instance-manager.js';
import {
  type WorkflowType,
  type WorkflowState,
  type EscalationAction,
  getStateDefinition,
  getEscalationActions,
} from './definitions.js';
import { App } from '@slack/bolt';

// Agent Slack IDs for notifications
const AGENT_SLACK_IDS: Record<string, string> = {
  patricia: 'U0AC79NTDAN',
  maya: 'U0AC3RA4JVB',
  david: 'U0AC0SVD3MH',
  rosa: 'U0ACASZ36BW',
  james: 'U0AC582GXBQ',
  jodie: 'U0ACP8LKFB3',
  marcus: 'U0ADSL3DL95',
};

// Human Slack IDs for escalation
const HUMAN_SLACK_IDS: Record<string, string> = {
  lapedra: 'U07QGKC2MJL', // Update with actual ID
  tamara: 'U07QGKC2MJL', // Update with actual ID
};

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

/**
 * Result of processing a single escalation
 */
interface EscalationResult {
  instanceId: string;
  referenceId: string;
  action: EscalationAction;
  success: boolean;
  notes?: string;
}

/**
 * Process all breached workflows
 */
export async function processTimeouts(): Promise<EscalationResult[]> {
  console.log('\n[TimeoutProcessor] Checking for SLA breaches...');

  const breachedWorkflows = await getBreachedWorkflows();

  if (breachedWorkflows.length === 0) {
    console.log('[TimeoutProcessor] No SLA breaches found');
    return [];
  }

  console.log(`[TimeoutProcessor] Found ${breachedWorkflows.length} breached workflow(s)`);

  const results: EscalationResult[] = [];

  for (const workflow of breachedWorkflows) {
    const escalationResults = await processWorkflowEscalation(workflow);
    results.push(...escalationResults);
  }

  return results;
}

/**
 * Process escalation for a single workflow
 */
async function processWorkflowEscalation(workflow: WorkflowInstance): Promise<EscalationResult[]> {
  const workflowType = workflow.workflow_type as WorkflowType;
  const currentState = workflow.current_state as WorkflowState;
  const escalationActions = getEscalationActions(workflowType, currentState);

  if (escalationActions.length === 0) {
    console.log(`[TimeoutProcessor] No escalation actions defined for ${currentState}`);
    return [];
  }

  // Get the next escalation action based on current level
  const nextLevel = workflow.escalation_level + 1;

  if (nextLevel > escalationActions.length) {
    console.log(
      `[TimeoutProcessor] ${workflow.reference_id}: All escalation actions exhausted (level ${workflow.escalation_level})`
    );
    return [];
  }

  const action = escalationActions[nextLevel - 1];
  console.log(
    `[TimeoutProcessor] ${workflow.reference_id}: Executing escalation level ${nextLevel} - ${action}`
  );

  // Execute the escalation action
  const result = await executeEscalationAction(workflow, action, nextLevel);

  // Record the escalation
  await recordEscalation(workflow, nextLevel, action, result);

  // Update workflow escalation level
  if (result.success) {
    await escalateWorkflow(workflow.id, nextLevel, `Escalation action: ${action}`);
  }

  return [result];
}

/**
 * Execute a specific escalation action
 */
async function executeEscalationAction(
  workflow: WorkflowInstance,
  action: EscalationAction,
  level: number
): Promise<EscalationResult> {
  const baseResult = {
    instanceId: workflow.id,
    referenceId: workflow.reference_id,
    action,
  };

  try {
    switch (action) {
      case 'notify_patricia':
        return await notifyAgent(workflow, 'patricia', level);

      case 'notify_channel':
        return await notifyChannel(workflow, level);

      case 'auto_advance':
        return await autoAdvanceWorkflow(workflow);

      case 'assign_backup':
        return await assignBackupAgent(workflow);

      case 'escalate_human':
        return await escalateToHuman(workflow, level);

      case 'timeout_fail':
        return await markTimeoutFailed(workflow);

      default:
        return {
          ...baseResult,
          success: false,
          notes: `Unknown escalation action: ${action}`,
        };
    }
  } catch (error) {
    return {
      ...baseResult,
      success: false,
      notes: `Error executing action: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Notify a specific agent about the stuck workflow
 */
async function notifyAgent(
  workflow: WorkflowInstance,
  agent: string,
  level: number
): Promise<EscalationResult> {
  const app = await getPatriciaApp();

  if (!app || !workflow.thread_ts) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'notify_patricia',
      success: false,
      notes: 'Slack not configured or no thread',
    };
  }

  const agentMention = AGENT_SLACK_IDS[agent] ? `<@${AGENT_SLACK_IDS[agent]}>` : agent;
  const responsibleMention = workflow.responsible_agent
    ? `<@${AGENT_SLACK_IDS[workflow.responsible_agent] || workflow.responsible_agent}>`
    : 'unassigned';

  const breachMinutes = workflow.sla_deadline
    ? Math.round((Date.now() - new Date(workflow.sla_deadline).getTime()) / 60000)
    : 0;

  try {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      thread_ts: workflow.thread_ts,
      text:
        `⏰ *SLA Alert* (Level ${level})\n\n` +
        `${agentMention}, this workflow has been stuck in *${workflow.current_state}* ` +
        `for ${breachMinutes} minutes past its SLA.\n\n` +
        `• *Opportunity:* ${workflow.reference_title || workflow.reference_id}\n` +
        `• *Responsible:* ${responsibleMention}\n` +
        `• *Action needed:* Please check on progress or reassign.\n\n` +
        `_React with ✅ to acknowledge, or I'll escalate further._`,
    });

    await app.stop();

    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'notify_patricia',
      success: true,
      notes: `Notified ${agent}`,
    };
  } catch (error) {
    await app.stop();
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'notify_patricia',
      success: false,
      notes: `Failed to notify: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Notify the entire channel about the stuck workflow
 */
async function notifyChannel(workflow: WorkflowInstance, level: number): Promise<EscalationResult> {
  const app = await getPatriciaApp();

  if (!app) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'notify_channel',
      success: false,
      notes: 'Slack not configured',
    };
  }

  const breachMinutes = workflow.sla_deadline
    ? Math.round((Date.now() - new Date(workflow.sla_deadline).getTime()) / 60000)
    : 0;

  try {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text:
        `🚨 *Workflow Stuck - Escalation Level ${level}*\n\n` +
        `An opportunity workflow needs attention:\n\n` +
        `• *Opportunity:* ${workflow.reference_title || workflow.reference_id}\n` +
        `• *Current state:* ${workflow.current_state}\n` +
        `• *Assigned to:* ${workflow.responsible_agent || 'Unassigned'}\n` +
        `• *Overdue by:* ${breachMinutes} minutes\n\n` +
        (workflow.thread_ts ? `_See thread for context._` : `_No thread context available._`),
      ...(workflow.thread_ts ? { thread_ts: workflow.thread_ts } : {}),
    });

    await app.stop();

    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'notify_channel',
      success: true,
      notes: 'Posted to channel',
    };
  } catch (error) {
    await app.stop();
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'notify_channel',
      success: false,
      notes: `Failed to post: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Auto-advance the workflow to the next state with available data
 */
async function autoAdvanceWorkflow(workflow: WorkflowInstance): Promise<EscalationResult> {
  const workflowType = workflow.workflow_type as WorkflowType;
  const currentState = workflow.current_state as WorkflowState;
  const stateDefinition = getStateDefinition(workflowType, currentState);

  if (!stateDefinition || stateDefinition.transitions.length === 0) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'auto_advance',
      success: false,
      notes: 'No valid transitions available',
    };
  }

  // Find the next logical state (first non-terminal transition)
  const nextState = stateDefinition.transitions.find(
    (s) => !['passed', 'cancelled', 'completed'].includes(s)
  );

  if (!nextState) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'auto_advance',
      success: false,
      notes: 'Only terminal states available',
    };
  }

  // Transition to next state
  const result = await transitionWorkflow({
    instanceId: workflow.id,
    toState: nextState,
    triggeredBy: 'escalation',
    notes: `Auto-advanced due to SLA breach (was in ${currentState})`,
  });

  if (result) {
    // Notify about auto-advancement
    const app = await getPatriciaApp();
    if (app && workflow.thread_ts) {
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        thread_ts: workflow.thread_ts,
        text:
          `⚡ *Auto-Advanced*\n\n` +
          `Due to SLA breach, this workflow has been automatically moved from ` +
          `*${currentState}* → *${nextState}*.\n\n` +
          `_Proceeding with available data. Some analysis may be incomplete._`,
      });
      await app.stop();
    }

    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'auto_advance',
      success: true,
      notes: `Advanced from ${currentState} to ${nextState}`,
    };
  }

  return {
    instanceId: workflow.id,
    referenceId: workflow.reference_id,
    action: 'auto_advance',
    success: false,
    notes: 'Transition failed',
  };
}

/**
 * Assign a backup agent when primary is unresponsive
 */
async function assignBackupAgent(workflow: WorkflowInstance): Promise<EscalationResult> {
  // Backup agent mapping
  const backupAgents: Record<string, string> = {
    david: 'maya', // Maya can do basic research
    rosa: 'patricia', // Patricia can coordinate
    marcus: 'david', // David can do basic tech review
    james: 'patricia', // Patricia escalates to human
    maya: 'david', // David can scout
    jodie: 'patricia', // Patricia coordinates
  };

  const currentAgent = workflow.responsible_agent;
  if (!currentAgent) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'assign_backup',
      success: false,
      notes: 'No current agent assigned',
    };
  }

  const backupAgent = backupAgents[currentAgent];
  if (!backupAgent) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'assign_backup',
      success: false,
      notes: `No backup defined for ${currentAgent}`,
    };
  }

  // Update workflow with backup agent
  const { error } = await getSupabase()
    .from('workflow_instances')
    .update({
      responsible_agent: backupAgent,
      metadata: {
        ...workflow.metadata,
        original_agent: currentAgent,
        backup_assigned_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', workflow.id);

  if (error) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'assign_backup',
      success: false,
      notes: `Failed to assign backup: ${error.message}`,
    };
  }

  // Notify backup agent
  const app = await getPatriciaApp();
  if (app && workflow.thread_ts) {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      thread_ts: workflow.thread_ts,
      text:
        `🔄 *Backup Assignment*\n\n` +
        `<@${AGENT_SLACK_IDS[backupAgent]}>, you've been assigned as backup for this workflow.\n\n` +
        `• *Original agent:* ${currentAgent}\n` +
        `• *Current state:* ${workflow.current_state}\n` +
        `• *Reason:* SLA breach - original agent unresponsive\n\n` +
        `_Please review and continue where ${currentAgent} left off._`,
    });
    await app.stop();
  }

  return {
    instanceId: workflow.id,
    referenceId: workflow.reference_id,
    action: 'assign_backup',
    success: true,
    notes: `Reassigned from ${currentAgent} to ${backupAgent}`,
  };
}

/**
 * Escalate to human (Lapedra/Tamara)
 */
async function escalateToHuman(
  workflow: WorkflowInstance,
  level: number
): Promise<EscalationResult> {
  const app = await getPatriciaApp();

  if (!app) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'escalate_human',
      success: false,
      notes: 'Slack not configured',
    };
  }

  const breachMinutes = workflow.sla_deadline
    ? Math.round((Date.now() - new Date(workflow.sla_deadline).getTime()) / 60000)
    : 0;

  try {
    // Post to channel (not thread) for visibility
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text:
        `🆘 *Human Intervention Required* (Escalation Level ${level})\n\n` +
        `<@${HUMAN_SLACK_IDS.lapedra}> - A workflow needs your attention:\n\n` +
        `• *Opportunity:* ${workflow.reference_title || workflow.reference_id}\n` +
        `• *Stuck in:* ${workflow.current_state}\n` +
        `• *Responsible agent:* ${workflow.responsible_agent || 'None'}\n` +
        `• *Overdue by:* ${breachMinutes} minutes\n` +
        `• *Escalation attempts:* ${level}\n\n` +
        `_Automated escalation has been exhausted. Please review and take action._` +
        (workflow.thread_ts ? `\n\n_Thread context: ${workflow.thread_ts}_` : ''),
    });

    await app.stop();

    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'escalate_human',
      success: true,
      notes: 'Escalated to Lapedra',
    };
  } catch (error) {
    await app.stop();
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'escalate_human',
      success: false,
      notes: `Failed to escalate: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Mark workflow as timed out / failed
 */
async function markTimeoutFailed(workflow: WorkflowInstance): Promise<EscalationResult> {
  const result = await transitionWorkflow({
    instanceId: workflow.id,
    toState: 'cancelled',
    triggeredBy: 'escalation',
    notes: 'Workflow timed out - all escalation actions exhausted',
    metadata: {
      timeout_reason: 'sla_breach',
      final_state: workflow.current_state,
    },
  });

  if (result) {
    return {
      instanceId: workflow.id,
      referenceId: workflow.reference_id,
      action: 'timeout_fail',
      success: true,
      notes: `Marked as cancelled due to timeout`,
    };
  }

  return {
    instanceId: workflow.id,
    referenceId: workflow.reference_id,
    action: 'timeout_fail',
    success: false,
    notes: 'Failed to cancel workflow',
  };
}

/**
 * Record escalation in database
 */
async function recordEscalation(
  workflow: WorkflowInstance,
  level: number,
  action: EscalationAction,
  result: EscalationResult
): Promise<void> {
  const breachMinutes = workflow.sla_deadline
    ? Math.round((Date.now() - new Date(workflow.sla_deadline).getTime()) / 60000)
    : 0;

  try {
    await getSupabase().from('workflow_escalations').insert({
      workflow_instance_id: workflow.id,
      escalation_level: level,
      action_taken: action,
      triggered_at: new Date().toISOString(),
      action_successful: result.success,
      result_notes: result.notes,
      sla_breach_minutes: breachMinutes,
      current_state: workflow.current_state,
    });
  } catch (err) {
    console.warn('[TimeoutProcessor] Failed to record escalation:', err);
  }
}

/**
 * Get Patricia's Slack app for notifications
 */
async function getPatriciaApp(): Promise<App | null> {
  const botToken = process.env.PATRICIA_BOT_TOKEN;
  const appToken = process.env.PATRICIA_APP_TOKEN;

  if (!botToken || !appToken) {
    console.warn('[TimeoutProcessor] Patricia Slack tokens not configured');
    return null;
  }

  const app = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  });

  await app.start();
  return app;
}

/**
 * Main entry point for cron job
 */
export async function runTimeoutProcessor(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  Timeout Processor - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60));

  try {
    const results = await processTimeouts();

    if (results.length > 0) {
      console.log(`\nProcessed ${results.length} escalation(s):`);
      for (const result of results) {
        const status = result.success ? '✓' : '✗';
        console.log(
          `  ${status} ${result.referenceId}: ${result.action} - ${result.notes || 'OK'}`
        );
      }
    }
  } catch (error) {
    console.error('[TimeoutProcessor] Error:', error);
  }

  console.log('\nTimeout processing complete');
}
