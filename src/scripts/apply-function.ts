/**
 * Apply the get_pending_events_for_agent function to Supabase
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/database/client.js';

const sql = `
CREATE OR REPLACE FUNCTION get_pending_events_for_agent(p_agent_name TEXT)
RETURNS SETOF agent_events AS $$
BEGIN
  RETURN QUERY
  SELECT e.*
  FROM agent_events e
  JOIN agent_subscriptions s ON s.event_type = e.event_type
  WHERE s.agent = p_agent_name
    AND s.enabled = true
    AND e.status = 'pending'
    AND (e.target_agent IS NULL OR e.target_agent = p_agent_name)
    AND e.source_agent != p_agent_name
  ORDER BY
    e.priority ASC,
    e.created_at ASC;
END;
$$ LANGUAGE plpgsql;
`;

async function main() {
  console.log('Applying get_pending_events_for_agent function...');

  const supabase = getSupabase();

  // Execute raw SQL - need to use the postgres schema
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    console.error('Error applying function via RPC:', error);
    // Try direct approach - the function may already exist or we need admin access
    console.log(
      'Note: You may need to run this SQL directly in the Supabase dashboard SQL editor.'
    );
    console.log('\n--- SQL TO RUN ---');
    console.log(sql);
    console.log('--- END SQL ---');
    process.exit(1);
  }

  console.log('Function applied successfully!');
}

main().catch(console.error);
