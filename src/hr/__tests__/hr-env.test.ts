/**
 * HR Environment Configuration Tests
 *
 * Verifies credential isolation, BD project rejection, and fail-closed behavior.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('HR Environment — loadHREnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('rejects BD Supabase project URL', async () => {
    process.env.HR_SUPABASE_URL = 'https://bvgtfadggtgnakrxvuim.supabase.co';
    process.env.HR_SUPABASE_SERVICE_KEY = 'some-key';
    const { loadHREnv } = await import('../config/hr-env.js');
    expect(() => loadHREnv()).toThrow('BD Supabase project');
  });

  it('rejects shared BD service key', async () => {
    process.env.HR_SUPABASE_URL = 'https://hr-project.supabase.co';
    process.env.HR_SUPABASE_SERVICE_KEY = 'shared-key';
    process.env.SUPABASE_SERVICE_KEY = 'shared-key';
    const { loadHREnv } = await import('../config/hr-env.js');
    expect(() => loadHREnv()).toThrow('matches SUPABASE_SERVICE_KEY');
  });

  it('fails closed when Slack enabled but tokens missing', async () => {
    process.env.HR_SLACK_ENABLED = 'true';
    const { loadHREnv } = await import('../config/hr-env.js');
    expect(() => loadHREnv()).toThrow('HR_BOT_TOKEN');
  });

  it('fails closed when Slack enabled but channel missing', async () => {
    process.env.HR_SLACK_ENABLED = 'true';
    process.env.HR_BOT_TOKEN = 'xoxb-test';
    process.env.HR_APP_TOKEN = 'xapp-test';
    const { loadHREnv } = await import('../config/hr-env.js');
    expect(() => loadHREnv()).toThrow('HR_LEADERSHIP_CHANNEL_ID');
  });

  it('fails closed when Slack enabled but team ID missing', async () => {
    process.env.HR_SLACK_ENABLED = 'true';
    process.env.HR_BOT_TOKEN = 'xoxb-test';
    process.env.HR_APP_TOKEN = 'xapp-test';
    process.env.HR_LEADERSHIP_CHANNEL_ID = 'C_LEAD';
    process.env.HR_HELP_CHANNEL_ID = 'C_HELP';
    delete process.env.HR_EXPECTED_TEAM_ID;
    const { loadHREnv } = await import('../config/hr-env.js');
    expect(() => loadHREnv()).toThrow('HR_EXPECTED_TEAM_ID');
  });

  it('accepts full Slack config including team ID', async () => {
    process.env.HR_SLACK_ENABLED = 'true';
    process.env.HR_BOT_TOKEN = 'xoxb-test';
    process.env.HR_APP_TOKEN = 'xapp-test';
    process.env.HR_LEADERSHIP_CHANNEL_ID = 'C_LEAD';
    process.env.HR_HELP_CHANNEL_ID = 'C_HELP';
    process.env.HR_EXPECTED_TEAM_ID = 'T_WORKSPACE';
    const { loadHREnv } = await import('../config/hr-env.js');
    const env = loadHREnv();
    expect(env.slackEnabled).toBe(true);
    expect(env.expectedTeamId).toBe('T_WORKSPACE');
  });

  it('fails closed when LLM enabled but API key missing', async () => {
    process.env.HR_LLM_ENABLED = 'true';
    const { loadHREnv } = await import('../config/hr-env.js');
    expect(() => loadHREnv()).toThrow('HR_ANTHROPIC_API_KEY');
  });

  it('loads successfully with minimal config (all disabled)', async () => {
    delete process.env.HR_SUPABASE_URL;
    delete process.env.HR_SLACK_ENABLED;
    delete process.env.HR_LLM_ENABLED;
    const { loadHREnv } = await import('../config/hr-env.js');
    const env = loadHREnv();
    expect(env.slackEnabled).toBe(false);
    expect(env.aiEnabled).toBe(false);
    expect(env.llmEnabled).toBe(false);
  });

  it('does not require Anthropic key when LLM is disabled', async () => {
    delete process.env.HR_LLM_ENABLED;
    delete process.env.HR_ANTHROPIC_API_KEY;
    const { loadHREnv } = await import('../config/hr-env.js');
    const env = loadHREnv();
    expect(env.llmEnabled).toBe(false);
    expect(env.anthropicApiKey).toBeNull();
  });

  it('parses authorized admins from comma-separated list', async () => {
    process.env.HR_AUTHORIZED_ADMINS = 'U001,U002, U003 ';
    const { loadHREnv } = await import('../config/hr-env.js');
    const env = loadHREnv();
    expect(env.authorizedAdmins).toEqual(['U001', 'U002', 'U003']);
  });

  it('does not fall back to BD SLACK_BOT_TOKEN', async () => {
    process.env.SLACK_BOT_TOKEN = 'bd-token';
    delete process.env.HR_BOT_TOKEN;
    const { loadHREnv } = await import('../config/hr-env.js');
    const env = loadHREnv();
    expect(env.botToken).toBeNull();
  });
});
