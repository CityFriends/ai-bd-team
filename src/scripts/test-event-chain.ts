/**
 * Test Event Chain - Manually trigger the event chain to debug
 *
 * This publishes a test NEW_OPPORTUNITY event to trigger David's handler
 * and see where the chain breaks.
 */
import 'dotenv/config';
import { publishEvent, EventTypes } from '../events/index.js';
import type { NewOpportunityPayload } from '../events/eventTypes.js';

async function main() {
  console.log('='.repeat(60));
  console.log('  TEST: Publishing NEW_OPPORTUNITY Event');
  console.log('='.repeat(60));

  // Create a test payload that mimics what Maya would send
  const testPayload: NewOpportunityPayload = {
    noticeId: 'TEST-' + Date.now(),
    title: 'TEST: Software Development Services for Testing Event Chain',
    agency: 'Department of Testing',
    value: 500000,
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
    naics: '541512',
    setAside: '8(a)',
    url: 'https://sam.gov/test-opportunity',
    score: 75,
    scoreBreakdown: {
      keywordMatch: 30,
      agencyFit: 20,
      setAsideFit: 20,
      valueFit: 5,
    },
    source: 'manual',
  };

  console.log('\nPayload to publish:');
  console.log(JSON.stringify(testPayload, null, 2));

  console.log('\n--- Publishing NEW_OPPORTUNITY event ---\n');

  const result = await publishEvent({
    eventType: EventTypes.NEW_OPPORTUNITY,
    sourceAgent: 'maya',
    payload: testPayload as unknown as Record<string, unknown>,
    priority: 3,
  });

  console.log('\n--- Publish Result ---');
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    console.log(`\n✓ Event published successfully with ID: ${result.eventId}`);
    console.log('\nNow run the event processors to see David claim and process this event:');
    console.log('  npx tsx src/live/run-team.ts');
    console.log('\nOr check Railway logs if running in production.');
  } else {
    console.log(`\n✗ Failed to publish event: ${result.error}`);
  }

  // Wait a moment for logs to flush
  await new Promise((r) => setTimeout(r, 1000));
}

main().catch(console.error);
