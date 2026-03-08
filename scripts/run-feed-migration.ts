/**
 * Run the agent feed migration directly via Supabase
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'public' },
  auth: { persistSession: false },
});

async function runMigration() {
  console.log('Reading migration file...');
  const sql = readFileSync('supabase/migrations/20260308_agent_feed.sql', 'utf-8');

  // Split into individual statements
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  console.log(`Found ${statements.length} statements to execute`);

  // Execute statements via the REST API using rpc
  // Unfortunately Supabase doesn't expose raw SQL execution via REST
  // We'll need to check if tables exist first

  // Check if tables already exist
  const { data: tables } = await supabase
    .from('information_schema.tables' as any)
    .select('table_name')
    .eq('table_schema', 'public')
    .in('table_name', ['agent_feed_posts', 'agent_feed_reactions']);

  if (tables && tables.length > 0) {
    console.log(
      'Tables already exist:',
      tables.map((t: any) => t.table_name)
    );
    console.log('Migration may already be applied. Checking...');

    // Try to select from the table
    const { error } = await supabase.from('agent_feed_posts').select('id').limit(1);
    if (!error) {
      console.log('agent_feed_posts table is accessible!');
      console.log('Migration appears to be already applied.');
      return;
    }
  }

  console.log('\nTo apply this migration, run the following in the Supabase SQL Editor:');
  console.log('https://supabase.com/dashboard/project/bvgtfadggtgnakrxvuim/sql');
  console.log('\n' + '='.repeat(60) + '\n');
  console.log(sql);
  console.log('\n' + '='.repeat(60) + '\n');
}

runMigration().catch(console.error);
