import 'dotenv/config';
import { getSupabase } from './integrations/supabase.js';

async function main() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('agencies')
    .select('*')
    .eq('abbreviation', 'VA')
    .single();

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('VA Agency Research:\n');
  console.log('Tech Stack:', data.tech_stack);
  console.log('\nPain Points:', data.pain_points);
  console.log('\nResearch Notes:', data.research_notes);
  console.log('\nLast Researched:', data.last_researched);
}

main();
