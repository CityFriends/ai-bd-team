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
import { registerLeadershipChannel } from './leadership-channel.js';
import { registerDMHandler } from './dm-handler.js';

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
}

export function createHRSlackApp(
  env: HREnvConfig,
  auth: HRAuthProvider,
  expectedTeamId?: string,
  readerPool?: HRReaderPool | null,
  signingSecret?: string | null
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

  // Register leadership channel and DM handlers only.
  // Public employee-help channel (#help-people-ops) is NOT processed.
  // Employees submit HR questions via direct message to the bot.
  registerLeadershipChannel(app, env, auth, expectedTeamId);
  registerDMHandler(app, auth, expectedTeamId, readerPool ?? undefined, signingSecret ?? undefined);

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
