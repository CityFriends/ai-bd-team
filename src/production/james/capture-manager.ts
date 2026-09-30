/**
 * Capture Manager — Lifecycle Management
 *
 * Creates captures via atomic RPC, manages state transitions,
 * loads capture context for James assessment.
 */

import { ensureWorkflowBudget } from '../../services/llm-gateway/budget.js';
import { CAPTURE_BUDGET } from './types.js';
import type { CaptureStatus } from './types.js';

/**
 * Create a capture from a SEND_TO_CAPTURE event.
 * Uses atomic RPC: capture creation + event emission + thread ownership transfer.
 * Also creates the capture budget scope.
 */
export async function createCapture(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  materialHash: string,
  humanId: string,
  sendToCaptureEventId: string,
  channelId: string,
  threadTs: string
): Promise<string | null> {
  const { data: captureId, error } = await supabase.rpc('create_capture_from_send_to_capture', {
    p_opportunity_id: opportunityId,
    p_material_hash: materialHash,
    p_human_id: humanId,
    p_send_to_capture_event_id: sendToCaptureEventId,
    p_channel_id: channelId,
    p_thread_ts: threadTs,
  });

  if (error) {
    console.error('[CaptureManager] Failed to create capture:', error.message);
    return null;
  }

  if (!captureId) return null;

  // Create capture budget scope ($0.25)
  await ensureWorkflowBudget(supabase, `capture-${captureId}`, CAPTURE_BUDGET.MAX_CAPTURE_USD);

  return captureId;
}

/**
 * Atomic status transition with optimistic locking.
 * Only succeeds if current status matches fromStatus.
 */
export async function transitionCapture(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  fromStatus: CaptureStatus,
  toStatus: CaptureStatus,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  additionalFields?: Record<string, any>
): Promise<boolean> {
  const { data, error } = await supabase
    .from('captures')
    .update({
      status: toStatus,
      updated_at: new Date().toISOString(),
      ...additionalFields,
    })
    .eq('id', captureId)
    .eq('status', fromStatus)
    .select('id')
    .single();

  if (error || !data) return false;
  return true;
}

/**
 * Record a James decision version immutably.
 * Increments decision_version on the capture and creates a decision record.
 */
export async function recordDecision(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  recommendation: string,
  confidence: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decisionPayload: any,
  researchRound: number,
  ledgerId?: string,
  modelRoute?: string
): Promise<number> {
  // Get current version
  const { data: capture } = await supabase
    .from('captures')
    .select('decision_version')
    .eq('id', captureId)
    .single();

  const newVersion = (capture?.decision_version || 0) + 1;

  // Create immutable decision record
  await supabase.from('capture_decision_records').insert({
    capture_id: captureId,
    decision_version: newVersion,
    recommendation,
    confidence,
    decision_payload: decisionPayload,
    research_round: researchRound,
    inference_ledger_id: ledgerId,
    model_route: modelRoute,
  });

  // Update capture with latest (but decision record preserves history)
  await supabase
    .from('captures')
    .update({
      james_recommendation: recommendation,
      james_confidence: confidence,
      james_decision_payload: decisionPayload,
      decision_version: newVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', captureId);

  return newVersion;
}

/**
 * Load full capture context for James assessment.
 */
export async function getCaptureContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const [captureResult, tasksResult, artifactsResult] = await Promise.all([
    supabase.from('captures').select('*').eq('id', captureId).single(),
    supabase.from('specialist_tasks').select('*').eq('capture_id', captureId).order('created_at'),
    supabase.from('specialist_artifacts').select('*').eq('capture_id', captureId),
  ]);

  const capture = captureResult.data;
  if (!capture) return null;

  // Load opportunity with Maya decision
  const { data: opportunity } = await supabase
    .from('pipeline_opportunities')
    .select('*')
    .eq('source_id', capture.opportunity_id)
    .single();

  // Load decision history
  const { data: decisionRecords } = await supabase
    .from('capture_decision_records')
    .select('*')
    .eq('capture_id', captureId)
    .order('decision_version');

  return {
    capture,
    opportunity,
    specialistTasks: tasksResult.data || [],
    specialistArtifacts: artifactsResult.data || [],
    decisionRecords: decisionRecords || [],
  };
}

/**
 * Get remaining budget for a capture workflow scope.
 */
export async function getRemainingCaptureBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string
): Promise<number> {
  const { data } = await supabase
    .from('ai_budget_scopes')
    .select('limit_usd, spent_usd, reserved_usd')
    .eq('scope_id', `capture-${captureId}`)
    .single();

  if (!data) return 0;
  return Math.max(0, Number(data.limit_usd) - Number(data.spent_usd) - Number(data.reserved_usd));
}
