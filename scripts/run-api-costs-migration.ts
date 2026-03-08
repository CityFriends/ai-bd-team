/**
 * Creates the api_costs table for cost tracking
 * Run: npx tsx scripts/run-api-costs-migration.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS api_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_costs_created_at ON api_costs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_costs_agent ON api_costs(agent) WHERE agent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_costs_purpose ON api_costs(purpose);
`;

async function run() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // Test if table exists by trying to query it
  const { error: testError } = await supabase.from('api_costs').select('id').limit(1);

  if (
    testError &&
    (testError.message.includes('does not exist') || testError.message.includes('schema cache'))
  ) {
    console.log('Table api_costs does not exist.');
    console.log('\nPlease run this SQL in the Supabase dashboard SQL editor:\n');
    console.log('```sql');
    console.log(CREATE_TABLE_SQL);
    console.log('```');
    process.exit(1);
  } else if (testError) {
    console.log('Error checking table:', testError.message);
    process.exit(1);
  } else {
    console.log('✓ Table api_costs exists and is ready');

    // Test insert
    const { error: insertError } = await supabase.from('api_costs').insert({
      purpose: 'other',
      model: 'test',
      model_tier: 'sonnet',
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    });

    if (insertError) {
      console.log('✗ Insert test failed:', insertError.message);
    } else {
      console.log('✓ Insert test passed');
    }
  }
}

run();
