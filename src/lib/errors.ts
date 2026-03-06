/**
 * Error Handling Library
 *
 * Provides error categorization, retry logic, and standardized error handling.
 *
 * Error Categories:
 * - Transient: Network issues, rate limits, timeouts - safe to retry
 * - Permanent: Auth failures, invalid params, not found - don't retry
 * - Unknown: Unclassified errors - retry with caution
 *
 * Usage:
 *   import { isRetryable, withRetry, categorizeError } from '../lib/errors.js';
 *
 *   // Check if error is retryable
 *   if (isRetryable(error)) {
 *     await withRetry(() => fetchData(), { maxRetries: 3 });
 *   }
 */

import { logger } from './logger.js';

// ============================================================
// Error Categories
// ============================================================

export enum ErrorCategory {
  TRANSIENT = 'transient', // Network issues, rate limits - safe to retry
  PERMANENT = 'permanent', // Auth, invalid params - don't retry
  UNKNOWN = 'unknown', // Unclassified - retry with caution
}

export interface CategorizedError {
  category: ErrorCategory;
  originalError: Error;
  message: string;
  code?: string;
  statusCode?: number;
  retryable: boolean;
  context?: Record<string, unknown>;
}

// ============================================================
// Error Classification
// ============================================================

/** Patterns that indicate transient errors (safe to retry) */
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /network/i,
  /rate limit/i,
  /too many requests/i,
  /429/,
  /503/,
  /502/,
  /504/,
  /service unavailable/i,
  /temporarily unavailable/i,
  /try again/i,
  /retry/i,
];

/** Patterns that indicate permanent errors (don't retry) */
const PERMANENT_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /not found/i,
  /invalid.*param/i,
  /invalid.*key/i,
  /invalid.*token/i,
  /authentication/i,
  /permission denied/i,
  /bad request/i,
  /400/,
  /401/,
  /403/,
  /404/,
  /405/,
  /422/,
];

/**
 * Categorize an error based on its message and properties
 */
export function categorizeError(error: unknown): CategorizedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || String(error);

  // Extract status code if available
  const statusCode = extractStatusCode(err);

  // Check for transient patterns
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      category: ErrorCategory.TRANSIENT,
      originalError: err,
      message,
      statusCode,
      retryable: true,
    };
  }

  // Check for permanent patterns
  if (PERMANENT_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      category: ErrorCategory.PERMANENT,
      originalError: err,
      message,
      statusCode,
      retryable: false,
    };
  }

  // Check status codes directly
  if (statusCode) {
    if (statusCode >= 500 || statusCode === 429) {
      return {
        category: ErrorCategory.TRANSIENT,
        originalError: err,
        message,
        statusCode,
        retryable: true,
      };
    }
    if (statusCode >= 400 && statusCode < 500) {
      return {
        category: ErrorCategory.PERMANENT,
        originalError: err,
        message,
        statusCode,
        retryable: false,
      };
    }
  }

  // Unknown - default to cautious retry
  return {
    category: ErrorCategory.UNKNOWN,
    originalError: err,
    message,
    statusCode,
    retryable: true, // Allow one retry for unknown errors
  };
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  return categorizeError(error).retryable;
}

/**
 * Extract status code from various error formats
 */
function extractStatusCode(error: Error): number | undefined {
  // Check common status code properties
  const anyError = error as unknown as Record<string, unknown>;

  if (typeof anyError.status === 'number') {
    return anyError.status;
  }
  if (typeof anyError.statusCode === 'number') {
    return anyError.statusCode;
  }
  if (typeof anyError.code === 'number') {
    return anyError.code;
  }

  // Try to extract from message
  const statusMatch = error.message.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch) {
    return parseInt(statusMatch[1], 10);
  }

  return undefined;
}

// ============================================================
// Retry Logic
// ============================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 10000) */
  maxDelayMs?: number;
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Add random jitter to delays (default: true) */
  jitter?: boolean;
  /** Only retry for specific error categories */
  retryOn?: ErrorCategory[];
  /** Callback before each retry */
  onRetry?: (error: CategorizedError, attempt: number, delayMs: number) => void;
  /** Operation name for logging */
  operationName?: string;
}

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'operationName' | 'retryOn'>> =
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    jitter: true,
  };

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  const operationName = opts.operationName || 'operation';

  let lastError: CategorizedError | null = null;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = categorizeError(error);

      // Check if we should retry
      const shouldRetry =
        attempt < opts.maxRetries &&
        lastError.retryable &&
        (!opts.retryOn || opts.retryOn.includes(lastError.category));

      if (!shouldRetry) {
        // Log final failure
        logger.warn(
          {
            operation: operationName,
            attempt: attempt + 1,
            error: lastError.message,
            category: lastError.category,
            statusCode: lastError.statusCode,
          },
          `${operationName} failed (not retrying)`
        );
        throw lastError.originalError;
      }

      // Calculate delay with optional jitter
      let actualDelay = Math.min(delay, opts.maxDelayMs);
      if (opts.jitter) {
        // Add up to 25% random jitter
        actualDelay = actualDelay * (0.75 + Math.random() * 0.5);
      }

      // Log retry attempt
      logger.info(
        {
          operation: operationName,
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          nextDelayMs: Math.round(actualDelay),
          error: lastError.message,
          category: lastError.category,
        },
        `${operationName} failed, retrying in ${Math.round(actualDelay)}ms`
      );

      // Callback
      if (opts.onRetry) {
        opts.onRetry(lastError, attempt + 1, actualDelay);
      }

      // Wait before retry
      await sleep(actualDelay);

      // Increase delay for next attempt
      delay *= opts.backoffMultiplier;
    }
  }

  // This shouldn't happen, but TypeScript needs it
  throw lastError?.originalError || new Error('Retry failed');
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Error Wrapping & Logging
// ============================================================

/**
 * Wrap an error with additional context
 */
export function wrapError(
  error: unknown,
  context: Record<string, unknown>,
  message?: string
): CategorizedError {
  const categorized = categorizeError(error);
  return {
    ...categorized,
    message: message || categorized.message,
    context: { ...categorized.context, ...context },
  };
}

/**
 * Log an error with full context before potentially swallowing it
 */
export function logError(
  error: unknown,
  context: Record<string, unknown> = {},
  operation?: string
): CategorizedError {
  const categorized = categorizeError(error);

  logger.error(
    {
      operation,
      error: categorized.message,
      category: categorized.category,
      statusCode: categorized.statusCode,
      retryable: categorized.retryable,
      stack: categorized.originalError.stack,
      ...context,
    },
    operation ? `${operation} error` : 'Error occurred'
  );

  return categorized;
}

/**
 * Create a safe wrapper that logs errors and returns a fallback
 */
export function withFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  options: { operation?: string; logLevel?: 'warn' | 'error' } = {}
): () => Promise<T> {
  return async () => {
    try {
      return await fn();
    } catch (error) {
      const { operation = 'operation', logLevel = 'warn' } = options;
      const categorized = categorizeError(error);

      const logData = {
        operation,
        error: categorized.message,
        category: categorized.category,
        usingFallback: true,
      };

      if (logLevel === 'error') {
        logger.error(logData, `${operation} failed, using fallback`);
      } else {
        logger.warn(logData, `${operation} failed, using fallback`);
      }

      return fallback;
    }
  };
}

// ============================================================
// Common Error Types
// ============================================================

/**
 * Error thrown when an operation times out
 */
export class TimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when rate limited
 */
export class RateLimitError extends Error {
  retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Error thrown for API errors with status codes
 */
export class ApiError extends Error {
  statusCode: number;
  response?: unknown;

  constructor(message: string, statusCode: number, response?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}
