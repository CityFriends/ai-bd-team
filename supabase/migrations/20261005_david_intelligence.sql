-- ============================================================
-- David Competitive & Market Intelligence
-- ============================================================
--
-- David is an intelligence analyst agent. He produces competitive
-- briefs, market briefs, forecast signals, and event briefs.
--
-- Two modes:
--   CAPTURE_INTELLIGENCE — reactive, dispatched by James
--   MARKET_INTELLIGENCE  — proactive, event-driven
--
-- David does NOT make GO/NO-GO decisions.
-- ============================================================

-- ============================================================
-- Intelligence Tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS david_intelligence_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'CAPTURE_REQUEST', 'FORECAST_SIGNAL', 'COMPETITIVE_SIGNAL',
    'GOVCON_EVENT', 'HUMAN_REQUEST'
  )),
  trigger_source_id TEXT NOT NULL,

  -- Status machine: pending -> in_progress -> completed / failed / skipped
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped'
  )),

  -- Research scope (for CAPTURE_REQUEST triggers)
  research_type TEXT,
  question TEXT NOT NULL,

  -- Correlation
  capture_id UUID,
  opportunity_id TEXT,

  -- Output
  artifact_type TEXT,
  result_payload JSONB,

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Budget tracking
  workflow_budget_scope_id UUID,
  task_budget_scope_id UUID,
  inference_ledger_id UUID,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_david_tasks_pending
  ON david_intelligence_tasks (status)
  WHERE status = 'pending';

CREATE INDEX idx_david_tasks_trigger_type
  ON david_intelligence_tasks (trigger_type);

CREATE INDEX idx_david_tasks_opportunity
  ON david_intelligence_tasks (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

-- ============================================================
-- Intelligence Artifacts
-- ============================================================

CREATE TABLE IF NOT EXISTS david_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent task
  task_id UUID NOT NULL REFERENCES david_intelligence_tasks(id),

  -- Artifact classification
  artifact_type TEXT NOT NULL CHECK (artifact_type IN (
    'COMPETITIVE_BRIEF', 'CUSTOMER_MARKET_BRIEF',
    'FORECAST_SIGNAL', 'EVENT_BRIEF'
  )),

  -- Subject (company name, agency, forecast ID, event name)
  subject TEXT NOT NULL,

  -- Human-readable summary
  summary TEXT NOT NULL,

  -- Full structured artifact content
  content JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Confidence assessment
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  -- Advisory recommendation (nullable — not all artifacts carry one)
  recommendation TEXT,

  -- Correlation
  related_capture_id UUID,
  related_opportunity_id TEXT,

  -- Versioning (new versions supersede old ones)
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TIMESTAMPTZ,

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_david_artifacts_task
  ON david_artifacts (task_id);

CREATE INDEX idx_david_artifacts_type
  ON david_artifacts (artifact_type);

CREATE INDEX idx_david_artifacts_subject
  ON david_artifacts (subject);

CREATE INDEX idx_david_artifacts_opportunity
  ON david_artifacts (related_opportunity_id)
  WHERE related_opportunity_id IS NOT NULL;

CREATE INDEX idx_david_artifacts_current
  ON david_artifacts (subject, artifact_type)
  WHERE superseded_at IS NULL;

-- ============================================================
-- Company Intelligence Profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS company_intelligence_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  uei TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,

  -- Full structured profile
  profile_data JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Refresh tracking
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_count INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_profiles_name
  ON company_intelligence_profiles (company_name);

-- ============================================================
-- Agency Intelligence Profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS agency_intelligence_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  agency_code TEXT UNIQUE NOT NULL,
  agency_name TEXT NOT NULL,

  -- Full structured profile
  profile_data JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Refresh tracking
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_count INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agency_profiles_name
  ON agency_intelligence_profiles (agency_name);

-- ============================================================
-- Watched Signals
-- ============================================================

CREATE TABLE IF NOT EXISTS david_watched_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Signal classification
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'FORECAST', 'EVENT', 'COMPANY', 'RECOMPETE'
  )),
  signal_source_id TEXT NOT NULL,

  -- Status machine
  status TEXT NOT NULL DEFAULT 'WATCHING' CHECK (status IN (
    'WATCHING', 'DISMISSED', 'RESOLVED'
  )),

  -- Change detection
  material_hash TEXT NOT NULL,

  -- Monitoring lifecycle
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dismissal tracking
  dismissed_by TEXT,
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only one active watch per signal
  UNIQUE (signal_type, signal_source_id)
);

CREATE INDEX idx_david_watched_active
  ON david_watched_signals (status)
  WHERE status = 'WATCHING';

-- ============================================================
-- David Observation Windows (LLM observation)
-- Same pattern as maya_observation_windows — durable,
-- concurrency-safe limits for controlled activation.
-- ============================================================

CREATE TABLE IF NOT EXISTS david_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')),

  -- Limits
  max_tasks INTEGER NOT NULL DEFAULT 10,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 0.20,

  -- Counters
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  cumulative_actual_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  cumulative_reserved_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,

  -- Lifecycle
  stop_reason TEXT,
  last_task_id UUID,
  last_ledger_id UUID,

  started_at TIMESTAMPTZ DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Atomic: Claim a David observation slot
-- Returns TRUE if slot was claimed, FALSE if window exhausted.
-- Concurrency-safe via SELECT FOR UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_david_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window RECORD;
BEGIN
  SELECT * INTO v_window
  FROM david_observation_windows
  WHERE status = 'ACTIVE'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_window IS NULL THEN
    RETURN TRUE; -- No observation window = no limit enforced
  END IF;

  IF v_window.completed_tasks >= v_window.max_tasks THEN
    UPDATE david_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_TASKS_REACHED',
      stopped_at = now(), updated_at = now()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  IF v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd > v_window.max_cumulative_spend_usd THEN
    UPDATE david_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_SPEND_REACHED',
      stopped_at = now(), updated_at = now()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  UPDATE david_observation_windows SET
    completed_tasks = completed_tasks + 1,
    cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
    last_task_id = p_task_id,
    updated_at = now()
  WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Settle a David observation slot after inference completes
-- ============================================================
CREATE OR REPLACE FUNCTION settle_david_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window_id UUID;
BEGIN
  SELECT id INTO v_window_id
  FROM david_observation_windows
  WHERE status IN ('ACTIVE', 'STOPPED')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_window_id IS NOT NULL THEN
    UPDATE david_observation_windows SET
      cumulative_reserved_spend_usd = GREATEST(cumulative_reserved_spend_usd - p_reserved_cost_usd, 0),
      cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
      last_ledger_id = p_ledger_id,
      updated_at = now()
    WHERE id = v_window_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- David G2X Observation (separate from Maya's g2x_enrichment_observation)
-- ============================================================

CREATE TABLE IF NOT EXISTS david_g2x_observation (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')) DEFAULT 'ACTIVE',

  -- Limits
  max_enrichments INTEGER NOT NULL DEFAULT 10,
  max_total_calls INTEGER NOT NULL DEFAULT 100,
  max_total_records INTEGER NOT NULL DEFAULT 2000,

  -- Counters
  enrichments_completed INTEGER NOT NULL DEFAULT 0,
  total_g2x_calls INTEGER NOT NULL DEFAULT 0,
  total_records INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  stop_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE david_intelligence_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE david_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_intelligence_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_intelligence_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE david_watched_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE david_observation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE david_g2x_observation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_david_tasks" ON david_intelligence_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_david_artifacts" ON david_artifacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_company_profiles" ON company_intelligence_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_agency_profiles" ON agency_intelligence_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_david_watched_signals" ON david_watched_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_david_observation" ON david_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_david_g2x_observation" ON david_g2x_observation FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Grants
-- ============================================================

GRANT ALL ON david_intelligence_tasks TO service_role;
GRANT ALL ON david_artifacts TO service_role;
GRANT ALL ON company_intelligence_profiles TO service_role;
GRANT ALL ON agency_intelligence_profiles TO service_role;
GRANT ALL ON david_watched_signals TO service_role;
GRANT ALL ON david_observation_windows TO service_role;
GRANT ALL ON david_g2x_observation TO service_role;

GRANT EXECUTE ON FUNCTION claim_david_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_david_observation_slot TO service_role;

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE david_intelligence_tasks IS 'Intelligence research tasks for David. Triggered by James capture requests or proactive signal monitoring.';
COMMENT ON TABLE david_artifacts IS 'Structured intelligence artifacts produced by David. Versioned with supersession tracking.';
COMMENT ON TABLE company_intelligence_profiles IS 'Durable competitor/partner profiles. Incrementally refreshed from G2X research.';
COMMENT ON TABLE agency_intelligence_profiles IS 'Durable agency profiles. Incrementally refreshed from G2X research.';
COMMENT ON TABLE david_watched_signals IS 'Proactive signal monitoring. David watches forecasts, events, companies, and recompetes for material changes.';
COMMENT ON TABLE david_observation_windows IS 'Durable production observation limits for David controlled activation. Same pattern as Maya/James.';
COMMENT ON TABLE david_g2x_observation IS 'G2X usage observation window for David. Separate from Maya g2x_enrichment_observation. Limits: max 100 calls, 2000 records.';
COMMENT ON FUNCTION claim_david_observation_slot IS 'Atomic: claim one task slot, checking count + spend limits. Concurrency-safe.';
COMMENT ON FUNCTION settle_david_observation_slot IS 'Settle reserved spend after David inference completes. Converts reserved to actual.';
