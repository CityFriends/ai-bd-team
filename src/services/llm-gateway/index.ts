/**
 * LLM Gateway — Public API
 */

export { complete, embed, _resetGatewayClients, _setSupabaseClient } from './gateway.js';

export type {
  InferenceRequest,
  InferenceResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  TaskType,
  Provider,
  AgentId,
  InferenceStatus,
  LLMMessage,
  InferenceAttribution,
  ModelRoute,
  ModelPricing,
  BudgetScope,
} from './types.js';

export {
  AIDisabledError,
  BudgetExceededError,
  MissingAttributionError,
  DatabaseUnavailableError,
  ProviderError,
  DuplicateRequestError,
  RouteNotFoundError,
  MissingBudgetScopeError,
  IdempotentRequestExistsError,
} from './errors.js';

export { getSpend, getSpendBreakdown } from './usage.js';
export type { SpendSummary, SpendBreakdown } from './usage.js';

export {
  calculateCost,
  estimateMaxCost,
  estimateInputTokens,
  isPricingAvailable,
  _loadTestPricing,
} from './pricing.js';
export { resolveBudgetScopes, ensureWorkflowBudget, ensureTaskBudget } from './budget.js';

import { complete as _complete, embed as _embed } from './gateway.js';
export const llmGateway = { complete: _complete, embed: _embed };
