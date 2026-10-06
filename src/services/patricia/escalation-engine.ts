/**
 * Patricia Escalation Engine
 *
 * Structured human escalation tracking. Silence NEVER means approval.
 * No deterministic timeout may produce Pursue, Submit, outreach
 * authorization, spending approval, or deadline override.
 *
 * Zero LLM calls.
 */

import type {
  SupabaseClient,
  EscalationType,
  FindingSeverity,
  Escalation,
} from './types.js';
import { recordAction } from './operational-actions.js';

export interface CreateEscalationInput {
  idempotencyKey: string;
  escalationType: EscalationType;
  opportunityId?: string;
  captureId?: string;
  proposalWorkspaceId?: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  decisionOwner?: string;
  evidence?: Record<string, unknown>;
  conflictingInputs?: Record<string, unknown>;
}

/**
 * Create an escalation idempotently via RPC.
 */
export async function createEscalation(
  supabase: SupabaseClient,
  input: CreateEscalationInput,
  triggeringEventType?: string,
  triggeringEventId?: string
): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_patricia_escalation', {
    p_idempotency_key: input.idempotencyKey,
    p_escalation_type: input.escalationType,
    p_opportunity_id: input.opportunityId || null,
    p_capture_id: input.captureId || null,
    p_proposal_workspace_id: input.proposalWorkspaceId || null,
    p_title: input.title,
    p_description: input.description,
    p_severity: input.severity,
    p_decision_owner: input.decisionOwner || null,
    p_evidence: input.evidence || {},
    p_conflicting_inputs: input.conflictingInputs || null,
  });

  if (error) {
    throw new Error(`[Patricia] Failed to create escalation: ${error.message}`);
  }

  const escalationId = data as string;

  await recordAction(supabase, {
    idempotencyKey: `action-escalation-${input.idempotencyKey}`,
    actionType: 'ESCALATION_CREATED',
    targetType: 'escalation',
    targetId: escalationId,
    triggeringEventType,
    triggeringEventId,
    evidence: { escalationType: input.escalationType, severity: input.severity },
    result: { escalationId },
  });

  return escalationId;
}

/**
 * Get open escalations.
 */
export async function getOpenEscalations(
  supabase: SupabaseClient,
  filters?: {
    severity?: FindingSeverity;
    escalationType?: EscalationType;
    opportunityId?: string;
  }
): Promise<Escalation[]> {
  let query = supabase
    .from('patricia_escalations')
    .select('*')
    .eq('status', 'OPEN');

  if (filters?.severity) query = query.eq('severity', filters.severity);
  if (filters?.escalationType) query = query.eq('escalation_type', filters.escalationType);
  if (filters?.opportunityId) query = query.eq('opportunity_id', filters.opportunityId);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`[Patricia] Failed to get open escalations: ${error.message}`);
  }

  return (data || []) as Escalation[];
}

/**
 * Supersede escalations for a capture (on NO_GO, etc.)
 */
export async function supersedeEscalationsForCapture(
  supabase: SupabaseClient,
  captureId: string,
  reason: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('patricia_escalations')
    .update({
      status: 'SUPERSEDED',
      resolved_at: now,
      resolution: reason,
      updated_at: now,
    })
    .eq('capture_id', captureId)
    .eq('status', 'OPEN')
    .select('id');

  if (error) {
    throw new Error(`[Patricia] Failed to supersede escalations: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Create a conflict escalation when specialist conclusions disagree.
 * Patricia does NOT resolve the conflict — she persists it and
 * identifies the decision owner.
 */
export async function createConflictEscalation(
  supabase: SupabaseClient,
  input: {
    opportunityId: string;
    captureId: string;
    conflictTitle: string;
    inputA: { agent: string; conclusion: string; evidence: Record<string, unknown> };
    inputB: { agent: string; conclusion: string; evidence: Record<string, unknown> };
    decisionOwner: string;
    idempotencyKey: string;
  }
): Promise<string> {
  return createEscalation(supabase, {
    idempotencyKey: input.idempotencyKey,
    escalationType: 'AUTHORITATIVE_CONFLICT',
    opportunityId: input.opportunityId,
    captureId: input.captureId,
    title: input.conflictTitle,
    description: `Conflicting authoritative inputs: ${input.inputA.agent} (${input.inputA.conclusion}) vs ${input.inputB.agent} (${input.inputB.conclusion}). Decision owner: ${input.decisionOwner}`,
    severity: 'AT_RISK',
    decisionOwner: input.decisionOwner,
    evidence: {
      inputA: input.inputA,
      inputB: input.inputB,
    },
    conflictingInputs: {
      [input.inputA.agent]: input.inputA,
      [input.inputB.agent]: input.inputB,
    },
  });
}
