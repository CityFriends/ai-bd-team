import pino from 'pino';

/**
 * Structured logger for AI BD Team
 *
 * Uses pino for high-performance structured logging.
 * In development, uses pino-pretty for readable output.
 * In production, uses JSON format for log aggregation.
 *
 * Usage:
 *   import { logger } from '../lib/logger.js';
 *   logger.info('Message');
 *   logger.info({ userId: '123' }, 'User action');
 *   logger.error({ err }, 'Operation failed');
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

// Default export for convenience
export default logger;
