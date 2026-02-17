/**
 * Test Notion Hub
 *
 * Creates a test opportunity and shows it flowing through the pipeline.
 *
 * Usage:
 *   npm run notion:test
 */
import 'dotenv/config';
import * as fs from 'fs';
import {
  addOpportunityToNotion,
  updateOpportunityInNotion,
  logActivityToNotion,
  NotionHubIds,
} from '../integrations/notion-hub.js';

function loadHubIds(): NotionHubIds | null {
  try {
    const data = fs.readFileSync('notion-hub-ids.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    console.error('Hub IDs not found. Run: npm run notion:setup <parent-page-id>');
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const hubIds = loadHubIds();
  if (!hubIds) {
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('  Testing AI BD Team Notion Hub');
  console.log('='.repeat(60));

  // Step 1: Maya finds an opportunity
  console.log('\n1. Maya finds a test opportunity...');
  const opportunityId = await addOpportunityToNotion(hubIds.opportunitiesDbId, {
    name: '[TEST] VA Digital Services Modernization',
    status: 'New',
    fitScore: 85,
    strategicFit: true,
    agency: 'VA',
    subAgency: 'Office of Information and Technology',
    valueLow: 5000000,
    valueHigh: 10000000,
    dueDate: '2026-03-15',
    postedDate: new Date().toISOString().split('T')[0],
    naics: '541511',
    setAside: '8(a)',
    type: 'RFP',
    samLink: 'https://sam.gov/opp/test123/view',
    mayasTake:
      'This looks solid - HCD focus, reasonable timeline, and we have VA experience. Score: 85/100. Worth a deeper look.',
  });

  await logActivityToNotion(hubIds.activityLogDbId, {
    agent: 'Maya',
    actionType: 'Found Opportunity',
    summary: 'Found VA Digital Services Modernization - looks like a good fit',
    opportunityId,
  });

  console.log(`   ✓ Created opportunity: ${opportunityId}`);
  await sleep(2000);

  // Step 2: David analyzes
  console.log('\n2. David analyzes the opportunity...');
  await updateOpportunityInNotion(opportunityId, {
    status: 'Researching',
    davidsAnalysis:
      'Incumbent is Booz Allen on a $7M contract expiring this year. VA IT spending up 12% YoY. No protests on similar contracts. Risk assessment: MEDIUM - established incumbent but signs of customer dissatisfaction in recent award reviews.',
    incumbent: 'Booz Allen Hamilton',
    competitors: 'Deloitte, SAIC, possibly Fearless',
  });

  await logActivityToNotion(hubIds.activityLogDbId, {
    agent: 'David',
    actionType: 'Analyzed',
    summary: 'Completed incumbent research - Booz Allen incumbent, medium risk',
    opportunityId,
  });

  console.log('   ✓ David added analysis');
  await sleep(2000);

  // Step 3: Rosa recommends partners
  console.log('\n3. Rosa recommends teaming partners...');
  await updateOpportunityInNotion(opportunityId, {
    rosasPartners:
      'Recommend teaming with CivicActions (strong VA past performance, Agile expertise) or Ad Hoc (USDS alumni, similar work). Both have warm relationships - I can make intros.',
  });

  await logActivityToNotion(hubIds.activityLogDbId, {
    agent: 'Rosa',
    actionType: 'Recommended Partner',
    summary: 'Suggested CivicActions or Ad Hoc as teaming partners',
    opportunityId,
  });

  console.log('   ✓ Rosa added partner recommendations');
  await sleep(2000);

  // Step 4: James makes recommendation
  console.log('\n4. James makes go/no-go recommendation...');
  await updateOpportunityInNotion(opportunityId, {
    jamesRecommendation:
      'RECOMMEND GO. Strong fit with our capabilities, good teaming options, and strategic value for VA past performance. Win probability: 35-40% as sub, 20-25% as prime. Suggest pursuing as sub to CivicActions initially.',
    decision: 'Pending',
  });

  await logActivityToNotion(hubIds.activityLogDbId, {
    agent: 'James',
    actionType: 'Made Recommendation',
    summary: 'Recommends GO - pursue as sub to CivicActions',
    opportunityId,
  });

  console.log('   ✓ James added recommendation');
  await sleep(2000);

  // Step 5: Patricia marks for decision
  console.log('\n5. Patricia marks opportunity for decision...');
  await logActivityToNotion(hubIds.activityLogDbId, {
    agent: 'Patricia',
    actionType: 'Decision Requested',
    summary: 'All analysis complete - awaiting Go/No-Go decision from Lapedra',
    opportunityId,
  });

  console.log('   ✓ Patricia logged decision request');

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Test Complete!');
  console.log('='.repeat(60));

  console.log(`
Test opportunity created and processed through the pipeline.

Open Notion to see:
1. The new opportunity in the Pipeline Board
2. Activity log entries from each agent
3. Status progression from New → Researching

To complete the test:
1. Open the opportunity in Notion
2. Change "Decision" from "Pending" to "Go" or "No-Go"
3. Run 'npm run notion:sync' to sync the decision back to Supabase

The test opportunity has [TEST] in the name - you can delete it when done.
`);
}

main().catch(console.error);
