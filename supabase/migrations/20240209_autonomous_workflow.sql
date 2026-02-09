-- Autonomous Workflow Tables
-- Supports semi-autonomous agent coordination

-- ============================================
-- OPPORTUNITY WORKFLOW STATE MACHINE
-- ============================================
-- Tracks each opportunity through stages with automatic triggers

CREATE TABLE IF NOT EXISTS opportunity_workflow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Opportunity reference
  notice_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sam_url TEXT,
  agency TEXT,
  score INTEGER,

  -- State machine
  stage TEXT NOT NULL DEFAULT 'found',
  -- Stages: found → researching → partner_search → strategy → decision → pursuing/passed

  -- Ownership and timing
  agent_responsible TEXT,  -- Which agent owns the current step
  auto_action_at TIMESTAMPTZ,  -- When to auto-advance if no human input
  awaiting_input_from TEXT,  -- 'lapedra', 'tamara', 'auto', or null

  -- Slack context for threading
  channel_id TEXT,
  thread_ts TEXT,

  -- Research results (accumulated)
  incumbent TEXT,
  incumbent_contract_value TEXT,
  red_flags TEXT[] DEFAULT '{}',
  teaming_recommended BOOLEAN,
  teaming_partners TEXT[] DEFAULT '{}',
  james_recommendation TEXT,  -- 'GO', 'PASS', 'NEEDS_DISCUSSION'

  -- Human decision
  decision TEXT,  -- 'go', 'pass', 'hold'
  decision_by TEXT,
  decision_at TIMESTAMPTZ,
  decision_notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  stage_entered_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicates
  UNIQUE(notice_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflow_stage ON opportunity_workflow(stage);
CREATE INDEX IF NOT EXISTS idx_workflow_auto_action ON opportunity_workflow(auto_action_at)
  WHERE auto_action_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_notice ON opportunity_workflow(notice_id);
CREATE INDEX IF NOT EXISTS idx_workflow_agent ON opportunity_workflow(agent_responsible);
CREATE INDEX IF NOT EXISTS idx_workflow_awaiting ON opportunity_workflow(awaiting_input_from)
  WHERE awaiting_input_from IS NOT NULL;

-- RLS
ALTER TABLE opportunity_workflow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to opportunity_workflow" ON opportunity_workflow
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- TEAM ACTIVITY LOG
-- ============================================
-- Tracks what each agent contributed to avoid repetition

CREATE TABLE IF NOT EXISTS team_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  thread_ts TEXT NOT NULL,
  channel_id TEXT,
  notice_id TEXT,  -- Optional link to opportunity

  -- Who and what
  agent TEXT NOT NULL,
  activity_type TEXT NOT NULL,  -- 'research', 'recommendation', 'question', 'handoff', 'decision'

  -- Content
  summary TEXT NOT NULL,  -- 1-2 sentence summary
  key_facts TEXT[] DEFAULT '{}',  -- Extracted facts for deduplication
  full_response TEXT,  -- Full text if needed

  -- Metadata
  confidence TEXT,  -- 'HIGH', 'MEDIUM', 'LOW'
  sources TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_activity_thread ON team_activity_log(thread_ts);
CREATE INDEX IF NOT EXISTS idx_activity_notice ON team_activity_log(notice_id)
  WHERE notice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_agent ON team_activity_log(agent);
CREATE INDEX IF NOT EXISTS idx_activity_created ON team_activity_log(created_at);

-- RLS
ALTER TABLE team_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to team_activity_log" ON team_activity_log
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- DECISION OUTCOMES (for learning)
-- ============================================
-- Track recommendation accuracy over time

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference
  notice_id TEXT,
  opportunity_title TEXT,
  workflow_id UUID REFERENCES opportunity_workflow(id),

  -- What was recommended
  james_recommendation TEXT,  -- 'GO', 'PASS', 'NEEDS_DISCUSSION'
  david_red_flags TEXT[] DEFAULT '{}',
  rosa_teaming_suggested BOOLEAN,

  -- What was decided
  human_decision TEXT,  -- 'go', 'pass'
  decision_by TEXT,

  -- Outcome (filled in later)
  outcome TEXT,  -- 'won', 'lost', 'no_bid', 'withdrawn'
  outcome_notes TEXT,

  -- Timing
  recommended_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  outcome_recorded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_outcomes_recommendation ON decision_outcomes(james_recommendation);
CREATE INDEX IF NOT EXISTS idx_outcomes_decision ON decision_outcomes(human_decision);
CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON decision_outcomes(outcome) WHERE outcome IS NOT NULL;

-- RLS
ALTER TABLE decision_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to decision_outcomes" ON decision_outcomes
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- WORKFLOW STAGE HISTORY
-- ============================================
-- Audit trail of stage transitions

CREATE TABLE IF NOT EXISTS workflow_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES opportunity_workflow(id) ON DELETE CASCADE,

  from_stage TEXT,
  to_stage TEXT NOT NULL,
  triggered_by TEXT,  -- 'auto', 'maya', 'david', 'rosa', 'james', 'lapedra', 'tamara'
  trigger_reason TEXT,  -- Why the transition happened

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_stage_history_workflow ON workflow_stage_history(workflow_id);

-- RLS
ALTER TABLE workflow_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to workflow_stage_history" ON workflow_stage_history
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- UPDATE seen_opportunities TABLE
-- ============================================
-- Add columns needed for workflow integration

-- Add thread_ts if not exists (for David to reply in thread)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seen_opportunities' AND column_name = 'thread_ts'
  ) THEN
    ALTER TABLE seen_opportunities ADD COLUMN thread_ts TEXT;
  END IF;
END $$;

-- Add agency if not exists (for research context)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seen_opportunities' AND column_name = 'agency'
  ) THEN
    ALTER TABLE seen_opportunities ADD COLUMN agency TEXT;
  END IF;
END $$;

-- Add workflow_id if not exists (link to workflow)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'seen_opportunities' AND column_name = 'workflow_id'
  ) THEN
    ALTER TABLE seen_opportunities ADD COLUMN workflow_id UUID REFERENCES opportunity_workflow(id);
  END IF;
END $$;
