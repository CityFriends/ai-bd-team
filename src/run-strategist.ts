#!/usr/bin/env npx tsx
import 'dotenv/config';
import { strategist } from './agents/strategist.js';

async function main() {
  // Parse --opportunity-id argument
  const args = process.argv.slice(2);
  let opportunityId: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--opportunity-id=')) {
      opportunityId = arg.split('=')[1];
    }
  }

  if (!opportunityId) {
    console.error('Usage: npm run strategist -- --opportunity-id=<uuid>');
    console.error('');
    console.error('Example:');
    console.error('  npm run strategist -- --opportunity-id=2e59b339-6c37-4925-84c5-4e27abf7a47f');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════');
  console.log('  Running Strategist Capture Assessment');
  console.log('═══════════════════════════════════════\n');

  const start = Date.now();

  try {
    await strategist.synthesizeOpportunity(opportunityId);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ Strategist completed in ${elapsed}s`);
  } catch (error) {
    console.error('\n❌ Strategist failed:', error);
    process.exit(1);
  }
}

main();
