-- ============================================================
-- Denise — Acquisition Intelligence Lead: Deterministic Foundation
--
-- Denise interprets how the government intends to buy, evaluate,
-- and administer the work and turns acquisition rules into
-- actionable intelligence for the BD team.
--
-- This migration creates the acquisition analysis, evaluation
-- model, clause register, risk, clarification, conflict,
-- regulatory evidence, source cache, and observation infrastructure.
--
-- Authority:
--   Denise MAY NOT: authorize Pursue, issue GO/NO_GO, submit
--   proposals, contact agency, send clarification questions,
--   approve spending, provide legal advice, act as contracting
--   officer, overwrite another employee's owned artifact,
--   invent regulatory authority.
-- ============================================================

-- ============================================================
-- 1. ACQUISITION TASKS — durable task queue for Denise
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id UUID REFERENCES captures(id),
  opportunity_id TEXT,
  proposal_workspace_id UUID REFERENCES proposal_workspaces(id),

  task_type TEXT NOT NULL CHECK (task_type IN (
    'ACQUISITION_STRUCTURE', 'EVALUATION_MODEL', 'CLAUSE_ANALYSIS',
    'SUBMISSION_REQUIREMENTS', 'ELIGIBILITY', 'ACQUISITION_RISK',
    'CLARIFICATION', 'REGULATORY_INTERPRETATION', 'AMENDMENT_ANALYSIS'
  )),

  requester TEXT NOT NULL,
  question TEXT,
  research_type TEXT NOT NULL CHECK (research_type IN (
    'ACQUISITION_STRUCTURE', 'EVALUATION_MODEL', 'CLAUSE_ANALYSIS',
    'SUBMISSION_REQUIREMENTS', 'ELIGIBILITY', 'ACQUISITION_RISK',
    'CLARIFICATION', 'REGULATORY_INTERPRETATION'
  )),
  expected_artifact TEXT,
  evidence_refs JSONB DEFAULT '[]',

  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN (
    'CRITICAL', 'HIGH', 'NORMAL', 'LOW'
  )),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped', 'timed_out'
  )),

  -- Execution
  inference_ledger_id UUID,
  execution_mode TEXT DEFAULT 'REAL' CHECK (execution_mode IN (
    'REAL', 'TEST_FIXTURE'
  )),

  -- Budget
  budget_usd NUMERIC(10,4),
  budget_scope_id UUID,

  -- Timeout
  timeout_seconds INTEGER DEFAULT 300,
  timeout_at TIMESTAMPTZ,

  idempotency_key TEXT UNIQUE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_acq_tasks_capture ON acquisition_tasks(capture_id, status);
CREATE INDEX IF NOT EXISTS idx_acq_tasks_status ON acquisition_tasks(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_acq_tasks_opportunity ON acquisition_tasks(opportunity_id);

COMMENT ON TABLE acquisition_tasks IS 'Denise acquisition intelligence task queue — durable, idempotent work items';

-- ============================================================
-- 2. ACQUISITION ANALYSES — versioned, immutable
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL,
  capture_id UUID REFERENCES captures(id),
  proposal_workspace_id UUID REFERENCES proposal_workspaces(id),

  -- Solicitation identity
  solicitation_version TEXT,
  amendment_version INTEGER NOT NULL DEFAULT 0,

  -- Normalized acquisition structure
  contract_type TEXT,
  competition_type TEXT,
  set_aside TEXT,
  naics TEXT,
  size_standard TEXT,
  vehicle TEXT,
  period_of_performance TEXT,
  option_structure JSONB,
  submission_method TEXT,
  proposal_due_date TIMESTAMPTZ,
  questions_due_date TIMESTAMPTZ,

  -- Interpretation
  source_refs JSONB NOT NULL DEFAULT '[]',
  interpretation JSONB NOT NULL DEFAULT '{}',
  acquisition_implications JSONB NOT NULL DEFAULT '[]',
  unresolved_issues JSONB NOT NULL DEFAULT '[]',

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id UUID REFERENCES acquisition_analyses(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'denise',
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_analyses_opp ON acquisition_analyses(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_acq_analyses_capture ON acquisition_analyses(capture_id);
CREATE INDEX IF NOT EXISTS idx_acq_analyses_version ON acquisition_analyses(opportunity_id, version);

COMMENT ON TABLE acquisition_analyses IS 'Denise acquisition analyses — versioned, immutable, append-only';

-- Immutability trigger: prevent UPDATE on settled analyses
CREATE OR REPLACE FUNCTION prevent_acquisition_analysis_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'acquisition_analyses rows are immutable — create a new version with supersedes_id instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acquisition_analysis_immutable
  BEFORE UPDATE ON acquisition_analyses
  FOR EACH ROW
  EXECUTE FUNCTION prevent_acquisition_analysis_mutation();

-- ============================================================
-- 3. EVALUATION MODELS — structured evaluation factor analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_evaluation_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_analysis_id UUID NOT NULL REFERENCES acquisition_analyses(id),
  opportunity_id TEXT NOT NULL,

  -- Evaluation method
  evaluation_method TEXT CHECK (evaluation_method IN (
    'LPTA', 'TRADEOFF', 'BEST_VALUE', 'NOT_STATED', 'OTHER'
  )),

  -- Factors (JSONB array of structured factor objects)
  factors JSONB NOT NULL DEFAULT '[]',
  subfactors JSONB NOT NULL DEFAULT '[]',
  relative_importance JSONB NOT NULL DEFAULT '{}',
  explicit_weighting JSONB,

  -- Price and past performance treatment
  past_performance_treatment TEXT,
  price_treatment TEXT,

  -- Source evidence
  source_refs JSONB NOT NULL DEFAULT '[]',

  -- Interpretation
  acquisition_implications JSONB NOT NULL DEFAULT '[]',
  uncertainty JSONB NOT NULL DEFAULT '[]',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_eval_analysis ON acquisition_evaluation_models(acquisition_analysis_id);
CREATE INDEX IF NOT EXISTS idx_acq_eval_opp ON acquisition_evaluation_models(opportunity_id);

COMMENT ON TABLE acquisition_evaluation_models IS 'Denise evaluation model — structured Section M analysis with evidence-backed relative importance';

-- ============================================================
-- 4. CLAUSE REGISTER — material clause analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_clause_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_analysis_id UUID NOT NULL REFERENCES acquisition_analyses(id),
  opportunity_id TEXT NOT NULL,

  clause_number TEXT NOT NULL,
  authority TEXT NOT NULL,
  source_version TEXT,
  applicability TEXT,
  requirement TEXT NOT NULL,
  operational_impact TEXT,
  recommended_owner TEXT,

  risk_severity TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_severity IN (
    'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL'
  )),

  evidence_refs JSONB NOT NULL DEFAULT '[]',
  legal_review_required BOOLEAN NOT NULL DEFAULT false,
  action_required BOOLEAN NOT NULL DEFAULT false,
  action_type TEXT CHECK (action_type IN (
    'REPS_CERTS', 'OCI_MITIGATION', 'LIMITATION_ON_SUBCONTRACTING',
    'SUBCONTRACTING_PLAN', 'SECURITY_DOCUMENTATION', 'KEY_PERSONNEL_EVIDENCE',
    'MANDATORY_FORM', 'SUBMISSION_PREREQUISITE', 'OTHER'
  )),
  action_description TEXT,
  action_owner TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_clause_analysis ON acquisition_clause_register(acquisition_analysis_id);
CREATE INDEX IF NOT EXISTS idx_acq_clause_action ON acquisition_clause_register(action_required) WHERE action_required = true;

COMMENT ON TABLE acquisition_clause_register IS 'Denise clause register — material FAR/DFARS/agency provisions with operational impact';

-- ============================================================
-- 5. ACQUISITION RISKS
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_analysis_id UUID NOT NULL REFERENCES acquisition_analyses(id),
  opportunity_id TEXT NOT NULL,

  risk_type TEXT NOT NULL CHECK (risk_type IN (
    'ELIGIBILITY', 'CERTIFICATION', 'CLEARANCE', 'OCI',
    'SET_ASIDE_MISMATCH', 'VEHICLE_ACCESS', 'EXPERIENCE_REQUIREMENT',
    'SUBCONTRACTING', 'EVALUATION', 'SUBMISSION', 'CONTRACTUAL',
    'REGULATORY', 'OTHER'
  )),

  severity TEXT NOT NULL CHECK (severity IN (
    'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  )),

  source_refs JSONB NOT NULL DEFAULT '[]',
  source_fact TEXT NOT NULL,
  interpretation TEXT NOT NULL,
  operational_impact TEXT NOT NULL,

  affected_owner TEXT,
  affected_workflow TEXT,

  potentially_disqualifying BOOLEAN NOT NULL DEFAULT false,
  legal_review_required BOOLEAN NOT NULL DEFAULT false,

  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'MITIGATED', 'ACCEPTED', 'CLOSED', 'SUPERSEDED'
  )),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_risks_analysis ON acquisition_risks(acquisition_analysis_id);
CREATE INDEX IF NOT EXISTS idx_acq_risks_severity ON acquisition_risks(severity) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_acq_risks_disqualifying ON acquisition_risks(potentially_disqualifying) WHERE potentially_disqualifying = true;

COMMENT ON TABLE acquisition_risks IS 'Denise acquisition risks — eligibility, compliance, structural risks with disqualification flagging';

-- ============================================================
-- 6. CLARIFICATION QUESTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_clarification_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_analysis_id UUID NOT NULL REFERENCES acquisition_analyses(id),
  opportunity_id TEXT NOT NULL,

  source_section TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]',
  ambiguity TEXT NOT NULL,
  conflicting_language TEXT,
  operational_impact TEXT NOT NULL,
  affected_area TEXT,

  proposed_question TEXT NOT NULL,

  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN (
    'CRITICAL', 'HIGH', 'NORMAL', 'LOW'
  )),
  question_deadline TIMESTAMPTZ,

  classification TEXT NOT NULL CHECK (classification IN (
    'CLARIFICATION_NEEDED', 'INTERPRETATION_REQUIRED', 'LEGAL_REVIEW_REQUIRED'
  )),

  -- Human approval gate — Denise may draft, never send
  human_approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (human_approval_status IN (
    'PENDING', 'APPROVED', 'REJECTED', 'DEFERRED'
  )),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  -- External send gate — NOT implemented in foundation
  external_send_status TEXT NOT NULL DEFAULT 'NOT_SENT' CHECK (external_send_status IN (
    'NOT_SENT', 'DRAFT_ONLY'
  )),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_clarification_analysis ON acquisition_clarification_questions(acquisition_analysis_id);
CREATE INDEX IF NOT EXISTS idx_acq_clarification_priority ON acquisition_clarification_questions(priority) WHERE human_approval_status = 'PENDING';

COMMENT ON TABLE acquisition_clarification_questions IS 'Denise clarification questions — draft only, human approval required, no external send capability';

-- ============================================================
-- 7. ACQUISITION CONFLICTS
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_analysis_id UUID REFERENCES acquisition_analyses(id),
  opportunity_id TEXT NOT NULL,

  -- What conflicts
  acquisition_artifact_id TEXT NOT NULL,
  conflicting_artifact_type TEXT NOT NULL,
  conflicting_artifact_id TEXT NOT NULL,

  source_refs JSONB NOT NULL DEFAULT '[]',
  conflict_description TEXT NOT NULL,
  affected_owners TEXT[] NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'RESOLVED', 'SUPERSEDED'
  )),
  decision_owner TEXT,
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_conflicts_analysis ON acquisition_conflicts(acquisition_analysis_id);
CREATE INDEX IF NOT EXISTS idx_acq_conflicts_status ON acquisition_conflicts(status) WHERE status = 'OPEN';

COMMENT ON TABLE acquisition_conflicts IS 'Denise acquisition conflicts — cross-artifact conflicts, never overwrites another employee artifact';

-- ============================================================
-- 8. REGULATORY EVIDENCE — authoritative regulatory source records
-- ============================================================
CREATE TABLE IF NOT EXISTS regulatory_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  authority TEXT NOT NULL,
  citation TEXT NOT NULL,
  provision TEXT,
  source_url TEXT,
  title TEXT,

  -- Version/freshness
  version TEXT,
  effective_date DATE,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash TEXT NOT NULL,
  bounded_relevant_text TEXT NOT NULL,

  -- Freshness tracking
  freshness_status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (freshness_status IN (
    'CURRENT', 'REVALIDATION_REQUIRED', 'SUPERSEDED', 'UNKNOWN'
  )),
  superseded_by_id UUID REFERENCES regulatory_evidence(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reg_evidence_citation ON regulatory_evidence(authority, citation);
CREATE INDEX IF NOT EXISTS idx_reg_evidence_freshness ON regulatory_evidence(freshness_status) WHERE freshness_status != 'CURRENT';

COMMENT ON TABLE regulatory_evidence IS 'Denise regulatory evidence — authoritative source records with citation/version/hash verification';

-- Immutability trigger for regulatory evidence
CREATE OR REPLACE FUNCTION prevent_regulatory_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow freshness_status updates only
  IF NEW.authority != OLD.authority
     OR NEW.citation != OLD.citation
     OR NEW.content_hash != OLD.content_hash
     OR NEW.bounded_relevant_text != OLD.bounded_relevant_text THEN
    RAISE EXCEPTION 'regulatory_evidence substantive fields are immutable — create a new record';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_regulatory_evidence_immutable
  BEFORE UPDATE ON regulatory_evidence
  FOR EACH ROW
  EXECUTE FUNCTION prevent_regulatory_evidence_mutation();

-- ============================================================
-- 9. REGULATORY SOURCE CACHE — reusable authoritative source cache
-- ============================================================
CREATE TABLE IF NOT EXISTS regulatory_source_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  authority TEXT NOT NULL,
  citation TEXT NOT NULL,
  version TEXT,
  effective_date DATE,

  source_url TEXT,
  content_hash TEXT NOT NULL,
  cached_text TEXT NOT NULL,

  -- Freshness (not fixed TTL)
  freshness_status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (freshness_status IN (
    'CURRENT', 'REVALIDATION_REQUIRED', 'SUPERSEDED', 'EXPIRED'
  )),
  last_validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseding_version TEXT,
  superseding_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(authority, citation, version)
);

CREATE INDEX IF NOT EXISTS idx_reg_cache_lookup ON regulatory_source_cache(authority, citation);
CREATE INDEX IF NOT EXISTS idx_reg_cache_freshness ON regulatory_source_cache(freshness_status) WHERE freshness_status != 'CURRENT';

COMMENT ON TABLE regulatory_source_cache IS 'Denise regulatory source cache — reusable authoritative sources, freshness by citation/version/hash, not fixed TTL';

-- ============================================================
-- 10. DENISE OBSERVATION WINDOWS (AI budget, disabled)
-- ============================================================
CREATE TABLE IF NOT EXISTS denise_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type TEXT NOT NULL CHECK (observation_type IN (
    'CAPTURE', 'PURSUIT'
  )),
  status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (status IN (
    'INACTIVE', 'ACTIVE', 'STOPPED', 'COMPLETE'
  )),

  -- Capture observation: shares James parent, Denise child $0.05
  -- Pursuit observation: 10 calls / $0.25
  max_calls INTEGER NOT NULL DEFAULT 10,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 0.25,

  completed_calls INTEGER NOT NULL DEFAULT 0,
  cumulative_actual_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  cumulative_reserved_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,

  -- Context
  capture_id UUID REFERENCES captures(id),
  proposal_workspace_id UUID REFERENCES proposal_workspaces(id),

  stop_reason TEXT,
  last_task_id UUID,
  last_ledger_id UUID,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE denise_observation_windows IS 'Denise observation windows — capture ($0.05 child) and pursuit (10 calls / $0.25) budgets, INACTIVE until commissioning';

-- Observation window: claim slot
CREATE OR REPLACE FUNCTION claim_denise_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window denise_observation_windows%ROWTYPE;
BEGIN
  SELECT * INTO v_window
    FROM denise_observation_windows
    WHERE status = 'ACTIVE'
    ORDER BY started_at DESC LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Check call count
  IF v_window.completed_calls >= v_window.max_calls THEN
    UPDATE denise_observation_windows
      SET status = 'STOPPED', stop_reason = 'MAX_CALLS_REACHED',
          stopped_at = NOW(), updated_at = NOW()
      WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  -- Check spend
  IF (v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd) > v_window.max_cumulative_spend_usd THEN
    UPDATE denise_observation_windows
      SET status = 'STOPPED', stop_reason = 'SPEND_CEILING_REACHED',
          stopped_at = NOW(), updated_at = NOW()
      WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  UPDATE denise_observation_windows
    SET completed_calls = completed_calls + 1,
        cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
        last_task_id = p_task_id, updated_at = NOW()
    WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Observation window: settle slot
CREATE OR REPLACE FUNCTION settle_denise_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window denise_observation_windows%ROWTYPE;
BEGIN
  SELECT * INTO v_window
    FROM denise_observation_windows
    WHERE status IN ('ACTIVE', 'STOPPED')
    ORDER BY started_at DESC LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE denise_observation_windows
    SET cumulative_reserved_spend_usd = GREATEST(0, cumulative_reserved_spend_usd - p_reserved_cost_usd),
        cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
        last_ledger_id = p_ledger_id, updated_at = NOW()
    WHERE id = v_window.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY — service_role only
-- ============================================================

ALTER TABLE acquisition_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_tasks" ON acquisition_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_tasks TO service_role;

ALTER TABLE acquisition_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_analyses" ON acquisition_analyses FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_analyses TO service_role;

ALTER TABLE acquisition_evaluation_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_eval" ON acquisition_evaluation_models FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_evaluation_models TO service_role;

ALTER TABLE acquisition_clause_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_clause" ON acquisition_clause_register FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_clause_register TO service_role;

ALTER TABLE acquisition_risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_risks" ON acquisition_risks FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_risks TO service_role;

ALTER TABLE acquisition_clarification_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_clarifications" ON acquisition_clarification_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_clarification_questions TO service_role;

ALTER TABLE acquisition_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_acq_conflicts" ON acquisition_conflicts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON acquisition_conflicts TO service_role;

ALTER TABLE regulatory_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_reg_evidence" ON regulatory_evidence FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON regulatory_evidence TO service_role;

ALTER TABLE regulatory_source_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_reg_cache" ON regulatory_source_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON regulatory_source_cache TO service_role;

ALTER TABLE denise_observation_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_denise_windows" ON denise_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON denise_observation_windows TO service_role;

-- Function grants
GRANT EXECUTE ON FUNCTION claim_denise_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_denise_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION prevent_acquisition_analysis_mutation TO service_role;
GRANT EXECUTE ON FUNCTION prevent_regulatory_evidence_mutation TO service_role;
