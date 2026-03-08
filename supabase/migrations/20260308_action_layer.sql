-- Action Layer: Deliverables, Directives, and Feedback
-- Enables agents to produce work product and learn from human decisions

-- ============================================================
-- Team Directives (Human Control)
-- ============================================================

CREATE TABLE IF NOT EXISTS team_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Directive type: focus, avoid, priority, pause
  directive_type TEXT NOT NULL CHECK (directive_type IN ('focus', 'avoid', 'priority', 'pause')),

  -- What it targets: agency, naics, keyword, partner, opportunity_type
  target_type TEXT NOT NULL CHECK (target_type IN ('agency', 'naics', 'keyword', 'partner', 'opportunity_type')),

  -- The specific value (e.g., 'VA', '541511', 'cloud')
  target_value TEXT NOT NULL,

  -- Why this directive was set
  reason TEXT,

  -- Who set it
  set_by TEXT DEFAULT 'lapedra',

  -- Is it currently active?
  active BOOLEAN DEFAULT true,

  -- Optional expiration
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_team_directives_active ON team_directives(active) WHERE active = true;
CREATE INDEX idx_team_directives_type ON team_directives(directive_type, target_type);

-- ============================================================
-- Decision Feedback (Learning Loop)
-- ============================================================

CREATE TABLE IF NOT EXISTS decision_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to opportunity
  opportunity_id UUID,
  opportunity_title TEXT,

  -- The decision made
  decision TEXT NOT NULL CHECK (decision IN ('go', 'no_go', 'hold')),

  -- Human's reasoning
  human_reasoning TEXT,

  -- What did agents recommend?
  agent_recommendation TEXT,
  agent_reasoning TEXT,

  -- Did human agree with agents?
  alignment BOOLEAN,

  -- Key factors the human cited
  factors_cited JSONB DEFAULT '[]',

  -- Who made the decision
  decided_by TEXT DEFAULT 'lapedra',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decision_feedback_opportunity ON decision_feedback(opportunity_id);
CREATE INDEX idx_decision_feedback_alignment ON decision_feedback(alignment);
CREATE INDEX idx_decision_feedback_created ON decision_feedback(created_at DESC);

-- ============================================================
-- Deliverables (Work Products)
-- ============================================================

CREATE TABLE IF NOT EXISTS deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What type of deliverable
  deliverable_type TEXT NOT NULL CHECK (deliverable_type IN (
    'go_no_go_memo',
    'research_brief',
    'partner_shortlist',
    'tech_assessment',
    'executive_insight',
    'capture_plan',
    'weekly_rollup'
  )),

  -- Title
  title TEXT NOT NULL,

  -- Which agent produced it
  owner_agent TEXT NOT NULL,

  -- Related opportunity (optional)
  opportunity_id UUID,
  opportunity_title TEXT,

  -- Status workflow
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'actioned', 'archived')),

  -- The actual content (markdown)
  content TEXT,

  -- Notion page ID if synced
  notion_page_id TEXT,

  -- Which feed posts triggered this
  source_post_ids UUID[] DEFAULT '{}',

  -- Metadata
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deliverables_type ON deliverables(deliverable_type);
CREATE INDEX idx_deliverables_status ON deliverables(status);
CREATE INDEX idx_deliverables_opportunity ON deliverables(opportunity_id);
CREATE INDEX idx_deliverables_created ON deliverables(created_at DESC);
CREATE INDEX idx_deliverables_owner ON deliverables(owner_agent);

-- ============================================================
-- Synthesized Discussions (Track which discussions produced deliverables)
-- ============================================================

CREATE TABLE IF NOT EXISTS synthesized_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The original post that started the discussion
  root_post_id UUID NOT NULL,

  -- The deliverable that was produced
  deliverable_id UUID REFERENCES deliverables(id),

  -- When it was synthesized
  synthesized_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate synthesis
  UNIQUE(root_post_id)
);

-- ============================================================
-- RLS Policies
-- ============================================================

ALTER TABLE team_directives ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthesized_discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_directives" ON team_directives
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_feedback" ON decision_feedback
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_deliverables" ON deliverables
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all_synthesized" ON synthesized_discussions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Helper Functions
-- ============================================================

-- Get active directives that apply to an opportunity
CREATE OR REPLACE FUNCTION get_applicable_directives(
  p_agency TEXT DEFAULT NULL,
  p_naics_codes TEXT[] DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  directive_type TEXT,
  target_type TEXT,
  target_value TEXT,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.directive_type, d.target_type, d.target_value, d.reason
  FROM team_directives d
  WHERE d.active = true
    AND (d.expires_at IS NULL OR d.expires_at > NOW())
    AND (
      -- Agency match
      (d.target_type = 'agency' AND p_agency ILIKE '%' || d.target_value || '%')
      -- NAICS match
      OR (d.target_type = 'naics' AND d.target_value = ANY(p_naics_codes))
      -- Keyword match in description
      OR (d.target_type = 'keyword' AND p_description ILIKE '%' || d.target_value || '%')
    );
END;
$$ LANGUAGE plpgsql;

-- Get recent deliverables summary
CREATE OR REPLACE FUNCTION get_deliverables_summary(since_days INTEGER DEFAULT 7)
RETURNS TABLE (
  deliverable_type TEXT,
  count BIGINT,
  latest TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT d.deliverable_type, COUNT(*)::BIGINT, MAX(d.created_at)
  FROM deliverables d
  WHERE d.created_at > NOW() - (since_days || ' days')::INTERVAL
  GROUP BY d.deliverable_type;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE team_directives IS 'Human-set focus areas and priorities for agents';
COMMENT ON TABLE decision_feedback IS 'Records of human go/no-go decisions for agent learning';
COMMENT ON TABLE deliverables IS 'Work products generated by agents (memos, briefs, etc)';
COMMENT ON TABLE synthesized_discussions IS 'Tracks which feed discussions have been synthesized';
