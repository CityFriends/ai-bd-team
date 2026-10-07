/**
 * LLM Gateway Errors
 *
 * Typed errors for all failure modes in the inference control plane.
 */

/** Budget has been exhausted — no provider call permitted */
export class BudgetExceededError extends Error {
  constructor(
    public readonly scopeType: string,
    public readonly scopeId: string,
    public readonly limitUsd: number,
    public readonly requestedUsd: number
  ) {
    const limitStr = limitUsd < 0 ? 'unknown' : `$${limitUsd.toFixed(4)}`;
    super(
      `Budget exceeded for ${scopeType}:${scopeId} ` +
        `(limit: ${limitStr}, requested: $${requestedUsd.toFixed(4)})`
    );
    this.name = 'BudgetExceededError';
  }
}

/** AI execution is disabled — no provider call permitted */
export class AIDisabledError extends Error {
  constructor() {
    super('AI execution is currently disabled.');
    this.name = 'AIDisabledError';
  }
}

/** Missing required attribution fields */
export class MissingAttributionError extends Error {
  constructor(public readonly missingFields: string[]) {
    super(`Missing required attribution: ${missingFields.join(', ')}`);
    this.name = 'MissingAttributionError';
  }
}

/** Database unavailable — fail closed */
export class DatabaseUnavailableError extends Error {
  constructor(public readonly cause?: Error) {
    super('Database unavailable — cannot authorize inference');
    this.name = 'DatabaseUnavailableError';
  }
}

/** Provider returned an error */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly providerMessage?: string,
    public readonly retryable: boolean = false
  ) {
    super(`Provider error (${provider}): ${providerMessage || 'Unknown error'}`);
    this.name = 'ProviderError';
  }
}

/** Duplicate idempotency key — request already processed */
export class DuplicateRequestError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly existingLedgerId: string
  ) {
    super(`Duplicate request: idempotency key "${idempotencyKey}" already exists`);
    this.name = 'DuplicateRequestError';
  }
}

/** Model route not found or disabled */
export class RouteNotFoundError extends Error {
  constructor(public readonly taskType: string) {
    super(`No enabled model route for task type: ${taskType}`);
    this.name = 'RouteNotFoundError';
  }
}

/** Required budget scope is missing — fail closed */
export class MissingBudgetScopeError extends Error {
  constructor(
    public readonly scopeType: string,
    public readonly scopeId: string
  ) {
    super(
      `Required budget scope missing: ${scopeType}:${scopeId}. Create budget before requesting inference.`
    );
    this.name = 'MissingBudgetScopeError';
  }
}

/**
 * Duplicate idempotency key — existing entry owns execution.
 * Callers receiving this error must NOT invoke the provider.
 */
export class IdempotentRequestExistsError extends Error {
  constructor(
    public readonly idempotencyKey: string,
    public readonly existingLedgerId: string,
    public readonly existingStatus: string
  ) {
    super(
      `Idempotent request exists: key="${idempotencyKey}" ledger=${existingLedgerId} status=${existingStatus}`
    );
    this.name = 'IdempotentRequestExistsError';
  }
}
