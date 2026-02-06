-- User profiles table for identifying Slack users
-- This allows agents to recognize who they're talking to (Lapedra, Tamara, etc.)

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_user_id TEXT UNIQUE NOT NULL,
  user_name TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  background TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups by Slack user ID
CREATE INDEX IF NOT EXISTS idx_user_profiles_slack_id ON user_profiles(slack_user_id);

-- Seed initial user profiles
-- NOTE: Replace <SLACK_USER_ID> with actual Slack member IDs
-- Get from Slack: Profile > ... > Copy member ID
INSERT INTO user_profiles (slack_user_id, user_name, display_name, role, background) VALUES
('U01SC2TNYKU', 'lapedra', 'Lapedra', 'CEO', 'Founder and CEO of Friends From The City. Makes final calls on opportunities. Prefers opportunities with clear HCD/design focus.'),
('U01RXBVUA0P', 'tamara', 'Tamara Tolson', 'COO', 'COO. Handles operations and keeps things running smoothly. Focuses on operational feasibility and team capacity.')
ON CONFLICT (slack_user_id) DO NOTHING;

-- Seed user_context table with additional profile info
INSERT INTO user_context (user_name, context_type, content, still_relevant) VALUES
('lapedra', 'personal', 'CEO and founder of Friends From The City', true),
('lapedra', 'preference', 'Prefers opportunities with clear HCD/design focus', true),
('tamara', 'personal', 'COO. Handles operations and keeps things running smoothly.', true),
('tamara', 'preference', 'Focuses on operational feasibility and team capacity', true)
ON CONFLICT DO NOTHING;
