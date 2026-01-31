#!/usr/bin/env npx tsx
import 'dotenv/config';
import { maya } from './maya.js';

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Maya (Scout) - Live Mode');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Check for required tokens
  if (!process.env.MAYA_BOT_TOKEN || !process.env.MAYA_APP_TOKEN) {
    console.error('ERROR: Missing MAYA_BOT_TOKEN or MAYA_APP_TOKEN in .env');
    console.error('');
    console.error('Please create Maya\'s Slack app and add her tokens to .env:');
    console.error('  MAYA_BOT_TOKEN=xoxb-...');
    console.error('  MAYA_APP_TOKEN=xapp-...');
    process.exit(1);
  }

  try {
    await maya.connect();
    console.log('');
    console.log('Maya is now listening for @mentions and thread replies.');
    console.log('Press Ctrl+C to disconnect.');
    console.log('');

    // Keep running
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await maya.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start Maya:', error);
    process.exit(1);
  }
}

main();
