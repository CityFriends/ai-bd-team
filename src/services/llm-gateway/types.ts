/**
 * LLM Gateway Types
 *
 * Core type definitions for the centralized inference control plane.
 */

/** Task types for model routing — determines provider/model selection */
export type TaskType =
  | 'classify'
  | 'extract'
  | 'summarize'
  | 'research'
  | 'reason'
  | 'write'
  | 'review'
  | 'embed';

/** Provider identifiers */
export type Provider = 'anthropic' | 'openai';

/** Agent identifiers */
export type AgentId =
  | 'maya'
  | 'david'
  | 'rosa'
  | 'james'
  | 'patricia'
  | 'marcus'
  | 'jodie'
  | 'system';

/** Ledger entry status lifecycle */
export type InferenceStatus =
  | 'reserved'
  | 'in_progress'
  | 'settled'
  | 'released'
  | 'failed'
  | 'ambiguous';

/** Message format for LLM requests */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Required attribution for every inference request */
export interface InferenceAttribution {
  /** Which agent is requesting inference */
  agentId: AgentId;
  /** High-level purpose category for routing */
  purpose: TaskType;
  /** Specific task type for cost categorization */
  taskType: string;
  /** Workflow instance ID if part of a workflow */
  workflowId?: string;
  /** Logical task identifier within the workflow */
  taskId?: string;
  /** Opportunity notice ID or reference */
  opportunityId?: string;
}

/** Complete inference request to the Gateway */
export interface InferenceRequest extends InferenceAttribution {
  /** Chat messages to send to the model */
  messages: LLMMessage[];
  /** System prompt (for Anthropic) */
  systemPrompt?: string;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Maximum cost in USD for this request */
  maxCostUsd?: number;
  /** Idempotency key — prevents duplicate charges for the same logical request */
  idempotencyKey: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Embedding request to the Gateway */
export interface EmbeddingRequest extends InferenceAttribution {
  /** Text(s) to embed */
  texts: string[];
  /** Idempotency key */
  idempotencyKey: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Successful inference response */
export interface InferenceResponse {
  /** Ledger entry ID */
  ledgerId: string;
  /** Generated text content */
  text: string;
  /** Actual token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Actual cost in USD */
  costUsd: number;
  /** Model that was used */
  model: string;
  /** Provider that was used */
  provider: Provider;
  /** Provider-assigned request ID if available */
  providerRequestId?: string;
}

/** Successful embedding response */
export interface EmbeddingResponse {
  /** Ledger entry ID */
  ledgerId: string;
  /** Generated embeddings */
  embeddings: number[][];
  /** Actual token usage */
  usage: {
    totalTokens: number;
  };
  /** Actual cost in USD */
  costUsd: number;
}

/** Model routing configuration */
export interface ModelRoute {
  taskType: TaskType;
  provider: Provider;
  model: string;
  maxOutputTokens: number;
  maxInputTokens: number;
  maxCostUsd: number | null;
  enabled: boolean;
}

/** Model pricing configuration */
export interface ModelPricing {
  provider: Provider;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  tier: string | null;
}

/** Budget scope */
export interface BudgetScope {
  id: string;
  scopeType: 'global_daily' | 'workflow' | 'agent' | 'task';
  scopeId: string;
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  enabled: boolean;
}
