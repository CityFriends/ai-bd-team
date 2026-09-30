-- ============================================================
-- Milestone 3B: James Capture Orchestration
-- Capture aggregate, specialist tasks, artifacts, proposal workspaces.
-- Atomic RPCs for consequential human decisions.
-- ============================================================

-- ============================================================
-- Captures — the Capture aggregate
-- ============================================================
CREATE TABLE IF NOT EXISTS captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL,
  source_material_hash TEXT NOT NULL,

  -- Status machine
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'initial_assessment', 'researching',
    'recommendation_ready', 'pursuit_authorized', 'no_go', 'abandoned'
  )),

  owner TEXT NOT NULL DEFAULT 'JAMES',

  -- Research control
  research_round INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 2,

  -- James recommendation (immutable per version — new versions create decision_records)
  james_recommendation TEXT CHECK (james_recommendation IN ('GO', 'NO_GO', 'MORE_RESEARCH_REQUIRED')),
  james_confidence INTEGER,
  james_decision_payload JSONB,
  decision_version INTEGER NOT NULL DEFAULT 0,

  -- Human decision (independent of James recommendation)
  human_decision TEXT CHECK (human_decision IN ('PURSUIT', 'NO_GO')),
  human_decision_by TEXT,
  human_decision_at TIMESTAMPTZ,

  -- Slack thread (reuses Maya's existing thread)
  slack_channel_id TEXT,
  slack_thread_ts TEXT,
  slack_brief_message_ts TEXT,

  -- Budget
  capture_budget_scope_id UUID,

  -- Provenance
  created_by_human_id TEXT NOT NULL,
  send_to_capture_event_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(opportunity_id, source_material_hash)
);

CREATE INDEX idx_captures_status ON captures(status) WHERE status IN ('pending', 'initial_assessment', 'researching', 'recommendation_ready');
CREATE INDEX idx_captures_opportunity ON captures(opportunity_id);

-- ============================================================
-- Capture Decision Records — immutable history of James recommendations
-- ============================================================
CREATE TABLE IF NOT EXISTS capture_decision_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id UUID NOT NULL REFERENCES captures(id),
  decision_version INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  confidence INTEGER,
  decision_payload JSONB NOT NULL,
  research_round INTEGER NOT NULL,
  inference_ledger_id UUID,
  model_route TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(capture_id, decision_version)
);

-- ============================================================
-- Specialist Tasks — specialist work items
-- ============================================================
CREATE TABLE IF NOT EXISTS specialist_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id UUID NOT NULL REFERENCES captures(id),
  opportunity_id TEXT NOT NULL,

  task_type TEXT NOT NULL CHECK (task_type IN (
    'COMPETITIVE_INTELLIGENCE', 'TECHNICAL_ASSESSMENT',
    'PARTNER_SEARCH', 'ACQUISITION_INTERPRETATION'
  )),

  requested_by TEXT NOT NULL DEFAULT 'JAMES_CAPTURE',

  question TEXT NOT NULL,
  why_decision_blocking TEXT NOT NULL,
  evidence_refs JSONB DEFAULT '[]',

  research_round INTEGER NOT NULL,
  research_authority TEXT NOT NULL DEFAULT 'AUTONOMOUS' CHECK (research_authority IN (
    'AUTONOMOUS', 'EXECUTIVE_REQUESTED'
  )),

  priority TEXT NOT NULL DEFAULT 'REQUIRED' CHECK (priority IN ('REQUIRED', 'USEFUL')),

  budget_usd NUMERIC(10,4),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped', 'timed_out'
  )),

  -- Execution
  inference_ledger_id UUID,
  execution_mode TEXT DEFAULT 'REAL_SPECIALIST' CHECK (execution_mode IN (
    'REAL_SPECIALIST', 'TEST_FIXTURE'
  )),

  -- Timeout
  timeout_seconds INTEGER DEFAULT 300,
  timeout_at TIMESTAMPTZ,

  idempotency_key TEXT UNIQUE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_specialist_tasks_capture ON specialist_tasks(capture_id, status);
CREATE INDEX idx_specialist_tasks_pending ON specialist_tasks(status) WHERE status = 'pending';

-- ============================================================
-- Specialist Artifacts — specialist results
-- ============================================================
CREATE TABLE IF NOT EXISTS specialist_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specialist_task_id UUID NOT NULL REFERENCES specialist_tasks(id),
  capture_id UUID NOT NULL REFERENCES captures(id),

  finding TEXT NOT NULL,
  assessment TEXT NOT NULL CHECK (assessment IN (
    'FAVORABLE', 'MIXED', 'UNFAVORABLE', 'INSUFFICIENT'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  evidence JSONB DEFAULT '[]',
  material_unsolicited_findings JSONB DEFAULT '[]',
  unknowns JSONB DEFAULT '[]',
  capture_implications JSONB DEFAULT '[]',
  recommended_followup JSONB DEFAULT '[]',

  artifact_source TEXT NOT NULL DEFAULT 'REAL_SPECIALIST' CHECK (artifact_source IN (
    'REAL_SPECIALIST', 'TEST_FIXTURE'
  )),

  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_specialist_artifacts_capture ON specialist_artifacts(capture_id);

-- ============================================================
-- Proposal Workspaces — created on pursuit authorization
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id UUID NOT NULL UNIQUE REFERENCES captures(id),
  opportunity_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),

  -- Deterministic Jodie readiness (not toggled by James)
  jodie_ready BOOLEAN NOT NULL DEFAULT false,
  jodie_readiness_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Atomic RPC: Create Capture from Send-to-Capture
-- ============================================================
CREATE OR REPLACE FUNCTION create_capture_from_send_to_capture(
  p_opportunity_id TEXT,
  p_material_hash TEXT,
  p_human_id TEXT,
  p_send_to_capture_event_id TEXT,
  p_channel_id TEXT,
  p_thread_ts TEXT
) RETURNS UUID AS $$
DECLARE
  v_capture_id UUID;
  v_idemp_key TEXT;
BEGIN
  v_idemp_key := 'capture:' || p_opportunity_id || ':' || p_material_hash || ':' || p_send_to_capture_event_id;

  -- Check for existing capture (idempotent)
  SELECT id INTO v_capture_id FROM captures WHERE idempotency_key = v_idemp_key;
  IF v_capture_id IS NOT NULL THEN
    RETURN v_capture_id;
  END IF;

  -- Create capture
  INSERT INTO captures (
    opportunity_id, source_material_hash, status, created_by_human_id,
    send_to_capture_event_id, slack_channel_id, slack_thread_ts,
    idempotency_key
  ) VALUES (
    p_opportunity_id, p_material_hash, 'pending', p_human_id,
    p_send_to_capture_event_id, p_channel_id, p_thread_ts,
    v_idemp_key
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_capture_id;

  IF v_capture_id IS NULL THEN
    -- Race condition: another transaction created it
    SELECT id INTO v_capture_id FROM captures WHERE idempotency_key = v_idemp_key;
    RETURN v_capture_id;
  END IF;

  -- Emit CAPTURE_STARTED event
  INSERT INTO opportunity_events (
    event_type, aggregate_type, aggregate_id, opportunity_id,
    actor_type, actor_id, source, correlation_id,
    idempotency_key, schema_version, payload
  ) VALUES (
    'CAPTURE_STARTED', 'capture', v_capture_id::TEXT, p_opportunity_id,
    'SYSTEM', 'james', 'capture-manager',
    'capture:' || v_capture_id::TEXT,
    'evt:capture-started:' || v_capture_id::TEXT,
    1, jsonb_build_object('humanId', p_human_id, 'materialHash', p_material_hash)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  -- Transfer thread ownership to James
  UPDATE slack_opportunity_briefs
  SET thread_owner = 'JAMES', updated_at = NOW()
  WHERE opportunity_id = p_opportunity_id
    AND status = 'capture_sent';

  RETURN v_capture_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Atomic RPC: Authorize Pursuit
-- ============================================================
CREATE OR REPLACE FUNCTION authorize_pursuit(
  p_capture_id UUID,
  p_human_id TEXT,
  p_decision_version INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_capture RECORD;
  v_opp_id TEXT;
BEGIN
  -- Lock and validate
  SELECT * INTO v_capture FROM captures WHERE id = p_capture_id FOR UPDATE;

  IF v_capture IS NULL THEN
    RAISE EXCEPTION 'Capture not found: %', p_capture_id;
  END IF;

  IF v_capture.status != 'recommendation_ready' THEN
    RAISE EXCEPTION 'Invalid capture status for pursuit: %', v_capture.status;
  END IF;

  IF v_capture.decision_version != p_decision_version THEN
    RAISE EXCEPTION 'Stale decision version: expected %, got %', v_capture.decision_version, p_decision_version;
  END IF;

  v_opp_id := v_capture.opportunity_id;

  -- Update capture — preserve James recommendation, record human decision
  UPDATE captures SET
    status = 'pursuit_authorized',
    human_decision = 'PURSUIT',
    human_decision_by = p_human_id,
    human_decision_at = NOW(),
    updated_at = NOW()
  WHERE id = p_capture_id;

  -- Create Proposal Workspace
  INSERT INTO proposal_workspaces (capture_id, opportunity_id)
  VALUES (p_capture_id, v_opp_id)
  ON CONFLICT (capture_id) DO NOTHING;

  -- Emit PURSUIT_AUTHORIZED event
  INSERT INTO opportunity_events (
    event_type, aggregate_type, aggregate_id, opportunity_id,
    actor_type, actor_id, source, correlation_id,
    idempotency_key, schema_version, payload
  ) VALUES (
    'PURSUIT_AUTHORIZED', 'capture', p_capture_id::TEXT, v_opp_id,
    'HUMAN', p_human_id, 'slack',
    'capture:' || p_capture_id::TEXT,
    'pursue:' || p_capture_id::TEXT || ':v' || p_decision_version,
    1, jsonb_build_object(
      'jamesRecommendation', v_capture.james_recommendation,
      'humanDecision', 'PURSUIT',
      'decisionVersion', p_decision_version
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Atomic RPC: Authorize No-Go
-- ============================================================
CREATE OR REPLACE FUNCTION authorize_no_go(
  p_capture_id UUID,
  p_human_id TEXT,
  p_decision_version INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_capture RECORD;
BEGIN
  -- Lock and validate
  SELECT * INTO v_capture FROM captures WHERE id = p_capture_id FOR UPDATE;

  IF v_capture IS NULL THEN
    RAISE EXCEPTION 'Capture not found: %', p_capture_id;
  END IF;

  IF v_capture.status != 'recommendation_ready' THEN
    RAISE EXCEPTION 'Invalid capture status for no-go: %', v_capture.status;
  END IF;

  IF v_capture.decision_version != p_decision_version THEN
    RAISE EXCEPTION 'Stale decision version: expected %, got %', v_capture.decision_version, p_decision_version;
  END IF;

  -- Update capture — preserve James recommendation, record human NO_GO
  UPDATE captures SET
    status = 'no_go',
    human_decision = 'NO_GO',
    human_decision_by = p_human_id,
    human_decision_at = NOW(),
    updated_at = NOW()
  WHERE id = p_capture_id;

  -- Emit PURSUIT_NO_GO event
  INSERT INTO opportunity_events (
    event_type, aggregate_type, aggregate_id, opportunity_id,
    actor_type, actor_id, source, correlation_id,
    idempotency_key, schema_version, payload
  ) VALUES (
    'PURSUIT_NO_GO', 'capture', p_capture_id::TEXT, v_capture.opportunity_id,
    'HUMAN', p_human_id, 'slack',
    'capture:' || p_capture_id::TEXT,
    'nogo:' || p_capture_id::TEXT || ':v' || p_decision_version,
    1, jsonb_build_object(
      'jamesRecommendation', v_capture.james_recommendation,
      'humanDecision', 'NO_GO',
      'decisionVersion', p_decision_version
    )
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_captures" ON captures FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_capture_decisions" ON capture_decision_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_specialist_tasks" ON specialist_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_specialist_artifacts" ON specialist_artifacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_proposal_workspaces" ON proposal_workspaces FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION create_capture_from_send_to_capture TO service_role;
GRANT EXECUTE ON FUNCTION authorize_pursuit TO service_role;
GRANT EXECUTE ON FUNCTION authorize_no_go TO service_role;

COMMENT ON TABLE captures IS 'Capture aggregate — James evaluates opportunities for pursuit decision.';
COMMENT ON TABLE capture_decision_records IS 'Immutable history of James recommendations per capture.';
COMMENT ON TABLE specialist_tasks IS 'Specialist research tasks dispatched by James during capture.';
COMMENT ON TABLE specialist_artifacts IS 'Results from specialist research. artifact_source distinguishes test fixtures from real specialist work.';
COMMENT ON TABLE proposal_workspaces IS 'Created on PURSUIT_AUTHORIZED. Tracks proposal readiness.';
COMMENT ON FUNCTION create_capture_from_send_to_capture IS 'Atomic: create capture + emit event + transfer thread ownership.';
COMMENT ON FUNCTION authorize_pursuit IS 'Atomic: validate + state transition + create workspace + emit event.';
COMMENT ON FUNCTION authorize_no_go IS 'Atomic: validate + state transition + emit event. Preserves James recommendation.';
