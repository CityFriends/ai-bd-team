import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

async function check() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('case_studies').select('title, agency, client');

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }

  console.log('CASE STUDIES (' + data?.length + '):');
  data?.forEach((cs) => console.log('  -', cs.title, '|', cs.agency, '|', cs.client));
}

check();
