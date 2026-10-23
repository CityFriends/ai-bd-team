/**
 * FFTC HR AI Employee — Service Entry Point
 *
 * Independent of the BD run-all.ts process.
 * Uses dedicated HR credentials, database, and Slack app.
 *
 * M1: Synthetic employee directory, Slack foundation, no LLM.
 */

import 'dotenv/config';
import { createServer } from 'http';
import { loadHREnv, HREnvError } from './config/hr-env.js';
import { createHRControls, markStarted, getHealthStatus } from './config/hr-controls.js';
import { createHRClient } from './database/hr-client.js';
import { createHRAuth } from './auth/hr-auth.js';
import { isKnownSlackUser, syncBootstrapAdmins } from './database/employees.js';
import { createHRSlackApp, type HRSlackApp } from './slack/hr-slack-app.js';

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

  // 2. Log startup configuration (no secrets, no IDs)
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

    // Sync bootstrap admins atomically via RPC
    if (dbConnected && env.authorizedAdmins.length > 0) {
      const syncResult = await syncBootstrapAdmins(dbClient.client, env.authorizedAdmins);
      if (syncResult.error) {
        console.error(`[HR Service] Bootstrap admin sync failed: ${syncResult.error}`);
      } else {
        console.log(`[HR Service] Bootstrap admins synced: added=${syncResult.added} removed=${syncResult.removed}`);
      }
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
  let slackApp: HRSlackApp | null = null;
  let slackConnected: boolean | null = null;
  if (controls.isSlackEnabled()) {
    try {
      slackApp = createHRSlackApp(env, auth, env.expectedTeamId ?? undefined);
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

  // 7. Start health endpoint (keeps the process alive and supports Railway health checks)
  const port = parseInt(process.env.PORT || '3000', 10);
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const currentHealth = getHealthStatus(env, dbConnected, slackConnected);
      const statusCode = currentHealth.status === 'unhealthy' ? 503 : 200;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(currentHealth));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[HR Service] Health endpoint listening on :${port}/health`);
    console.log('[HR Service] Ready.');
  });

  // 8. Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[HR Service] Received ${signal}, shutting down...`);
    server.close();
    if (slackApp) {
      try { await slackApp.stop(); } catch { /* best effort */ }
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[HR Service] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
