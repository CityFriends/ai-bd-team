/**
 * Request Context Management
 *
 * Provides request ID generation and propagation for correlating
 * logs and metrics across agent calls and external services.
 *
 * Uses AsyncLocalStorage to maintain context across async boundaries.
 *
 * Usage:
 *   import { withRequestContext, getRequestId, getRequestContext } from './request-context.js';
 *
 *   // Wrap an operation with context
 *   await withRequestContext({ agent: 'maya' }, async () => {
 *     const reqId = getRequestId(); // Get current request ID
 *     logger.info({ requestId: reqId }, 'Processing...');
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

// ============================================================
// Types
// ============================================================

export interface RequestContext {
  requestId: string;
  agent?: string;
  threadTs?: string;
  channelId?: string;
  userId?: string;
  startTime: number;
  parentRequestId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// AsyncLocalStorage Instance
// ============================================================

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// ============================================================
// Context Functions
// ============================================================

/**
 * Generate a new request ID
 * Format: {prefix}-{timestamp}-{random}
 */
export function generateRequestId(prefix: string = 'req'): string {
  const timestamp = Date.now().toString(36);
  const random = randomUUID().split('-')[0];
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Get the current request context
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the current request ID
 */
export function getRequestId(): string | undefined {
  return getRequestContext()?.requestId;
}

/**
 * Get the current agent name from context
 */
export function getContextAgent(): string | undefined {
  return getRequestContext()?.agent;
}

/**
 * Run a function within a new request context
 */
export function withRequestContext<T>(
  contextOrAgent: Partial<RequestContext> | string,
  fn: () => T
): T {
  const parentContext = getRequestContext();

  const newContext: RequestContext = {
    requestId: generateRequestId(),
    startTime: Date.now(),
    ...(typeof contextOrAgent === 'string' ? { agent: contextOrAgent } : contextOrAgent),
    parentRequestId: parentContext?.requestId,
  };

  return asyncLocalStorage.run(newContext, fn);
}

/**
 * Run an async function within a new request context
 */
export async function withRequestContextAsync<T>(
  contextOrAgent: Partial<RequestContext> | string,
  fn: () => Promise<T>
): Promise<T> {
  return withRequestContext(contextOrAgent, fn);
}

/**
 * Update the current request context
 */
export function updateRequestContext(updates: Partial<RequestContext>): void {
  const current = getRequestContext();
  if (current) {
    Object.assign(current, updates);
  }
}

/**
 * Get elapsed time since request started
 */
export function getRequestElapsed(): number {
  const context = getRequestContext();
  return context ? Date.now() - context.startTime : 0;
}

/**
 * Create a child context (for sub-operations)
 */
export function createChildContext(
  childAgent?: string,
  metadata?: Record<string, unknown>
): RequestContext {
  const parent = getRequestContext();
  return {
    requestId: generateRequestId('child'),
    agent: childAgent || parent?.agent,
    threadTs: parent?.threadTs,
    channelId: parent?.channelId,
    userId: parent?.userId,
    startTime: Date.now(),
    parentRequestId: parent?.requestId,
    metadata: { ...parent?.metadata, ...metadata },
  };
}

// ============================================================
// Logger Integration Helpers
// ============================================================

/**
 * Get context fields for logging
 * Automatically includes request ID and other context
 */
export function getLogContext(): Record<string, unknown> {
  const context = getRequestContext();
  if (!context) {
    return {};
  }

  return {
    requestId: context.requestId,
    agent: context.agent,
    threadTs: context.threadTs,
    elapsed: getRequestElapsed(),
    ...(context.parentRequestId && { parentRequestId: context.parentRequestId }),
  };
}

/**
 * Wrap a logger with automatic context injection
 */
export function withLogContext<T extends { child: (bindings: Record<string, unknown>) => T }>(
  logger: T
): T {
  const context = getLogContext();
  if (Object.keys(context).length === 0) {
    return logger;
  }
  return logger.child(context);
}
