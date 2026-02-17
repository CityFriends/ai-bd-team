/**
 * Bot Factory - Shared Slack bot initialization
 *
 * Consolidates the repeated App initialization pattern across 13+ files.
 * Each agent has its own bot token (AGENT_BOT_TOKEN) and app token (AGENT_APP_TOKEN).
 *
 * Usage:
 *   const app = await createBotApp('maya');
 *   if (!app) {
 *     // Missing tokens, handle gracefully
 *   }
 */

import { App, LogLevel } from '@slack/bolt';
import { createAgentLogger, type Logger } from './logger.js';

export type AgentId = 'maya' | 'david' | 'rosa' | 'james' | 'patricia' | 'marcus' | 'jodie';

interface BotTokens {
  botToken: string;
  appToken: string;
}

/**
 * Get bot and app tokens for an agent from environment variables
 * Follows the naming convention: AGENT_BOT_TOKEN and AGENT_APP_TOKEN
 */
export function getAgentTokens(agentId: AgentId): BotTokens | null {
  const upperAgent = agentId.toUpperCase();
  const botToken = process.env[`${upperAgent}_BOT_TOKEN`];
  const appToken = process.env[`${upperAgent}_APP_TOKEN`];

  if (!botToken || !appToken) {
    return null;
  }

  return { botToken, appToken };
}

export interface BotAppOptions {
  /** Whether to start the app immediately (default: true) */
  autoStart?: boolean;
  /** Log level for Slack Bolt (default: WARN) */
  logLevel?: LogLevel;
  /** Logger instance for status messages */
  logger?: Logger;
}

export interface BotAppResult {
  app: App;
  botToken: string;
  appToken: string;
}

/**
 * Create a Slack bot App for an agent
 *
 * Returns null if required tokens are not configured.
 * By default, starts the app in socket mode.
 *
 * @param agentId - The agent identifier (maya, david, rosa, etc.)
 * @param options - Optional configuration
 * @returns The initialized App, or null if tokens missing
 */
export async function createBotApp(
  agentId: AgentId,
  options: BotAppOptions = {}
): Promise<BotAppResult | null> {
  const { autoStart = true, logLevel = LogLevel.WARN, logger: log } = options;

  const agentLogger = log ?? createAgentLogger(agentId);
  const tokens = getAgentTokens(agentId);

  if (!tokens) {
    agentLogger.warn(
      { agentId },
      `Missing ${agentId.toUpperCase()}_BOT_TOKEN or ${agentId.toUpperCase()}_APP_TOKEN`
    );
    return null;
  }

  const app = new App({
    token: tokens.botToken,
    appToken: tokens.appToken,
    socketMode: true,
    logLevel,
  });

  if (autoStart) {
    await app.start();
    agentLogger.info({ agentId }, 'Bot app started');
  }

  return {
    app,
    botToken: tokens.botToken,
    appToken: tokens.appToken,
  };
}

/**
 * Create multiple bot apps for a list of agents
 *
 * Returns a map of agentId -> App (only for successfully initialized agents)
 */
export async function createBotApps(
  agentIds: AgentId[],
  options: BotAppOptions = {}
): Promise<Map<AgentId, App>> {
  const apps = new Map<AgentId, App>();
  const logger = options.logger ?? createAgentLogger('bot-factory');

  const results = await Promise.allSettled(
    agentIds.map(async (agentId) => {
      const result = await createBotApp(agentId, { ...options, logger });
      return { agentId, result };
    })
  );

  for (const outcome of results) {
    if (outcome.status === 'fulfilled' && outcome.value.result) {
      apps.set(outcome.value.agentId, outcome.value.result.app);
    }
  }

  return apps;
}

/**
 * Stop a bot app gracefully
 */
export async function stopBotApp(app: App): Promise<void> {
  await app.stop();
}

/**
 * Stop multiple bot apps gracefully
 */
export async function stopBotApps(apps: Map<AgentId, App>): Promise<void> {
  await Promise.all(Array.from(apps.values()).map((app) => app.stop()));
}
