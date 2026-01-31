#!/usr/bin/env npx tsx
import 'dotenv/config';
import { analyst } from './agents/analyst.js';

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
    console.error('Usage: npm run analyst -- --opportunity-id=<uuid>');
    console.error('');
    console.error('Example:');
    console.error('  npm run analyst -- --opportunity-id=2e59b339-6c37-4925-84c5-4e27abf7a47f');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════');
  console.log('  Running Analyst Research');
  console.log('═══════════════════════════════════════\n');

  const start = Date.now();

  try {
    await analyst.researchOpportunity(opportunityId);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ Analyst completed in ${elapsed}s`);
  } catch (error) {
    console.error('\n❌ Analyst failed:', error);
    process.exit(1);
  }
}

main();
