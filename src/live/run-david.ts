#!/usr/bin/env npx tsx
import 'dotenv/config';
import { david } from './david.js';

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  David (Analyst) - Live Mode');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Check for required tokens
  if (!process.env.DAVID_BOT_TOKEN || !process.env.DAVID_APP_TOKEN) {
    console.error('ERROR: Missing DAVID_BOT_TOKEN or DAVID_APP_TOKEN in .env');
    console.error('');
    console.error("Please create David's Slack app and add his tokens to .env:");
    console.error('  DAVID_BOT_TOKEN=xoxb-...');
    console.error('  DAVID_APP_TOKEN=xapp-...');
    process.exit(1);
  }

  try {
    await david.connect();
    console.log('');
    console.log('David is now listening for @mentions and thread replies.');
    console.log('Press Ctrl+C to disconnect.');
    console.log('');

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await david.disconnect();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start David:', error);
    process.exit(1);
  }
}

main();
