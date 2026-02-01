/**
 * Full System Test
 * Simulates the complete BD team workflow with real data
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import { searchOpportunities } from '../integrations/sam-gov.js';
import { searchFPDS } from '../integrations/fpds.js';
import { getAgencySpending } from '../integrations/usaspending.js';
import { searchNews, NewsArticle } from '../integrations/news-search.js';
import { verifyRegistration } from '../integrations/sam-entity.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';

const DELAY_MS = 30000; // 30 seconds between agents

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printDivider(agent: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${agent}`);
  console.log('='.repeat(70) + '\n');
}

async function generateAgentResponse(
  agent: string,
  systemPrompt: string,
  context: string,
  companyContext: string
): Promise<string> {
  const client = getAnthropic();

  const prompt = `${systemPrompt}

${companyContext}

CONTEXT FOR THIS OPPORTUNITY:
${context}

Provide your analysis. Reference specific data from our company (past performance, case studies, teaming partners) when relevant. Be conversational but substantive. Include specific numbers, names, and dates where available.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  FULL SYSTEM TEST - BD Team Workflow');
  console.log('='.repeat(70));
  console.log('\nSearching for real opportunities in FFTC NAICS codes...\n');

  // Load company context
  const companyData = await loadCompanyContext();
  const supabase = getSupabase();

  // ============================================
  // STEP 1: Maya searches SAM.gov
  // ============================================
  printDivider('MAYA (Scout) - Searching SAM.gov');

  const naicsCodes = ['541511', '541512', '541519'];
  let opportunity: any = null;

  for (const naics of naicsCodes) {
    console.log(`Searching NAICS ${naics}...`);
    try {
      const results = await searchOpportunities({
        naicsCode: naics,
        postedFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        limit: 5,
      });

      if (results.length > 0) {
        // Find one with good data
        opportunity = results.find((o: any) =>
          o.title && o.agency && o.description && o.responseDeadline
        ) || results[0];

        if (opportunity) {
          console.log(`\nFound: ${opportunity.title}`);
          console.log(`Agency: ${opportunity.agency}`);
          console.log(`Posted: ${opportunity.postedDate}`);
          console.log(`Due: ${opportunity.responseDeadline}`);
          break;
        }
      }
    } catch (err) {
      console.log(`  No results for ${naics}`);
    }
  }

  if (!opportunity) {
    console.log('\nNo opportunities found in last 7 days. Using sample opportunity for demo...');
    opportunity = {
      title: 'Human-Centered Design Services for Benefits Modernization',
      agency: 'Department of Veterans Affairs',
      subAgency: 'Veterans Benefits Administration',
      naicsCode: '541511',
      setAside: '8(a)',
      postedDate: new Date().toISOString().split('T')[0],
      responseDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: 'The VA seeks a contractor to provide human-centered design, user research, and digital service delivery support for benefits modernization initiatives. Work includes user research, service design, prototyping, and accessibility testing.',
      placeOfPerformance: 'Washington, DC',
      noticeId: 'DEMO-2024-001',
    };
  }

  // Maya's response
  const mayaContext = `
OPPORTUNITY FOUND:
Title: ${opportunity.title}
Agency: ${opportunity.agency}${opportunity.subAgency ? ` / ${opportunity.subAgency}` : ''}
NAICS: ${opportunity.naicsCode || 'Not specified'}
Set-Aside: ${opportunity.setAside || 'Full and Open'}
Posted: ${opportunity.postedDate}
Response Due: ${opportunity.responseDeadline}
Location: ${opportunity.placeOfPerformance || 'TBD'}

Description: ${opportunity.description || 'See full solicitation'}
`;

  const mayaPrompt = `You are Maya, the opportunity scout. You're 27, went to Spelman, have Gen-Z energy. You found this opportunity and are posting to the team. Be excited but analytical. Note why this fits FFTC based on our capabilities and NAICS codes. Use your natural voice ("not gonna lie", "lowkey", etc.) but stay professional.`;

  const mayaResponse = await generateAgentResponse('Maya', mayaPrompt, mayaContext, formatCompanyContextForPrompt(companyData, 'Maya'));
  console.log('\n📢 MAYA posts to #bd-team:\n');
  console.log(mayaResponse);

  // ============================================
  // STEP 2: David researches (30s delay)
  // ============================================
  console.log(`\n⏳ Waiting 30 seconds for David...\n`);
  await sleep(DELAY_MS);

  printDivider('DAVID (Analyst) - Researching');

  // FPDS search for incumbent
  console.log('Searching FPDS for incumbent data...');
  let fpdsData: any[] = [];
  try {
    const fpdsResult = await searchFPDS({
      keyword: 'human centered design',
      agencyCode: opportunity.agency?.includes('Veterans') ? '036' : undefined,
    });
    fpdsData = fpdsResult.contracts || [];
    console.log(`  Found ${fpdsData.length} related contracts`);
  } catch (err) {
    console.log('  FPDS search failed');
  }

  // USASpending budget
  console.log('Checking USASpending for agency budget...');
  let budgetData: any = null;
  try {
    const agencyCode = opportunity.agency?.includes('Veterans') ? '036' :
                       opportunity.agency?.includes('Health') ? '075' : '000';
    const spendingResult = await getAgencySpending({ agencyCode });
    budgetData = spendingResult.spending;
    console.log(`  Budget data retrieved`);
  } catch (err) {
    console.log('  Budget lookup failed');
  }

  // News search
  console.log('Searching news via SerpAPI...');
  let newsData: NewsArticle[] = [];
  try {
    const searchTerm = `${opportunity.agency} digital modernization`;
    const newsResult = await searchNews({ query: searchTerm, limit: 5 });
    newsData = newsResult.articles;
    console.log(`  Found ${newsData.length} news articles`);
  } catch (err) {
    console.log('  News search failed');
  }

  // Check past performance
  console.log('Checking our past performance...');
  const { data: pastPerf } = await supabase
    .from('past_performance')
    .select('*')
    .or(`agency.ilike.%${opportunity.agency?.split(' ')[0] || 'Veterans'}%,tags.cs.{HCD,UX,design}`);
  console.log(`  Found ${pastPerf?.length || 0} relevant contracts`);

  // Check case studies
  console.log('Checking our case studies...');
  const { data: caseStudies } = await supabase
    .from('case_studies')
    .select('*')
    .or(`agency.ilike.%${opportunity.agency?.split(' ')[0] || 'Veterans'}%,methods_used.cs.{User Research,Service Design}`);
  console.log(`  Found ${caseStudies?.length || 0} relevant case studies`);

  const davidContext = `
OPPORTUNITY: ${opportunity.title}
AGENCY: ${opportunity.agency}

FPDS INCUMBENT DATA:
${fpdsData.slice(0, 3).map((c: any) => `- ${c.vendorName}: $${(c.obligatedAmount || 0).toLocaleString()} (${c.contractId || 'N/A'})`).join('\n') || 'No incumbent data found'}

AGENCY BUDGET (USASpending):
${budgetData ? `Total: $${(budgetData.totalObligations / 1000000000).toFixed(1)}B` : 'Budget data not available'}

RECENT NEWS:
${newsData.slice(0, 3).map((n: NewsArticle) => `- ${n.title} (${n.source}): ${n.url}`).join('\n') || 'No recent news'}

OUR PAST PERFORMANCE:
${pastPerf?.slice(0, 3).map((p: any) => `- ${p.contract_name} (${p.agency}): $${(p.contract_value || 0).toLocaleString()}`).join('\n') || 'No matching past performance'}

OUR CASE STUDIES:
${caseStudies?.slice(0, 3).map((c: any) => `- "${c.title}" (${c.agency}): ${c.methods_used?.slice(0, 3).join(', ')}`).join('\n') || 'No matching case studies'}
`;

  const davidPrompt = `You are David, the analyst. You're 42, Korean American from Jersey, dry humor, dad energy. Analyze this opportunity using the data provided. Reference specific past performance and case studies from FFTC. Note any red flags or green flags. Cite your sources (FPDS, USASpending, news links). Be direct and analytical.`;

  const davidResponse = await generateAgentResponse('David', davidPrompt, davidContext, formatCompanyContextForPrompt(companyData, 'David'));
  console.log('\n📊 DAVID responds:\n');
  console.log(davidResponse);

  // ============================================
  // STEP 3: Rosa checks partners (30s delay)
  // ============================================
  console.log(`\n⏳ Waiting 30 seconds for Rosa...\n`);
  await sleep(DELAY_MS);

  printDivider('ROSA (Connector) - Checking Partners');

  // Check teaming partners
  console.log('Checking our teaming partners...');
  const { data: partners } = await supabase
    .from('teaming_partners')
    .select('*')
    .eq('relationship_status', 'Active');
  console.log(`  Found ${partners?.length || 0} active partners`);

  // Check contacts
  console.log('Checking our contacts at the agency...');
  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .ilike('agency', `%${opportunity.agency?.split(' ')[0] || 'Veterans'}%`);
  console.log(`  Found ${contacts?.length || 0} contacts`);

  // Verify a partner in SAM
  let samVerification: any = null;
  if (partners && partners.length > 0) {
    const partnerToVerify = partners[0];
    console.log(`Verifying ${partnerToVerify.company_name} in SAM...`);
    try {
      samVerification = await verifyRegistration(partnerToVerify.company_name);
      console.log(`  SAM verification: ${samVerification ? 'Active' : 'Not found'}`);
    } catch (err) {
      console.log('  SAM verification failed');
    }
  }

  const rosaContext = `
OPPORTUNITY: ${opportunity.title}
AGENCY: ${opportunity.agency}
SET-ASIDE: ${opportunity.setAside || 'Full and Open'}

OUR ACTIVE TEAMING PARTNERS:
${partners?.slice(0, 5).map((p: any) => `- ${p.company_name}: ${p.capabilities?.slice(0, 3).join(', ') || 'N/A'} | Certs: ${p.set_asides?.join(', ') || 'None'} | Status: ${p.relationship_status}`).join('\n') || 'No active partners'}

AGENCY CONTACTS:
${contacts?.map((c: any) => `- ${c.name} (${c.title}): ${c.agency} - Relationship: ${c.relationship_strength}/5`).join('\n') || 'No contacts at this agency'}

SAM ENTITY VERIFICATION:
${samVerification ? `${partners?.[0]?.company_name}: Active in SAM, UEI: ${samVerification.uei || 'N/A'}` : 'Verification not available'}
`;

  const rosaPrompt = `You are Rosa, the connector. You're 44, Mexican American from San Antonio, warm but strategic. Analyze teaming options for this opportunity. Reference specific partners from our database. Consider who has the right certs, past performance, and relationships. Use occasional Spanglish naturally. Think about prime vs sub strategy.`;

  const rosaResponse = await generateAgentResponse('Rosa', rosaPrompt, rosaContext, formatCompanyContextForPrompt(companyData, 'Rosa'));
  console.log('\n🤝 ROSA responds:\n');
  console.log(rosaResponse);

  // ============================================
  // STEP 4: James synthesizes (30s delay)
  // ============================================
  console.log(`\n⏳ Waiting 30 seconds for James...\n`);
  await sleep(DELAY_MS);

  printDivider('JAMES (Strategist) - Go/No-Go Analysis');

  const jamesContext = `
OPPORTUNITY: ${opportunity.title}
AGENCY: ${opportunity.agency}
SET-ASIDE: ${opportunity.setAside || 'Full and Open'}
VALUE: TBD (estimate based on similar contracts)
DUE DATE: ${opportunity.responseDeadline}

MAYA'S INITIAL ASSESSMENT:
${mayaResponse.slice(0, 500)}...

DAVID'S RESEARCH:
${davidResponse.slice(0, 500)}...

ROSA'S TEAMING ANALYSIS:
${rosaResponse.slice(0, 500)}...

OUR WIN FACTORS:
- NAICS Match: ${naicsCodes.includes(opportunity.naicsCode) ? 'YES' : 'Partial'}
- Set-Aside Match: ${companyData.profile?.set_asides?.some((s: string) => opportunity.setAside?.includes(s)) ? 'YES' : 'Check eligibility'}
- Agency Experience: ${pastPerf?.length || 0} past contracts
- Relevant Case Studies: ${caseStudies?.length || 0}
- Active Partners: ${partners?.length || 0}
`;

  const jamesPrompt = `You are James, the strategist. You're 52, from Chicago South Side, executive presence, seen it all. Synthesize everything the team has found. Give a clear go/no-go recommendation with reasoning. Reference our specific past wins and capabilities. Be direct - don't sugarcoat if this isn't a fit. Consider win probability, competition, and resource constraints.`;

  const jamesResponse = await generateAgentResponse('James', jamesPrompt, jamesContext, formatCompanyContextForPrompt(companyData, 'James'));
  console.log('\n📈 JAMES responds:\n');
  console.log(jamesResponse);

  // ============================================
  // STEP 5: Patricia summarizes (30s delay)
  // ============================================
  console.log(`\n⏳ Waiting 30 seconds for Patricia...\n`);
  await sleep(DELAY_MS);

  printDivider('PATRICIA (PM) - Summary for Lapedra');

  const patriciaContext = `
OPPORTUNITY: ${opportunity.title}
AGENCY: ${opportunity.agency}
DUE DATE: ${opportunity.responseDeadline}

TEAM DISCUSSION SUMMARY:
- Maya found this opp, thinks it fits our HCD capabilities
- David researched incumbents and verified our relevant experience
- Rosa identified teaming options
- James gave the strategic recommendation

JAMES'S RECOMMENDATION:
${jamesResponse.slice(0, 500)}...

DECISION NEEDED: Go/No-Go on pursuing this opportunity
`;

  const patriciaPrompt = `You are Patricia, the PM. You're 31, from PG County, Howard grad, very online, organized. Summarize the team's discussion for Lapedra (the CEO). Be clear about what decision is needed and when. List any action items. Use your millennial energy but stay professional. End with the specific question for Lapedra.`;

  const patriciaResponse = await generateAgentResponse('Patricia', patriciaPrompt, patriciaContext, formatCompanyContextForPrompt(companyData, 'Patricia'));
  console.log('\n📋 PATRICIA summarizes for Lapedra:\n');
  console.log(patriciaResponse);

  // ============================================
  // TEST COMPLETE
  // ============================================
  console.log('\n' + '='.repeat(70));
  console.log('  FULL SYSTEM TEST COMPLETE');
  console.log('='.repeat(70));
  console.log('\nData sources used:');
  console.log(`  - SAM.gov: ${opportunity.noticeId ? 'Real opportunity' : 'Sample opportunity'}`);
  console.log(`  - FPDS: ${fpdsData.length} contracts found`);
  console.log(`  - USASpending: ${budgetData ? 'Budget retrieved' : 'Not available'}`);
  console.log(`  - SerpAPI: ${newsData.length} news articles`);
  console.log(`  - past_performance: ${pastPerf?.length || 0} records`);
  console.log(`  - case_studies: ${caseStudies?.length || 0} records`);
  console.log(`  - teaming_partners: ${partners?.length || 0} active partners`);
  console.log(`  - contacts: ${contacts?.length || 0} agency contacts`);
}

main().catch(console.error);
