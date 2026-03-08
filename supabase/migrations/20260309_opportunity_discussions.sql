-- Opportunity Discussions: Multi-turn agent conversations anchored to specific opportunities
-- Enables real collaborative reasoning visible in Notion

-- ============================================================
-- Main Discussions Table
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to opportunity (pipeline)
  opportunity_id UUID NOT NULL,
  opportunity_name TEXT NOT NULL,
  notion_page_id TEXT,  -- For syncing discussions back to Notion

  -- Discussion state machine
  state TEXT DEFAULT 'gathering' CHECK (state IN (
    'gathering',    -- Agents adding initial perspectives
    'debating',     -- Agents responding to each other
    'concluding',   -- Converging on recommendation
    'synthesized',  -- Deliverable generated
    'stale'         -- No activity for 48+ hours
  )),

  -- Multi-turn conversation stored as JSONB array
  -- Each turn: {
  --   agent: string,
  --   role: string (scout, analyst, connector, strategist, tech_lead),
  --   content: string,
  --   references: string[] (sources cited),
  --   turn_type: 'initial' | 'build' | 'challenge' | 'question' | 'answer' | 'synthesis',
  --   responds_to: number (index of turn being responded to),
  --   timestamp: ISO string
  -- }
  turns JSONB DEFAULT '[]',

  -- Participation tracking
  agents_contributed TEXT[] DEFAULT '{}',
  expected_agents TEXT[] DEFAULT ARRAY['maya', 'david', 'rosa', 'james', 'marcus'],

  -- Deliverables produced from this discussion
  deliverable_ids UUID[] DEFAULT '{}',

  -- How this discussion was triggered
  triggered_by TEXT,  -- 'maya_scanner', 'manual', 'slack_mention'

  -- Tags for filtering/searching
  tags TEXT[] DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_turn_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_opp_discussions_opportunity ON opportunity_discussions(opportunity_id);
CREATE INDEX idx_opp_discussions_state ON opportunity_discussions(state);
CREATE INDEX idx_opp_discussions_notion ON opportunity_discussions(notion_page_id);
CREATE INDEX idx_opp_discussions_created ON opportunity_discussions(created_at DESC);
CREATE INDEX idx_opp_discussions_last_turn ON opportunity_discussions(last_turn_at DESC);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE opportunity_discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_discussions" ON opportunity_discussions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Helper Functions
-- ============================================================

-- Get discussions needing attention (stale or incomplete)
CREATE OR REPLACE FUNCTION get_pending_discussions(
  p_max_age_hours INTEGER DEFAULT 48
)
RETURNS TABLE (
  id UUID,
  opportunity_name TEXT,
  state TEXT,
  agents_contributed TEXT[],
  missing_agents TEXT[],
  hours_since_last_turn NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.opportunity_name,
    d.state,
    d.agents_contributed,
    ARRAY(
      SELECT unnest(d.expected_agents)
      EXCEPT
      SELECT unnest(d.agents_contributed)
    ) AS missing_agents,
    EXTRACT(EPOCH FROM (NOW() - d.last_turn_at)) / 3600 AS hours_since_last_turn
  FROM opportunity_discussions d
  WHERE d.state IN ('gathering', 'debating', 'concluding')
    AND d.last_turn_at < NOW() - (p_max_age_hours || ' hours')::INTERVAL
  ORDER BY d.last_turn_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Get discussion for an opportunity
CREATE OR REPLACE FUNCTION get_discussion_for_opportunity(
  p_opportunity_id UUID
)
RETURNS opportunity_discussions AS $$
DECLARE
  result opportunity_discussions;
BEGIN
  SELECT * INTO result
  FROM opportunity_discussions
  WHERE opportunity_id = p_opportunity_id
    AND state != 'stale'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON TABLE opportunity_discussions IS 'Multi-turn agent discussions anchored to specific opportunities, synced to Notion';
