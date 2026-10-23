/**
 * FFTC HR AI Employee — Service Entry Point
 *
 * Independent of the BD run-all.ts process.
 * Uses dedicated HR credentials, database, and Slack app.
 *
 * M1: Synthetic employee directory, Slack foundation, no LLM.
 */

import 'dotenv/config';
import { loadHREnv, HREnvError } from './config/hr-env.js';
import { createHRControls, markStarted, getHealthStatus } from './config/hr-controls.js';
import { createHRClient } from './database/hr-client.js';
import { createHRAuth } from './auth/hr-auth.js';
import { isKnownSlackUser, syncBootstrapAdmins } from './database/employees.js';
import { createHRSlackApp } from './slack/hr-slack-app.js';

async function main(): Promise<void> {
  console.log('[HR Service] Starting FFTC HR AI Employee...');

  // 1. Load and validate environment
  let env;
  try {
    env = loadHREnv();
  } catch (err) {
    if (err instanceof HREnvError) {
      console.error(`[HR Service] Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const controls = createHRControls(env);

  // 2. Log startup configuration (no secrets)
  console.log('[HR Service] Configuration:');
  console.log(`  Database: ${env.supabaseUrl ? 'configured' : 'not configured'}`);
  console.log(`  Slack: ${controls.isSlackEnabled() ? 'enabled' : 'disabled'}`);
  console.log(`  AI: ${controls.isAIEnabled() ? 'enabled' : 'disabled'}`);
  console.log(`  LLM: ${controls.isLLMEnabled() ? 'enabled' : 'disabled'}`);
  console.log(`  Synthetic-only: ${controls.isSyntheticOnly()}`);
  console.log(`  Authorized admins: ${env.authorizedAdmins.length} configured`);

  // 3. Initialize database (if configured)
  let dbClient;
  let dbConnected = false;
  if (env.supabaseUrl && env.supabaseServiceKey) {
    dbClient = createHRClient(env.supabaseUrl, env.supabaseServiceKey);
    dbConnected = await dbClient.isConnected();
    console.log(`[HR Service] Database: ${dbConnected ? 'connected' : 'connection failed'}`);

    // Sync bootstrap admins to database for RPC authorization
    if (dbConnected && env.authorizedAdmins.length > 0) {
      await syncBootstrapAdmins(dbClient.client, env.authorizedAdmins);
      console.log(`[HR Service] Bootstrap admins synced: ${env.authorizedAdmins.length}`);
    }
  } else {
    console.log('[HR Service] Database: not configured (HR_SUPABASE_URL not set)');
  }

  // 4. Initialize authorization
  const auth = createHRAuth(
    env.authorizedAdmins,
    dbClient ? (slackId) => isKnownSlackUser(dbClient!.client, slackId) : undefined
  );

  // 5. Start Slack (if enabled)
  let slackConnected: boolean | null = null;
  if (controls.isSlackEnabled()) {
    try {
      const slackApp = createHRSlackApp(env, auth, env.expectedTeamId ?? undefined);
      await slackApp.start();
      slackConnected = true;
      console.log('[HR Service] Slack: connected');
    } catch (err) {
      slackConnected = false;
      console.error(
        '[HR Service] Slack connection failed:',
        err instanceof Error ? err.message : err
      );
    }
  } else {
    console.log('[HR Service] Slack: disabled (HR_SLACK_ENABLED != true)');
  }

  // 6. Mark started and report health
  markStarted();
  const health = getHealthStatus(env, dbConnected, slackConnected);
  console.log(`[HR Service] Health: ${health.status}`);
  console.log('[HR Service] Ready.');

  // Keep the process running
  process.on('SIGTERM', () => {
    console.log('[HR Service] Received SIGTERM, shutting down...');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    console.log('[HR Service] Received SIGINT, shutting down...');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[HR Service] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
