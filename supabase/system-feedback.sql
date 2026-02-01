-- System Feedback Table
-- Tracks issues, bugs, and suggestions for agent improvement

CREATE TABLE IF NOT EXISTS system_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE DEFAULT CURRENT_DATE,
  agent TEXT,
  feedback_type TEXT, -- "bug", "wrong_answer", "great_catch", "suggestion", "annoying", "missing_info"
  what_happened TEXT,
  what_should_happen TEXT,
  severity TEXT DEFAULT 'medium', -- "minor", "medium", "major"
  resolved BOOLEAN DEFAULT false,
  resolution TEXT,
  slack_ts TEXT, -- Reference to original message if from reaction
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_agent ON system_feedback(agent);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON system_feedback(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_resolved ON system_feedback(resolved);
CREATE INDEX IF NOT EXISTS idx_feedback_date ON system_feedback(date);

-- Sample queries:
-- Get unresolved feedback: SELECT * FROM system_feedback WHERE resolved = false ORDER BY created_at DESC;
-- Feedback by agent: SELECT agent, COUNT(*) FROM system_feedback GROUP BY agent;
-- Weekly summary: SELECT feedback_type, COUNT(*) FROM system_feedback WHERE date >= CURRENT_DATE - 7 GROUP BY feedback_type;
