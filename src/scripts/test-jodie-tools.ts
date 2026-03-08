/**
 * Test Jodie's proposal tools
 *
 * Verifies that proposal snippets, case studies, Notion tools,
 * and writing guide are accessible.
 */
import 'dotenv/config';
import { getToolsForAgent, getToolDefinitionsForAgent } from '../tools/index.js';
import {
  searchProposalSnippetsTool,
  getCaseStudyDetailsTool,
  getProposalWritingGuideTool,
} from '../tools/definitions/proposal.tools.js';
import {
  searchNotionCaseStudiesTool,
  getNotionCaseStudyContentTool,
  searchNotionOpportunitiesTool,
  writeOpportunityContentTool,
} from '../tools/definitions/notion.tools.js';

// Flag to control whether we actually write to Notion
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--write');

async function testJodieTools() {
  console.log('JODIE TOOLS TEST');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write to Notion)'}`);

  // 1. Check tool registration
  console.log('\n1. TOOL REGISTRATION CHECK:');
  const jodieTools = getToolsForAgent('jodie');
  console.log(`   Tools registered for Jodie: ${jodieTools.length}`);
  jodieTools.forEach((t) => {
    console.log(`   - ${t.definition.name}`);
  });

  const toolDefs = getToolDefinitionsForAgent('jodie');
  console.log(`   Tool definitions: ${toolDefs.length}`);

  // 2. Test Writing Guide
  console.log('\n2. TEST: get_proposal_writing_guide');
  console.log('-'.repeat(40));

  const guideResult = await getProposalWritingGuideTool.execute({ section: 'voice' });
  if (guideResult.success && guideResult.data) {
    const data = guideResult.data as { section: string; content: string };
    console.log(`   Section: ${data.section}`);
    console.log(`   Content length: ${data.content.length} chars`);
    console.log(`   Preview: ${data.content.slice(0, 200)}...`);
  } else {
    console.log(`   ERROR: ${guideResult.error}`);
  }

  // Test "avoid" section (banned words)
  const avoidResult = await getProposalWritingGuideTool.execute({ section: 'avoid' });
  if (avoidResult.success && avoidResult.data) {
    const data = avoidResult.data as { section: string; content: string };
    console.log(`\n   Banned words section loaded: ${data.content.length} chars`);
  }

  // 3. Test Notion Case Studies Search
  console.log('\n3. TEST: search_notion_case_studies');
  console.log('-'.repeat(40));

  interface NotionCaseStudy {
    id: string;
    projectName: string;
    tags: string[];
    roles: string[];
    eligibility: string;
  }

  // Search by accessibility tag
  console.log('   a) Search by tag "Accessibility":');
  const notionResult1 = await searchNotionCaseStudiesTool.execute({
    tags: ['Accessibility'],
    limit: 5,
  });
  if (notionResult1.success && notionResult1.data) {
    const data = notionResult1.data as { caseStudies: NotionCaseStudy[]; count: number };
    console.log(`      Found ${data.count} case studies`);
    data.caseStudies.forEach((cs) => {
      console.log(`      - ${cs.projectName}`);
      console.log(
        `        Tags: ${cs.tags.slice(0, 5).join(', ')}${cs.tags.length > 5 ? '...' : ''}`
      );
      console.log(`        Roles: ${cs.roles.join(', ')}`);
    });
  } else {
    console.log(`      ERROR: ${notionResult1.error}`);
  }

  // Search by role
  console.log('\n   b) Search by role "UXR":');
  const notionResult2 = await searchNotionCaseStudiesTool.execute({
    roles: ['UXR'],
    limit: 3,
  });
  if (notionResult2.success && notionResult2.data) {
    const data = notionResult2.data as { caseStudies: NotionCaseStudy[]; count: number };
    console.log(`      Found ${data.count} case studies`);
    data.caseStudies.forEach((cs) => {
      console.log(`      - ${cs.projectName} (${cs.eligibility})`);
    });
  } else {
    console.log(`      ERROR: ${notionResult2.error}`);
  }

  // 4. Test fetching case study content
  console.log('\n4. TEST: get_notion_case_study_content');
  console.log('-'.repeat(40));

  if (notionResult1.success && notionResult1.data) {
    const data = notionResult1.data as { caseStudies: NotionCaseStudy[]; count: number };
    if (data.caseStudies.length > 0) {
      const firstCaseStudy = data.caseStudies[0];
      console.log(`   Fetching content for: ${firstCaseStudy.projectName}`);

      const contentResult = await getNotionCaseStudyContentTool.execute({
        page_id: firstCaseStudy.id,
      });

      if (contentResult.success && contentResult.data) {
        const content = contentResult.data as {
          projectName: string;
          content: string;
          tags: string[];
        };
        console.log(`   Content length: ${content.content.length} chars`);
        if (content.content) {
          console.log(`   Preview:\n${content.content.slice(0, 500)}...`);
        } else {
          console.log('   (No page content - may be in sub-pages or linked case study)');
        }
      } else {
        console.log(`   ERROR: ${contentResult.error}`);
      }
    }
  }

  // 5. Test Notion Opportunities Search
  console.log('\n5. TEST: search_notion_opportunities');
  console.log('-'.repeat(40));

  interface NotionOpportunity {
    id: string;
    name: string;
    stage: string;
    solicitationType: string;
    proposalDueDate: string;
  }

  const oppResult = await searchNotionOpportunitiesTool.execute({
    stage: 'Under Review',
    limit: 5,
  });
  if (oppResult.success && oppResult.data) {
    const data = oppResult.data as { opportunities: NotionOpportunity[]; count: number };
    console.log(`   Found ${data.count} opportunities in "Under Review"`);
    data.opportunities.forEach((opp) => {
      console.log(`   - ${opp.name}`);
      console.log(`     Stage: ${opp.stage}, Type: ${opp.solicitationType || 'N/A'}`);
    });
  } else {
    console.log(`   ERROR: ${oppResult.error}`);
  }

  // 6. Test write (DRY RUN by default)
  console.log('\n6. TEST: write_opportunity_content');
  console.log('-'.repeat(40));

  if (DRY_RUN) {
    console.log('   SKIPPED (dry run mode - use --write flag to test actual writes)');
    console.log('   Example command: npx tsx src/scripts/test-jodie-tools.ts --write');
  } else if (oppResult.success && oppResult.data) {
    const data = oppResult.data as { opportunities: NotionOpportunity[]; count: number };
    if (data.opportunities.length > 0) {
      const testOpp = data.opportunities[0];
      console.log(`   Writing test content to: ${testOpp.name}`);

      const writeResult = await writeOpportunityContentTool.execute({
        opportunity_id: testOpp.id,
        section_header: "Jodie's Test Draft",
        content: `## Test Section

This is a test of Jodie's Notion writing capability.

### What We Did
• Tested the search_notion_case_studies tool
• Tested the get_notion_case_study_content tool
• Tested the write_opportunity_content tool

### Result
If you see this in Notion, the integration works.

---
*This test content can be safely deleted.*`,
      });

      if (writeResult.success && writeResult.data) {
        const result = writeResult.data as {
          pageName: string;
          pageUrl: string;
          blocksWritten: number;
        };
        console.log(`   SUCCESS: Wrote ${result.blocksWritten} blocks to "${result.pageName}"`);
        console.log(`   View at: ${result.pageUrl}`);
      } else {
        console.log(`   ERROR: ${writeResult.error}`);
      }
    }
  }

  // 7. Test Supabase tools (existing)
  console.log('\n7. TEST: Supabase proposal tools (existing)');
  console.log('-'.repeat(40));

  interface SnippetData {
    snippets: Array<{
      title: string;
      type: string;
      wordCount: number;
    }>;
    count: number;
  }

  const snippetResult = await searchProposalSnippetsTool.execute({ limit: 3 });
  if (snippetResult.success && snippetResult.data) {
    const data = snippetResult.data as SnippetData;
    console.log(`   Proposal snippets: ${data.count} found`);
    data.snippets.forEach((s) => {
      console.log(`   - ${s.title} (${s.type})`);
    });
  } else {
    console.log(`   Snippets: ${snippetResult.error || 'No data'}`);
  }

  interface CaseStudyData {
    caseStudies: Array<{ title: string; agency: string }>;
    count: number;
  }

  const caseResult = await getCaseStudyDetailsTool.execute({ agency: 'VA' });
  if (caseResult.success && caseResult.data) {
    const data = caseResult.data as CaseStudyData;
    console.log(`   Supabase case studies: ${data.count} found`);
  } else {
    console.log(`   Case studies: ${caseResult.error || 'No data'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('JODIE TOOLS TEST COMPLETE');
}

testJodieTools().catch(console.error);
