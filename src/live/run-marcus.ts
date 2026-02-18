#!/usr/bin/env npx tsx
import 'dotenv/config';
import { marcus } from './marcus.js';

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Marcus (Engineering Lead) - Live Mode');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Check for required tokens
  if (!process.env.MARCUS_BOT_TOKEN || !process.env.MARCUS_APP_TOKEN) {
    console.error('ERROR: Missing MARCUS_BOT_TOKEN or MARCUS_APP_TOKEN in .env');
    console.error('');
    console.error("Please create Marcus's Slack app and add his tokens to .env:");
    console.error('  MARCUS_BOT_TOKEN=xoxb-...');
    console.error('  MARCUS_APP_TOKEN=xapp-...');
    process.exit(1);
  }

  // Check for GitHub token (optional but recommended)
  if (!process.env.GITHUB_TOKEN) {
    console.warn("WARNING: GITHUB_TOKEN not set. Marcus won't be able to analyze repos.");
    console.warn('Add GITHUB_TOKEN to .env for GitHub repo analysis.');
    console.warn('');
  }

  try {
    await marcus.connect();
    console.log('');
    console.log('Marcus is now listening for @mentions and thread replies.');
    console.log('He can analyze GitHub repos when asked.');
    console.log('Press Ctrl+C to disconnect.');
    console.log('');

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await marcus.disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start Marcus:', error);
    process.exit(1);
  }
}

main();
