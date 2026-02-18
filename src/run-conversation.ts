#!/usr/bin/env npx tsx
import 'dotenv/config';
import { runConversation } from './conversation/engine.js';

async function main() {
  const args = process.argv.slice(2);
  let opportunityId: string | null = null;
  let delayMs = 15000; // 15 seconds default

  for (const arg of args) {
    if (arg.startsWith('--opportunity-id=')) {
      opportunityId = arg.split('=')[1];
    }
    if (arg.startsWith('--delay=')) {
      delayMs = parseInt(arg.split('=')[1], 10) * 1000;
    }
  }

  if (!opportunityId) {
    console.error('Usage: npm run conversation -- --opportunity-id=<uuid> [--delay=<seconds>]');
    console.error('');
    console.error('Example:');
    console.error(
      '  npm run conversation -- --opportunity-id=2e59b339-6c37-4925-84c5-4e27abf7a47f'
    );
    console.error(
      '  npm run conversation -- --opportunity-id=2e59b339-6c37-4925-84c5-4e27abf7a47f --delay=5'
    );
    process.exit(1);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  AI BD Team - Threaded Conversation');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Opportunity ID: ${opportunityId}`);
  console.log(`  Delay between messages: ${delayMs / 1000}s`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('');

  const start = Date.now();

  try {
    await runConversation(opportunityId, delayMs);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('');
    console.log(`✅ Conversation complete in ${elapsed}s`);
    console.log('');
    console.log('Check Slack:');
    console.log("  • Maya's post in main channel (thread has full discussion)");
    console.log('  • David, Rosa, James reply in thread');
    console.log("  • Patricia's summary in main channel");
    console.log('');
  } catch (error) {
    console.error('\n❌ Conversation failed:', error);
    process.exit(1);
  }
}

main();
