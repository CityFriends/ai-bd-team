import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = process.env;

describe('logger module', () => {
  beforeEach(() => {
    // Reset modules to allow re-importing with different env
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('logger instance', () => {
    it('should export a logger instance', async () => {
      const { logger } = await import('../logger.js');

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should have base fields configured', async () => {
      const { logger } = await import('../logger.js');

      // Check that logger has expected bindings
      expect(logger.bindings()).toMatchObject({
        app: 'ai-bd-team',
      });
    });

    it('should set log level from LOG_LEVEL env var', async () => {
      process.env.LOG_LEVEL = 'warn';

      const { logger } = await import('../logger.js');

      expect(logger.level).toBe('warn');
    });

    it('should default to debug level in development', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.LOG_LEVEL;

      const { logger } = await import('../logger.js');

      expect(logger.level).toBe('debug');
    });

    it('should default to info level in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;

      const { logger } = await import('../logger.js');

      expect(logger.level).toBe('info');
    });
  });

  describe('createLogger', () => {
    it('should create a child logger with name', async () => {
      const { createLogger } = await import('../logger.js');

      const childLogger = createLogger('test-logger');

      expect(childLogger.bindings()).toMatchObject({
        name: 'test-logger',
        app: 'ai-bd-team',
      });
    });

    it('should create a child logger with additional context', async () => {
      const { createLogger } = await import('../logger.js');

      const childLogger = createLogger('test-logger', {
        component: 'scanner',
        version: '1.0.0',
      });

      expect(childLogger.bindings()).toMatchObject({
        name: 'test-logger',
        component: 'scanner',
        version: '1.0.0',
      });
    });

    it('should inherit parent logger methods', async () => {
      const { createLogger } = await import('../logger.js');

      const childLogger = createLogger('child');

      expect(typeof childLogger.info).toBe('function');
      expect(typeof childLogger.error).toBe('function');
      expect(typeof childLogger.warn).toBe('function');
      expect(typeof childLogger.debug).toBe('function');
      expect(typeof childLogger.trace).toBe('function');
      expect(typeof childLogger.fatal).toBe('function');
    });
  });

  describe('createAgentLogger', () => {
    it('should create logger with agent type', async () => {
      const { createAgentLogger } = await import('../logger.js');

      const agentLogger = createAgentLogger('maya');

      expect(agentLogger.bindings()).toMatchObject({
        name: 'maya',
        type: 'agent',
      });
    });

    it('should work for different agent names', async () => {
      const { createAgentLogger } = await import('../logger.js');

      const davidLogger = createAgentLogger('david');
      const rosaLogger = createAgentLogger('rosa');
      const jamesLogger = createAgentLogger('james');

      expect(davidLogger.bindings().name).toBe('david');
      expect(rosaLogger.bindings().name).toBe('rosa');
      expect(jamesLogger.bindings().name).toBe('james');
    });
  });

  describe('createJobLogger', () => {
    it('should create logger with job type', async () => {
      const { createJobLogger } = await import('../logger.js');

      const jobLogger = createJobLogger('daily-scan');

      expect(jobLogger.bindings()).toMatchObject({
        name: 'daily-scan',
        type: 'job',
      });
    });

    it('should work for cron jobs', async () => {
      const { createJobLogger } = await import('../logger.js');

      const cronLogger = createJobLogger('hourly-check');

      expect(cronLogger.bindings()).toMatchObject({
        name: 'hourly-check',
        type: 'job',
      });
    });
  });

  describe('createIntegrationLogger', () => {
    it('should create logger with integration type', async () => {
      const { createIntegrationLogger } = await import('../logger.js');

      const integrationLogger = createIntegrationLogger('sam-gov');

      expect(integrationLogger.bindings()).toMatchObject({
        name: 'sam-gov',
        type: 'integration',
      });
    });

    it('should work for different integrations', async () => {
      const { createIntegrationLogger } = await import('../logger.js');

      const slackLogger = createIntegrationLogger('slack');
      const supabaseLogger = createIntegrationLogger('supabase');
      const claudeLogger = createIntegrationLogger('claude');

      expect(slackLogger.bindings().name).toBe('slack');
      expect(supabaseLogger.bindings().name).toBe('supabase');
      expect(claudeLogger.bindings().name).toBe('claude');
    });
  });

  describe('default export', () => {
    it('should export logger as default', async () => {
      const loggerModule = await import('../logger.js');

      expect(loggerModule.default).toBeDefined();
      expect(typeof loggerModule.default.info).toBe('function');
    });
  });

  describe('Logger type export', () => {
    it('should export Logger type', async () => {
      // This is a compile-time check - if it compiles, the type is exported correctly
      const { createLogger } = await import('../logger.js');
      const logger = createLogger('test');

      // Verify it has Logger interface methods
      expect(logger.info).toBeDefined();
      expect(logger.child).toBeDefined();
    });
  });

  describe('logging functionality', () => {
    it('should be able to log messages', async () => {
      const { createLogger } = await import('../logger.js');
      const logger = createLogger('test');

      // These should not throw
      expect(() => logger.info('test message')).not.toThrow();
      expect(() => logger.info({ data: 'test' }, 'with object')).not.toThrow();
      expect(() => logger.error({ err: new Error('test') }, 'error occurred')).not.toThrow();
    });

    it('should create nested child loggers', async () => {
      const { createLogger } = await import('../logger.js');

      const parent = createLogger('parent');
      const child = parent.child({ nested: true });

      expect(child.bindings()).toMatchObject({
        name: 'parent',
        nested: true,
      });
    });
  });
});
