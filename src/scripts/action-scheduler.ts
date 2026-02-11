/**
 * Action Scheduler
 *
 * Checks for due agent actions and executes them.
 * Can run standalone or integrated into the production runner.
 *
 * Usage:
 *   npm run actions:check    # Check and execute due actions once
 *   npm run actions:schedule # Run on schedule (every 15 minutes)
 */

import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { getDueActions } from '../integrations/agent-actions.js';
import { executeAction } from '../integrations/action-executor.js';

/**
 * Initialize all agent apps
 */
async function initializeApps(): Promise<Map<string, App>> {
  const apps = new Map<string, App>();

  const agentConfigs = [
    { name: 'maya', botToken: process.env.MAYA_BOT_TOKEN, appToken: process.env.MAYA_APP_TOKEN },
    { name: 'david', botToken: process.env.DAVID_BOT_TOKEN, appToken: process.env.DAVID_APP_TOKEN },
    { name: 'marcus', botToken: process.env.MARCUS_BOT_TOKEN, appToken: process.env.MARCUS_APP_TOKEN },
    { name: 'patricia', botToken: process.env.PATRICIA_BOT_TOKEN, appToken: process.env.PATRICIA_APP_TOKEN },
    { name: 'rosa', botToken: process.env.ROSA_BOT_TOKEN, appToken: process.env.ROSA_APP_TOKEN },
    { name: 'james', botToken: process.env.JAMES_BOT_TOKEN, appToken: process.env.JAMES_APP_TOKEN },
  ];

  for (const config of agentConfigs) {
    if (config.botToken && config.appToken) {
      try {
        const app = new App({
          token: config.botToken,
          appToken: config.appToken,
          socketMode: true,
        });
        await app.start();
        apps.set(config.name, app);
        console.log(`[ActionScheduler] ${config.name} app initialized`);
      } catch (err) {
        console.warn(`[ActionScheduler] Failed to initialize ${config.name}:`, err);
      }
    }
  }

  return apps;
}

/**
 * Cleanup all apps
 */
async function cleanupApps(apps: Map<string, App>): Promise<void> {
  for (const [name, app] of apps) {
    try {
      await app.stop();
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check for and execute due actions
 */
export async function checkAndExecuteActions(): Promise<number> {
  console.log(`\n[ActionScheduler] Checking for due actions at ${new Date().toLocaleString()}`);

  const dueActions = await getDueActions();

  if (dueActions.length === 0) {
    console.log('[ActionScheduler] No actions due');
    return 0;
  }

  console.log(`[ActionScheduler] Found ${dueActions.length} due action(s)`);

  // Initialize apps
  const apps = await initializeApps();

  if (apps.size === 0) {
    console.error('[ActionScheduler] No agent apps available');
    return 0;
  }

  // Execute each action
  let executed = 0;
  for (const action of dueActions) {
    try {
      await executeAction(action, apps);
      executed++;
    } catch (err) {
      console.error(`[ActionScheduler] Failed to execute action:`, err);
    }

    // Small delay between actions
    await new Promise(r => setTimeout(r, 2000));
  }

  // Cleanup
  await cleanupApps(apps);

  console.log(`[ActionScheduler] Executed ${executed} action(s)`);
  return executed;
}

/**
 * Run the action scheduler with apps already initialized (for production use)
 */
export async function checkAndExecuteActionsWithApps(apps: Map<string, App>): Promise<number> {
  console.log(`[ActionScheduler] Checking for due actions...`);

  const dueActions = await getDueActions();

  if (dueActions.length === 0) {
    return 0;
  }

  console.log(`[ActionScheduler] Found ${dueActions.length} due action(s)`);

  let executed = 0;
  for (const action of dueActions) {
    try {
      await executeAction(action, apps);
      executed++;
    } catch (err) {
      console.error(`[ActionScheduler] Failed to execute action:`, err);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[ActionScheduler] Executed ${executed} action(s)`);
  return executed;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Action Scheduler - Running');
    console.log('='.repeat(60));
    console.log('\nChecking for due actions every 15 minutes...\n');

    // Check immediately on start
    await checkAndExecuteActions();

    // Then check every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      await checkAndExecuteActions();
    });

    console.log('[ActionScheduler] Scheduler running...');

  } else {
    // One-time check
    await checkAndExecuteActions();
  }
}

main().catch(console.error);
