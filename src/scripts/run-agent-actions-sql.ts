/**
 * One-time script to create the agent_actions table
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

async function createAgentActionsTable() {
  const supabase = getSupabase();

  // Check if table already exists
  const { data, error: checkError } = await supabase
    .from('agent_actions')
    .select('id')
    .limit(1);

  if (!checkError) {
    console.log('✓ agent_actions table already exists');
    return;
  }

  if (checkError.code !== '42P01') {
    console.log('Table exists but got error:', checkError.message);
    return;
  }

  console.log('Table does not exist. Please run this SQL in Supabase dashboard:\n');
  console.log(`
CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT,
  source_channel TEXT,
  source_thread_ts TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_message TEXT,
  result_thread_ts TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  recurrence TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_pending
  ON agent_actions(status, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_actions_agent
  ON agent_actions(agent_name, status);

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access for agent_actions"
  ON agent_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
  `);
}

createAgentActionsTable();
