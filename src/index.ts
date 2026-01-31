import 'dotenv/config';
import { startSlackApp, stopSlackApp } from './integrations/slack.js';
import { startScheduler, stopScheduler, runScoutScanNow, runStandupNow } from './coordination/scheduler.js';
import { startQueueProcessor, stopQueueProcessor } from './coordination/queue.js';
import { setupTriggers } from './coordination/triggers.js';

// Graceful shutdown handling
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${signal} received. Shutting down gracefully...`);

  try {
    stopScheduler();
    stopQueueProcessor();
    await stopSlackApp();
    console.log('Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Main startup function
async function main(): Promise<void> {
  console.log('Starting BD Team AI Agents...');
  console.log('=========================================');

  // Verify environment variables
  const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
    'SLACK_CHANNEL_ID',
    'SUPABASE_URL',
    'ANTHROPIC_API_KEY',
  ];

  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    for (const v of missing) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  // Optional but recommended
  if (!process.env.SAM_API_KEY) {
    console.warn('Warning: SAM_API_KEY not set. Scout will not be able to fetch opportunities.');
  }

  if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY');
    process.exit(1);
  }

  try {
    // Start Slack app
    console.log('Starting Slack app...');
    await startSlackApp();

    // Set up event triggers
    console.log('Setting up triggers...');
    setupTriggers();

    // Start the task queue processor
    console.log('Starting queue processor...');
    startQueueProcessor();

    // Start the scheduler for daily jobs
    console.log('Starting scheduler...');
    startScheduler();

    console.log('=========================================');
    console.log('BD Team AI Agents is running!');
    console.log('');
    console.log('Scheduled jobs:');
    console.log('  - Scout daily scan: 6:00 AM');
    console.log('  - Strategist standup: 8:00 AM (weekdays)');
    console.log('');
    console.log('Listening for Slack events...');
    console.log('Press Ctrl+C to stop');
    console.log('=========================================');

    // Handle CLI commands for testing
    if (process.argv.includes('--run-scout')) {
      console.log('Running Scout scan immediately...');
      await runScoutScanNow();
    }

    if (process.argv.includes('--run-standup')) {
      console.log('Running standup immediately...');
      await runStandupNow();
    }
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

// Set up signal handlers
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Start the application
main();
