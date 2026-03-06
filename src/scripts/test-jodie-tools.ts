/**
 * Test Jodie's proposal tools
 *
 * Verifies that proposal snippets and case studies are accessible.
 */
import 'dotenv/config';
import { getToolsForAgent, getToolDefinitionsForAgent } from '../tools/index.js';
import {
  searchProposalSnippetsTool,
  getCaseStudyDetailsTool,
} from '../tools/definitions/proposal.tools.js';

async function testJodieTools() {
  console.log('JODIE TOOLS TEST');
  console.log('='.repeat(60));

  // 1. Check tool registration
  console.log('\n1. TOOL REGISTRATION CHECK:');
  const jodieTools = getToolsForAgent('jodie');
  console.log(`   Tools registered for Jodie: ${jodieTools.length}`);
  jodieTools.forEach((t) => {
    console.log(`   - ${t.definition.name}`);
  });

  const toolDefs = getToolDefinitionsForAgent('jodie');
  console.log(`   Tool definitions: ${toolDefs.length}`);

  // 2. Test search_proposal_snippets
  console.log('\n2. TEST: search_proposal_snippets');
  console.log('-'.repeat(40));

  interface SnippetData {
    snippets: Array<{
      title: string;
      type: string;
      wordCount: number;
      audience: string;
      tags: string[];
    }>;
    count: number;
  }

  interface CaseStudyData {
    caseStudies: Array<{ title: string; client: string; agency: string }>;
    count: number;
  }

  // Test without filters
  console.log('   a) No filters (first 5 snippets):');
  const result1 = await searchProposalSnippetsTool.execute({});
  if (result1.success && result1.data) {
    const data = result1.data as SnippetData;
    console.log(`      Found ${data.count} snippets`);
    data.snippets.forEach((s) => {
      console.log(`      - ${s.title} (${s.type}, ${s.wordCount} words)`);
    });
  } else {
    console.log(`      ERROR: ${result1.error}`);
  }

  // Test with snippet_type filter
  console.log('\n   b) Filter by type=past_performance:');
  const result2 = await searchProposalSnippetsTool.execute({
    snippet_type: 'past_performance',
    limit: 3,
  });
  if (result2.success && result2.data) {
    const data = result2.data as SnippetData;
    console.log(`      Found ${data.count} snippets`);
    data.snippets.forEach((s) => {
      console.log(`      - ${s.title} (audience: ${s.audience})`);
    });
  } else {
    console.log(`      ERROR: ${result2.error}`);
  }

  // Test with tags filter
  console.log('\n   c) Filter by tags=["VA"]:');
  const result3 = await searchProposalSnippetsTool.execute({
    tags: ['VA'],
    limit: 5,
  });
  if (result3.success && result3.data) {
    const data = result3.data as SnippetData;
    console.log(`      Found ${data.count} snippets`);
    data.snippets.forEach((s) => {
      console.log(`      - ${s.title} (tags: ${s.tags.join(', ')})`);
    });
  } else {
    console.log(`      ERROR: ${result3.error}`);
  }

  // 3. Test get_case_study_details
  console.log('\n3. TEST: get_case_study_details');
  console.log('-'.repeat(40));

  // Note: Case studies use full agency names like "Department of Veterans Affairs"
  const result4 = await getCaseStudyDetailsTool.execute({ agency: 'Veterans' });
  if (result4.success && result4.data) {
    const data = result4.data as CaseStudyData;
    console.log(`   Found ${data.count} case studies`);
    data.caseStudies.forEach((cs) => {
      console.log(`   - ${cs.title} (${cs.client}, ${cs.agency})`);
    });
  } else {
    console.log(`   ERROR: ${result4.error}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('JODIE TOOLS TEST COMPLETE');
}

testJodieTools().catch(console.error);
