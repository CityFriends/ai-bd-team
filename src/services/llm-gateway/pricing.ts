/**
 * LLM Gateway Pricing
 *
 * Centralized model pricing. All cost calculations go through here.
 *
 * FAIL-CLOSED: If pricing is unavailable, no inference can be authorized.
 * A short-lived cache of DB-loaded pricing is acceptable.
 * Hardcoded fallback pricing is NOT used for financial authorization.
 */

import type { ModelPricing, Provider } from './types.js';

/** Cache state */
let pricingCache: Map<string, ModelPricing> = new Map();
let lastRefresh = 0;
let pricingLoaded = false;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_AGE_MS = 15 * 60 * 1000; // 15 minutes — after this, cache is stale and must refresh

function pricingKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Refresh pricing from database. Must succeed at least once
 * before any financial authorization is permitted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshPricing(supabase: any): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('ai_model_pricing')
      .select('provider, model, input_price_per_million, output_price_per_million, tier')
      .is('effective_until', null);

    if (error || !data || data.length === 0) {
      return false;
    }

    const newCache = new Map<string, ModelPricing>();
    for (const row of data) {
      newCache.set(pricingKey(row.provider, row.model), {
        provider: row.provider as Provider,
        model: row.model,
        inputPricePerMillion: Number(row.input_price_per_million),
        outputPricePerMillion: Number(row.output_price_per_million),
        tier: row.tier,
      });
    }

    pricingCache = newCache;
    lastRefresh = Date.now();
    pricingLoaded = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Get pricing for a specific model. Returns null if not found.
 */
export function getPricing(provider: string, model: string): ModelPricing | null {
  return pricingCache.get(pricingKey(provider, model)) || null;
}

/**
 * Whether pricing has been loaded from DB at least once.
 */
export function isPricingAvailable(): boolean {
  return pricingLoaded && pricingCache.size > 0;
}

/**
 * Whether pricing cache is within acceptable age.
 */
export function isPricingFresh(): boolean {
  if (!pricingLoaded) return false;
  return Date.now() - lastRefresh < MAX_CACHE_AGE_MS;
}

/**
 * Calculate cost for given tokens. Returns null if pricing unavailable (fail closed).
 */
export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const pricing = getPricing(provider, model);
  if (!pricing) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
  return inputCost + outputCost;
}

/**
 * Estimate maximum possible cost for a request (for reservation).
 * Uses max input tokens + max output tokens for conservative bound.
 * Returns null if pricing unavailable.
 */
export function estimateMaxCost(
  provider: string,
  model: string,
  maxInputTokens: number,
  maxOutputTokens: number
): number | null {
  return calculateCost(provider, model, maxInputTokens, maxOutputTokens);
}

/** Safety margin multiplier applied to token estimates */
export const TOKEN_SAFETY_MARGIN = 1.2; // 20% overhead

/**
 * Estimate input tokens from message content with safety margin.
 * Conservative: overestimates to ensure reservation covers actual.
 */
export function estimateInputTokens(
  messages: Array<{ content: string }>,
  systemPrompt?: string
): number {
  let charCount = 0;
  for (const m of messages) {
    charCount += m.content.length;
  }
  if (systemPrompt) charCount += systemPrompt.length;
  // ~4 chars per token, plus 20% safety margin
  return Math.ceil((charCount / 4) * TOKEN_SAFETY_MARGIN);
}

/**
 * Check if pricing cache needs refresh.
 */
export function needsRefresh(): boolean {
  return !pricingLoaded || Date.now() - lastRefresh > REFRESH_INTERVAL_MS;
}

/** For testing */
export function _resetPricingCache(): void {
  pricingCache = new Map();
  lastRefresh = 0;
  pricingLoaded = false;
}

/** For testing — load pricing directly */
export function _loadTestPricing(entries: ModelPricing[]): void {
  pricingCache = new Map();
  for (const e of entries) {
    pricingCache.set(pricingKey(e.provider, e.model), e);
  }
  lastRefresh = Date.now();
  pricingLoaded = true;
}
