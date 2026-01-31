#!/usr/bin/env npx tsx
import 'dotenv/config';
import { scout } from './agents/scout.js';

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Running Scout Daily Scan');
  console.log('═══════════════════════════════════════\n');

  const start = Date.now();

  try {
    await scout.runDailyScan();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ Scout completed in ${elapsed}s`);
  } catch (error) {
    console.error('\n❌ Scout failed:', error);
    process.exit(1);
  }
}

main();
