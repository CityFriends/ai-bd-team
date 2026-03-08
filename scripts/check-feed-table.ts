import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  console.log('Checking if agent_feed_posts table exists...');
  const { data, error } = await supabase.from('agent_feed_posts').select('id').limit(1);

  if (error) {
    console.log('Table does not exist or error:', error.message);
    console.log('\nPlease run the migration manually in the Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/bvgtfadggtgnakrxvuim/sql/new');
    console.log('\nPaste the contents of: supabase/migrations/20260308_agent_feed.sql');
  } else {
    console.log('Table exists! Data:', data);
    console.log('\nMigration is already applied.');
  }
}

main().catch(console.error);
