-- ============================================================
-- Patricia — Program/Pipeline Management: Deterministic Foundation
--
-- Patricia observes durable system state, not agent chatter.
-- Patricia coordinates dependencies, not conversations.
--
-- This migration creates the commitment registry, dependency graph,
-- workflow health findings, escalation engine, proposal readiness,
-- internal milestones, portfolio snapshots, and reconciliation
-- infrastructure. All tables are deterministic — zero LLM calls.
--
-- Authority model:
--   Patricia MAY maintain operational state, commitments, deadlines,
--   detect overdue/stalled work, create authorized tasks, unblock
--   work when dependencies become satisfied, cancel obsolete tasks,
--   perform safe/idempotent mechanical repairs.
--
--   Patricia MAY NOT authorize Pursue, make/override GO/NO_GO,
--   reinterpret specialist conclusions, reassign domain ownership,
--   submit proposals, send external outreach, approve spending.
-- ============================================================

-- ============================================================
-- 1. COMMITMENT REGISTRY
-- Durable commitment/deadline model
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT,
  capture_id UUID,
  proposal_workspace_id UUID,
  title TEXT NOT NULL,
  commitment_type TEXT NOT NULL CHECK (commitment_type IN (
    'GOVERNMENT_DEADLINE',
    'INTERNAL_MILESTONE',
    'SPECIALIST_DELIVERABLE',
    'REVIEW_GATE',
    'HUMAN_DECISION',
    'POST_SUBMISSION',
    'CUSTOM'
  )),
  owner_type TEXT NOT NULL CHECK (owner_type IN (
    'AGENT', 'HUMAN', 'SYSTEM', 'TEAM'
  )),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'SOLICITATION', 'SYSTEM_RULE', 'HUMAN_OVERRIDE',
    'MILESTONE_PLAN', 'EVENT', 'MANUAL'
  )),
  source_id TEXT NOT NULL,
  source_version_id TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  hard_or_soft TEXT NOT NULL DEFAULT 'HARD' CHECK (hard_or_soft IN ('HARD', 'SOFT')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE',
    'CANCELLED', 'SUPERSEDED'
  )),
  escalation_level TEXT NOT NULL DEFAULT 'NONE' CHECK (escalation_level IN (
    'NONE', 'NOTICE', 'ACTION_REQUIRED', 'AT_RISK'
  )),
  provenance JSONB NOT NULL DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancellation_event_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_commitments_opportunity
  ON patricia_commitments(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patricia_commitments_capture
  ON patricia_commitments(capture_id) WHERE capture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patricia_commitments_proposal
  ON patricia_commitments(proposal_workspace_id) WHERE proposal_workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patricia_commitments_status
  ON patricia_commitments(status) WHERE status IN ('PENDING', 'IN_PROGRESS', 'OVERDUE');
CREATE INDEX IF NOT EXISTS idx_patricia_commitments_due
  ON patricia_commitments(due_at) WHERE status IN ('PENDING', 'IN_PROGRESS');
CREATE INDEX IF NOT EXISTS idx_patricia_commitments_escalation
  ON patricia_commitments(escalation_level) WHERE escalation_level != 'NONE';

COMMENT ON TABLE patricia_commitments IS 'Patricia commitment registry — durable deadline/obligation tracking with provenance';

-- ============================================================
-- 2. DEPENDENCY GRAPH
-- Durable dependency relationships between work items
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES patricia_commitments(id),
  depends_on_type TEXT NOT NULL CHECK (depends_on_type IN (
    'COMMITMENT', 'TASK', 'DECISION', 'ARTIFACT', 'EXTERNAL'
  )),
  depends_on_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'BLOCKED' CHECK (status IN (
    'BLOCKED', 'READY', 'SATISFIED', 'CANCELLED'
  )),
  satisfied_at TIMESTAMPTZ,
  satisfied_by TEXT,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_deps_commitment
  ON patricia_dependencies(commitment_id);
CREATE INDEX IF NOT EXISTS idx_patricia_deps_depends_on
  ON patricia_dependencies(depends_on_type, depends_on_id);
CREATE INDEX IF NOT EXISTS idx_patricia_deps_blocked
  ON patricia_dependencies(status) WHERE status = 'BLOCKED';

COMMENT ON TABLE patricia_dependencies IS 'Patricia dependency graph — tracks blocking relationships between commitments, tasks, decisions, artifacts';

-- ============================================================
-- 3. WORKFLOW HEALTH FINDINGS
-- Deterministic health rule violations
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_workflow_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id TEXT NOT NULL,
  opportunity_id TEXT,
  capture_id UUID,
  proposal_workspace_id UUID,
  severity TEXT NOT NULL CHECK (severity IN (
    'NOTICE', 'ACTION_REQUIRED', 'AT_RISK'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}',
  recommended_action TEXT,
  auto_repair_permitted BOOLEAN NOT NULL DEFAULT false,
  auto_repair_executed BOOLEAN NOT NULL DEFAULT false,
  auto_repair_action_id UUID,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED'
  )),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_reason TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_findings_rule
  ON patricia_workflow_findings(rule_id);
CREATE INDEX IF NOT EXISTS idx_patricia_findings_opportunity
  ON patricia_workflow_findings(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patricia_findings_open
  ON patricia_workflow_findings(status) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_patricia_findings_severity
  ON patricia_workflow_findings(severity) WHERE status = 'OPEN';

COMMENT ON TABLE patricia_workflow_findings IS 'Patricia workflow health findings — deterministic rule violations with evidence and repair tracking';

-- ============================================================
-- 4. OPERATIONAL ACTIONS (Safe Repair Audit Trail)
-- Every Patricia action is auditable
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_operational_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'SAFE_REPAIR',
    'TASK_CREATED',
    'TASK_ADVANCED',
    'TASK_CANCELLED',
    'COMMITMENT_CREATED',
    'COMMITMENT_UPDATED',
    'DEPENDENCY_SATISFIED',
    'DEPENDENCY_CANCELLED',
    'ESCALATION_CREATED',
    'FINDING_CREATED',
    'MILESTONE_CREATED',
    'MILESTONE_UPDATED',
    'SNAPSHOT_CREATED',
    'PROPOSAL_STAGE_CHANGED',
    'POST_SUBMISSION_EVENT'
  )),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  triggering_event_type TEXT,
  triggering_event_id TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  result JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_actions_target
  ON patricia_operational_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_patricia_actions_type
  ON patricia_operational_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_patricia_actions_trigger
  ON patricia_operational_actions(triggering_event_type) WHERE triggering_event_type IS NOT NULL;

COMMENT ON TABLE patricia_operational_actions IS 'Patricia operational action audit trail — every repair, task creation, escalation is recorded with evidence';

-- ============================================================
-- 5. ESCALATION RECORDS
-- Structured human escalation tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_type TEXT NOT NULL CHECK (escalation_type IN (
    'DECISION_REQUIRED',
    'DEADLINE_THREAT',
    'BLOCKER',
    'AUTHORITATIVE_CONFLICT',
    'MISSING_PREREQUISITE',
    'STALLED_WORK'
  )),
  opportunity_id TEXT,
  capture_id UUID,
  proposal_workspace_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN (
    'NOTICE', 'ACTION_REQUIRED', 'AT_RISK'
  )),
  decision_owner TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  conflicting_inputs JSONB,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPERSEDED', 'EXPIRED'
  )),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_escalations_opportunity
  ON patricia_escalations(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patricia_escalations_open
  ON patricia_escalations(status) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_patricia_escalations_severity
  ON patricia_escalations(severity) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_patricia_escalations_type
  ON patricia_escalations(escalation_type);

COMMENT ON TABLE patricia_escalations IS 'Patricia escalation records — structured human decision requests with conflict tracking';

-- ============================================================
-- 6. PROPOSAL READINESS STATE
-- Tracks proposal readiness stages per workspace
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_proposal_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL UNIQUE,
  capture_id UUID NOT NULL,
  opportunity_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'PRE_SOLICITATION' CHECK (stage IN (
    'PRE_SOLICITATION',
    'INTAKE',
    'REQUIREMENTS_ANALYSIS',
    'DRAFTING',
    'REVIEW',
    'FINALIZATION',
    'READY_TO_SUBMIT',
    'SUBMITTED'
  )),
  has_actionable_solicitation BOOLEAN NOT NULL DEFAULT false,
  solicitation_received_at TIMESTAMPTZ,
  government_deadline TIMESTAMPTZ,
  jodie_analysis_task_id UUID,
  submission_confirmed_by TEXT,
  submission_confirmed_at TIMESTAMPTZ,
  stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_readiness_workspace
  ON patricia_proposal_readiness(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_patricia_readiness_stage
  ON patricia_proposal_readiness(stage) WHERE stage NOT IN ('SUBMITTED');
CREATE INDEX IF NOT EXISTS idx_patricia_readiness_opportunity
  ON patricia_proposal_readiness(opportunity_id);

COMMENT ON TABLE patricia_proposal_readiness IS 'Patricia proposal readiness — operational stage management per workspace';

-- ============================================================
-- 7. INTERNAL MILESTONE PLANS
-- Backward-planned milestones from government deadline
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_internal_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL,
  capture_id UUID,
  opportunity_id TEXT,
  milestone_type TEXT NOT NULL CHECK (milestone_type IN (
    'REQUIREMENTS_ANALYSIS_COMPLETE',
    'FIRST_DRAFT',
    'TECHNICAL_INPUTS_COMPLETE',
    'COMPLIANCE_REVIEW',
    'MANAGEMENT_REVIEW',
    'FINAL_CONTENT_FREEZE',
    'FINAL_PRODUCTION_QA',
    'READY_TO_SUBMIT',
    'CUSTOM'
  )),
  title TEXT NOT NULL,
  planned_date TIMESTAMPTZ NOT NULL,
  actual_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN (
    'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE',
    'CANCELLED', 'SUPERSEDED'
  )),
  commitment_id UUID REFERENCES patricia_commitments(id),
  offset_days_before_deadline INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_milestones_workspace
  ON patricia_internal_milestones(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_patricia_milestones_status
  ON patricia_internal_milestones(status) WHERE status IN ('PLANNED', 'IN_PROGRESS', 'OVERDUE');

COMMENT ON TABLE patricia_internal_milestones IS 'Patricia backward-planned milestones from government deadline';

-- ============================================================
-- 8. MILESTONE OVERRIDES (Human override history)
-- Immutable audit trail of human deadline changes
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_milestone_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES patricia_internal_milestones(id),
  previous_date TIMESTAMPTZ NOT NULL,
  new_date TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_overrides_milestone
  ON patricia_milestone_overrides(milestone_id);

COMMENT ON TABLE patricia_milestone_overrides IS 'Patricia milestone override history — immutable human deadline change audit trail';

-- Prevent updates/deletes on milestone overrides (immutable)
CREATE OR REPLACE FUNCTION prevent_milestone_override_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'patricia_milestone_overrides is immutable — inserts only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_milestone_override_no_update ON patricia_milestone_overrides;
CREATE TRIGGER trg_milestone_override_no_update
  BEFORE UPDATE ON patricia_milestone_overrides
  FOR EACH ROW EXECUTE FUNCTION prevent_milestone_override_mutation();

DROP TRIGGER IF EXISTS trg_milestone_override_no_delete ON patricia_milestone_overrides;
CREATE TRIGGER trg_milestone_override_no_delete
  BEFORE DELETE ON patricia_milestone_overrides
  FOR EACH ROW EXECUTE FUNCTION prevent_milestone_override_mutation();

-- ============================================================
-- 9. PORTFOLIO SNAPSHOTS
-- Deterministic weekly portfolio data
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type TEXT NOT NULL DEFAULT 'WEEKLY' CHECK (snapshot_type IN (
    'WEEKLY', 'DAILY', 'ON_DEMAND'
  )),
  snapshot_data JSONB NOT NULL,
  active_watches INTEGER NOT NULL DEFAULT 0,
  active_captures INTEGER NOT NULL DEFAULT 0,
  active_pursuits INTEGER NOT NULL DEFAULT 0,
  active_proposals INTEGER NOT NULL DEFAULT 0,
  deadlines_next_7d INTEGER NOT NULL DEFAULT 0,
  deadlines_next_14d INTEGER NOT NULL DEFAULT 0,
  deadlines_next_30d INTEGER NOT NULL DEFAULT 0,
  overdue_commitments INTEGER NOT NULL DEFAULT 0,
  blocked_work_items INTEGER NOT NULL DEFAULT 0,
  at_risk_pursuits INTEGER NOT NULL DEFAULT 0,
  human_decisions_needed INTEGER NOT NULL DEFAULT 0,
  recently_submitted INTEGER NOT NULL DEFAULT 0,
  awards INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_snapshots_type
  ON patricia_portfolio_snapshots(snapshot_type, created_at DESC);

COMMENT ON TABLE patricia_portfolio_snapshots IS 'Patricia portfolio snapshots — deterministic pipeline state for brief generation';

-- ============================================================
-- 10. PATRICIA OBSERVATION WINDOWS (AI Boundary - INACTIVE)
-- Future: 10 reasoning calls OR $0.15 actual cumulative spend
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK (status IN (
    'INACTIVE', 'ACTIVE', 'STOPPED', 'COMPLETE'
  )),
  max_tasks INTEGER NOT NULL DEFAULT 10,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 0.15,
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

COMMENT ON TABLE patricia_observation_windows IS 'Patricia observation windows — AI reasoning budget (INACTIVE until commissioning)';

-- ============================================================
-- 11. RECONCILIATION CHECKPOINTS
-- Restart-safe processing state for the reconciler
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_reconciliation_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_type TEXT NOT NULL DEFAULT 'PERIODIC' CHECK (checkpoint_type IN (
    'PERIODIC', 'EVENT_DRIVEN', 'MANUAL'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  findings_count INTEGER NOT NULL DEFAULT 0,
  repairs_count INTEGER NOT NULL DEFAULT 0,
  escalations_count INTEGER NOT NULL DEFAULT 0,
  items_inspected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN (
    'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ABANDONED'
  )),
  error_message TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_checkpoints_status
  ON patricia_reconciliation_checkpoints(status) WHERE status = 'IN_PROGRESS';

COMMENT ON TABLE patricia_reconciliation_checkpoints IS 'Patricia reconciliation checkpoints — restart-safe processing state';

-- ============================================================
-- 12. POST-SUBMISSION EVENT LOG
-- Tracks post-submission lifecycle events
-- ============================================================
CREATE TABLE IF NOT EXISTS patricia_post_submission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_workspace_id UUID NOT NULL,
  capture_id UUID,
  opportunity_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'SUBMITTED',
    'CLARIFICATION_REQUEST',
    'ORAL_PRESENTATION',
    'REVISED_PROPOSAL_REQUEST',
    'EVALUATION_UPDATE',
    'AWARD',
    'LOSS',
    'CANCELLATION',
    'RETROSPECTIVE',
    'CLOSEOUT'
  )),
  title TEXT NOT NULL,
  description TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'SYSTEM')),
  actor_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patricia_post_sub_workspace
  ON patricia_post_submission_events(proposal_workspace_id);
CREATE INDEX IF NOT EXISTS idx_patricia_post_sub_type
  ON patricia_post_submission_events(event_type);

COMMENT ON TABLE patricia_post_submission_events IS 'Patricia post-submission lifecycle events — clarifications, orals, awards, losses';

-- ============================================================
-- OBSERVATION WINDOW FUNCTIONS
-- ============================================================

-- Claim slot (follows existing agent pattern but starts INACTIVE)
CREATE OR REPLACE FUNCTION claim_patricia_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window patricia_observation_windows%ROWTYPE;
BEGIN
  SELECT * INTO v_window
    FROM patricia_observation_windows
    WHERE status = 'ACTIVE'
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

  -- No active window = no limit enforced (Patricia AI is not commissioned yet)
  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  -- Check task ceiling
  IF v_window.completed_tasks >= v_window.max_tasks THEN
    UPDATE patricia_observation_windows
      SET status = 'STOPPED',
          stop_reason = 'max_tasks_reached',
          stopped_at = NOW(),
          updated_at = NOW()
      WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  -- Check spend ceiling
  IF (v_window.cumulative_actual_spend_usd
      + v_window.cumulative_reserved_spend_usd
      + p_reserved_cost_usd) > v_window.max_cumulative_spend_usd THEN
    UPDATE patricia_observation_windows
      SET status = 'STOPPED',
          stop_reason = 'spend_ceiling_reached',
          stopped_at = NOW(),
          updated_at = NOW()
      WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  -- Reserve the slot
  UPDATE patricia_observation_windows
    SET completed_tasks = completed_tasks + 1,
        cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
        last_task_id = p_task_id,
        updated_at = NOW()
    WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Settle slot
CREATE OR REPLACE FUNCTION settle_patricia_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window patricia_observation_windows%ROWTYPE;
BEGIN
  SELECT * INTO v_window
    FROM patricia_observation_windows
    WHERE status IN ('ACTIVE', 'STOPPED')
    ORDER BY started_at DESC
    LIMIT 1
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE patricia_observation_windows
    SET cumulative_reserved_spend_usd =
          GREATEST(0, cumulative_reserved_spend_usd - p_reserved_cost_usd),
        cumulative_actual_spend_usd =
          cumulative_actual_spend_usd + p_actual_cost_usd,
        last_ledger_id = p_ledger_id,
        updated_at = NOW()
    WHERE id = v_window.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- IDEMPOTENT COMMITMENT UPSERT
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_patricia_commitment(
  p_idempotency_key TEXT,
  p_opportunity_id TEXT,
  p_capture_id UUID,
  p_proposal_workspace_id UUID,
  p_title TEXT,
  p_commitment_type TEXT,
  p_owner_type TEXT,
  p_owner_id TEXT,
  p_source_type TEXT,
  p_source_id TEXT,
  p_source_version_id TEXT,
  p_due_at TIMESTAMPTZ,
  p_timezone TEXT,
  p_hard_or_soft TEXT,
  p_provenance JSONB
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO patricia_commitments (
    idempotency_key, opportunity_id, capture_id, proposal_workspace_id,
    title, commitment_type, owner_type, owner_id,
    source_type, source_id, source_version_id,
    due_at, timezone, hard_or_soft, provenance
  ) VALUES (
    p_idempotency_key, p_opportunity_id, p_capture_id, p_proposal_workspace_id,
    p_title, p_commitment_type, p_owner_type, p_owner_id,
    p_source_type, p_source_id, p_source_version_id,
    p_due_at, p_timezone, p_hard_or_soft, p_provenance
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM patricia_commitments WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- IDEMPOTENT DEPENDENCY UPSERT
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_patricia_dependency(
  p_idempotency_key TEXT,
  p_commitment_id UUID,
  p_depends_on_type TEXT,
  p_depends_on_id TEXT
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO patricia_dependencies (
    idempotency_key, commitment_id, depends_on_type, depends_on_id
  ) VALUES (
    p_idempotency_key, p_commitment_id, p_depends_on_type, p_depends_on_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM patricia_dependencies WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- IDEMPOTENT FINDING UPSERT
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_patricia_finding(
  p_idempotency_key TEXT,
  p_rule_id TEXT,
  p_opportunity_id TEXT,
  p_capture_id UUID,
  p_proposal_workspace_id UUID,
  p_severity TEXT,
  p_title TEXT,
  p_description TEXT,
  p_evidence JSONB,
  p_recommended_action TEXT,
  p_auto_repair_permitted BOOLEAN
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO patricia_workflow_findings (
    idempotency_key, rule_id, opportunity_id, capture_id,
    proposal_workspace_id, severity, title, description,
    evidence, recommended_action, auto_repair_permitted
  ) VALUES (
    p_idempotency_key, p_rule_id, p_opportunity_id, p_capture_id,
    p_proposal_workspace_id, p_severity, p_title, p_description,
    p_evidence, p_recommended_action, p_auto_repair_permitted
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM patricia_workflow_findings WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- IDEMPOTENT ESCALATION UPSERT
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_patricia_escalation(
  p_idempotency_key TEXT,
  p_escalation_type TEXT,
  p_opportunity_id TEXT,
  p_capture_id UUID,
  p_proposal_workspace_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_severity TEXT,
  p_decision_owner TEXT,
  p_evidence JSONB,
  p_conflicting_inputs JSONB
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO patricia_escalations (
    idempotency_key, escalation_type, opportunity_id, capture_id,
    proposal_workspace_id, title, description, severity,
    decision_owner, evidence, conflicting_inputs
  ) VALUES (
    p_idempotency_key, p_escalation_type, p_opportunity_id, p_capture_id,
    p_proposal_workspace_id, p_title, p_description, p_severity,
    p_decision_owner, p_evidence, p_conflicting_inputs
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM patricia_escalations WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ATOMIC DEPENDENCY SATISFACTION
-- Satisfies a dependency and returns downstream commitments
-- that may now be unblocked
-- ============================================================
CREATE OR REPLACE FUNCTION satisfy_patricia_dependency(
  p_depends_on_type TEXT,
  p_depends_on_id TEXT,
  p_satisfied_by TEXT
) RETURNS TABLE(
  dependency_id UUID,
  commitment_id UUID,
  remaining_blocked INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH updated AS (
    UPDATE patricia_dependencies
      SET status = 'SATISFIED',
          satisfied_at = NOW(),
          satisfied_by = p_satisfied_by,
          updated_at = NOW()
      WHERE depends_on_type = p_depends_on_type
        AND depends_on_id = p_depends_on_id
        AND status = 'BLOCKED'
      RETURNING id AS dependency_id, patricia_dependencies.commitment_id
  )
  SELECT
    u.dependency_id,
    u.commitment_id,
    (SELECT COUNT(*)::INTEGER
     FROM patricia_dependencies d
     WHERE d.commitment_id = u.commitment_id
       AND d.status = 'BLOCKED'
       AND d.id != u.dependency_id
    ) AS remaining_blocked
  FROM updated u;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- ROW LEVEL SECURITY
-- Service-role only. Remember the RLS incident.
-- ============================================================

-- patricia_commitments
ALTER TABLE patricia_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_commitments"
  ON patricia_commitments FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_commitments TO service_role;

-- patricia_dependencies
ALTER TABLE patricia_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_dependencies"
  ON patricia_dependencies FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_dependencies TO service_role;

-- patricia_workflow_findings
ALTER TABLE patricia_workflow_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_findings"
  ON patricia_workflow_findings FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_workflow_findings TO service_role;

-- patricia_operational_actions
ALTER TABLE patricia_operational_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_actions"
  ON patricia_operational_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_operational_actions TO service_role;

-- patricia_escalations
ALTER TABLE patricia_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_escalations"
  ON patricia_escalations FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_escalations TO service_role;

-- patricia_proposal_readiness
ALTER TABLE patricia_proposal_readiness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_readiness"
  ON patricia_proposal_readiness FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_proposal_readiness TO service_role;

-- patricia_internal_milestones
ALTER TABLE patricia_internal_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_milestones"
  ON patricia_internal_milestones FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_internal_milestones TO service_role;

-- patricia_milestone_overrides
ALTER TABLE patricia_milestone_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_overrides"
  ON patricia_milestone_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_milestone_overrides TO service_role;

-- patricia_portfolio_snapshots
ALTER TABLE patricia_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_snapshots"
  ON patricia_portfolio_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_portfolio_snapshots TO service_role;

-- patricia_observation_windows
ALTER TABLE patricia_observation_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_windows"
  ON patricia_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_observation_windows TO service_role;

-- patricia_reconciliation_checkpoints
ALTER TABLE patricia_reconciliation_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_checkpoints"
  ON patricia_reconciliation_checkpoints FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_reconciliation_checkpoints TO service_role;

-- patricia_post_submission_events
ALTER TABLE patricia_post_submission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_patricia_post_sub"
  ON patricia_post_submission_events FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON patricia_post_submission_events TO service_role;

-- Function grants
GRANT EXECUTE ON FUNCTION claim_patricia_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_patricia_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION upsert_patricia_commitment TO service_role;
GRANT EXECUTE ON FUNCTION upsert_patricia_dependency TO service_role;
GRANT EXECUTE ON FUNCTION upsert_patricia_finding TO service_role;
GRANT EXECUTE ON FUNCTION upsert_patricia_escalation TO service_role;
GRANT EXECUTE ON FUNCTION satisfy_patricia_dependency TO service_role;
