import 'dotenv/config';
import { getSupabase } from './integrations/supabase.js';

async function main() {
  const supabase = getSupabase();

  // Count total
  const { count } = await supabase
    .from('opportunities')
    .select('*', { count: 'exact', head: true });

  console.log(`Total opportunities in database: ${count}\n`);

  // Top 10 by score
  const { data, error } = await supabase
    .from('opportunities')
    .select('title, agency, fit_score, fit_reasoning, type')
    .order('fit_score', { ascending: false })
    .limit(10);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('Top 10 by fit score:\n');
  for (const opp of data || []) {
    console.log(`[${opp.fit_score}] ${opp.title.substring(0, 55)}...`);
    console.log(`    ${opp.type} | ${opp.agency || 'Unknown'} | ${opp.fit_reasoning}\n`);
  }
}

main();
