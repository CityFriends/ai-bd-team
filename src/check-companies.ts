import 'dotenv/config';
import { getSupabase } from './integrations/supabase.js';

async function main() {
  const supabase = getSupabase();

  const { data, error, count } = await supabase
    .from('companies')
    .select('name, capabilities, certifications, relationship_status, source', { count: 'exact' });

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log(`Total companies in database: ${count}\n`);
  console.log('Partners:\n');

  for (const company of data || []) {
    console.log(`• ${company.name}`);
    if (company.capabilities) {
      console.log(`  Capabilities: ${company.capabilities}`);
    }
    if (company.certifications?.length) {
      console.log(`  Certs: ${company.certifications.join(', ')}`);
    }
    console.log(`  Status: ${company.relationship_status} | Source: ${company.source}`);
    console.log('');
  }
}

main();
