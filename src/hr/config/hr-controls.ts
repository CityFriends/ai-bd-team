/**
 * HR Feature Controls
 *
 * M1: AI and LLM are disabled. Slack is configurable.
 * All controls fail closed — disabled unless explicitly enabled.
 */

import type { HREnvConfig } from './hr-env.js';

export interface HRControls {
  isSlackEnabled(): boolean;
  isAIEnabled(): boolean;
  isLLMEnabled(): boolean;
  isNotionSyncEnabled(): boolean;
  isSyntheticOnly(): boolean;
}

/**
 * Check whether Notion synchronization is enabled at runtime.
 * Reads the environment variable on every call — never cached —
 * so that the kill switch takes effect immediately.
 *
 * Canonical implementation: sync-engine and webhook-handler import this.
 */
export function isNotionSyncEnabled(): boolean {
  return process.env.HR_NOTION_SYNC_ENABLED?.toLowerCase() === 'true';
}

export function createHRControls(env: HREnvConfig): HRControls {
  return {
    isSlackEnabled: () => env.slackEnabled,
    isAIEnabled: () => env.aiEnabled,
    isLLMEnabled: () => env.llmEnabled,
    isNotionSyncEnabled,
    isSyntheticOnly: () => true,
  };
}

/**
 * Health/readiness status for the HR service.
 * Suitable for Railway health checks and operational monitoring.
 */
export interface HRHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: {
    database: boolean;
    slack: boolean | null; // null when Slack is disabled
  };
}

let startTime: number | null = null;

export function markStarted(): void {
  startTime = Date.now();
}

export function getHealthStatus(
  env: HREnvConfig,
  dbConnected: boolean,
  slackConnected: boolean | null
): HRHealthStatus {
  const dbOk = dbConnected;
  const slackOk = env.slackEnabled ? slackConnected === true : null;
  const allOk = dbOk && (slackOk === null || slackOk);

  return {
    status: allOk ? 'healthy' : dbOk ? 'degraded' : 'unhealthy',
    version: 'M1',
    uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
    checks: {
      database: dbOk,
      slack: slackOk,
    },
  };
}
