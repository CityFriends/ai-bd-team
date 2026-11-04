/**
 * HR Slack Application
 *
 * Dedicated Slack Bolt app for HR, completely independent of the BD Slack app.
 * Uses HR_BOT_TOKEN / HR_APP_TOKEN — never falls back to BD tokens.
 *
 * Socket Mode connection is only established when HR_SLACK_ENABLED=true.
 */

import { App, LogLevel } from '@slack/bolt';
import type { HREnvConfig } from '../config/hr-env.js';
import type { HRAuthProvider } from '../auth/hr-auth.js';
import type { HRReaderPool } from '../database/hr-client.js';
import type { HRPipelineConfig } from '../llm/hr-answer-pipeline.js';
import { registerLeadershipChannel } from './leadership-channel.js';
import { registerMessageHandler } from './dm-handler.js';
import { loadPilotConfig } from './hr-pilot-access.js';

export interface HRSlackApp {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface HRSlackAppOptions {
  env: HREnvConfig;
  auth: HRAuthProvider;
  expectedTeamId?: string;
  readerPool?: HRReaderPool | null;
  signingSecret?: string | null;
  pipelineConfig?: HRPipelineConfig;
}

export function createHRSlackApp(
  env: HREnvConfig,
  auth: HRAuthProvider,
  expectedTeamId?: string,
  readerPool?: HRReaderPool | null,
  signingSecret?: string | null,
  pipelineConfig?: HRPipelineConfig
): HRSlackApp {
  if (!env.botToken || !env.appToken) {
    throw new Error('HR Slack app requires HR_BOT_TOKEN and HR_APP_TOKEN.');
  }

  const app = new App({
    token: env.botToken,
    appToken: env.appToken,
    socketMode: true,
    logLevel: LogLevel.INFO,
  });

  // Load pilot access configuration (fail-closed from env vars).
  // Defaults to disabled when HR_PILOT_ENABLED is not 'true'.
  const pilotConfig = loadPilotConfig();

  // Register leadership channel handler.
  // Public employee-help channel (#help-people-ops) is NOT processed.
  registerLeadershipChannel(app, env, auth, expectedTeamId);

  // Register unified message handler (DMs + pilot private channel).
  // AI pipeline is only activated when pilotConfig, pipelineConfig, and
  // feature gates are all correctly configured. Otherwise, the pilot
  // path is inactive and DMs show safe placeholder responses.
  registerMessageHandler({
    app,
    auth,
    expectedTeamId,
    readerPool: readerPool ?? undefined,
    signingSecret: signingSecret ?? undefined,
    pilotConfig,
    pipelineConfig,
  });

  return {
    async start() {
      await app.start();
      console.log('[HR Slack] Connected via Socket Mode');
    },
    async stop() {
      await app.stop();
      console.log('[HR Slack] Disconnected');
    },
  };
}
