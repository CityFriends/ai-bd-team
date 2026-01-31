#!/usr/bin/env npx tsx
import 'dotenv/config';
import { pm } from './agents/pm.js';

async function main() {
  const args = process.argv.slice(2);
  let action = 'standup'; // default action

  for (const arg of args) {
    if (arg.startsWith('--action=')) {
      action = arg.split('=')[1];
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('  Running PM (Patricia)');
  console.log('═══════════════════════════════════════\n');

  const start = Date.now();

  try {
    switch (action) {
      case 'standup':
        console.log('PM: Running morning standup...\n');
        await pm.runMorningStandup();
        break;
      case 'decisions':
        console.log('PM: Checking pending decisions...\n');
        await pm.checkPendingDecisions();
        break;
      default:
        console.error('Unknown action. Available actions:');
        console.error('  --action=standup    Run morning standup (default)');
        console.error('  --action=decisions  Check and remind about pending decisions');
        process.exit(1);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ PM completed in ${elapsed}s`);
  } catch (error) {
    console.error('\n❌ PM failed:', error);
    process.exit(1);
  }
}

main();
