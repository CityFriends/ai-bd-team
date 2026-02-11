-- Team Activity Log
-- Tracks what each agent has contributed to threads/opportunities
-- Enables coordination and prevents agents from repeating each other

CREATE TABLE IF NOT EXISTS team_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_ts TEXT,                    -- Slack thread timestamp
  notice_id TEXT,                    -- SAM.gov notice ID
  channel_id TEXT,                   -- Slack channel ID
  agent TEXT NOT NULL,               -- Agent name (maya, david, rosa, james, patricia)
  action_type TEXT NOT NULL,         -- research, analysis, recommendation, question, partner_search, strategy, alert
  summary TEXT NOT NULL,             -- 1-2 sentence summary of contribution
  key_facts TEXT[],                  -- Specific facts/data points provided
  recommendations TEXT[],            -- Any recommendations made
  sentiment TEXT,                    -- positive, negative, neutral, cautious
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_team_activity_thread ON team_activity_log(thread_ts);
CREATE INDEX IF NOT EXISTS idx_team_activity_notice ON team_activity_log(notice_id);
CREATE INDEX IF NOT EXISTS idx_team_activity_agent ON team_activity_log(agent);
CREATE INDEX IF NOT EXISTS idx_team_activity_created ON team_activity_log(created_at DESC);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_team_activity_thread_agent ON team_activity_log(thread_ts, agent);
CREATE INDEX IF NOT EXISTS idx_team_activity_notice_type ON team_activity_log(notice_id, action_type);

-- Row Level Security
ALTER TABLE team_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to team_activity_log" ON team_activity_log
  FOR ALL USING (auth.role() = 'service_role');
