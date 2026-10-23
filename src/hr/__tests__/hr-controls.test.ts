/**
 * HR Controls Tests
 */
import { describe, it, expect } from 'vitest';
import { createHRControls, getHealthStatus } from '../config/hr-controls.js';
import type { HREnvConfig } from '../config/hr-env.js';

function makeEnv(overrides: Partial<HREnvConfig> = {}): HREnvConfig {
  return {
    supabaseUrl: '',
    supabaseServiceKey: '',
    slackEnabled: false,
    botToken: null,
    appToken: null,
    leadershipChannelId: null,
    helpChannelId: null,
    authorizedAdmins: [],
    aiEnabled: false,
    llmEnabled: false,
    anthropicApiKey: null,
    ...overrides,
  };
}

describe('createHRControls', () => {
  it('all controls disabled by default', () => {
    const controls = createHRControls(makeEnv());
    expect(controls.isSlackEnabled()).toBe(false);
    expect(controls.isAIEnabled()).toBe(false);
    expect(controls.isLLMEnabled()).toBe(false);
    expect(controls.isSyntheticOnly()).toBe(true);
  });

  it('M1 always returns synthetic-only', () => {
    const controls = createHRControls(makeEnv({ aiEnabled: true, llmEnabled: true }));
    expect(controls.isSyntheticOnly()).toBe(true);
  });

  it('reflects Slack enabled state', () => {
    const controls = createHRControls(makeEnv({ slackEnabled: true }));
    expect(controls.isSlackEnabled()).toBe(true);
  });
});

describe('getHealthStatus', () => {
  it('healthy when DB connected and Slack disabled', () => {
    const status = getHealthStatus(makeEnv(), true, null);
    expect(status.status).toBe('healthy');
    expect(status.checks.database).toBe(true);
    expect(status.checks.slack).toBeNull();
  });

  it('degraded when DB connected but Slack failed', () => {
    const status = getHealthStatus(makeEnv({ slackEnabled: true }), true, false);
    expect(status.status).toBe('degraded');
  });

  it('unhealthy when DB not connected', () => {
    const status = getHealthStatus(makeEnv(), false, null);
    expect(status.status).toBe('unhealthy');
  });
});
