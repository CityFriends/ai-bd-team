#!/usr/bin/env npx tsx
import 'dotenv/config';
import { scout } from './agents/scout.js';
import { analyst } from './agents/analyst.js';
import { connector } from './agents/connector.js';
import { strategist } from './agents/strategist.js';
import { pm } from './agents/pm.js';
import { getOpportunity } from './integrations/supabase.js';

// Default 2 minutes, can be overridden with --delay=<seconds>
let DELAY_MS = 2 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

async function countdown(ms: number, label: string): Promise<void> {
  const interval = 10000; // Update every 10 seconds
  let remaining = ms;

  while (remaining > 0) {
    console.log(`  ⏳ ${label} in ${formatTime(remaining)}...`);
    await sleep(Math.min(interval, remaining));
    remaining -= interval;
  }
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let opportunityId: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--opportunity-id=')) {
      opportunityId = arg.split('=')[1];
    }
    if (arg.startsWith('--delay=')) {
      const seconds = parseInt(arg.split('=')[1], 10);
      DELAY_MS = seconds * 1000;
    }
  }

  if (!opportunityId) {
    console.error('Usage: npm run full-flow -- --opportunity-id=<uuid> [--delay=<seconds>]');
    console.error('');
    console.error('Example:');
    console.error('  npm run full-flow -- --opportunity-id=2e59b339-6c37-4925-84c5-4e27abf7a47f');
    console.error(
      '  npm run full-flow -- --opportunity-id=2e59b339-6c37-4925-84c5-4e27abf7a47f --delay=15'
    );
    process.exit(1);
  }

  // Verify opportunity exists
  const opp = await getOpportunity(opportunityId);
  if (!opp) {
    console.error(`Opportunity ${opportunityId} not found`);
    process.exit(1);
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  AI BD Team - Full Pipeline Demo');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Opportunity: ${opp.title}`);
  console.log(`  Agency: ${opp.agency || 'Unknown'}`);
  console.log(`  Delay between agents: ${DELAY_MS / 1000} seconds`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('');

  const totalStart = Date.now();

  try {
    // Step 1: Scout posts about the opportunity
    console.log('┌─────────────────────────────────────┐');
    console.log('│  1/5  SCOUT - Opportunity Hunter    │');
    console.log('└─────────────────────────────────────┘');
    console.log('');

    const scoutStart = Date.now();
    await scout.postOpportunity(opportunityId);
    console.log(`  ✅ Scout posted in ${((Date.now() - scoutStart) / 1000).toFixed(1)}s`);
    console.log('');

    // Wait before Analyst
    await countdown(DELAY_MS, 'Analyst responds');
    console.log('');

    // Step 2: Analyst researches and responds
    console.log('┌─────────────────────────────────────┐');
    console.log('│  2/5  ANALYST - Research Lead       │');
    console.log('└─────────────────────────────────────┘');
    console.log('');

    const analystStart = Date.now();
    await analyst.researchOpportunity(opportunityId);
    console.log(`  ✅ Analyst posted in ${((Date.now() - analystStart) / 1000).toFixed(1)}s`);
    console.log('');

    // Wait before Connector
    await countdown(DELAY_MS, 'Connector responds');
    console.log('');

    // Step 3: Connector finds partners
    console.log('┌─────────────────────────────────────┐');
    console.log('│  3/5  CONNECTOR - Partner Finder    │');
    console.log('└─────────────────────────────────────┘');
    console.log('');

    const connectorStart = Date.now();
    await connector.findPartners(opportunityId);
    console.log(`  ✅ Connector posted in ${((Date.now() - connectorStart) / 1000).toFixed(1)}s`);
    console.log('');

    // Wait before Strategist
    await countdown(DELAY_MS, 'Strategist responds');
    console.log('');

    // Step 4: Strategist synthesizes
    console.log('┌─────────────────────────────────────┐');
    console.log('│  4/5  STRATEGIST - Capture Lead     │');
    console.log('└─────────────────────────────────────┘');
    console.log('');

    const strategistStart = Date.now();
    await strategist.synthesizeOpportunity(opportunityId);
    console.log(`  ✅ Strategist posted in ${((Date.now() - strategistStart) / 1000).toFixed(1)}s`);
    console.log('');

    // Wait before PM
    await countdown(DELAY_MS, 'PM wraps up');
    console.log('');

    // Step 5: PM summarizes and runs standup
    console.log('┌─────────────────────────────────────┐');
    console.log('│  5/5  PM - Project Manager          │');
    console.log('└─────────────────────────────────────┘');
    console.log('');

    const pmStart = Date.now();
    await pm.runMorningStandup();
    console.log(`  ✅ PM posted in ${((Date.now() - pmStart) / 1000).toFixed(1)}s`);
    console.log('');

    // Done!
    const totalElapsed = (Date.now() - totalStart) / 1000;
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ✅ Full pipeline complete in ${formatTime(totalElapsed * 1000)}`);
    console.log('');
    console.log('  Check Slack - Patricia wrapped it up for @Lapedra!');
    console.log('══════════════════════════════════════════════════════════');
    console.log('');
  } catch (error) {
    console.error('\n❌ Pipeline failed:', error);
    process.exit(1);
  }
}

main();
