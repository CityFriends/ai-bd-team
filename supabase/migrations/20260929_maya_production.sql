-- ============================================================
-- Milestone 3A: Maya Production Workflow
-- Source sync state, opportunity events, Slack projection, human actions.
-- ============================================================

-- ============================================================
-- Source sync state — tracks incremental collection progress
-- ============================================================
CREATE TABLE IF NOT EXISTS source_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL UNIQUE,
  last_successful_sync TIMESTAMPTZ,
  last_sync_cursor TEXT,          -- source-specific cursor/date window
  last_attempted_sync TIMESTAMPTZ,
  last_error TEXT,
  consecutive_failures INTEGER DEFAULT 0,
  records_fetched INTEGER DEFAULT 0,
  records_new INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  material_changes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO source_sync_state (source) VALUES ('sam_gov') ON CONFLICT DO NOTHING;

-- ============================================================
-- Opportunity events — domain event log for opportunity lifecycle
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,

  -- Aggregate
  aggregate_type TEXT NOT NULL DEFAULT 'opportunity',
  aggregate_id TEXT NOT NULL,        -- opportunity source_id

  -- Context
  workflow_id TEXT,
  opportunity_id TEXT,

  -- Actor
  actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'AGENT', 'SYSTEM', 'SOURCE')),
  actor_id TEXT,

  source TEXT NOT NULL,              -- 'collector', 'maya', 'slack', 'human'

  -- Correlation
  correlation_id TEXT NOT NULL,      -- ties related events
  causation_id TEXT,                 -- event that caused this one
  idempotency_key TEXT UNIQUE NOT NULL,

  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  payload JSONB DEFAULT '{}'
);

CREATE INDEX idx_opp_events_type ON opportunity_events(event_type);
CREATE INDEX idx_opp_events_aggregate ON opportunity_events(aggregate_id);
CREATE INDEX idx_opp_events_correlation ON opportunity_events(correlation_id);
CREATE INDEX idx_opp_events_created ON opportunity_events(created_at DESC);

-- ============================================================
-- Maya review tasks — tracks Maya inference work items
-- ============================================================
CREATE TABLE IF NOT EXISTS maya_review_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL,
  material_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL DEFAULT 'v1',

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped'
  )),

  -- Budget
  workflow_budget_scope_id UUID,
  task_budget_scope_id UUID,
  inference_ledger_id UUID,

  -- Result
  recommendation TEXT,              -- EVALUATE, WATCH, PASS
  confidence INTEGER,
  decision_payload JSONB,

  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  -- Versioning
  scorer_version TEXT DEFAULT 'v1',
  model_route TEXT,
  evidence_hash TEXT,

  UNIQUE(opportunity_id, material_hash, contract_version)
);

CREATE INDEX idx_maya_tasks_status ON maya_review_tasks(status) WHERE status = 'pending';
CREATE INDEX idx_maya_tasks_opp ON maya_review_tasks(opportunity_id);

-- ============================================================
-- Slack projections — tracks Slack message state
-- ============================================================
CREATE TABLE IF NOT EXISTS slack_opportunity_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL,
  maya_task_id UUID REFERENCES maya_review_tasks(id),

  -- Slack state
  channel_id TEXT,
  message_ts TEXT,
  thread_ts TEXT,

  -- Ownership
  thread_owner TEXT DEFAULT 'MAYA',

  -- Human actions
  human_action TEXT,                 -- SEND_TO_CAPTURE, MORE_RESEARCH, DISMISSED
  human_action_by TEXT,
  human_action_at TIMESTAMPTZ,
  dismissal_reason TEXT,

  -- State
  status TEXT DEFAULT 'posted' CHECK (status IN (
    'pending', 'posted', 'acknowledged', 'dismissed', 'capture_sent'
  )),
  projection_attempts INTEGER DEFAULT 0,
  last_projection_error TEXT,

  -- Versioning
  decision_version TEXT,
  message_version INTEGER DEFAULT 1,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_slack_briefs_opp ON slack_opportunity_briefs(opportunity_id);
CREATE INDEX idx_slack_briefs_status ON slack_opportunity_briefs(status);
CREATE INDEX idx_slack_briefs_msg ON slack_opportunity_briefs(message_ts) WHERE message_ts IS NOT NULL;

-- ============================================================
-- Cost guardrails — configurable safety caps
-- ============================================================
CREATE TABLE IF NOT EXISTS maya_cost_guardrails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name TEXT NOT NULL DEFAULT 'default' UNIQUE,
  max_reviews_per_cycle INTEGER NOT NULL DEFAULT 5,
  max_reviews_per_day INTEGER NOT NULL DEFAULT 20,
  max_task_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0.02,
  max_workflow_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0.03,
  reviews_today INTEGER NOT NULL DEFAULT 0,
  reviews_today_reset_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO maya_cost_guardrails (config_name) VALUES ('default') ON CONFLICT DO NOTHING;

-- ============================================================
-- Add version columns to pipeline_opportunities
-- ============================================================
ALTER TABLE pipeline_opportunities
  ADD COLUMN IF NOT EXISTS maya_task_id UUID,
  ADD COLUMN IF NOT EXISTS maya_recommendation TEXT,
  ADD COLUMN IF NOT EXISTS maya_confidence INTEGER,
  ADD COLUMN IF NOT EXISTS maya_decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS maya_contract_version TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS scorer_version TEXT DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS evidence_hash TEXT,
  ADD COLUMN IF NOT EXISTS slack_brief_id UUID,
  ADD COLUMN IF NOT EXISTS human_action TEXT,
  ADD COLUMN IF NOT EXISTS human_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_action_by TEXT;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE source_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE maya_review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_opportunity_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maya_cost_guardrails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_source_sync" ON source_sync_state FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_opp_events" ON opportunity_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_maya_tasks" ON maya_review_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_slack_briefs" ON slack_opportunity_briefs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_cost_guardrails" ON maya_cost_guardrails FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE source_sync_state IS 'Tracks incremental source collection progress per source adapter.';
COMMENT ON TABLE opportunity_events IS 'Domain event log for opportunity lifecycle.';
COMMENT ON TABLE maya_review_tasks IS 'Maya inference work items with idempotency and versioning.';
COMMENT ON TABLE slack_opportunity_briefs IS 'Slack message projection state. Slack is presentation, not authority.';
COMMENT ON TABLE maya_cost_guardrails IS 'Configurable safety caps for autonomous Maya inference volume.';
