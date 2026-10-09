/**
 * Denise Dedicated Slack Process — Startup/Shutdown/Isolation Tests
 *
 * Verifies that Denise runs on its own Bolt app, uses its own credentials,
 * prevents duplicate listeners, and shuts down independently of Maya.
 *
 * All tests use mocked Bolt — zero live Slack Socket Mode connections.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Mocked Bolt App — prevents real Socket Mode connections
// ============================================================
vi.mock('@slack/bolt', () => {
  class MockApp {
    private _started = false;
    private _actions = new Map<string, unknown>();
    readonly token: string;
    readonly appToken: string;

    constructor(opts: { token: string; appToken: string; socketMode: boolean }) {
      this.token = opts.token;
      this.appToken = opts.appToken;
    }

    async start() { this._started = true; }
    async stop() { this._started = false; }
    isStarted() { return this._started; }
    action(name: string, handler: unknown) { this._actions.set(name, handler); }
    getRegisteredActions() { return Array.from(this._actions.keys()); }
  }

  return {
    App: MockApp,
    LogLevel: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug' },
  };
});

// ============================================================
// Startup tests
// ============================================================
describe('Denise Dedicated Startup', () => {
  beforeEach(async () => {
    const { _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();
  });

  it('starts with DENISE_BOT_TOKEN and DENISE_APP_TOKEN', async () => {
    const savedBot = process.env.DENISE_BOT_TOKEN;
    const savedApp = process.env.DENISE_APP_TOKEN;
    process.env.DENISE_BOT_TOKEN = 'xoxb-denise-test-token';
    process.env.DENISE_APP_TOKEN = 'xapp-denise-test-token';

    const { startDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    const result = await startDeniseSlackApp();
    expect(result.started).toBe(true);
    expect(result.reason).toContain('started');
    expect(isDeniseSlackAppRunning()).toBe(true);

    if (savedBot) process.env.DENISE_BOT_TOKEN = savedBot; else delete process.env.DENISE_BOT_TOKEN;
    if (savedApp) process.env.DENISE_APP_TOKEN = savedApp; else delete process.env.DENISE_APP_TOKEN;
  });

  it('fails closed when DENISE_BOT_TOKEN is missing', async () => {
    const savedBot = process.env.DENISE_BOT_TOKEN;
    const savedApp = process.env.DENISE_APP_TOKEN;
    delete process.env.DENISE_BOT_TOKEN;
    process.env.DENISE_APP_TOKEN = 'xapp-test';

    const { startDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    const result = await startDeniseSlackApp();
    expect(result.started).toBe(false);
    expect(result.reason).toContain('Missing DENISE_BOT_TOKEN');
    expect(isDeniseSlackAppRunning()).toBe(false);

    if (savedBot) process.env.DENISE_BOT_TOKEN = savedBot;
    if (savedApp) process.env.DENISE_APP_TOKEN = savedApp; else delete process.env.DENISE_APP_TOKEN;
  });

  it('fails closed when DENISE_APP_TOKEN is missing', async () => {
    const savedBot = process.env.DENISE_BOT_TOKEN;
    const savedApp = process.env.DENISE_APP_TOKEN;
    process.env.DENISE_BOT_TOKEN = 'xoxb-test';
    delete process.env.DENISE_APP_TOKEN;

    const { startDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    const result = await startDeniseSlackApp();
    expect(result.started).toBe(false);
    expect(result.reason).toContain('Missing DENISE_BOT_TOKEN');
    expect(isDeniseSlackAppRunning()).toBe(false);

    if (savedBot) process.env.DENISE_BOT_TOKEN = savedBot; else delete process.env.DENISE_BOT_TOKEN;
    if (savedApp) process.env.DENISE_APP_TOKEN = savedApp;
  });

  it('prevents duplicate Socket Mode listeners', async () => {
    const savedBot = process.env.DENISE_BOT_TOKEN;
    const savedApp = process.env.DENISE_APP_TOKEN;
    process.env.DENISE_BOT_TOKEN = 'xoxb-denise-test';
    process.env.DENISE_APP_TOKEN = 'xapp-denise-test';

    const { startDeniseSlackApp, _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    const first = await startDeniseSlackApp();
    expect(first.started).toBe(true);

    const second = await startDeniseSlackApp();
    expect(second.started).toBe(false);
    expect(second.reason).toContain('already running');

    if (savedBot) process.env.DENISE_BOT_TOKEN = savedBot; else delete process.env.DENISE_BOT_TOKEN;
    if (savedApp) process.env.DENISE_APP_TOKEN = savedApp; else delete process.env.DENISE_APP_TOKEN;
  });

  it('does NOT use Maya credentials', async () => {
    const savedDeniseBot = process.env.DENISE_BOT_TOKEN;
    const savedDeniseApp = process.env.DENISE_APP_TOKEN;
    const savedMayaBot = process.env.MAYA_BOT_TOKEN;
    const savedMayaApp = process.env.MAYA_APP_TOKEN;

    // Set ONLY Maya tokens, NOT Denise tokens
    delete process.env.DENISE_BOT_TOKEN;
    delete process.env.DENISE_APP_TOKEN;
    process.env.MAYA_BOT_TOKEN = 'xoxb-maya-test';
    process.env.MAYA_APP_TOKEN = 'xapp-maya-test';

    const { startDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    const result = await startDeniseSlackApp();
    expect(result.started).toBe(false); // Must fail — Denise needs its OWN tokens
    expect(isDeniseSlackAppRunning()).toBe(false);

    if (savedDeniseBot) process.env.DENISE_BOT_TOKEN = savedDeniseBot;
    if (savedDeniseApp) process.env.DENISE_APP_TOKEN = savedDeniseApp;
    if (savedMayaBot) process.env.MAYA_BOT_TOKEN = savedMayaBot; else delete process.env.MAYA_BOT_TOKEN;
    if (savedMayaApp) process.env.MAYA_APP_TOKEN = savedMayaApp; else delete process.env.MAYA_APP_TOKEN;
  });
});

// ============================================================
// Shutdown tests
// ============================================================
describe('Denise Dedicated Shutdown', () => {
  beforeEach(async () => {
    const { _resetDeniseSlackApp } = await import('../slack-adapter.js');
    _resetDeniseSlackApp();
  });

  it('shutdown sets isDeniseSlackAppRunning to false', async () => {
    const savedBot = process.env.DENISE_BOT_TOKEN;
    const savedApp = process.env.DENISE_APP_TOKEN;
    process.env.DENISE_BOT_TOKEN = 'xoxb-denise-test';
    process.env.DENISE_APP_TOKEN = 'xapp-denise-test';

    const { startDeniseSlackApp, stopDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } =
      await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    await startDeniseSlackApp();
    expect(isDeniseSlackAppRunning()).toBe(true);

    await stopDeniseSlackApp();
    expect(isDeniseSlackAppRunning()).toBe(false);

    if (savedBot) process.env.DENISE_BOT_TOKEN = savedBot; else delete process.env.DENISE_BOT_TOKEN;
    if (savedApp) process.env.DENISE_APP_TOKEN = savedApp; else delete process.env.DENISE_APP_TOKEN;
  });

  it('shutdown is safe when not started', async () => {
    const { stopDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } =
      await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    // Should not throw
    await stopDeniseSlackApp();
    expect(isDeniseSlackAppRunning()).toBe(false);
  });

  it('can restart after shutdown', async () => {
    const savedBot = process.env.DENISE_BOT_TOKEN;
    const savedApp = process.env.DENISE_APP_TOKEN;
    process.env.DENISE_BOT_TOKEN = 'xoxb-denise-test';
    process.env.DENISE_APP_TOKEN = 'xapp-denise-test';

    const { startDeniseSlackApp, stopDeniseSlackApp, isDeniseSlackAppRunning, _resetDeniseSlackApp } =
      await import('../slack-adapter.js');
    _resetDeniseSlackApp();

    const first = await startDeniseSlackApp();
    expect(first.started).toBe(true);

    await stopDeniseSlackApp();
    expect(isDeniseSlackAppRunning()).toBe(false);

    const second = await startDeniseSlackApp();
    expect(second.started).toBe(true);
    expect(isDeniseSlackAppRunning()).toBe(true);

    if (savedBot) process.env.DENISE_BOT_TOKEN = savedBot; else delete process.env.DENISE_BOT_TOKEN;
    if (savedApp) process.env.DENISE_APP_TOKEN = savedApp; else delete process.env.DENISE_APP_TOKEN;
  });
});

// ============================================================
// Action handler registration
// ============================================================
describe('Denise Action Handler Registration', () => {
  it('registerDeniseActions registers both action handlers', async () => {
    const { registerDeniseActions } = await import('../slack-adapter.js');

    const registeredActions: string[] = [];
    const mockApp = {
      action: (name: string, _handler: unknown) => { registeredActions.push(name); },
    };

    registerDeniseActions(mockApp);
    expect(registeredActions).toContain('denise_acknowledge');
    expect(registeredActions).toContain('denise_request_review');
    expect(registeredActions).toHaveLength(2);
  });
});

// ============================================================
// run-team.ts topology verification
// ============================================================
describe('run-team.ts Topology', () => {
  it('imports startDeniseSlackApp and stopDeniseSlackApp', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'live', 'run-team.ts'),
      'utf-8'
    );
    expect(content).toContain('startDeniseSlackApp');
    expect(content).toContain('stopDeniseSlackApp');
  });

  it('does NOT import registerDeniseActions', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'live', 'run-team.ts'),
      'utf-8'
    );
    expect(content).not.toContain('registerDeniseActions');
  });

  it('does NOT register Denise actions on Maya app', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'live', 'run-team.ts'),
      'utf-8'
    );
    expect(content).not.toContain('registerDeniseActions(mayaApp)');
    expect(content).not.toContain('registerDeniseActions(maya');
  });

  it('calls stopDeniseSlackApp in shutdown handler', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', '..', 'live', 'run-team.ts'),
      'utf-8'
    );
    // Shutdown section should include stopDeniseSlackApp
    const shutdownSection = content.slice(content.indexOf('SIGINT'));
    expect(shutdownSection).toContain('stopDeniseSlackApp');
  });
});
