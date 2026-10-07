-- ============================================================
-- Jodie — Proposal Writer: Deterministic Foundation
--
-- Evidence before prose. No silent gap filling.
--
-- Jodie turns authoritative solicitation requirements, capture
-- strategy, technical inputs, teaming inputs, approved company
-- evidence, and pricing/form inputs into compliant proposal
-- structure, traceable content, and reviewable artifacts.
--
-- This migration creates the proposal requirements, compliance
-- matrix, evidence library, section versioning, claim provenance,
-- form mapping, rendered artifacts, and submission checklist.
--
-- Authority:
--   Jodie MAY NOT: authorize Pursue, make GO/NO_GO, invent past
--   performance/personnel/certifications/metrics/pricing, submit
--   externally, sign forms, send email, contact government/partners.
-- ============================================================

-- ============================================================
-- 1. PROPOSAL REQUIREMENTS / COMPLIANCE MATRIX
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  source_document_id TEXT,
  source_version_id TEXT,
  source_page TEXT,
  source_section TEXT,
  requirement_text TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN (
    'TECHNICAL', 'MANAGEMENT', 'PAST_PERFORMANCE', 'PERSONNEL',
    'SECURITY', 'CERTIFICATION', 'PRICING', 'ADMINISTRATIVE',
    'FORM', 'ATTACHMENT', 'SUBMISSION', 'OTHER'
  )),
  mandatory BOOLEAN NOT NULL DEFAULT true,
  evaluation_factor TEXT,
  response_location TEXT,
  owner_type TEXT,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'IDENTIFIED' CHECK (status IN (
    'IDENTIFIED', 'ASSIGNED', 'COVERED', 'GAP',
    'COMPLIANCE_RISK', 'NOT_APPLICABLE', 'SUPERSEDED'
  )),
  compliance_risk TEXT CHECK (compliance_risk IN (
    'NONE', 'LOW', 'MEDIUM', 'HIGH', 'FATAL'
  )),
  evidence_refs TEXT[] DEFAULT '{}',
  interpretation_status TEXT DEFAULT 'PENDING' CHECK (interpretation_status IN (
    'PENDING', 'INTERPRETED', 'AMBIGUOUS', 'CLARIFICATION_NEEDED'
  )),
  amendment_version INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_req_workspace ON proposal_requirements(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_req_status ON proposal_requirements(status) WHERE status NOT IN ('COVERED', 'NOT_APPLICABLE', 'SUPERSEDED');
CREATE INDEX IF NOT EXISTS idx_prop_req_type ON proposal_requirements(requirement_type);

COMMENT ON TABLE proposal_requirements IS 'Jodie proposal requirements / compliance matrix — every solicitation requirement as durable structured state';

-- ============================================================
-- 2. APPROVED EVIDENCE LIBRARY
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'CORPORATE_CAPABILITY', 'PAST_PERFORMANCE', 'RESUME',
    'CERTIFICATION', 'SOCIOECONOMIC_STATUS', 'CONTRACT_VEHICLE',
    'METRIC', 'CUSTOMER_REFERENCE', 'TECHNICAL_ARTIFACT',
    'TEAMING_ARTIFACT', 'CAPTURE_STRATEGY', 'PRICING_INPUT',
    'COMPANY_IDENTIFIER', 'FORM_VALUE'
  )),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version_id TEXT,
  title TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  provenance JSONB NOT NULL DEFAULT '{}',
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  human_verified BOOLEAN NOT NULL DEFAULT false,
  proposal_usable BOOLEAN NOT NULL DEFAULT false,
  sensitivity TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (sensitivity IN (
    'PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED'
  )),
  allowed_use_scope TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_evidence_workspace ON proposal_evidence_items(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_evidence_type ON proposal_evidence_items(evidence_type);
CREATE INDEX IF NOT EXISTS idx_prop_evidence_usable ON proposal_evidence_items(proposal_usable) WHERE proposal_usable = true;

COMMENT ON TABLE proposal_evidence_items IS 'Jodie approved evidence library — facts usable in proposal content, with provenance and human approval';

-- ============================================================
-- 3. PROPOSAL SECTIONS (versioned)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  requirement_refs TEXT[] DEFAULT '{}',
  owner TEXT,
  current_version_id UUID,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN (
    'NOT_STARTED', 'DRAFTING', 'DRAFTED', 'REVIEW_REQUIRED',
    'CHANGES_REQUESTED', 'REVISION_REQUIRED', 'APPROVED'
  )),
  stale BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  lock_reason TEXT,
  max_pages INTEGER,
  max_words INTEGER,
  pass_count INTEGER NOT NULL DEFAULT 0,
  input_version_hash TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_workspace_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_prop_sections_workspace ON proposal_sections(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_sections_status ON proposal_sections(status) WHERE status NOT IN ('APPROVED');

COMMENT ON TABLE proposal_sections IS 'Jodie proposal sections — lifecycle, locks, staleness, pass counts';

-- ============================================================
-- 4. PROPOSAL SECTION VERSIONS (immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_section_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES proposal_sections(id),
  version_number INTEGER NOT NULL,
  previous_version_id UUID REFERENCES proposal_section_versions(id),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  evidence_refs TEXT[] DEFAULT '{}',
  requirement_coverage TEXT[] DEFAULT '{}',
  upstream_artifact_versions JSONB DEFAULT '{}',
  author_type TEXT NOT NULL CHECK (author_type IN ('AI', 'HUMAN', 'HYBRID')),
  author_id TEXT,
  word_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at — immutable
);

CREATE INDEX IF NOT EXISTS idx_prop_sv_section ON proposal_section_versions(section_id);

-- Immutability triggers
CREATE OR REPLACE FUNCTION prevent_section_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'proposal_section_versions is immutable — inserts only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_psv_no_update ON proposal_section_versions;
CREATE TRIGGER trg_psv_no_update
  BEFORE UPDATE ON proposal_section_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_section_version_mutation();

DROP TRIGGER IF EXISTS trg_psv_no_delete ON proposal_section_versions;
CREATE TRIGGER trg_psv_no_delete
  BEFORE DELETE ON proposal_section_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_section_version_mutation();

COMMENT ON TABLE proposal_section_versions IS 'Jodie proposal section versions — immutable append-only content history';

-- ============================================================
-- 5. PROPOSAL CLAIMS (evidence-backed assertions)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_version_id UUID NOT NULL REFERENCES proposal_section_versions(id),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'PAST_PERFORMANCE', 'TECHNICAL_CAPABILITY', 'CERTIFICATION',
    'CONTRACT_VEHICLE', 'PERSONNEL_QUALIFICATION', 'METRIC',
    'CUSTOMER_RESULT', 'CORPORATE_STATUS', 'IMPLEMENTATION',
    'TECHNICAL_ASSERTION', 'COMMITMENT', 'OTHER'
  )),
  material BOOLEAN NOT NULL DEFAULT true,
  evidence_refs TEXT[] DEFAULT '{}',
  validation_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN (
    'PENDING', 'SUPPORTED', 'UNSUPPORTED', 'CANDIDATE_EVIDENCE'
  )),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_claims_sv ON proposal_claims(section_version_id);
CREATE INDEX IF NOT EXISTS idx_prop_claims_workspace ON proposal_claims(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_claims_unsupported ON proposal_claims(validation_status) WHERE validation_status = 'UNSUPPORTED';

COMMENT ON TABLE proposal_claims IS 'Jodie proposal claims — material assertions requiring evidence provenance';

-- ============================================================
-- 6. PROPOSAL REVIEWS (human approval)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('SECTION', 'PROPOSAL')),
  target_id UUID NOT NULL,
  target_version_id UUID,
  review_role TEXT NOT NULL CHECK (review_role IN (
    'CONTENT_CAPTURE', 'FINAL_MANAGEMENT', 'TECHNICAL', 'COMPLIANCE', 'EXECUTIVE'
  )),
  reviewer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'INVALIDATED'
  )),
  comments TEXT,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_reviews_workspace ON proposal_reviews(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_reviews_target ON proposal_reviews(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_prop_reviews_status ON proposal_reviews(status) WHERE status NOT IN ('INVALIDATED');

COMMENT ON TABLE proposal_reviews IS 'Jodie proposal reviews — human approval tracking with invalidation on material change';

-- ============================================================
-- 7. PROPOSAL SPECIALIST REQUESTS (cross-agent structured requests)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_specialist_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  request_type TEXT NOT NULL CHECK (request_type IN (
    'CAPTURE_STRATEGY', 'TECHNICAL_SOLUTION', 'TECHNICAL_FEASIBILITY',
    'COMPETITIVE_INTELLIGENCE', 'PARTNER_INTELLIGENCE', 'TEAMING_INPUT',
    'OPERATIONAL_READINESS', 'ACQUISITION_INTERPRETATION', 'PRICING_INPUT'
  )),
  target_agent TEXT NOT NULL,
  request_description TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  dependency_refs TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  response_artifact_id TEXT,
  response_artifact_version_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_spec_req_workspace ON proposal_specialist_requests(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_spec_req_status ON proposal_specialist_requests(status) WHERE status = 'PENDING';

COMMENT ON TABLE proposal_specialist_requests IS 'Jodie cross-agent structured requests — no direct agent chat';

-- ============================================================
-- 8. PROPOSAL CONFLICTS
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  conflict_type TEXT NOT NULL CHECK (conflict_type IN (
    'STRATEGY_VS_TECHNICAL', 'STRATEGY_VS_TEAMING',
    'TECHNICAL_VS_COMPLIANCE', 'EVIDENCE_CONFLICT',
    'REQUIREMENT_CONFLICT', 'OTHER'
  )),
  affected_section_ids UUID[] DEFAULT '{}',
  input_a JSONB NOT NULL,
  input_b JSONB NOT NULL,
  decision_owner TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'RESOLVED', 'SUPERSEDED'
  )),
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_conflicts_workspace ON proposal_conflicts(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_conflicts_open ON proposal_conflicts(status) WHERE status = 'OPEN';

COMMENT ON TABLE proposal_conflicts IS 'Jodie proposal conflicts — blocks affected sections until decision owner resolves';

-- ============================================================
-- 9. APPROVED PRICING INPUTS
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_pricing_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value JSONB NOT NULL,
  currency TEXT DEFAULT 'USD',
  source_version TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  locked BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_workspace_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_prop_pricing_workspace ON proposal_pricing_inputs(proposal_workspace_id);

COMMENT ON TABLE proposal_pricing_inputs IS 'Jodie approved pricing inputs — Jodie may reference but never originate pricing';

-- ============================================================
-- 10. FORM MAPPING
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_form_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  form_type TEXT NOT NULL,
  form_version TEXT,
  field_identifier TEXT NOT NULL,
  target_data_path TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (mapping_status IN (
    'PROPOSED', 'APPROVED', 'REJECTED'
  )),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_workspace_id, form_type, field_identifier)
);

CREATE INDEX IF NOT EXISTS idx_prop_forms_workspace ON proposal_form_mappings(proposal_workspace_id);

COMMENT ON TABLE proposal_form_mappings IS 'Jodie form field mapping — proposed by Jodie, approved by human before population';

-- ============================================================
-- 11. FORM VALUES (populated from approved mappings + sources)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_form_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  form_mapping_id UUID NOT NULL REFERENCES proposal_form_mappings(id),
  resolved_value JSONB,
  resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED' CHECK (resolution_status IN (
    'RESOLVED', 'UNRESOLVED', 'HUMAN_INPUT_REQUIRED', 'ERROR'
  )),
  source_evidence_id UUID,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_fv_workspace ON proposal_form_values(proposal_workspace_id);

COMMENT ON TABLE proposal_form_values IS 'Jodie form values — deterministically populated from approved mappings and evidence';

-- ============================================================
-- 12. RENDERED ARTIFACTS (DOCX/PDF/XLSX metadata)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_rendered_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  artifact_type TEXT NOT NULL CHECK (artifact_type IN (
    'PROPOSAL_DOCX', 'PROPOSAL_PDF', 'PRICING_XLSX',
    'ATTACHMENT', 'FORM', 'PACKAGE'
  )),
  version_number INTEGER NOT NULL DEFAULT 1,
  storage_bucket TEXT NOT NULL DEFAULT 'proposal-artifacts',
  storage_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_size_bytes BIGINT,
  source_proposal_version TEXT,
  template_version TEXT,
  solicitation_version TEXT,
  amendment_version INTEGER,
  review_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (review_status IN (
    'DRAFT', 'REVIEW_READY', 'APPROVED', 'SUPERSEDED'
  )),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_rendered_workspace ON proposal_rendered_artifacts(proposal_workspace_id);

COMMENT ON TABLE proposal_rendered_artifacts IS 'Jodie rendered artifacts — DOCX/PDF/XLSX with full metadata and storage references';

-- ============================================================
-- 13. FILE VERSIONS (human edit re-ingestion)
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_file_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rendered_artifact_id UUID NOT NULL REFERENCES proposal_rendered_artifacts(id),
  version_number INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_size_bytes BIGINT,
  upload_source TEXT NOT NULL CHECK (upload_source IN ('SYSTEM', 'HUMAN_EDIT')),
  uploaded_by TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (reconciliation_status IN (
    'CURRENT', 'RECONCILIATION_REQUIRED', 'RECONCILED', 'SUPERSEDED'
  )),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO updated_at — append-only for versions
);

CREATE INDEX IF NOT EXISTS idx_prop_fv_artifact ON proposal_file_versions(rendered_artifact_id);

COMMENT ON TABLE proposal_file_versions IS 'Jodie file versions — immutable version history including human-edited re-ingestion';

-- Immutability on file versions (content, not metadata)
CREATE OR REPLACE FUNCTION prevent_file_version_content_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.content_hash != NEW.content_hash OR OLD.storage_path != NEW.storage_path THEN
    RAISE EXCEPTION 'proposal_file_versions content is immutable — only reconciliation_status may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pfv_no_content_update ON proposal_file_versions;
CREATE TRIGGER trg_pfv_no_content_update
  BEFORE UPDATE ON proposal_file_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_file_version_content_mutation();

-- ============================================================
-- 14. SUBMISSION CHECKLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_submission_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  gate_type TEXT NOT NULL CHECK (gate_type IN (
    'COMPLIANCE', 'EVIDENCE', 'PRODUCTION'
  )),
  check_id TEXT NOT NULL,
  check_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PASSED', 'FAILED', 'WAIVED', 'NOT_APPLICABLE'
  )),
  blocking BOOLEAN NOT NULL DEFAULT true,
  evidence JSONB DEFAULT '{}',
  last_evaluated_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_workspace_id, check_id)
);

CREATE INDEX IF NOT EXISTS idx_prop_checklist_workspace ON proposal_submission_checklist(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_prop_checklist_failed ON proposal_submission_checklist(status) WHERE status IN ('PENDING', 'FAILED');

COMMENT ON TABLE proposal_submission_checklist IS 'Jodie submission checklist — deterministic readiness gates';

-- ============================================================
-- 15. AMENDMENT IMPACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS proposal_amendment_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL REFERENCES proposal_workspaces(id),
  amendment_version INTEGER NOT NULL,
  source_document_id TEXT,
  source_version_id TEXT,
  change_class TEXT NOT NULL CHECK (change_class IN (
    'NON_MATERIAL', 'MATERIAL_LOCAL', 'MATERIAL_GLOBAL'
  )),
  affected_requirement_ids UUID[] DEFAULT '{}',
  affected_section_ids UUID[] DEFAULT '{}',
  description TEXT NOT NULL,
  impact_assessment JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'PROCESSED', 'CAPTURE_REASSESSMENT_REQUIRED'
  )),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_amendments_workspace ON proposal_amendment_impacts(proposal_workspace_id);

COMMENT ON TABLE proposal_amendment_impacts IS 'Jodie amendment impact tracking — NON_MATERIAL, MATERIAL_LOCAL, MATERIAL_GLOBAL classification';

-- ============================================================
-- 16. JODIE OBSERVATION WINDOWS (AI budget, disabled)
-- ============================================================
CREATE TABLE IF NOT EXISTS jodie_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (status IN (
    'INACTIVE', 'ACTIVE', 'STOPPED', 'COMPLETE'
  )),
  max_tasks INTEGER NOT NULL DEFAULT 20,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 1.00,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  cumulative_actual_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  cumulative_reserved_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  stop_reason TEXT,
  last_task_id UUID,
  last_ledger_id UUID,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE jodie_observation_windows IS 'Jodie observation windows — AI proposal budget (INACTIVE until commissioning)';

-- Observation window functions
CREATE OR REPLACE FUNCTION claim_jodie_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window jodie_observation_windows%ROWTYPE;
BEGIN
  SELECT * INTO v_window
    FROM jodie_observation_windows
    WHERE status = 'ACTIVE'
    ORDER BY started_at DESC LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN RETURN TRUE; END IF;

  IF v_window.completed_tasks >= v_window.max_tasks THEN
    UPDATE jodie_observation_windows
      SET status = 'STOPPED', stop_reason = 'max_tasks_reached',
          stopped_at = NOW(), updated_at = NOW()
      WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  IF (v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd) > v_window.max_cumulative_spend_usd THEN
    UPDATE jodie_observation_windows
      SET status = 'STOPPED', stop_reason = 'spend_ceiling_reached',
          stopped_at = NOW(), updated_at = NOW()
      WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  UPDATE jodie_observation_windows
    SET completed_tasks = completed_tasks + 1,
        cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
        last_task_id = p_task_id, updated_at = NOW()
    WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION settle_jodie_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window jodie_observation_windows%ROWTYPE;
BEGIN
  SELECT * INTO v_window
    FROM jodie_observation_windows
    WHERE status IN ('ACTIVE', 'STOPPED')
    ORDER BY started_at DESC LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE jodie_observation_windows
    SET cumulative_reserved_spend_usd = GREATEST(0, cumulative_reserved_spend_usd - p_reserved_cost_usd),
        cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
        last_ledger_id = p_ledger_id, updated_at = NOW()
    WHERE id = v_window.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY — service_role only
-- ============================================================

ALTER TABLE proposal_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_requirements" ON proposal_requirements FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_requirements TO service_role;

ALTER TABLE proposal_evidence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_evidence" ON proposal_evidence_items FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_evidence_items TO service_role;

ALTER TABLE proposal_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_sections" ON proposal_sections FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_sections TO service_role;

ALTER TABLE proposal_section_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_sv" ON proposal_section_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_section_versions TO service_role;

ALTER TABLE proposal_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_claims" ON proposal_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_claims TO service_role;

ALTER TABLE proposal_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_reviews" ON proposal_reviews FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_reviews TO service_role;

ALTER TABLE proposal_specialist_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_spec_req" ON proposal_specialist_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_specialist_requests TO service_role;

ALTER TABLE proposal_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_conflicts" ON proposal_conflicts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_conflicts TO service_role;

ALTER TABLE proposal_pricing_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_pricing" ON proposal_pricing_inputs FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_pricing_inputs TO service_role;

ALTER TABLE proposal_form_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_forms" ON proposal_form_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_form_mappings TO service_role;

ALTER TABLE proposal_form_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_fv" ON proposal_form_values FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_form_values TO service_role;

ALTER TABLE proposal_rendered_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_rendered" ON proposal_rendered_artifacts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_rendered_artifacts TO service_role;

ALTER TABLE proposal_file_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_file_versions" ON proposal_file_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_file_versions TO service_role;

ALTER TABLE proposal_submission_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_checklist" ON proposal_submission_checklist FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_submission_checklist TO service_role;

ALTER TABLE proposal_amendment_impacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_prop_amendments" ON proposal_amendment_impacts FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON proposal_amendment_impacts TO service_role;

ALTER TABLE jodie_observation_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_jodie_windows" ON jodie_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON jodie_observation_windows TO service_role;

-- Function grants
GRANT EXECUTE ON FUNCTION claim_jodie_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_jodie_observation_slot TO service_role;
