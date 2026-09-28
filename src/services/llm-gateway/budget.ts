/**
 * LLM Gateway Budget
 *
 * Hierarchical multi-scope atomic budget reservation.
 *
 * FAIL-CLOSED: If a request claims workflow/task context,
 * the corresponding budget scope MUST exist or the request is REJECTED.
 *
 * Accounting invariant at every scope:
 *   spent_usd + reserved_usd <= limit_usd
 */

import {
  BudgetExceededError,
  DatabaseUnavailableError,
  MissingBudgetScopeError,
  IdempotentRequestExistsError,
} from './errors.js';

/** Reservation result from the RPC */
export interface ReservationResult {
  success: boolean;
  ledgerId: string | null;
  /** True if this call created the reservation (owns execution permission) */
  isNewReservation: boolean;
  error?:
    | BudgetExceededError
    | DatabaseUnavailableError
    | MissingBudgetScopeError
    | IdempotentRequestExistsError;
}

/**
 * Resolve the budget scope IDs that MUST be enforced for a request.
 * Returns array ordered: global_daily → workflow → agent → task.
 *
 * FAIL-CLOSED:
 *   workflowId supplied + workflow budget missing → MissingBudgetScopeError
 *   taskId supplied + task budget missing → MissingBudgetScopeError
 *   global missing → DatabaseUnavailableError
 */
export async function resolveBudgetScopes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    workflowId?: string;
    agentId: string;
    taskId?: string;
  }
): Promise<string[]> {
  const scopeIds: string[] = [];

  // 1. Global daily — ALWAYS required
  const { data: globalScope, error: gErr } = await supabase
    .from('ai_budget_scopes')
    .select('id')
    .eq('scope_type', 'global_daily')
    .eq('scope_id', 'default')
    .single();

  if (gErr || !globalScope) {
    throw new DatabaseUnavailableError(new Error('No global daily budget scope found'));
  }
  scopeIds.push(globalScope.id);

  // 2. Workflow scope — REQUIRED when workflowId is supplied
  if (params.workflowId) {
    const { data: wfScope } = await supabase
      .from('ai_budget_scopes')
      .select('id')
      .eq('scope_type', 'workflow')
      .eq('scope_id', params.workflowId)
      .single();

    if (!wfScope) {
      throw new MissingBudgetScopeError('workflow', params.workflowId);
    }
    scopeIds.push(wfScope.id);
  }

  // 3. Agent scope — optional (enforce if exists)
  const { data: agentScope } = await supabase
    .from('ai_budget_scopes')
    .select('id')
    .eq('scope_type', 'agent')
    .eq('scope_id', params.agentId)
    .single();

  if (agentScope) {
    scopeIds.push(agentScope.id);
  }

  // 4. Task scope — REQUIRED when taskId is supplied
  if (params.taskId) {
    const { data: taskScope } = await supabase
      .from('ai_budget_scopes')
      .select('id')
      .eq('scope_type', 'task')
      .eq('scope_id', params.taskId)
      .single();

    if (!taskScope) {
      throw new MissingBudgetScopeError('task', params.taskId);
    }
    scopeIds.push(taskScope.id);
  }

  return scopeIds;
}

/**
 * Create a workflow budget scope. Must be called when creating a workflow.
 * Idempotent (ON CONFLICT DO NOTHING in application layer).
 */
export async function ensureWorkflowBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workflowId: string,
  limitUsd: number = 1.0
): Promise<string> {
  const { data, error } = await supabase
    .from('ai_budget_scopes')
    .upsert(
      {
        scope_type: 'workflow',
        scope_id: workflowId,
        limit_usd: limitUsd,
        spent_usd: 0,
        reserved_usd: 0,
        enabled: true,
      },
      { onConflict: 'scope_type,scope_id' }
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new DatabaseUnavailableError(
      new Error(`Failed to create workflow budget: ${error?.message}`)
    );
  }
  return data.id;
}

/**
 * Create a task budget scope. Must be called when creating a task.
 * Idempotent.
 */
export async function ensureTaskBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string,
  limitUsd: number = 0.5
): Promise<string> {
  const { data, error } = await supabase
    .from('ai_budget_scopes')
    .upsert(
      {
        scope_type: 'task',
        scope_id: taskId,
        limit_usd: limitUsd,
        spent_usd: 0,
        reserved_usd: 0,
        enabled: true,
      },
      { onConflict: 'scope_type,scope_id' }
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new DatabaseUnavailableError(
      new Error(`Failed to create task budget: ${error?.message}`)
    );
  }
  return data.id;
}

/**
 * Atomically reserve budget across ALL applicable scopes.
 *
 * The RPC returns a composite type: (ledger_id UUID, is_new BOOLEAN).
 * is_new=true means this call CREATED the reservation (owns execution).
 * is_new=false means an existing entry was found (caller must NOT invoke provider).
 *
 * Returns NULL when budget is exceeded.
 * Raises EXCEPTION on config/db errors.
 */
export async function reserveBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    idempotencyKey: string;
    agentId: string;
    purpose: string;
    taskType: string;
    provider: string;
    model: string;
    modelTier: string | null;
    estimatedInputTokens: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    reservedCostUsd: number;
    scopeIds: string[];
    workflowId?: string;
    taskId?: string;
    opportunityId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ReservationResult> {
  try {
    const { data, error } = await supabase.rpc('reserve_inference_hierarchical', {
      p_idempotency_key: params.idempotencyKey,
      p_agent_id: params.agentId,
      p_purpose: params.purpose,
      p_task_type: params.taskType,
      p_provider: params.provider,
      p_model: params.model,
      p_model_tier: params.modelTier,
      p_estimated_input_tokens: params.estimatedInputTokens,
      p_max_input_tokens: params.maxInputTokens,
      p_max_output_tokens: params.maxOutputTokens,
      p_reserved_cost_usd: params.reservedCostUsd,
      p_scope_ids: params.scopeIds,
      p_workflow_id: params.workflowId || null,
      p_task_id: params.taskId || null,
      p_opportunity_id: params.opportunityId || null,
      p_metadata: params.metadata || {},
    });

    if (error) {
      if (
        error.message?.includes('Budget scope disabled') ||
        error.message?.includes('SAFETY VIOLATION')
      ) {
        return {
          success: false,
          ledgerId: null,
          isNewReservation: false,
          error: new BudgetExceededError('scope', params.purpose, 0, params.reservedCostUsd),
        };
      }
      if (error.message?.includes('IDEMPOTENT_EXISTING')) {
        // RPC signals existing entry — extract ledger ID and status from error
        const match = error.message.match(/ledger=([^ ]+) status=([^ ]+)/);
        const existingId = match?.[1] || 'unknown';
        const existingStatus = match?.[2] || 'unknown';
        return {
          success: false,
          ledgerId: existingId,
          isNewReservation: false,
          error: new IdempotentRequestExistsError(
            params.idempotencyKey,
            existingId,
            existingStatus
          ),
        };
      }
      return {
        success: false,
        ledgerId: null,
        isNewReservation: false,
        error: new DatabaseUnavailableError(new Error(error.message)),
      };
    }

    // RPC returns reservation_result composite: {ledger_id, is_new}
    // When budget exceeded: {ledger_id: null, is_new: null}
    // When existing: {ledger_id: UUID, is_new: false}
    // When new: {ledger_id: UUID, is_new: true}

    if (data === null) {
      return {
        success: false,
        ledgerId: null,
        isNewReservation: false,
        error: new BudgetExceededError('hierarchical', params.purpose, 0, params.reservedCostUsd),
      };
    }

    // Handle plain UUID string (backward compat)
    if (typeof data === 'string') {
      return { success: true, ledgerId: data, isNewReservation: true };
    }

    const result = data as { ledger_id: string | null; is_new: boolean | null };

    // Budget exceeded: ledger_id is null
    if (!result.ledger_id) {
      return {
        success: false,
        ledgerId: null,
        isNewReservation: false,
        error: new BudgetExceededError('hierarchical', params.purpose, 0, params.reservedCostUsd),
      };
    }

    if (!result.is_new) {
      return {
        success: false,
        ledgerId: result.ledger_id,
        isNewReservation: false,
        error: new IdempotentRequestExistsError(
          params.idempotencyKey,
          result.ledger_id,
          'existing'
        ),
      };
    }

    return { success: true, ledgerId: result.ledger_id, isNewReservation: true };
  } catch (err) {
    return {
      success: false,
      ledgerId: null,
      isNewReservation: false,
      error: new DatabaseUnavailableError(err instanceof Error ? err : new Error(String(err))),
    };
  }
}

/**
 * Settle a reservation. Rejects if actual > reserved (safety violation).
 */
export async function settleBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    ledgerId: string;
    actualInputTokens: number;
    actualOutputTokens: number;
    actualCostUsd: number;
    providerRequestId?: string;
    providerModel?: string;
  }
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('settle_inference', {
      p_ledger_id: params.ledgerId,
      p_actual_input_tokens: params.actualInputTokens,
      p_actual_output_tokens: params.actualOutputTokens,
      p_actual_cost_usd: params.actualCostUsd,
      p_provider_request_id: params.providerRequestId || null,
      p_provider_model: params.providerModel || null,
    });
    if (error?.message?.includes('SAFETY VIOLATION')) {
      console.error(`[GATEWAY SAFETY VIOLATION] ${error.message}`);
      return false;
    }
    return !error;
  } catch {
    return false;
  }
}

/** Release pre-network reservation (status=reserved only). Safe. */
export async function releaseBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ledgerId: string,
  reason = 'released',
  errorCode?: string,
  errorMessage?: string
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('release_inference_reservation', {
      p_ledger_id: ledgerId,
      p_reason: reason,
      p_error_code: errorCode || null,
      p_error_message: errorMessage || null,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Mark in_progress as ambiguous. Budget stays reserved. */
export async function markAmbiguous(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ledgerId: string,
  errorCode: string,
  errorMessage: string
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: ledgerId,
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Release in_progress where provider definitively rejected (4xx, no charge). */
export async function releaseFailedInProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ledgerId: string,
  errorCode: string,
  errorMessage: string
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('release_failed_in_progress', {
      p_ledger_id: ledgerId,
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });
    return !error;
  } catch {
    return false;
  }
}

/** Mark in-progress (about to send to provider). */
export async function markInProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  ledgerId: string
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('mark_inference_in_progress', { p_ledger_id: ledgerId });
    return !error;
  } catch {
    return false;
  }
}
