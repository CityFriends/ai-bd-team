import pino from 'pino';

/**
 * Structured logger for AI BD Team
 *
 * Uses pino for high-performance structured logging.
 * In development, uses pino-pretty for readable output.
 * In production, uses JSON format for log aggregation.
 *
 * Integrates with request-context.ts for automatic request ID correlation.
 *
 * Usage:
 *   import { logger, getContextLogger } from '../lib/logger.js';
 *   logger.info('Message');
 *   logger.info({ userId: '123' }, 'User action');
 *   logger.error({ err }, 'Operation failed');
 *
 *   // With request context (auto-includes requestId, agent, elapsed time):
 *   const log = getContextLogger();
 *   log.info('Processing...'); // Automatically includes requestId
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

// Base logger configuration
const baseConfig: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  // Add timestamp
  timestamp: pino.stdTimeFunctions.isoTime,
  // Format errors properly
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Add base fields to all logs
  base: {
    app: 'ai-bd-team',
    env: process.env.NODE_ENV || 'development',
  },
};

// Development: use pretty printing
// Production: use JSON for log aggregation
const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,app,env',
        messageFormat: '{msg}',
      },
    }
  : undefined;

// Create the logger
export const logger = pino({
  ...baseConfig,
  transport,
});

/**
 * Create a child logger with additional context
 * Useful for agent-specific logging
 *
 * Usage:
 *   const agentLogger = createLogger('maya');
 *   agentLogger.info('Scanning opportunities...');
 */
export function createLogger(
  name: string,
  additionalContext: Record<string, unknown> = {}
): pino.Logger {
  return logger.child({
    name,
    ...additionalContext,
  });
}

/**
 * Create an agent logger with standard agent context
 */
export function createAgentLogger(agentName: string): pino.Logger {
  return createLogger(agentName, { type: 'agent' });
}

/**
 * Create a job logger for scheduled jobs/cron
 */
export function createJobLogger(jobName: string): pino.Logger {
  return createLogger(jobName, { type: 'job' });
}

/**
 * Create an integration logger for external service calls
 */
export function createIntegrationLogger(serviceName: string): pino.Logger {
  return createLogger(serviceName, { type: 'integration' });
}

// Export the pino type for TypeScript consumers
export type { Logger } from 'pino';

// Cache for request context module (loaded lazily to avoid circular dependency)
let requestContextModule: { getLogContext: () => Record<string, unknown> } | null = null;

async function loadRequestContext(): Promise<{ getLogContext: () => Record<string, unknown> }> {
  if (!requestContextModule) {
    requestContextModule = await import('./request-context.js');
  }
  return requestContextModule;
}

/**
 * Get a logger with current request context automatically included
 * This includes requestId, agent, threadTs, and elapsed time
 *
 * Note: This is synchronous and uses cached module. For first use in a request,
 * ensure request-context has been imported elsewhere first.
 *
 * Usage:
 *   import { getContextLogger } from '../lib/logger.js';
 *   const log = getContextLogger();
 *   log.info('Processing...'); // Auto-includes requestId, agent, etc.
 */
export function getContextLogger(): pino.Logger {
  if (!requestContextModule) {
    // Module not loaded yet - return base logger
    // Next call will work after async import completes
    loadRequestContext().catch(() => {});
    return logger;
  }

  const context = requestContextModule.getLogContext();
  if (Object.keys(context).length === 0) {
    return logger;
  }

  return logger.child(context);
}

/**
 * Create a child logger with request context plus additional bindings
 */
export function createContextLogger(
  name: string,
  additionalContext: Record<string, unknown> = {}
): pino.Logger {
  if (!requestContextModule) {
    // Module not loaded yet
    loadRequestContext().catch(() => {});
    return logger.child({ name, ...additionalContext });
  }

  const requestContext = requestContextModule.getLogContext();
  return logger.child({
    name,
    ...requestContext,
    ...additionalContext,
  });
}

// Default export for convenience
export default logger;
