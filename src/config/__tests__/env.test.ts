import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock process.exit to prevent test from exiting
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

// Mock console.error to suppress output during tests
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('env validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module cache to get fresh validation state
    vi.resetModules();
    // Create a fresh env object for each test
    process.env = { ...originalEnv };
    mockExit.mockClear();
    mockConsoleError.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should validate required environment variables', async () => {
    // Set up valid environment
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
    process.env.SLACK_APP_TOKEN = 'xapp-test-token';
    process.env.SLACK_CHANNEL_ID = 'C12345';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    const { validateEnv } = await import('../env.js');
    const env = validateEnv();

    expect(env.SLACK_BOT_TOKEN).toBe('xoxb-test-token');
    expect(env.SUPABASE_URL).toBe('https://test.supabase.co');
    expect(['development', 'production', 'test']).toContain(env.NODE_ENV);
  });

  it('should fail when required env vars are missing', async () => {
    // Clear required vars
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    const { validateEnv } = await import('../env.js');

    expect(() => validateEnv()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should require at least one Supabase key', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
    process.env.SLACK_APP_TOKEN = 'xapp-test-token';
    process.env.SLACK_CHANNEL_ID = 'C12345';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    // Don't set any Supabase key

    const { validateEnv } = await import('../env.js');

    expect(() => validateEnv()).toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should accept SUPABASE_ANON_KEY as alternative to SERVICE_KEY', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
    process.env.SLACK_APP_TOKEN = 'xapp-test-token';
    process.env.SLACK_CHANNEL_ID = 'C12345';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

    const { validateEnv } = await import('../env.js');
    const env = validateEnv();

    expect(env.SUPABASE_ANON_KEY).toBe('test-anon-key');
  });
});

describe('integration checks', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Set required vars
    process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
    process.env.SLACK_SIGNING_SECRET = 'test-secret';
    process.env.SLACK_APP_TOKEN = 'xapp-test-token';
    process.env.SLACK_CHANNEL_ID = 'C12345';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should detect Notion integration', async () => {
    process.env.NOTION_API_KEY = 'secret_test';
    process.env.NOTION_HUB_PAGE_ID = 'page-123';

    const { hasNotionIntegration } = await import('../env.js');
    expect(hasNotionIntegration()).toBe(true);
  });

  it('should detect missing Notion integration', async () => {
    const { hasNotionIntegration } = await import('../env.js');
    expect(hasNotionIntegration()).toBe(false);
  });

  it('should detect SAM.gov integration', async () => {
    process.env.SAM_API_KEY = 'sam-api-key';

    const { hasSamGovIntegration } = await import('../env.js');
    expect(hasSamGovIntegration()).toBe(true);
  });
});
