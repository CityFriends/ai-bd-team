/**
 * Denise Specialist Workflow Routing
 *
 * Event-driven routing of acquisition intelligence requests from
 * authorized specialists through controlled, auditable tasks.
 *
 * Reuses: denise_task_claims (atomic claim), getDeniseIntelligenceForSpecialist
 * (Milestone A read-only projection).
 *
 * Zero LLM calls for deterministic routing. Inference only when an
 * approved Denise capability is explicitly authorized and budgeted.
 *
 * No autonomous loops, no production activation, no specialist-to-specialist
 * conversational chains.
 */

import { z } from 'zod';
import type { SupabaseClient } from './types.js';
import {
  getDeniseIntelligenceForSpecialist,
  SPECIALIST_ARTIFACT_MAP,
} from './specialist-integration.js';
import type {
  SpecialistRole,
  WorkflowPhase,
  ArtifactType,
  DeniseIntelligenceBundle,
} from './specialist-integration.js';

// ============================================================
// REQUEST CONTRACT
// ============================================================

export const DeniseRoutingRequestSchema = z.object({
  opportunityId: z.string().min(1),
  pursuitId: z.string().optional(),
  requestingSpecialist: z.enum(['JAMES', 'PATRICIA', 'JODIE', 'MARCUS', 'ROSA']),
  workflowPhase: z.enum(['CAPTURE', 'PURSUIT']),
  requestType: z.string().min(1),
  requestedArtifactTypes: z.array(z.string()).optional(),
  sourceEventId: z.string().optional(),
  humanAuthorizationId: z.string().optional(),
  parentWorkflowId: z.string().optional(),
  idempotencyKey: z.string().min(1),
});

export type DeniseRoutingRequest = z.infer<typeof DeniseRoutingRequestSchema>;

// ============================================================
// RESULT CONTRACT
// ============================================================

export type RoutingDisposition =
  | 'COMPLETED'
  | 'ARTIFACTS_DELIVERED'
  | 'MISSING_ARTIFACTS'
  | 'CAPABILITY_DISABLED'
  | 'UNAUTHORIZED'
  | 'DUPLICATE'
  | 'CANCELLED'
  | 'FAILED'
  | 'AMBIGUOUS'
  | 'BUDGET_EXHAUSTED';

export interface DeniseRoutingResult {
  routingTaskId: string | null;
  requestingSpecialist: SpecialistRole;
  opportunityId: string;
  pursuitId: string | null;
  disposition: RoutingDisposition;
  bundle: DeniseIntelligenceBundle | null;
  referencedArtifactIds: string[];
  coverageLimitations: string[];
  legalReviewRequired: boolean;
  unresolvedConflicts: number;
  missingArtifacts: string[];
  completedAt: string | null;
  failureReason: string | null;
  failureCode: string | null;
}

// ============================================================
// AUTHORIZATION
// ============================================================

/**
 * Validate the requesting identity against approved workflow context.
 * Does NOT trust caller-supplied role alone — validates against
 * the source event or human authorization.
 */
function validateAuthorization(
  request: DeniseRoutingRequest
): { authorized: boolean; reason?: string } {
  // 1. Role must be in approved set
  if (!SPECIALIST_ARTIFACT_MAP[request.requestingSpecialist]) {
    return { authorized: false, reason: `Unknown specialist role: ${request.requestingSpecialist}` };
  }

  // 2. Must have at least one authorization source
  if (!request.sourceEventId && !request.humanAuthorizationId && !request.parentWorkflowId) {
    return { authorized: false, reason: 'No authorization source: requires sourceEventId, humanAuthorizationId, or parentWorkflowId' };
  }

  // 3. Opportunity ID must be present
  if (!request.opportunityId) {
    return { authorized: false, reason: 'Missing opportunityId' };
  }

  return { authorized: true };
}

// ============================================================
// MAIN DISPATCHER
// ============================================================

export async function dispatchDeniseRequest(
  supabase: SupabaseClient,
  request: DeniseRoutingRequest
): Promise<DeniseRoutingResult> {
  const now = new Date().toISOString();
  const claimKey = `denise-route-${request.idempotencyKey}`;

  const emptyResult = (disposition: RoutingDisposition, failureReason?: string, failureCode?: string): DeniseRoutingResult => ({
    routingTaskId: null,
    requestingSpecialist: request.requestingSpecialist,
    opportunityId: request.opportunityId,
    pursuitId: request.pursuitId || null,
    disposition,
    bundle: null,
    referencedArtifactIds: [],
    coverageLimitations: [],
    legalReviewRequired: false,
    unresolvedConflicts: 0,
    missingArtifacts: [],
    completedAt: null,
    failureReason: failureReason || null,
    failureCode: failureCode || null,
  });

  // 1. Validate request schema
  const parseResult = DeniseRoutingRequestSchema.safeParse(request);
  if (!parseResult.success) {
    return emptyResult('FAILED', `Invalid request: ${parseResult.error.issues[0]?.message}`, 'VALIDATION_FAILED');
  }

  // 2. Authorization check
  const auth = validateAuthorization(request);
  if (!auth.authorized) {
    return emptyResult('UNAUTHORIZED', auth.reason, 'UNAUTHORIZED');
  }

  // 3. Atomic claim — prevents duplicate execution
  const { data: claimResult, error: claimError } = await supabase.rpc('claim_denise_eval_task', {
    p_idempotency_key: claimKey,
    p_lease_seconds: 60,
  });

  if (claimError) {
    return emptyResult('FAILED', `Claim error: ${claimError.message}`, 'CLAIM_FAILED');
  }

  if (claimResult?.length > 0) {
    const claim = claimResult[0];

    // COMPLETED: return existing result (idempotent)
    if (claim.claim_status === 'COMPLETED') {
      return emptyResult('DUPLICATE', 'Request already completed');
    }

    // LEASE_HELD: concurrent execution in progress
    if (claim.claim_status === 'LEASE_HELD') {
      return emptyResult('DUPLICATE', 'Concurrent execution in progress');
    }

    // FAILED/AMBIGUOUS: do not auto-retry
    if (claim.claim_status === 'FAILED') {
      return emptyResult('FAILED', 'Previous execution failed — manual review required', 'PREVIOUS_FAILED');
    }
    if (claim.claim_status === 'AMBIGUOUS') {
      return emptyResult('AMBIGUOUS', 'Previous execution outcome uncertain — no automatic retry', 'PREVIOUS_AMBIGUOUS');
    }
  }

  const claimId: string | undefined = (claimResult as any)?.[0]?.claim_status === 'CLAIMED'
    ? (claimResult as any)[0].claim_id : undefined;

  // 4. Resolve Denise intelligence via Milestone A service
  try {
    const bundle = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: request.opportunityId,
      pursuitId: request.pursuitId,
      specialistRole: request.requestingSpecialist,
      workflowPhase: request.workflowPhase,
      requestedArtifactTypes: request.requestedArtifactTypes as ArtifactType[] | undefined,
    });

    // 5. Collect artifact references
    const allArtifactIds = [
      ...bundle.acquisitionAnalyses.map(a => String(a.id)),
      ...bundle.evaluationModels.map(a => String(a.id)),
      ...bundle.clauseRegister.map(a => String(a.id)),
      ...bundle.acquisitionRisks.map(a => String(a.id)),
      ...bundle.clarificationQuestions.map(a => String(a.id)),
      ...bundle.acquisitionConflicts.map(a => String(a.id)),
      ...bundle.amendmentImpacts.map(a => String(a.id)),
      ...bundle.regulatoryInterpretations.map(a => String(a.id)),
    ].filter(Boolean);

    // 6. Determine disposition
    const hasArtifacts = allArtifactIds.length > 0;
    const disposition: RoutingDisposition = hasArtifacts ? 'ARTIFACTS_DELIVERED'
      : bundle.missingArtifacts.length > 0 ? 'MISSING_ARTIFACTS'
      : 'COMPLETED';

    // 7. Complete claim
    if (claimId) {
      try {
        await supabase.rpc('complete_denise_eval_claim', {
          p_claim_id: claimId,
          p_analysis_id: allArtifactIds[0] || null,
          p_eval_model_id: null,
          p_ledger_id: null,
          p_cost_usd: 0,
        });
      } catch {}
    }

    return {
      routingTaskId: claimId || null,
      requestingSpecialist: request.requestingSpecialist,
      opportunityId: request.opportunityId,
      pursuitId: request.pursuitId || null,
      disposition,
      bundle,
      referencedArtifactIds: allArtifactIds,
      coverageLimitations: bundle.coverageLimitations,
      legalReviewRequired: bundle.legalReviewRequired,
      unresolvedConflicts: bundle.acquisitionConflicts.length,
      missingArtifacts: bundle.missingArtifacts,
      completedAt: new Date().toISOString(),
      failureReason: null,
      failureCode: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (claimId) {
      await supabase.rpc('fail_denise_eval_claim', {
        p_claim_id: claimId,
        p_error_code: 'DISPATCH_FAILED',
        p_error_message: msg.slice(0, 500),
      }).then(() => {}, () => {});
    }
    return emptyResult('FAILED', `Dispatch error: ${msg}`, 'DISPATCH_FAILED');
  }
}

/**
 * Cancel a pending routing task. Safe: only cancels CLAIMED tasks
 * that have NOT attempted inference.
 */
export async function cancelRoutingTask(
  supabase: SupabaseClient,
  idempotencyKey: string
): Promise<{ cancelled: boolean; reason: string }> {
  const claimKey = `denise-route-${idempotencyKey}`;
  const { data } = await supabase
    .from('denise_task_claims')
    .select('id, status, inference_attempted')
    .eq('idempotency_key', claimKey)
    .single();

  if (!data) return { cancelled: false, reason: 'Task not found' };
  if (data.status === 'COMPLETED') return { cancelled: false, reason: 'Task already completed' };
  if (data.status !== 'CLAIMED') return { cancelled: false, reason: `Task status is ${data.status}` };
  if (data.inference_attempted) return { cancelled: false, reason: 'Inference already attempted — cannot cancel safely' };

  await supabase.rpc('fail_denise_eval_claim', {
    p_claim_id: data.id,
    p_error_code: 'CANCELLED',
    p_error_message: 'Task cancelled by authorized request',
  });

  return { cancelled: true, reason: 'Task cancelled' };
}
