#!/usr/bin/env npx tsx
// Full team cycle with real data and real sources
import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { searchOpportunities, extractAgencyAbbreviation, mapOpportunityType } from '../integrations/sam-gov.js';
import { findIncumbent, getVendorHistory, searchFPDS } from '../integrations/fpds.js';
import { getAgencySpending, getAgencyTrend } from '../integrations/usaspending.js';
import { searchNews, getAgencyNews } from '../integrations/news-search.js';
import { verifyRegistration } from '../integrations/sam-entity.js';
import { getAnthropic } from '../integrations/claude.js';
import type { SAMOpportunity } from '../types/index.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';
const DELAY_MS = 30000; // 30 seconds between agents

// Agent Slack clients
const agents = {
  maya: new WebClient(process.env.MAYA_BOT_TOKEN),
  david: new WebClient(process.env.DAVID_BOT_TOKEN),
  rosa: new WebClient(process.env.ROSA_BOT_TOKEN),
  james: new WebClient(process.env.JAMES_BOT_TOKEN),
  patricia: new WebClient(process.env.PATRICIA_BOT_TOKEN),
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postMessage(agent: keyof typeof agents, text: string, threadTs?: string): Promise<string> {
  const result = await agents[agent].chat.postMessage({
    channel: CHANNEL_ID,
    text,
    thread_ts: threadTs,
  });
  return result.ts || '';
}

async function generateAgentResponse(agent: string, prompt: string): Promise<string> {
  const client = getAnthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Full Team Cycle - Real Data Demo');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // ============================================
  // STEP 1: Maya searches SAM.gov
  // ============================================
  console.log('Step 1: Maya searching SAM.gov...');

  // Search with our NAICS codes (default in searchOpportunities)
  const searchResult = await searchOpportunities({
    postedFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
    postedTo: new Date(),
    limit: 20,
  });

  let opportunities = searchResult.opportunitiesData || [];
  console.log(`  Found ${opportunities.length} opportunities`);

  if (opportunities.length === 0) {
    console.log('  Trying broader search (14 days)...');
    const broaderResult = await searchOpportunities({
      postedFrom: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      postedTo: new Date(),
      limit: 20,
    });
    opportunities = broaderResult.opportunitiesData || [];
    console.log(`  Found ${opportunities.length} opportunities`);
  }

  if (opportunities.length === 0) {
    console.log('❌ No opportunities found. Exiting.');
    return;
  }

  // Pick the best opportunity (first one for now)
  const opp: SAMOpportunity = opportunities[0];
  const agencyName = opp.department || opp.subTier || 'Unknown Agency';
  console.log(`Found: ${opp.title}`);
  console.log(`Agency: ${agencyName}`);

  // Maya posts the opportunity
  const mayaPrompt = `You are Maya, the opportunity scout. You just found this opportunity on SAM.gov:

Title: ${opp.title}
Agency: ${agencyName}
Type: ${mapOpportunityType(opp.type)}
Posted: ${opp.postedDate}
Due: ${opp.responseDeadLine || 'Not specified'}
NAICS: ${opp.naicsCode || 'Not specified'}
Set-aside: ${opp.setAsideDescription || opp.setAside || 'None'}

Description: ${opp.description?.substring(0, 500) || 'No description'}

Write a short Slack message (4-6 lines) announcing this opportunity to the team. Be excited but grounded. Cite that it's from SAM.gov. Ask David to dig into the agency.`;

  const mayaMessage = await generateAgentResponse('Maya', mayaPrompt);
  const threadTs = await postMessage('maya', mayaMessage);
  console.log('✅ Maya posted');

  await sleep(DELAY_MS);

  // ============================================
  // STEP 2: David does full research
  // ============================================
  console.log('Step 2: David researching...');

  // Get FPDS data
  console.log('  - Pulling FPDS incumbent data...');
  const incumbentData = await findIncumbent({
    agencyName: agencyName,
    keywords: opp.title?.split(' ').slice(0, 3) || [],
  });

  // Get USASpending data
  console.log('  - Checking USASpending...');
  const agencySpending = await getAgencySpending({ agencyName: agencyName });
  const agencyTrend = await getAgencyTrend({ agencyName: agencyName, years: 2 });

  // Get news
  console.log('  - Searching news...');
  const newsResults = await getAgencyNews(agencyName);

  const davidPrompt = `You are David, the analyst. Maya found an opportunity and you've done research. Here's what you found:

OPPORTUNITY:
Title: ${opp.title}
Agency: ${agencyName}
Due: ${opp.responseDeadLine || 'Not specified'}

FPDS INCUMBENT DATA:
${incumbentData.incumbent ? `Likely incumbent: ${incumbentData.incumbent}` : 'Could not identify incumbent'}
${incumbentData.contractValue ? `Contract value: $${(incumbentData.contractValue / 1000000).toFixed(1)}M` : ''}
Confidence: ${incumbentData.confidence}
Source: ${incumbentData.source}

USASPENDING DATA:
${agencySpending.spending ? `Agency FY${agencySpending.spending.fiscalYear} obligations: $${(agencySpending.spending.totalObligations / 1000000000).toFixed(1)}B` : 'Could not pull spending data'}
${agencyTrend.percentChange !== null ? `Trend: ${agencyTrend.percentChange >= 0 ? '+' : ''}${agencyTrend.percentChange}% year-over-year` : ''}
Source: ${agencySpending.source}

NEWS:
${newsResults.recentNews.length > 0 ? newsResults.recentNews.slice(0, 2).map(n => `- ${n.title}`).join('\n') : 'No recent news found'}
${newsResults.leadershipChanges.length > 0 ? `Leadership: ${newsResults.leadershipChanges[0].title}` : ''}
Source: ${newsResults.source}

Write a Slack message (5-8 lines) with your analysis. Cite your sources (FPDS, USASpending, news). Be honest about what you don't know. Tag @Rosa if partners might help.`;

  const davidMessage = await generateAgentResponse('David', davidPrompt);
  await postMessage('david', davidMessage, threadTs);
  console.log('✅ David posted');

  await sleep(DELAY_MS);

  // ============================================
  // STEP 3: Rosa checks partners
  // ============================================
  console.log('Step 3: Rosa checking partners...');

  // Pick a potential partner to verify (if incumbent found, check them)
  let partnerVerification = null;
  let partnerName = incumbentData.incumbent || 'Skylight'; // Default to Skylight as example

  console.log(`  - Verifying ${partnerName} in SAM...`);
  partnerVerification = await verifyRegistration(partnerName);

  const rosaPrompt = `You are Rosa, the partner researcher. The team is looking at an opportunity and you've done partner research.

OPPORTUNITY:
Title: ${opp.title}
Agency: ${agencyName}
Set-aside: ${opp.setAsideDescription || opp.setAside || 'None'}

PARTNER VERIFICATION (${partnerName}):
${partnerVerification.isRegistered ? `✓ Registered in SAM.gov` : `✗ Not found in SAM.gov`}
${partnerVerification.isActive ? `✓ Active registration` : ''}
${partnerVerification.certifications.length > 0 ? `Certifications: ${partnerVerification.certifications.join(', ')}` : 'No special certifications'}
${partnerVerification.expirationWarning || ''}
Source: ${partnerVerification.source}

Write a Slack message (4-6 lines) about teaming options. Be honest that you RESEARCHED this - you don't personally know anyone. Mention what you found in SAM. Tag @James for strategic input.`;

  const rosaMessage = await generateAgentResponse('Rosa', rosaPrompt);
  await postMessage('rosa', rosaMessage, threadTs);
  console.log('✅ Rosa posted');

  await sleep(DELAY_MS);

  // ============================================
  // STEP 4: James strategic assessment
  // ============================================
  console.log('Step 4: James synthesizing...');

  const jamesPrompt = `You are James, the capture strategist. The team has researched an opportunity. Here's the summary:

OPPORTUNITY:
Title: ${opp.title}
Agency: ${agencyName}
Due: ${opp.responseDeadLine || 'Not specified'}
Set-aside: ${opp.setAsideDescription || opp.setAside || 'None'}

WHAT WE FOUND:
- Incumbent: ${incumbentData.incumbent || 'Unknown'} (${incumbentData.confidence} confidence)
- Agency budget trend: ${agencyTrend.percentChange !== null ? `${agencyTrend.percentChange >= 0 ? '+' : ''}${agencyTrend.percentChange}%` : 'Unknown'}
- Partner options: ${partnerVerification?.isRegistered ? 'Verified options available' : 'Need more research'}
- News: ${newsResults.recentNews.length > 0 ? 'Some recent activity' : 'Quiet'}

Write a Slack message (5-7 lines) with your strategic assessment. Make a preliminary go/no-go recommendation. Be decisive but honest about risks. Base it on what the team actually found - don't make up data.`;

  const jamesMessage = await generateAgentResponse('James', jamesPrompt);
  await postMessage('james', jamesMessage, threadTs);
  console.log('✅ James posted');

  await sleep(DELAY_MS);

  // ============================================
  // STEP 5: Patricia wrap-up
  // ============================================
  console.log('Step 5: Patricia wrapping up...');

  const patriciaPrompt = `You are Patricia, the PM. The team just analyzed an opportunity.

WHAT HAPPENED:
1. Maya found the opportunity on SAM.gov
2. David researched incumbent (${incumbentData.incumbent || 'unknown'}), agency budget, and news
3. Rosa checked partner options in SAM
4. James gave a preliminary recommendation

Write a Slack message (4-6 lines) wrapping up:
- Summarize the key decision point for Lapedra
- List 1-2 open questions that need answers
- Ask if Lapedra wants to pursue or pass

Be concise and action-oriented.`;

  const patriciaMessage = await generateAgentResponse('Patricia', patriciaPrompt);
  await postMessage('patricia', patriciaMessage, threadTs);
  console.log('✅ Patricia posted');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Full cycle complete! Check #ai-bd-team');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

main().catch(console.error);
