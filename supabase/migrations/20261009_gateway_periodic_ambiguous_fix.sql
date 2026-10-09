-- ============================================================
-- Fix: Include ambiguous reservations in periodic budget enforcement
--
-- Problem: reserve_inference_hierarchical periodic-scope enforcement
-- excluded 'ambiguous' entries from the effective-spend calculation.
-- Ambiguous entries represent potentially-consumed budget (provider
-- may have charged) and must block new reservations while they
-- remain within the rolling window.
--
-- Change: For periodic scopes, use actual_cost_usd for settled
-- entries (known charge) and reserved_cost_usd for reserved,
-- in_progress, and ambiguous entries (worst-case exposure).
--
-- Preserves: rolling-window semantics, atomic reservation,
-- hierarchical enforcement, RPC signature, idempotency.
-- ============================================================

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
  p_workflow_id TEXT DEFAULT NULL,
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
      -- Periodic scope: recalculate from junction entries within the rolling window.
      -- Use actual_cost_usd for settled entries (known charge),
      -- reserved_cost_usd for active/ambiguous entries (worst-case exposure).
      v_period_start := NOW() - (v_scope.period_hours || ' hours')::INTERVAL;

      SELECT COALESCE(SUM(
        CASE
          WHEN il.status = 'settled' THEN il.actual_cost_usd
          ELSE ls.reserved_cost_usd
        END
      ), 0)
      INTO v_effective_spent
      FROM ai_ledger_scopes ls
      JOIN ai_inference_ledger il ON il.id = ls.ledger_id
      WHERE ls.scope_id = v_scope.id
        AND il.created_at >= v_period_start
        AND il.status IN ('reserved', 'in_progress', 'settled', 'ambiguous');
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

COMMENT ON FUNCTION reserve_inference_hierarchical IS
  'Atomically lock+check ALL scopes in one transaction. '
  'Deterministic lock order prevents deadlocks. '
  'Periodic scopes include ambiguous entries as worst-case exposure. '
  'Settled entries use actual_cost_usd; active/ambiguous use reserved_cost_usd.';
