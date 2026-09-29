/**
 * Maya Slack Surface Unit Tests
 *
 * Tests authorization, button idempotency, version-aware commands,
 * Slack projection control, and More Research branches.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('Slack Authorization — Fail Closed', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('authorized production user accepted', async () => {
    process.env.SLACK_AUTHORIZED_USERS = 'U123,U456';
    delete process.env.MAYA_DEV_MODE;
    const { isAuthorizedUser } = await import('../slack-surface.js');
    // Module caches AUTHORIZED_USERS at import time, so we re-import
    expect(isAuthorizedUser('U123')).toBe(true);
  });

  it('unauthorized production user denied', async () => {
    process.env.SLACK_AUTHORIZED_USERS = 'U123,U456';
    delete process.env.MAYA_DEV_MODE;
    const { isAuthorizedUser } = await import('../slack-surface.js');
    expect(isAuthorizedUser('UINTRUDER')).toBe(false);
  });

  it('missing production allowlist denied (fail closed)', async () => {
    delete process.env.SLACK_AUTHORIZED_USERS;
    delete process.env.MAYA_DEV_MODE;
    const { isAuthorizedUser } = await import('../slack-surface.js');
    expect(isAuthorizedUser('U123')).toBe(false);
  });

  it('empty production allowlist denied (fail closed)', async () => {
    process.env.SLACK_AUTHORIZED_USERS = '';
    delete process.env.MAYA_DEV_MODE;
    const { isAuthorizedUser } = await import('../slack-surface.js');
    expect(isAuthorizedUser('U123')).toBe(false);
  });

  it('dev mode with empty allowlist allows all', async () => {
    delete process.env.SLACK_AUTHORIZED_USERS;
    process.env.MAYA_DEV_MODE = 'true';
    const { isAuthorizedUser } = await import('../slack-surface.js');
    expect(isAuthorizedUser('UANYONE')).toBe(true);
  });
});

describe('Slack Projection Control', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('disabled when MAYA_SLACK_PROJECTION_ENABLED is missing', async () => {
    delete process.env.MAYA_SLACK_PROJECTION_ENABLED;
    const { isSlackProjectionEnabled } = await import('../slack-surface.js');
    expect(isSlackProjectionEnabled()).toBe(false);
  });

  it('disabled when set to false', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'false';
    const { isSlackProjectionEnabled } = await import('../slack-surface.js');
    expect(isSlackProjectionEnabled()).toBe(false);
  });

  it('enabled when explicitly true', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { isSlackProjectionEnabled } = await import('../slack-surface.js');
    expect(isSlackProjectionEnabled()).toBe(true);
  });
});

describe('Button Value Parsing', () => {
  it('parses material hash from button value', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    expect(parseButtonValue('abcdef1234567890:capture')).toEqual({
      materialHash: 'abcdef1234567890',
    });
  });

  it('returns empty for plain value', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    expect(parseButtonValue('capture')).toEqual({});
  });

  it('returns empty for undefined', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    expect(parseButtonValue(undefined)).toEqual({});
  });
});

describe('Format Brief — Version-Aware Buttons', () => {
  it('buttons include material hash in value when provided', async () => {
    const { formatOpportunityBrief } = await import('../slack-surface.js');
    const { blocks } = formatOpportunityBrief(
      {
        title: 'Test',
        agency: 'VA',
        setAside: null,
        naics: null,
        responseDeadline: null,
        sourceUrl: null,
      },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'custom',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      },
      'hash12345678'
    );
    const actions = blocks.find((b: { type: string }) => b.type === 'actions');
    expect(actions.elements[0].value).toContain('hash12345678');
    expect(actions.elements[1].value).toContain('hash12345678');
    expect(actions.elements[2].value).toContain('hash12345678');
  });
});

describe('Action Registration', () => {
  it('registerMayaActions registers all three action handlers', async () => {
    const { registerMayaActions } = await import('../slack-surface.js');
    const registered: string[] = [];
    const mockApp = {
      action: (id: string, _handler: unknown) => {
        registered.push(id);
      },
    };
    registerMayaActions(mockApp);
    expect(registered).toContain('maya_send_to_capture');
    expect(registered).toContain('maya_more_research');
    expect(registered).toContain('maya_dismiss');
    expect(registered).toHaveLength(3);
  });
});
