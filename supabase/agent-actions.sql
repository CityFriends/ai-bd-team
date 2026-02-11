-- Agent Actions Table
-- Tracks commitments agents make and ensures they follow through

CREATE TABLE IF NOT EXISTS agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who committed to this action
  agent_name TEXT NOT NULL,  -- 'patricia', 'maya', 'marcus', 'david', 'rosa', 'james'

  -- What type of action
  action_type TEXT NOT NULL,  -- 'team_meeting', 'watch_opportunity', 'follow_up', 'research', 'outreach'

  -- Description of the action
  description TEXT NOT NULL,

  -- Context that prompted this action (news digest, opportunity, conversation)
  context TEXT,

  -- The original message/thread where they committed to this
  source_channel TEXT,
  source_thread_ts TEXT,

  -- When to execute
  scheduled_for TIMESTAMPTZ NOT NULL,

  -- Execution status
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'in_progress', 'completed', 'cancelled', 'failed'

  -- Results
  result_message TEXT,
  result_thread_ts TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- For recurring actions (optional)
  recurrence TEXT  -- 'daily', 'weekly', 'monthly', or null for one-time
);

-- Index for finding pending actions
CREATE INDEX IF NOT EXISTS idx_agent_actions_pending
  ON agent_actions(status, scheduled_for)
  WHERE status = 'pending';

-- Index for agent lookups
CREATE INDEX IF NOT EXISTS idx_agent_actions_agent
  ON agent_actions(agent_name, status);

-- Enable RLS
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

-- Service role only policy
CREATE POLICY "Service role access for agent_actions"
  ON agent_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE agent_actions IS 'Tracks actions agents commit to and ensures follow-through';
