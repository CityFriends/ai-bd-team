-- ============================================================
-- Milestone 1B: LLM Gateway — Inference Ledger & Budget Enforcement
-- ============================================================
-- CORRECTED: Hierarchical multi-scope atomic reservation.
-- Budget accounting invariant: committed_spend + active_reservations <= limit
-- at every enforced scope, enforced within a single PostgreSQL transaction.
-- ============================================================

-- ============================================================
-- Table: ai_budget_scopes
-- Hierarchical budget limits. Each request may enforce multiple scopes.
-- Accounting invariant: spent_usd + reserved_usd <= limit_usd
-- spent_usd = sum of settled actual costs
-- reserved_usd = sum of active reservation costs (reserved + in_progress)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_budget_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global_daily', 'workflow', 'agent', 'task')),
  scope_id TEXT NOT NULL,
  limit_usd NUMERIC(10, 4) NOT NULL,
  period_hours INTEGER,             -- NULL for non-periodic scopes; 24 for daily
  spent_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  reserved_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scope_type, scope_id)
);

-- Default global daily budget — configurable, not a permanent business rule
INSERT INTO ai_budget_scopes (scope_type, scope_id, limit_usd, period_hours)
VALUES ('global_daily', 'default', 2.0000, 24)
ON CONFLICT (scope_type, scope_id) DO NOTHING;

-- ============================================================
-- Table: ai_inference_ledger
-- Authoritative record of every inference request.
-- Links to MULTIPLE budget scopes via ai_ledger_scopes junction table.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_inference_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,

  -- Attribution
  workflow_id UUID,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  opportunity_id TEXT,
  purpose TEXT NOT NULL,
  task_type TEXT NOT NULL,

  -- Provider/model
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  model TEXT NOT NULL,
  model_tier TEXT,

  -- Lifecycle status
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN (
    'reserved',      -- Budget reserved, not yet sent to provider
    'in_progress',   -- Sent to provider, awaiting response
    'settled',       -- Provider responded, actual cost recorded
    'released',      -- Reservation released (confirmed no provider call)
    'failed',        -- Provider definitively rejected (no charge)
    'ambiguous'      -- Request may have been processed; outcome unknown
  )),

  -- Token bounds
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  max_output_tokens INTEGER NOT NULL DEFAULT 0,
  max_input_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,

  -- Actual usage (after provider response)
  actual_input_tokens INTEGER,
  actual_output_tokens INTEGER,
  actual_cost_usd NUMERIC(10, 6),

  -- Provider metadata
  provider_request_id TEXT,
  provider_model TEXT,

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  network_sent_at TIMESTAMPTZ,      -- When network request was dispatched

  -- Error handling
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  error_message TEXT,

  -- Extensible
  metadata JSONB DEFAULT '{}'
);

-- Junction table: which budget scopes a ledger entry reserved against
CREATE TABLE IF NOT EXISTS ai_ledger_scopes (
  ledger_id UUID NOT NULL REFERENCES ai_inference_ledger(id) ON DELETE CASCADE,
  scope_id UUID NOT NULL REFERENCES ai_budget_scopes(id),
  reserved_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (ledger_id, scope_id)
);

-- Indexes
CREATE INDEX idx_inference_ledger_status ON ai_inference_ledger(status) WHERE status IN ('reserved', 'in_progress');
CREATE INDEX idx_inference_ledger_created ON ai_inference_ledger(created_at DESC);
CREATE INDEX idx_inference_ledger_agent ON ai_inference_ledger(agent_id);
CREATE INDEX idx_inference_ledger_workflow ON ai_inference_ledger(workflow_id) WHERE workflow_id IS NOT NULL;
CREATE INDEX idx_inference_ledger_opportunity ON ai_inference_ledger(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX idx_inference_ledger_purpose ON ai_inference_ledger(purpose);
CREATE INDEX idx_ledger_scopes_scope ON ai_ledger_scopes(scope_id);

-- ============================================================
-- Function: reserve_inference_hierarchical()
--
-- ATOMIC multi-scope reservation in ONE transaction.
-- Locks ALL applicable budget scope rows in deterministic order
-- (global → workflow → agent → task) to prevent deadlocks.
-- Checks every scope. If ANY scope fails: full rollback.
--
-- p_scope_ids: array of budget scope UUIDs to enforce (ordered by type).
-- Returns ledger ID on success, NULL on budget exceeded.
-- Raises exception on DB/config errors (fail closed).
-- ============================================================
-- Return type for reservation: distinguishes new vs existing
DROP TYPE IF EXISTS reservation_result CASCADE;
CREATE TYPE reservation_result AS (
  ledger_id UUID,
  is_new BOOLEAN
);

CREATE OR REPLACE FUNCTION reserve_inference_hierarchical(
  p_idempotency_key TEXT,
  p_agent_id TEXT,
  p_purpose TEXT,
  p_task_type TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_model_tier TEXT,
  p_estimated_input_tokens INTEGER,
  p_max_input_tokens INTEGER,
  p_max_output_tokens INTEGER,
  p_reserved_cost_usd NUMERIC,
  p_scope_ids UUID[],
  p_workflow_id UUID DEFAULT NULL,
  p_task_id TEXT DEFAULT NULL,
  p_opportunity_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS reservation_result
LANGUAGE plpgsql
AS $$
DECLARE
  v_ledger_id UUID;
  v_existing_status TEXT;
  v_scope RECORD;
  v_scope_id UUID;
  v_effective_spent NUMERIC;
  v_period_start TIMESTAMPTZ;
  v_result reservation_result;
BEGIN
  -- Idempotency check: find any existing entry with this key
  SELECT id, status INTO v_ledger_id, v_existing_status
  FROM ai_inference_ledger
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_ledger_id IS NOT NULL THEN
    -- Entry exists — caller does NOT own execution permission
    -- Return (ledger_id, is_new=false) for ALL existing states
    v_result.ledger_id := v_ledger_id;
    v_result.is_new := FALSE;
    RETURN v_result;
  END IF;

  -- Validate: at least one scope required
  IF array_length(p_scope_ids, 1) IS NULL OR array_length(p_scope_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one budget scope is required';
  END IF;

  -- Lock ALL scope rows in deterministic order (by scope_type then id)
  -- This prevents deadlocks when concurrent requests use overlapping scopes
  FOR v_scope IN
    SELECT bs.*
    FROM ai_budget_scopes bs
    WHERE bs.id = ANY(p_scope_ids)
    ORDER BY
      CASE bs.scope_type
        WHEN 'global_daily' THEN 1
        WHEN 'workflow' THEN 2
        WHEN 'agent' THEN 3
        WHEN 'task' THEN 4
      END,
      bs.id
    FOR UPDATE
  LOOP
    -- Check scope is enabled
    IF NOT v_scope.enabled THEN
      RAISE EXCEPTION 'Budget scope disabled: % (%)', v_scope.scope_type, v_scope.scope_id;
    END IF;

    -- Calculate effective spend for this scope
    IF v_scope.period_hours IS NOT NULL THEN
      -- Periodic scope: count within current period window
      v_period_start := NOW() - (v_scope.period_hours || ' hours')::INTERVAL;

      SELECT COALESCE(SUM(ls.reserved_cost_usd), 0)
      INTO v_effective_spent
      FROM ai_ledger_scopes ls
      JOIN ai_inference_ledger il ON il.id = ls.ledger_id
      WHERE ls.scope_id = v_scope.id
        AND il.created_at >= v_period_start
        AND il.status IN ('reserved', 'in_progress', 'settled');
    ELSE
      -- Non-periodic: use accounting columns directly
      -- Invariant: spent_usd + reserved_usd is the committed total
      v_effective_spent := v_scope.spent_usd + v_scope.reserved_usd;
    END IF;

    -- Check if reservation fits
    IF v_effective_spent + p_reserved_cost_usd > v_scope.limit_usd THEN
      -- Budget exceeded at this scope — entire transaction rolls back
      RETURN NULL;
    END IF;
  END LOOP;

  -- ALL scopes passed — create the ledger entry
  INSERT INTO ai_inference_ledger (
    idempotency_key, workflow_id, task_id, agent_id, opportunity_id,
    purpose, task_type, provider, model, model_tier, status,
    estimated_input_tokens, max_input_tokens, max_output_tokens,
    reserved_cost_usd, metadata
  ) VALUES (
    p_idempotency_key, p_workflow_id, p_task_id, p_agent_id, p_opportunity_id,
    p_purpose, p_task_type, p_provider, p_model, p_model_tier, 'reserved',
    p_estimated_input_tokens, p_max_input_tokens, p_max_output_tokens,
    p_reserved_cost_usd, p_metadata
  )
  RETURNING id INTO v_ledger_id;

  -- Create junction entries and increment reserved_usd on each scope
  FOREACH v_scope_id IN ARRAY p_scope_ids
  LOOP
    INSERT INTO ai_ledger_scopes (ledger_id, scope_id, reserved_cost_usd)
    VALUES (v_ledger_id, v_scope_id, p_reserved_cost_usd);

    UPDATE ai_budget_scopes
    SET reserved_usd = reserved_usd + p_reserved_cost_usd,
        updated_at = NOW()
    WHERE id = v_scope_id;
  END LOOP;

  -- New reservation created — caller owns execution permission
  v_result.ledger_id := v_ledger_id;
  v_result.is_new := TRUE;
  RETURN v_result;
END;
$$;

-- ============================================================
-- Function: settle_inference()
-- Settles actual cost. REJECTS if actual > reserved (safety violation).
-- ============================================================
CREATE OR REPLACE FUNCTION settle_inference(
  p_ledger_id UUID,
  p_actual_input_tokens INTEGER,
  p_actual_output_tokens INTEGER,
  p_actual_cost_usd NUMERIC,
  p_provider_request_id TEXT DEFAULT NULL,
  p_provider_model TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry ai_inference_ledger%ROWTYPE;
  v_scope RECORD;
BEGIN
  SELECT * INTO v_entry
  FROM ai_inference_ledger
  WHERE id = p_ledger_id AND status IN ('reserved', 'in_progress')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- SAFETY INVARIANT: actual cost must not exceed reserved cost
  IF p_actual_cost_usd > v_entry.reserved_cost_usd THEN
    -- Record safety violation — do NOT silently accept budget corruption
    UPDATE ai_inference_ledger
    SET error_code = 'settlement_exceeds_reservation',
        error_message = 'actual_cost=' || p_actual_cost_usd::TEXT
          || ' > reserved=' || v_entry.reserved_cost_usd::TEXT,
        metadata = metadata || jsonb_build_object(
          'safety_violation', true,
          'actual_cost_usd', p_actual_cost_usd,
          'reserved_cost_usd', v_entry.reserved_cost_usd
        )
    WHERE id = p_ledger_id;

    RAISE EXCEPTION 'SAFETY VIOLATION: actual_cost (%) exceeds reservation (%)',
      p_actual_cost_usd, v_entry.reserved_cost_usd;
  END IF;

  -- Update ledger
  UPDATE ai_inference_ledger
  SET status = 'settled',
      actual_input_tokens = p_actual_input_tokens,
      actual_output_tokens = p_actual_output_tokens,
      actual_cost_usd = p_actual_cost_usd,
      provider_request_id = p_provider_request_id,
      provider_model = p_provider_model,
      completed_at = NOW()
  WHERE id = p_ledger_id;

  -- Update each scope: move from reserved to spent, release excess
  FOR v_scope IN
    SELECT ls.scope_id, ls.reserved_cost_usd
    FROM ai_ledger_scopes ls WHERE ls.ledger_id = p_ledger_id
  LOOP
    UPDATE ai_budget_scopes
    SET reserved_usd = GREATEST(reserved_usd - v_scope.reserved_cost_usd, 0),
        spent_usd = spent_usd + p_actual_cost_usd,
        updated_at = NOW()
    WHERE id = v_scope.scope_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- Function: release_inference_reservation()
-- Releases reservation. Only safe for status=reserved (pre-network).
-- For in_progress: use mark_ambiguous instead.
-- ============================================================
CREATE OR REPLACE FUNCTION release_inference_reservation(
  p_ledger_id UUID,
  p_reason TEXT DEFAULT 'released',
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry ai_inference_ledger%ROWTYPE;
  v_scope RECORD;
BEGIN
  SELECT * INTO v_entry
  FROM ai_inference_ledger
  WHERE id = p_ledger_id AND status = 'reserved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE ai_inference_ledger
  SET status = CASE WHEN p_reason = 'failed' THEN 'failed' ELSE 'released' END,
      error_code = p_error_code,
      error_message = p_error_message,
      completed_at = NOW()
  WHERE id = p_ledger_id;

  -- Release reserved amount from ALL scopes
  FOR v_scope IN
    SELECT ls.scope_id, ls.reserved_cost_usd
    FROM ai_ledger_scopes ls WHERE ls.ledger_id = p_ledger_id
  LOOP
    UPDATE ai_budget_scopes
    SET reserved_usd = GREATEST(reserved_usd - v_scope.reserved_cost_usd, 0),
        updated_at = NOW()
    WHERE id = v_scope.scope_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- Function: mark_inference_ambiguous()
-- For in_progress requests where outcome is unknown.
-- Does NOT release budget — ambiguous spend stays reserved.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_inference_ambiguous(
  p_ledger_id UUID,
  p_error_code TEXT DEFAULT 'outcome_unknown',
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE ai_inference_ledger
  SET status = 'ambiguous',
      error_code = p_error_code,
      error_message = p_error_message,
      completed_at = NOW()
  WHERE id = p_ledger_id AND status = 'in_progress';

  -- Ambiguous: budget stays reserved (not released to pool)
  -- Reconciliation policy determines whether to eventually release

  RETURN FOUND;
END;
$$;

-- ============================================================
-- Function: mark_inference_in_progress()
-- ============================================================
CREATE OR REPLACE FUNCTION mark_inference_in_progress(p_ledger_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE ai_inference_ledger
  SET status = 'in_progress',
      started_at = NOW(),
      network_sent_at = NOW()
  WHERE id = p_ledger_id AND status = 'reserved';
  RETURN FOUND;
END;
$$;

-- ============================================================
-- Function: reconcile_stale_reservations()
-- reserved (pre-network) → released (safe, no charge)
-- in_progress (post-network) → ambiguous (may have charged)
-- Ambiguous budget stays reserved — never auto-released to pool.
-- ============================================================
CREATE OR REPLACE FUNCTION reconcile_stale_reservations(
  p_stale_minutes INTEGER DEFAULT 15
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
  v_entry RECORD;
  v_scope RECORD;
BEGIN
  -- Process each stale entry individually for correct scope handling
  FOR v_entry IN
    SELECT id, status, reserved_cost_usd
    FROM ai_inference_ledger
    WHERE status IN ('reserved', 'in_progress')
      AND created_at < NOW() - (p_stale_minutes || ' minutes')::INTERVAL
    FOR UPDATE
  LOOP
    IF v_entry.status = 'reserved' THEN
      -- Pre-network: safe to release budget
      UPDATE ai_inference_ledger
      SET status = 'released',
          error_code = 'stale_reservation',
          error_message = 'Reservation exceeded ' || p_stale_minutes || ' minute threshold',
          completed_at = NOW()
      WHERE id = v_entry.id;

      -- Release from all scopes
      FOR v_scope IN
        SELECT scope_id, reserved_cost_usd FROM ai_ledger_scopes WHERE ledger_id = v_entry.id
      LOOP
        UPDATE ai_budget_scopes
        SET reserved_usd = GREATEST(reserved_usd - v_scope.reserved_cost_usd, 0),
            updated_at = NOW()
        WHERE id = v_scope.scope_id;
      END LOOP;

    ELSIF v_entry.status = 'in_progress' THEN
      -- Post-network: outcome unknown — mark ambiguous, DO NOT release budget
      UPDATE ai_inference_ledger
      SET status = 'ambiguous',
          error_code = 'stale_in_progress',
          error_message = 'In-progress request exceeded ' || p_stale_minutes || ' minute threshold',
          completed_at = NOW()
      WHERE id = v_entry.id;
      -- Budget stays reserved — ambiguous spend is NOT returned to pool
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- Function: release_failed_in_progress()
-- Explicit release for in_progress entries where provider
-- definitively rejected (HTTP 4xx, no charge confirmed).
-- ============================================================
CREATE OR REPLACE FUNCTION release_failed_in_progress(
  p_ledger_id UUID,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry ai_inference_ledger%ROWTYPE;
  v_scope RECORD;
BEGIN
  SELECT * INTO v_entry
  FROM ai_inference_ledger
  WHERE id = p_ledger_id AND status = 'in_progress'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE ai_inference_ledger
  SET status = 'failed',
      error_code = p_error_code,
      error_message = p_error_message,
      completed_at = NOW()
  WHERE id = p_ledger_id;

  -- Release from all scopes (provider confirmed no charge)
  FOR v_scope IN
    SELECT scope_id, reserved_cost_usd FROM ai_ledger_scopes WHERE ledger_id = p_ledger_id
  LOOP
    UPDATE ai_budget_scopes
    SET reserved_usd = GREATEST(reserved_usd - v_scope.reserved_cost_usd, 0),
        updated_at = NOW()
    WHERE id = v_scope.scope_id;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- ============================================================
-- Table: ai_model_routing
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_model_routing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT NOT NULL,
  max_output_tokens INTEGER NOT NULL DEFAULT 1024,
  max_input_tokens INTEGER NOT NULL DEFAULT 16000,
  max_cost_usd NUMERIC(10, 4),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ai_model_routing (task_type, provider, model, max_output_tokens, max_input_tokens, max_cost_usd) VALUES
  ('classify',    'anthropic', 'claude-3-5-haiku-20241022', 256,  8000,  0.01),
  ('extract',     'anthropic', 'claude-3-5-haiku-20241022', 512,  8000,  0.02),
  ('summarize',   'anthropic', 'claude-3-5-haiku-20241022', 512,  16000, 0.02),
  ('research',    'anthropic', 'claude-sonnet-4-20250514',  2048, 16000, 0.10),
  ('reason',      'anthropic', 'claude-sonnet-4-20250514',  1024, 16000, 0.08),
  ('write',       'anthropic', 'claude-sonnet-4-20250514',  2048, 16000, 0.10),
  ('review',      'anthropic', 'claude-sonnet-4-20250514',  1024, 16000, 0.08),
  ('embed',       'openai',    'text-embedding-3-small',    0,    30000, 0.005)
ON CONFLICT (task_type) DO NOTHING;

-- ============================================================
-- Table: ai_model_pricing
-- Versioned. effective_from/effective_until for historical accuracy.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_price_per_million NUMERIC(10, 4) NOT NULL,
  output_price_per_million NUMERIC(10, 4) NOT NULL,
  tier TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  UNIQUE(provider, model, effective_from)
);

INSERT INTO ai_model_pricing (provider, model, input_price_per_million, output_price_per_million, tier) VALUES
  ('anthropic', 'claude-sonnet-4-20250514',   3.0,   15.0,  'sonnet'),
  ('anthropic', 'claude-3-5-sonnet-20241022', 3.0,   15.0,  'sonnet'),
  ('anthropic', 'claude-3-5-haiku-20241022',  0.8,   4.0,   'haiku'),
  ('anthropic', 'claude-3-haiku-20240307',    0.25,  1.25,  'haiku'),
  ('anthropic', 'claude-3-opus-20240229',     15.0,  75.0,  'opus'),
  ('openai',    'text-embedding-3-small',     0.02,  0.0,   'embed')
ON CONFLICT (provider, model, effective_from) DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE ai_inference_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_ledger_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_budget_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_ai_inference_ledger" ON ai_inference_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_ai_ledger_scopes" ON ai_ledger_scopes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_ai_budget_scopes" ON ai_budget_scopes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_ai_model_routing" ON ai_model_routing
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_ai_model_pricing" ON ai_model_pricing
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION reserve_inference_hierarchical TO service_role;
GRANT EXECUTE ON FUNCTION settle_inference TO service_role;
GRANT EXECUTE ON FUNCTION release_inference_reservation TO service_role;
GRANT EXECUTE ON FUNCTION mark_inference_ambiguous TO service_role;
GRANT EXECUTE ON FUNCTION mark_inference_in_progress TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_stale_reservations TO service_role;
GRANT EXECUTE ON FUNCTION release_failed_in_progress TO service_role;

COMMENT ON TABLE ai_inference_ledger IS 'Authoritative inference ledger. Every request. Every cost. One source of truth.';
COMMENT ON TABLE ai_ledger_scopes IS 'Junction: which budget scopes were enforced for each ledger entry.';
COMMENT ON TABLE ai_budget_scopes IS 'Hierarchical budget limits. Invariant: spent_usd + reserved_usd <= limit_usd.';
COMMENT ON FUNCTION reserve_inference_hierarchical IS 'Atomically lock+check ALL scopes in one transaction. Deterministic lock order prevents deadlocks.';
COMMENT ON FUNCTION settle_inference IS 'Record actual cost. Rejects if actual > reserved (safety violation).';
COMMENT ON FUNCTION mark_inference_ambiguous IS 'Post-network unknown outcome. Budget stays reserved, not released.';
COMMENT ON FUNCTION reconcile_stale_reservations IS 'Stale reserved→released (safe). Stale in_progress→ambiguous (budget stays reserved).';
