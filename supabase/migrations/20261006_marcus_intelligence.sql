-- ============================================================
-- Marcus Technical Intelligence
-- ============================================================
--
-- Marcus is a technical intelligence analyst agent. He produces
-- technical assessments, preliminary solution architectures,
-- ROMs, clarification questions, decisive blockers, and
-- teaming candidates.
--
-- Three trigger modes:
--   CAPTURE_REQUEST — reactive, dispatched by James during capture
--   PURSUIT_CHANGE  — reactive, triggered by material technical change
--   HUMAN_REQUEST   — direct request from a human operator
--
-- Marcus does NOT make GO/NO-GO decisions.
-- ============================================================

-- ============================================================
-- Technical Tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS marcus_technical_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'CAPTURE_REQUEST', 'PURSUIT_CHANGE', 'HUMAN_REQUEST'
  )),

  -- Research scope
  research_type TEXT,
  question TEXT NOT NULL,

  -- Status machine: pending -> in_progress -> completed / failed / skipped
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped'
  )),

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

CREATE INDEX idx_marcus_tasks_pending
  ON marcus_technical_tasks (status)
  WHERE status = 'pending';

CREATE INDEX idx_marcus_tasks_capture
  ON marcus_technical_tasks (capture_id);

CREATE INDEX idx_marcus_tasks_opportunity
  ON marcus_technical_tasks (opportunity_id);

-- ============================================================
-- Technical Assessments
-- ============================================================

CREATE TABLE IF NOT EXISTS technical_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent task
  task_id UUID NOT NULL REFERENCES marcus_technical_tasks(id),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Technical conclusion
  conclusion TEXT NOT NULL CHECK (conclusion IN (
    'FEASIBLE', 'FEASIBLE_WITH_RISKS', 'TEAMING_DEPENDENT',
    'INSUFFICIENT_EVIDENCE', 'TECHNICALLY_UNSUITABLE'
  )),

  -- Confidence
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  -- Full structured assessment content
  assessment_content JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TIMESTAMPTZ,

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_technical_assessments_task
  ON technical_assessments (task_id);

CREATE INDEX idx_technical_assessments_opportunity
  ON technical_assessments (opportunity_id);

CREATE INDEX idx_technical_assessments_current
  ON technical_assessments (capture_id, opportunity_id)
  WHERE superseded_at IS NULL;

-- ============================================================
-- Preliminary Solution Architectures
-- ============================================================

CREATE TABLE IF NOT EXISTS preliminary_solution_architectures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent task
  task_id UUID NOT NULL REFERENCES marcus_technical_tasks(id),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Full structured architecture content
  architecture_content JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TIMESTAMPTZ,

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psa_task
  ON preliminary_solution_architectures (task_id);

CREATE INDEX idx_psa_opportunity
  ON preliminary_solution_architectures (opportunity_id);

CREATE INDEX idx_psa_current
  ON preliminary_solution_architectures (capture_id, opportunity_id)
  WHERE superseded_at IS NULL;

-- ============================================================
-- Technical Solution Artifacts (durable, versioned)
-- ============================================================

CREATE TABLE IF NOT EXISTS technical_solution_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Current version pointer (nullable until first version created)
  current_version_id UUID,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tsa_opportunity
  ON technical_solution_artifacts (opportunity_id);

-- ============================================================
-- Technical Solution Artifact Versions (immutable append-only)
-- ============================================================

CREATE TABLE IF NOT EXISTS technical_solution_artifact_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent artifact
  artifact_id UUID NOT NULL REFERENCES technical_solution_artifacts(id),

  -- Version tracking
  version_number INTEGER NOT NULL,
  previous_version_id UUID REFERENCES technical_solution_artifact_versions(id),

  -- Full structured version content
  version_content JSONB NOT NULL,

  -- Source document version references
  source_document_version_refs TEXT[] DEFAULT '{}',

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Lifecycle (immutable — no updated_at)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tsav_artifact
  ON technical_solution_artifact_versions (artifact_id);

CREATE INDEX idx_tsav_artifact_version
  ON technical_solution_artifact_versions (artifact_id, version_number);

-- Immutable: no UPDATE or DELETE on versions
CREATE OR REPLACE FUNCTION prevent_tsav_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'technical_solution_artifact_versions rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tsav_no_update
  BEFORE UPDATE ON technical_solution_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_tsav_mutation();

CREATE TRIGGER trg_tsav_no_delete
  BEFORE DELETE ON technical_solution_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_tsav_mutation();

-- ============================================================
-- Technical ROMs
-- ============================================================

CREATE TABLE IF NOT EXISTS technical_roms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent task
  task_id UUID NOT NULL REFERENCES marcus_technical_tasks(id),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Always ROM
  estimate_type TEXT NOT NULL DEFAULT 'ROM' CHECK (estimate_type = 'ROM'),

  -- Full structured ROM content
  rom_content JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_technical_roms_task
  ON technical_roms (task_id);

CREATE INDEX idx_technical_roms_opportunity
  ON technical_roms (opportunity_id);

-- ============================================================
-- Technical Clarification Questions
-- ============================================================

CREATE TABLE IF NOT EXISTS technical_clarification_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent task
  task_id UUID NOT NULL REFERENCES marcus_technical_tasks(id),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Content
  source_requirement TEXT NOT NULL,
  proposed_question TEXT NOT NULL,

  -- Priority
  priority TEXT NOT NULL CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),

  -- Status: DRAFT or SUBMITTED_EXTERNAL (requires separate commissioning)
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED_EXTERNAL')),

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tcq_task
  ON technical_clarification_questions (task_id);

CREATE INDEX idx_tcq_opportunity
  ON technical_clarification_questions (opportunity_id);

CREATE INDEX idx_tcq_priority_status
  ON technical_clarification_questions (priority, status)
  WHERE status = 'DRAFT';

-- ============================================================
-- Technical Change Events
-- ============================================================

CREATE TABLE IF NOT EXISTS technical_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Correlation
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,

  -- Change classification
  change_type TEXT NOT NULL,
  material BOOLEAN NOT NULL DEFAULT false,

  -- Change detail
  changed_fields TEXT[] DEFAULT '{}',
  change_reasons TEXT[] DEFAULT '{}',

  -- Document version tracking
  source_document_version_id TEXT,
  previous_hash TEXT,
  new_hash TEXT,

  -- Lifecycle (immutable event log)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tce_opportunity
  ON technical_change_events (opportunity_id);

CREATE INDEX idx_tce_material
  ON technical_change_events (capture_id, opportunity_id)
  WHERE material = true;

-- ============================================================
-- Marcus Observation Windows (pursuit stewardship)
-- Same pattern as David/Rosa observation windows — durable,
-- concurrency-safe limits for controlled activation.
-- ============================================================

CREATE TABLE IF NOT EXISTS marcus_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')),

  -- Limits
  max_tasks INTEGER NOT NULL DEFAULT 10,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 0.25,

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
-- Atomic: Claim a Marcus observation slot
-- Returns TRUE if slot was claimed, FALSE if window exhausted.
-- Concurrency-safe via SELECT FOR UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_marcus_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window RECORD;
BEGIN
  SELECT * INTO v_window
  FROM marcus_observation_windows
  WHERE status = 'ACTIVE'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_window IS NULL THEN
    RETURN TRUE; -- No observation window = no limit enforced
  END IF;

  IF v_window.completed_tasks >= v_window.max_tasks THEN
    UPDATE marcus_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_TASKS_REACHED',
      stopped_at = now(), updated_at = now()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  IF v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd > v_window.max_cumulative_spend_usd THEN
    UPDATE marcus_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_SPEND_REACHED',
      stopped_at = now(), updated_at = now()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  UPDATE marcus_observation_windows SET
    completed_tasks = completed_tasks + 1,
    cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
    last_task_id = p_task_id,
    updated_at = now()
  WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Settle a Marcus observation slot after inference completes
-- ============================================================
CREATE OR REPLACE FUNCTION settle_marcus_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window_id UUID;
BEGIN
  SELECT id INTO v_window_id
  FROM marcus_observation_windows
  WHERE status IN ('ACTIVE', 'STOPPED')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_window_id IS NOT NULL THEN
    UPDATE marcus_observation_windows SET
      cumulative_reserved_spend_usd = GREATEST(cumulative_reserved_spend_usd - p_reserved_cost_usd, 0),
      cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
      last_ledger_id = p_ledger_id,
      updated_at = now()
    WHERE id = v_window_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Marcus G2X Observation
-- ============================================================

CREATE TABLE IF NOT EXISTS marcus_g2x_observation (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')) DEFAULT 'ACTIVE',

  -- Limits
  max_total_calls INTEGER NOT NULL DEFAULT 100,
  max_total_records INTEGER NOT NULL DEFAULT 2000,

  -- Counters
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

ALTER TABLE marcus_technical_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE preliminary_solution_architectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_solution_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_solution_artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_roms ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_clarification_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcus_observation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE marcus_g2x_observation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_marcus_tasks" ON marcus_technical_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_technical_assessments" ON technical_assessments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_psa" ON preliminary_solution_architectures FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tsa" ON technical_solution_artifacts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tsav" ON technical_solution_artifact_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_technical_roms" ON technical_roms FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tcq" ON technical_clarification_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_tce" ON technical_change_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_marcus_observation" ON marcus_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_marcus_g2x_observation" ON marcus_g2x_observation FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Grants
-- ============================================================

GRANT ALL ON marcus_technical_tasks TO service_role;
GRANT ALL ON technical_assessments TO service_role;
GRANT ALL ON preliminary_solution_architectures TO service_role;
GRANT ALL ON technical_solution_artifacts TO service_role;
GRANT ALL ON technical_solution_artifact_versions TO service_role;
GRANT ALL ON technical_roms TO service_role;
GRANT ALL ON technical_clarification_questions TO service_role;
GRANT ALL ON technical_change_events TO service_role;
GRANT ALL ON marcus_observation_windows TO service_role;
GRANT ALL ON marcus_g2x_observation TO service_role;

GRANT EXECUTE ON FUNCTION claim_marcus_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_marcus_observation_slot TO service_role;

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE marcus_technical_tasks IS 'Technical research tasks for Marcus. Triggered by James capture requests, pursuit changes, or human requests.';
COMMENT ON TABLE technical_assessments IS 'Structured technical feasibility assessments. Versioned with supersession tracking.';
COMMENT ON TABLE preliminary_solution_architectures IS 'Preliminary solution architectures with components, data flows, integrations, and technology decisions. Versioned.';
COMMENT ON TABLE technical_solution_artifacts IS 'Durable technical solution artifacts. Points to current version.';
COMMENT ON TABLE technical_solution_artifact_versions IS 'Immutable version history for technical solution artifacts. No UPDATE or DELETE.';
COMMENT ON TABLE technical_roms IS 'Rough order of magnitude estimates structured by workstreams.';
COMMENT ON TABLE technical_clarification_questions IS 'Technical clarification questions requiring external resolution. SUBMITTED_EXTERNAL requires separate commissioning.';
COMMENT ON TABLE technical_change_events IS 'Immutable log of material and non-material technical changes detected during pursuit.';
COMMENT ON TABLE marcus_observation_windows IS 'Durable production observation limits for Marcus controlled activation. Pursuit stewardship scope.';
COMMENT ON TABLE marcus_g2x_observation IS 'G2X usage observation window for Marcus. Limits: max 100 calls, 2000 records.';
COMMENT ON FUNCTION claim_marcus_observation_slot IS 'Atomic: claim one task slot, checking count + spend limits. Concurrency-safe.';
COMMENT ON FUNCTION settle_marcus_observation_slot IS 'Settle reserved spend after Marcus inference completes. Converts reserved to actual.';
