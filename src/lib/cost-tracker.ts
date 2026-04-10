/**
 * Cost Tracker for Claude API Usage
 *
 * Tracks API costs persistently in the database, with model-specific
 * pricing and purpose-based categorization.
 *
 * Usage:
 *   import { trackCost, getCostSummary } from '../lib/cost-tracker.js';
 *   const response = await client.messages.create(...);
 *   await trackCost({ agent, purpose, model, usage: response.usage });
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// Types
// ============================================================

export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export type CallPurpose =
  | 'thinking_session' // Agent decides what to post
  | 'engagement_decision' // Agent decides how to respond
  | 'opportunity_analysis' // Scoring opportunities
  | 'research' // Agency/partner research
  | 'outreach_draft' // Writing emails
  | 'conversation' // Slack/live conversation
  | 'summarization' // Memory/context summarization
  | 'discussion' // Multi-agent opportunity discussion
  | 'synthesis' // Deliverable generation from discussion
  | 'other';

export interface CostRecord {
  agent?: string;
  purpose: CallPurpose;
  model: string;
  model_tier: ModelTier;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface CostSummary {
  total_cost_usd: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  by_purpose: Record<CallPurpose, { calls: number; cost: number }>;
  by_model: Record<string, { calls: number; cost: number }>;
  by_agent: Record<string, { calls: number; cost: number }>;
  period_start: string;
  period_end: string;
}

// ============================================================
// Model Pricing (per million tokens)
// ============================================================

const MODEL_PRICING: Record<string, { input: number; output: number; tier: ModelTier }> = {
  // Claude 3.5/4 Sonnet
  'claude-sonnet-4-20250514': { input: 3, output: 15, tier: 'sonnet' },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, tier: 'sonnet' },
  'claude-3-5-sonnet-20240620': { input: 3, output: 15, tier: 'sonnet' },

  // Claude 3 Haiku
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, tier: 'haiku' },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4, tier: 'haiku' },

  // Claude 3 Opus
  'claude-3-opus-20240229': { input: 15, output: 75, tier: 'opus' },
  'claude-opus-4-5-20251101': { input: 15, output: 75, tier: 'opus' },
};

// Default pricing for unknown models (assume Sonnet pricing)
const DEFAULT_PRICING = { input: 3, output: 15, tier: 'sonnet' as ModelTier };

// ============================================================
// Database Client
// ============================================================

function getSupabase() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
}

// ============================================================
// Cost Calculation
// ============================================================

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { cost: number; tier: ModelTier } {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return {
    cost: inputCost + outputCost,
    tier: pricing.tier,
  };
}

export function getModelTier(model: string): ModelTier {
  return MODEL_PRICING[model]?.tier || 'sonnet';
}

// ============================================================
// Cost Tracking
// ============================================================

export async function trackCost(record: {
  agent?: string;
  purpose: CallPurpose;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { cost, tier } = calculateCost(
    record.model,
    record.usage.input_tokens,
    record.usage.output_tokens
  );

  const costRecord: CostRecord = {
    agent: record.agent,
    purpose: record.purpose,
    model: record.model,
    model_tier: tier,
    input_tokens: record.usage.input_tokens,
    output_tokens: record.usage.output_tokens,
    estimated_cost_usd: cost,
    duration_ms: record.durationMs,
    metadata: record.metadata,
  };

  try {
    const supabase = getSupabase();
    await supabase.from('api_costs').insert(costRecord);
  } catch (err) {
    // Don't fail the main operation if cost tracking fails
    console.warn('[CostTracker] Failed to record cost:', err);
  }
}

// ============================================================
// Cost Queries
// ============================================================

export async function getCostSummary(options?: {
  sinceHoursAgo?: number;
  agent?: string;
  purpose?: CallPurpose;
}): Promise<CostSummary> {
  const supabase = getSupabase();
  const sinceHours = options?.sinceHoursAgo || 24;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

  let query = supabase.from('api_costs').select('*').gte('created_at', since);

  if (options?.agent) {
    query = query.eq('agent', options.agent);
  }
  if (options?.purpose) {
    query = query.eq('purpose', options.purpose);
  }

  const { data: records, error } = await query;

  if (error || !records) {
    return {
      total_cost_usd: 0,
      total_calls: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      by_purpose: {} as Record<CallPurpose, { calls: number; cost: number }>,
      by_model: {},
      by_agent: {},
      period_start: since,
      period_end: new Date().toISOString(),
    };
  }

  const summary: CostSummary = {
    total_cost_usd: 0,
    total_calls: records.length,
    total_input_tokens: 0,
    total_output_tokens: 0,
    by_purpose: {} as Record<CallPurpose, { calls: number; cost: number }>,
    by_model: {},
    by_agent: {},
    period_start: since,
    period_end: new Date().toISOString(),
  };

  for (const record of records) {
    summary.total_cost_usd += record.estimated_cost_usd || 0;
    summary.total_input_tokens += record.input_tokens || 0;
    summary.total_output_tokens += record.output_tokens || 0;

    // By purpose
    const purpose = record.purpose as CallPurpose;
    if (!summary.by_purpose[purpose]) {
      summary.by_purpose[purpose] = { calls: 0, cost: 0 };
    }
    summary.by_purpose[purpose].calls++;
    summary.by_purpose[purpose].cost += record.estimated_cost_usd || 0;

    // By model
    const model = record.model || 'unknown';
    if (!summary.by_model[model]) {
      summary.by_model[model] = { calls: 0, cost: 0 };
    }
    summary.by_model[model].calls++;
    summary.by_model[model].cost += record.estimated_cost_usd || 0;

    // By agent
    const agent = record.agent || 'system';
    if (!summary.by_agent[agent]) {
      summary.by_agent[agent] = { calls: 0, cost: 0 };
    }
    summary.by_agent[agent].calls++;
    summary.by_agent[agent].cost += record.estimated_cost_usd || 0;
  }

  return summary;
}

export async function getDailyCost(): Promise<number> {
  const summary = await getCostSummary({ sinceHoursAgo: 24 });
  return summary.total_cost_usd;
}

export async function getMonthlyCostEstimate(): Promise<number> {
  const dailyCost = await getDailyCost();
  return dailyCost * 30;
}

// ============================================================
// Daily Cost Budget
// ============================================================

const DAILY_BUDGET_USD = 2.0; // Hard cap — stop non-essential API calls after this
let _cachedBudgetCheck: { overBudget: boolean; cost: number; checkedAt: number } | null = null;
const BUDGET_CACHE_TTL_MS = 5 * 60 * 1000; // Cache for 5 minutes to avoid DB spam

/**
 * Check if daily budget has been exceeded.
 * Results are cached for 5 minutes to avoid hammering the DB.
 */
export async function isDailyBudgetExceeded(): Promise<{ overBudget: boolean; cost: number }> {
  const now = Date.now();
  if (_cachedBudgetCheck && now - _cachedBudgetCheck.checkedAt < BUDGET_CACHE_TTL_MS) {
    return { overBudget: _cachedBudgetCheck.overBudget, cost: _cachedBudgetCheck.cost };
  }

  const cost = await getDailyCost();
  const overBudget = cost >= DAILY_BUDGET_USD;
  _cachedBudgetCheck = { overBudget, cost, checkedAt: now };

  if (overBudget) {
    console.warn(`[CostTracker] Daily budget exceeded: $${cost.toFixed(2)} / $${DAILY_BUDGET_USD}`);
  }

  return { overBudget, cost };
}

// ============================================================
// Model Selection Helpers
// ============================================================

/**
 * Get recommended model for a given purpose
 * Balances cost vs. capability
 */
export function getRecommendedModel(purpose: CallPurpose): string {
  switch (purpose) {
    // Simple/structured output - use Haiku (much cheaper)
    case 'engagement_decision':
    case 'thinking_session':
    case 'summarization':
      return 'claude-3-5-haiku-20241022';

    // Complex reasoning - use Sonnet
    case 'opportunity_analysis':
    case 'research':
    case 'outreach_draft':
    case 'conversation':
    case 'discussion':
    case 'synthesis':
      return 'claude-sonnet-4-20250514';

    default:
      return 'claude-sonnet-4-20250514';
  }
}

/**
 * Check if we should skip a Claude call based on heuristics
 */
export function shouldSkipClaudeCall(context: {
  relevanceScore?: number;
  importance?: number;
  agentAlreadyEngagedToday?: boolean;
  isOwnPost?: boolean;
}): { skip: boolean; reason?: string } {
  // Never respond to own posts
  if (context.isOwnPost) {
    return { skip: true, reason: 'own_post' };
  }

  // Very low relevance - don't bother
  if (context.relevanceScore !== undefined && context.relevanceScore < 0.3) {
    return { skip: true, reason: 'low_relevance' };
  }

  // Very low importance - probably not worth it
  if (context.importance !== undefined && context.importance < 4) {
    return { skip: true, reason: 'low_importance' };
  }

  // Already engaged a lot today - give others a chance
  if (context.agentAlreadyEngagedToday) {
    return { skip: true, reason: 'rate_limited' };
  }

  return { skip: false };
}
