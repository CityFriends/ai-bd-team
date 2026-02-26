/**
 * Load proposal snippets from markdown file into Supabase
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { getSupabase } from '../integrations/supabase.js';

interface Snippet {
  case_study_title: string;
  snippet_type: string;
  title: string;
  content: string;
  tags: string[];
  audience: string;
}

function parseSnippets(markdown: string): Snippet[] {
  const snippets: Snippet[] = [];

  // Split by "---" separator but ignore the header separators
  const blocks = markdown
    .split(/\n---\n/)
    .filter(
      (block) =>
        block.trim() &&
        !block.trim().startsWith('# Proposal Snippets') &&
        !block.trim().startsWith('## Supabase-ready')
    );

  for (const block of blocks) {
    // Skip section headers (lines starting with #)
    if (block.trim().startsWith('#') && !block.includes('Title:')) {
      continue;
    }

    // Parse fields
    const titleMatch = block.match(/Title:\s*(.+)/);
    const caseStudyMatch = block.match(/Case Study:\s*(.+)/);
    const typeMatch = block.match(/Type:\s*(.+)/);
    const tagsMatch = block.match(/Tags:\s*(.+)/);
    const audienceMatch = block.match(/Audience:\s*(.+)/);
    const contentMatch = block.match(/Content:\n([\s\S]+?)(?=\n---|\n\nTitle:|\n#|$)/);

    if (titleMatch && caseStudyMatch && typeMatch && contentMatch) {
      snippets.push({
        title: titleMatch[1].trim(),
        case_study_title: caseStudyMatch[1].trim(),
        snippet_type: typeMatch[1].trim(),
        tags: tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : [],
        audience: audienceMatch ? audienceMatch[1].trim() : 'general',
        content: contentMatch[1].trim(),
      });
    }
  }

  return snippets;
}

async function loadSnippets() {
  const supabase = getSupabase();

  console.log('Loading proposal snippets...\n');

  // Read the markdown file
  const markdown = readFileSync(
    '/Users/lapedratolson/Downloads/FFTC_All_Case_Study_Snippets_Supabase.md',
    'utf-8'
  );

  // Parse snippets
  const snippets = parseSnippets(markdown);
  console.log(`Parsed ${snippets.length} snippets\n`);

  // Get case study IDs
  const { data: caseStudies } = await supabase.from('case_studies').select('id, title');

  const caseStudyMap = new Map<string, string>();
  caseStudies?.forEach((cs) => caseStudyMap.set(cs.title, cs.id));

  // Clear existing snippets
  await supabase
    .from('proposal_snippets')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('Cleared existing snippets\n');

  // Insert snippets
  let inserted = 0;
  let errors = 0;

  for (const snippet of snippets) {
    const caseStudyId =
      snippet.case_study_title === 'General'
        ? null
        : caseStudyMap.get(snippet.case_study_title) || null;

    const record = {
      case_study_id: caseStudyId,
      snippet_type: snippet.snippet_type,
      title: snippet.title,
      content: snippet.content,
      word_count: snippet.content.split(/\s+/).length,
      tags: snippet.tags,
      audience: snippet.audience,
    };

    const { error } = await supabase.from('proposal_snippets').insert(record);

    if (error) {
      console.error(`Error inserting "${snippet.title}":`, error.message);
      errors++;
    } else {
      console.log(`  Added: ${snippet.title}`);
      inserted++;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`COMPLETE: ${inserted} snippets loaded, ${errors} errors`);
  console.log('='.repeat(60));

  // Show summary by type
  const { data: summary } = await supabase.from('proposal_snippets').select('snippet_type');

  const typeCounts: Record<string, number> = {};
  summary?.forEach((s) => {
    typeCounts[s.snippet_type] = (typeCounts[s.snippet_type] || 0) + 1;
  });

  console.log('\nBy type:');
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
}

loadSnippets().catch(console.error);
