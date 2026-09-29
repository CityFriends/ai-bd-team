/**
 * LLM Gateway — Centralized Inference Control Plane
 *
 * Every inference request flows through this pipeline:
 *
 *   REQUEST
 *   → ATTRIBUTION VALIDATION
 *   → KILL-SWITCH CHECK
 *   → PRICING AVAILABILITY CHECK (fail closed if unavailable)
 *   → MODEL ROUTING
 *   → INPUT SIZE ENFORCEMENT
 *   → CONSERVATIVE COST RESERVATION (max_input + max_output + safety margin)
 *   → HIERARCHICAL MULTI-SCOPE ATOMIC BUDGET RESERVATION
 *   → RE-CHECK KILL SWITCH
 *   → MARK IN-PROGRESS
 *   → PROVIDER CALL
 *   → SETTLEMENT (rejects if actual > reserved)
 *
 * Provider failures after network dispatch → AMBIGUOUS (budget stays reserved)
 * Provider definitive rejection (4xx) → FAILED (budget released)
 * Provider timeout/5xx → AMBIGUOUS (budget stays reserved)
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import type {
  InferenceRequest,
  InferenceResponse,
  EmbeddingRequest,
  EmbeddingResponse,
} from './types.js';
import {
  AIDisabledError,
  MissingAttributionError,
  DatabaseUnavailableError,
  ProviderError,
  BudgetExceededError,
  IdempotentRequestExistsError,
  MissingBudgetScopeError,
} from './errors.js';
import { isAIEnabled } from '../../config/ai-controls.js';
import { getRoute } from './routing.js';
import {
  estimateMaxCost,
  calculateCost,
  getPricing,
  refreshPricing,
  needsRefresh as pricingNeedsRefresh,
  isPricingAvailable,
  estimateInputTokens,
} from './pricing.js';
import { needsRefresh as routingNeedsRefresh, refreshRoutes } from './routing.js';
import {
  reserveBudget,
  settleBudget,
  releaseBudget,
  markInProgress,
  markAmbiguous,
  releaseFailedInProgress,
  resolveBudgetScopes,
} from './budget.js';

// ============================================================
// Provider Clients (singleton)
// ============================================================

let anthropicClient: Anthropic | null = null;
let openaiModule: typeof import('openai') | null = null;
let openaiClient: InstanceType<typeof import('openai').default> | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
    const defaultHeaders: Record<string, string> = {};
    // Admin/org-level API keys require workspace ID header
    if (process.env.ANTHROPIC_WORKSPACE_ID) {
      defaultHeaders['anthropic-workspace-id'] = process.env.ANTHROPIC_WORKSPACE_ID;
    }
    anthropicClient = new Anthropic({ apiKey, defaultHeaders });
  }
  return anthropicClient;
}

async function getOpenAIClient(): Promise<InstanceType<typeof import('openai').default>> {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    if (!openaiModule) openaiModule = await import('openai');
    openaiClient = new openaiModule.default({ apiKey });
  }
  return openaiClient;
}

// ============================================================
// Supabase Client
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseClient: any = null;

function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_KEY || ''
    );
  }
  return supabaseClient;
}

// ============================================================
// Attribution Validation
// ============================================================

function validateAttribution(request: InferenceRequest | EmbeddingRequest): void {
  const missing: string[] = [];
  if (!request.agentId) missing.push('agentId');
  if (!request.purpose) missing.push('purpose');
  if (!request.taskType) missing.push('taskType');
  if (!request.idempotencyKey) missing.push('idempotencyKey');
  if (missing.length > 0) throw new MissingAttributionError(missing);
}

// ============================================================
// Cache refresh
// ============================================================

async function ensurePricingAndRouting(): Promise<void> {
  const supabase = getSupabase();
  if (pricingNeedsRefresh()) {
    const loaded = await refreshPricing(supabase);
    if (!loaded && !isPricingAvailable()) {
      throw new DatabaseUnavailableError(
        new Error('Pricing data unavailable — cannot authorize inference')
      );
    }
  }
  if (routingNeedsRefresh()) {
    await refreshRoutes(supabase).catch(() => {});
  }
}

// ============================================================
// Main Gateway: complete()
// ============================================================

export async function complete(request: InferenceRequest): Promise<InferenceResponse> {
  // 1. ATTRIBUTION
  validateAttribution(request);

  // 2. KILL-SWITCH
  if (!(await isAIEnabled())) throw new AIDisabledError();

  // 3. PRICING + ROUTING (fail closed if unavailable)
  await ensurePricingAndRouting();

  const route = getRoute(request.purpose);
  const provider = route.provider;
  const model = route.model;
  const maxOutputTokens = Math.min(
    request.maxOutputTokens || route.maxOutputTokens,
    route.maxOutputTokens
  );
  const maxInputTokens = route.maxInputTokens;

  // 4. PRICING CHECK — fail closed if model pricing unknown
  const pricing = getPricing(provider, model);
  if (!pricing) {
    throw new DatabaseUnavailableError(
      new Error(`No pricing for ${provider}:${model} — cannot authorize`)
    );
  }

  // 5. CONSERVATIVE COST ESTIMATION
  //    Reserve for worst-case: bounded input + max output at model prices.
  //    Use max(estimated, chars/3) to account for tokenizer variance.
  const estInput = estimateInputTokens(request.messages, request.systemPrompt);
  // Also compute a more conservative estimate: chars/3 (tokens are ~3-4 chars average)
  let totalChars = 0;
  for (const m of request.messages) totalChars += m.content.length;
  if (request.systemPrompt) totalChars += request.systemPrompt.length;
  const conservativeInput = Math.ceil(totalChars / 3); // More conservative than /4
  const rawInput = Math.max(estInput, conservativeInput);

  // Reject if input exceeds route max BEFORE bounding
  if (rawInput > maxInputTokens) {
    throw new BudgetExceededError('input_size', request.purpose, maxInputTokens, rawInput);
  }
  const boundedInput = rawInput;

  const reservationCost = estimateMaxCost(provider, model, boundedInput, maxOutputTokens);
  if (reservationCost === null) {
    throw new DatabaseUnavailableError(new Error('Cannot calculate reservation cost'));
  }

  // Per-request cost cap
  const maxCost = request.maxCostUsd || route.maxCostUsd;
  if (maxCost && reservationCost > maxCost) {
    throw new BudgetExceededError('request_cap', request.purpose, maxCost, reservationCost);
  }

  // 6. RESOLVE HIERARCHICAL BUDGET SCOPES
  const supabase = getSupabase();
  const scopeIds = await resolveBudgetScopes(supabase, {
    workflowId: request.workflowId,
    agentId: request.agentId,
    taskId: request.taskId,
  });

  // 7. ATOMIC MULTI-SCOPE RESERVATION
  const reservation = await reserveBudget(supabase, {
    idempotencyKey: request.idempotencyKey,
    agentId: request.agentId,
    purpose: request.purpose,
    taskType: request.taskType,
    provider,
    model,
    modelTier: pricing.tier,
    estimatedInputTokens: estInput,
    maxInputTokens,
    maxOutputTokens,
    reservedCostUsd: reservationCost,
    scopeIds,
    workflowId: request.workflowId,
    taskId: request.taskId,
    opportunityId: request.opportunityId,
    metadata: request.metadata,
  });

  if (!reservation.success || !reservation.ledgerId) {
    throw reservation.error || new DatabaseUnavailableError();
  }

  // IDEMPOTENCY OWNERSHIP: only the caller that CREATED the reservation
  // may advance to provider execution. Duplicates must not invoke provider.
  if (!reservation.isNewReservation) {
    throw (
      reservation.error ||
      new IdempotentRequestExistsError(request.idempotencyKey, reservation.ledgerId, 'existing')
    );
  }

  const ledgerId = reservation.ledgerId;

  // 8. RE-CHECK KILL SWITCH (between reservation and network)
  if (!(await isAIEnabled())) {
    await releaseBudget(
      supabase,
      ledgerId,
      'released',
      'ai_disabled',
      'Kill switch after reservation'
    );
    throw new AIDisabledError();
  }

  // 9. MARK IN-PROGRESS (network about to be dispatched)
  await markInProgress(supabase, ledgerId);

  // 10. PROVIDER CALL
  try {
    if (provider !== 'anthropic') {
      // Release (pre-network failure — we haven't dispatched)
      await releaseFailedInProgress(
        supabase,
        ledgerId,
        'unsupported_provider',
        `Provider ${provider} not supported for completion`
      );
      throw new ProviderError(provider, undefined, `Unsupported provider: ${provider}`);
    }

    const client = getAnthropicClient();
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await client.messages.create({
      model,
      max_tokens: maxOutputTokens,
      system: request.systemPrompt,
      messages,
    });

    // SUCCESS — settle
    const actualIn = response.usage?.input_tokens || 0;
    const actualOut = response.usage?.output_tokens || 0;
    const actualCost = calculateCost(provider, model, actualIn, actualOut);

    if (actualCost === null) {
      // Pricing vanished between reservation and settlement — use reservation as ceiling
      await markAmbiguous(
        supabase,
        ledgerId,
        'pricing_unavailable',
        'Cannot calculate actual cost'
      );
      throw new DatabaseUnavailableError(new Error('Pricing unavailable at settlement'));
    }

    const settled = await settleBudget(supabase, {
      ledgerId,
      actualInputTokens: actualIn,
      actualOutputTokens: actualOut,
      actualCostUsd: actualCost,
      providerModel: response.model,
      providerRequestId: response.id,
    });

    if (!settled) {
      // Settlement failed (likely safety violation: actual > reserved)
      console.error(
        `[GATEWAY] Settlement failed for ${ledgerId} — actual cost may exceed reservation`
      );
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      ledgerId,
      text: textBlock?.type === 'text' ? textBlock.text : '',
      usage: { inputTokens: actualIn, outputTokens: actualOut },
      costUsd: actualCost,
      model: response.model,
      provider: 'anthropic',
      providerRequestId: response.id,
    };
  } catch (err) {
    if (
      err instanceof AIDisabledError ||
      err instanceof BudgetExceededError ||
      err instanceof MissingAttributionError ||
      err instanceof IdempotentRequestExistsError ||
      err instanceof MissingBudgetScopeError
    ) {
      throw err;
    }

    // Determine if this is a definitive rejection (safe to release) or ambiguous
    if (err instanceof Anthropic.APIError) {
      const status = err.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        // Client error (400, 401, 403, 404) — provider definitively rejected, no charge
        await releaseFailedInProgress(supabase, ledgerId, `provider_${status}`, err.message);
        throw new ProviderError('anthropic', status, err.message, false);
      }
      // 429 (rate limit) or 5xx (server error) or timeout — AMBIGUOUS
      await markAmbiguous(supabase, ledgerId, `provider_${status || 'unknown'}`, err.message);
      throw new ProviderError(
        'anthropic',
        status,
        err.message,
        status === 429 || (status !== undefined && status >= 500)
      );
    }

    // Unknown error after network dispatch — AMBIGUOUS
    const msg = err instanceof Error ? err.message : String(err);
    await markAmbiguous(supabase, ledgerId, 'unknown_error', msg);
    throw new ProviderError('anthropic', undefined, msg);
  }
}

// ============================================================
// Main Gateway: embed()
// ============================================================

export async function embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
  validateAttribution(request);
  if (!(await isAIEnabled())) throw new AIDisabledError();
  await ensurePricingAndRouting();

  const route = getRoute('embed');
  const pricing = getPricing(route.provider, route.model);
  if (!pricing)
    throw new DatabaseUnavailableError(
      new Error(`No pricing for ${route.provider}:${route.model}`)
    );

  const estTokens = estimateInputTokens(request.texts.map((t) => ({ content: t })));
  if (estTokens > route.maxInputTokens) {
    throw new BudgetExceededError('input_size', 'embed', route.maxInputTokens, estTokens);
  }

  const reservationCost = estimateMaxCost(route.provider, route.model, estTokens, 0);
  if (reservationCost === null)
    throw new DatabaseUnavailableError(new Error('Cannot calculate reservation'));

  const supabase = getSupabase();
  const scopeIds = await resolveBudgetScopes(supabase, {
    workflowId: request.workflowId,
    agentId: request.agentId,
    taskId: request.taskId,
  });

  const reservation = await reserveBudget(supabase, {
    idempotencyKey: request.idempotencyKey,
    agentId: request.agentId,
    purpose: 'embed',
    taskType: request.taskType,
    provider: route.provider,
    model: route.model,
    modelTier: 'embed',
    estimatedInputTokens: estTokens,
    maxInputTokens: route.maxInputTokens,
    maxOutputTokens: 0,
    reservedCostUsd: reservationCost,
    scopeIds,
    workflowId: request.workflowId,
    taskId: request.taskId,
    opportunityId: request.opportunityId,
    metadata: request.metadata,
  });

  if (!reservation.success || !reservation.ledgerId) {
    throw reservation.error || new DatabaseUnavailableError();
  }

  if (!reservation.isNewReservation) {
    throw (
      reservation.error ||
      new IdempotentRequestExistsError(request.idempotencyKey, reservation.ledgerId, 'existing')
    );
  }

  const ledgerId = reservation.ledgerId;
  if (!(await isAIEnabled())) {
    await releaseBudget(
      supabase,
      ledgerId,
      'released',
      'ai_disabled',
      'Kill switch after reservation'
    );
    throw new AIDisabledError();
  }

  await markInProgress(supabase, ledgerId);

  try {
    const client = await getOpenAIClient();
    const cleanTexts = request.texts
      .map((t) => t.trim().slice(0, 30000))
      .filter((t) => t.length > 0);

    const response = await client.embeddings.create({
      model: route.model,
      input: cleanTexts,
      dimensions: 1536,
    });

    const embeddings = response.data.map((d) => d.embedding);
    const totalTokens = response.usage?.total_tokens || 0;
    const actualCost = calculateCost(route.provider, route.model, totalTokens, 0);

    if (actualCost === null) {
      await markAmbiguous(
        supabase,
        ledgerId,
        'pricing_unavailable',
        'Cannot calculate actual cost'
      );
      throw new DatabaseUnavailableError(new Error('Pricing unavailable at settlement'));
    }

    await settleBudget(supabase, {
      ledgerId,
      actualInputTokens: totalTokens,
      actualOutputTokens: 0,
      actualCostUsd: actualCost,
    });

    return { ledgerId, embeddings, usage: { totalTokens }, costUsd: actualCost };
  } catch (err) {
    if (err instanceof AIDisabledError || err instanceof BudgetExceededError) throw err;

    const msg = err instanceof Error ? err.message : String(err);
    await markAmbiguous(supabase, ledgerId, 'provider_error', msg);
    throw new ProviderError('openai', undefined, msg);
  }
}

// ============================================================
// Reset — for testing
// ============================================================

export function _resetGatewayClients(): void {
  anthropicClient = null;
  openaiClient = null;
  openaiModule = null;
  supabaseClient = null;
}

/** Pre-set Supabase client — for testing */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _setSupabaseClient(client: any): void {
  supabaseClient = client;
}
