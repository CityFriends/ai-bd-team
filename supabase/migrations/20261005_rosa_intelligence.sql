-- ============================================================
-- Rosa Teaming & Partner Intelligence
-- ============================================================
--
-- Rosa is a teaming & partner intelligence agent. She produces
-- partner briefs and outreach drafts. She operates in multiple modes:
--
--   CAPTURE_REQUEST        — reactive, dispatched by James
--   DAVID_PARTNER_CANDIDATE — follow-up from David's partner signal
--   COMPANY_SIGNAL         — proactive company monitoring
--   RELATIONSHIP_SIGNAL    — proactive relationship change
--   HUMAN_REQUEST          — direct from human operator
--
-- Rosa does NOT initiate outreach. She provides partner briefs
-- and draft communications for James and human approval.
-- ============================================================

-- ============================================================
-- Intelligence Tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS rosa_intelligence_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trigger
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'CAPTURE_REQUEST', 'DAVID_PARTNER_CANDIDATE', 'COMPANY_SIGNAL',
    'RELATIONSHIP_SIGNAL', 'HUMAN_REQUEST'
  )),
  trigger_source_id TEXT NOT NULL,

  -- Status machine: pending -> in_progress -> completed / failed / skipped
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped'
  )),

  -- Teaming scope
  teaming_need TEXT,
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

CREATE INDEX idx_rosa_tasks_pending
  ON rosa_intelligence_tasks (status)
  WHERE status = 'pending';

CREATE INDEX idx_rosa_tasks_trigger_type
  ON rosa_intelligence_tasks (trigger_type);

CREATE INDEX idx_rosa_tasks_opportunity
  ON rosa_intelligence_tasks (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

-- ============================================================
-- Partner Briefs
-- ============================================================

CREATE TABLE IF NOT EXISTS rosa_partner_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent task
  task_id UUID NOT NULL REFERENCES rosa_intelligence_tasks(id),

  -- Company
  company TEXT NOT NULL,
  company_uei TEXT,

  -- Context
  context_type TEXT NOT NULL CHECK (context_type IN (
    'CAPTURE', 'PROACTIVE', 'HUMAN_REQUEST'
  )),

  -- Correlation
  capture_id UUID,
  opportunity_id TEXT,

  -- Assessment
  recommended_relationship TEXT NOT NULL CHECK (recommended_relationship IN (
    'PRIME_PARTNER', 'SUB_TO_PARTNER', 'JV', 'EXPLORE', 'NOT_RECOMMENDED'
  )),

  -- Full structured brief content
  brief_content JSONB NOT NULL,

  -- Evidence provenance
  evidence_refs TEXT[] DEFAULT '{}',

  -- Confidence
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  -- Versioning (new versions supersede old ones)
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TIMESTAMPTZ,

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rosa_briefs_task
  ON rosa_partner_briefs (task_id);

CREATE INDEX idx_rosa_briefs_company
  ON rosa_partner_briefs (company);

CREATE INDEX idx_rosa_briefs_current
  ON rosa_partner_briefs (company, context_type)
  WHERE superseded_at IS NULL;

-- ============================================================
-- Outreach Drafts
-- ============================================================

CREATE TABLE IF NOT EXISTS rosa_outreach_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent brief
  partner_brief_id UUID NOT NULL REFERENCES rosa_partner_briefs(id),

  -- Target
  company TEXT NOT NULL,
  contact_name TEXT,
  contact_role TEXT,

  -- Content
  context TEXT NOT NULL,
  objective TEXT NOT NULL,
  subject TEXT,
  message_body TEXT NOT NULL,

  -- Evidence
  evidence_refs TEXT[] DEFAULT '{}',

  -- Correlation
  capture_id UUID,

  -- Approval workflow
  requires_james_approval BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'JAMES_APPROVED', 'HUMAN_APPROVED', 'REJECTED'
  )),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,

  -- Idempotency
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rosa_outreach_brief
  ON rosa_outreach_drafts (partner_brief_id);

CREATE INDEX idx_rosa_outreach_status
  ON rosa_outreach_drafts (status)
  WHERE status = 'DRAFT';

-- ============================================================
-- Organizations (shared relationship graph)
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  canonical_name TEXT NOT NULL,
  uei TEXT UNIQUE,
  cage_code TEXT,
  sam_identifiers JSONB,
  website TEXT,
  aliases TEXT[] DEFAULT '{}',

  -- Classification
  organization_type TEXT NOT NULL DEFAULT 'COMPANY' CHECK (organization_type IN (
    'COMPANY', 'GOVERNMENT', 'NONPROFIT', 'OTHER'
  )),

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_name
  ON organizations (canonical_name);

CREATE INDEX idx_organizations_uei
  ON organizations (uei)
  WHERE uei IS NOT NULL;

-- ============================================================
-- People
-- ============================================================

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Organization link
  organization_id UUID NOT NULL REFERENCES organizations(id),

  -- Identity
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  linkedin TEXT,

  -- Provenance
  provenance TEXT NOT NULL,
  human_verified BOOLEAN NOT NULL DEFAULT false,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_people_org
  ON people (organization_id);

CREATE INDEX idx_people_name
  ON people (name);

-- ============================================================
-- Organization Relationships
-- ============================================================

CREATE TABLE IF NOT EXISTS organization_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationship pair
  organization_a_id UUID NOT NULL REFERENCES organizations(id),
  organization_b_id UUID NOT NULL REFERENCES organizations(id),

  -- Classification
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'FFTC_WORKED_WITH', 'TEAMED_WITH', 'COMPETED_WITH',
    'CONTACTED', 'MET_AT_EVENT', 'PRIME_SUB_HISTORY',
    'JV_HISTORY', 'STRATEGIC_RELATIONSHIP'
  )),

  -- Evidence link
  evidence_id UUID,

  -- Observation
  observed_at TIMESTAMPTZ,
  entered_by_human BOOLEAN NOT NULL DEFAULT false,
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  notes TEXT,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only one relationship of each type per pair
  UNIQUE (organization_a_id, organization_b_id, relationship_type)
);

CREATE INDEX idx_org_rel_a
  ON organization_relationships (organization_a_id);

CREATE INDEX idx_org_rel_b
  ON organization_relationships (organization_b_id);

-- ============================================================
-- Person Relationships
-- ============================================================

CREATE TABLE IF NOT EXISTS person_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Person link
  person_id UUID NOT NULL REFERENCES people(id),

  -- Classification
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'KNOWN_BY_FFTC', 'CONTACTED_BY_FFTC', 'MET_BY_FFTC', 'WORKED_WITH_FFTC'
  )),

  -- Context
  context TEXT,
  observed_at TIMESTAMPTZ,
  entered_by_human BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_person_rel_person
  ON person_relationships (person_id);

-- ============================================================
-- Relationship Assessments
-- ============================================================

CREATE TABLE IF NOT EXISTS relationship_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent relationship
  organization_relationship_id UUID NOT NULL REFERENCES organization_relationships(id),

  -- Assessment
  strength TEXT NOT NULL CHECK (strength IN (
    'STRONG', 'MODERATE', 'WEAK', 'NEW', 'STALE'
  )),
  relevance TEXT NOT NULL CHECK (relevance IN (
    'HIGH', 'MEDIUM', 'LOW', 'NONE'
  )),
  risks TEXT[] DEFAULT '{}',
  likely_teaming_direction TEXT NOT NULL CHECK (likely_teaming_direction IN (
    'PRIME_PARTNER', 'SUB_TO_PARTNER', 'JV', 'EXPLORE', 'NOT_RECOMMENDED'
  )),

  -- Timing
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_refs TEXT[] DEFAULT '{}',

  -- Versioning
  superseded_at TIMESTAMPTZ
);

CREATE INDEX idx_rel_assessments_org_rel
  ON relationship_assessments (organization_relationship_id);

CREATE INDEX idx_rel_assessments_current
  ON relationship_assessments (organization_relationship_id)
  WHERE superseded_at IS NULL;

-- ============================================================
-- Watched Partners
-- ============================================================

CREATE TABLE IF NOT EXISTS rosa_watched_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Partner identity
  company_name TEXT NOT NULL,
  company_uei TEXT,

  -- Status
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

  -- Only one active watch per partner
  UNIQUE (company_name, company_uei)
);

CREATE INDEX idx_rosa_watched_active
  ON rosa_watched_partners (status)
  WHERE status = 'WATCHING';

-- ============================================================
-- Rosa Observation Windows (LLM observation)
-- Same pattern as maya/david_observation_windows — durable,
-- concurrency-safe limits for controlled activation.
-- ============================================================

CREATE TABLE IF NOT EXISTS rosa_observation_windows (
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
-- Atomic: Claim a Rosa observation slot
-- Returns TRUE if slot was claimed, FALSE if window exhausted.
-- Concurrency-safe via SELECT FOR UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_rosa_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window RECORD;
BEGIN
  SELECT * INTO v_window
  FROM rosa_observation_windows
  WHERE status = 'ACTIVE'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_window IS NULL THEN
    RETURN TRUE; -- No observation window = no limit enforced
  END IF;

  IF v_window.completed_tasks >= v_window.max_tasks THEN
    UPDATE rosa_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_TASKS_REACHED',
      stopped_at = now(), updated_at = now()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  IF v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd > v_window.max_cumulative_spend_usd THEN
    UPDATE rosa_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_SPEND_REACHED',
      stopped_at = now(), updated_at = now()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  UPDATE rosa_observation_windows SET
    completed_tasks = completed_tasks + 1,
    cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
    last_task_id = p_task_id,
    updated_at = now()
  WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Settle a Rosa observation slot after inference completes
-- ============================================================
CREATE OR REPLACE FUNCTION settle_rosa_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window_id UUID;
BEGIN
  SELECT id INTO v_window_id
  FROM rosa_observation_windows
  WHERE status IN ('ACTIVE', 'STOPPED')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_window_id IS NOT NULL THEN
    UPDATE rosa_observation_windows SET
      cumulative_reserved_spend_usd = GREATEST(cumulative_reserved_spend_usd - p_reserved_cost_usd, 0),
      cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
      last_ledger_id = p_ledger_id,
      updated_at = now()
    WHERE id = v_window_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Rosa G2X Observation
-- ============================================================

CREATE TABLE IF NOT EXISTS rosa_g2x_observation (
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

ALTER TABLE rosa_intelligence_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosa_partner_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosa_outreach_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosa_watched_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosa_observation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosa_g2x_observation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_rosa_tasks" ON rosa_intelligence_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_rosa_briefs" ON rosa_partner_briefs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_rosa_outreach" ON rosa_outreach_drafts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_organizations" ON organizations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_people" ON people FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_org_relationships" ON organization_relationships FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_person_relationships" ON person_relationships FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_rel_assessments" ON relationship_assessments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_rosa_watched" ON rosa_watched_partners FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_rosa_observation" ON rosa_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_rosa_g2x_observation" ON rosa_g2x_observation FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Grants
-- ============================================================

GRANT ALL ON rosa_intelligence_tasks TO service_role;
GRANT ALL ON rosa_partner_briefs TO service_role;
GRANT ALL ON rosa_outreach_drafts TO service_role;
GRANT ALL ON organizations TO service_role;
GRANT ALL ON people TO service_role;
GRANT ALL ON organization_relationships TO service_role;
GRANT ALL ON person_relationships TO service_role;
GRANT ALL ON relationship_assessments TO service_role;
GRANT ALL ON rosa_watched_partners TO service_role;
GRANT ALL ON rosa_observation_windows TO service_role;
GRANT ALL ON rosa_g2x_observation TO service_role;

GRANT EXECUTE ON FUNCTION claim_rosa_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_rosa_observation_slot TO service_role;

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE rosa_intelligence_tasks IS 'Partner intelligence research tasks for Rosa. Triggered by James capture requests, David partner candidates, proactive signals, or human requests.';
COMMENT ON TABLE rosa_partner_briefs IS 'Structured partner briefs produced by Rosa. Versioned with supersession tracking.';
COMMENT ON TABLE rosa_outreach_drafts IS 'Draft outreach communications for potential teaming partners. Requires James and/or human approval.';
COMMENT ON TABLE organizations IS 'Canonical organization records for the relationship graph. Shared across Rosa and other agents.';
COMMENT ON TABLE people IS 'People associated with organizations. Provenance-tracked and optionally human-verified.';
COMMENT ON TABLE organization_relationships IS 'Observed relationships between organizations. Source evidence — not Rosa interpretation.';
COMMENT ON TABLE person_relationships IS 'Observed relationships between people and FFTC. Source evidence — not Rosa interpretation.';
COMMENT ON TABLE relationship_assessments IS 'Rosa interpretation of organization relationships. Strength, relevance, risks, and likely teaming direction. Not source evidence.';
COMMENT ON TABLE rosa_watched_partners IS 'Proactive partner monitoring. Rosa watches companies for material changes relevant to FFTC teaming.';
COMMENT ON TABLE rosa_observation_windows IS 'Durable production observation limits for Rosa controlled activation. Same pattern as Maya/David/James.';
COMMENT ON TABLE rosa_g2x_observation IS 'G2X usage observation window for Rosa. Limits: max 100 calls, 2000 records.';
COMMENT ON FUNCTION claim_rosa_observation_slot IS 'Atomic: claim one task slot, checking count + spend limits. Concurrency-safe.';
COMMENT ON FUNCTION settle_rosa_observation_slot IS 'Settle reserved spend after Rosa inference completes. Converts reserved to actual.';
