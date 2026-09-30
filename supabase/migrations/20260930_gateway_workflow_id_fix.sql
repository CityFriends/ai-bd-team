-- ============================================================
-- Fix workflow_id type mismatch
-- The workflow_id column on ai_inference_ledger is a metadata/attribution
-- field, not a foreign key. Application code uses text identifiers like
-- "capture-{uuid}" and "maya-review-{oppId}" which are not valid UUIDs.
-- Change from UUID to TEXT for compatibility.
-- ============================================================

ALTER TABLE ai_inference_ledger ALTER COLUMN workflow_id TYPE TEXT USING workflow_id::TEXT;

-- Drop old function signature (UUID parameter) before creating TEXT version
DROP FUNCTION IF EXISTS reserve_inference_hierarchical(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,NUMERIC,UUID[],UUID,TEXT,TEXT,JSONB);

-- Recreate with TEXT p_workflow_id
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
LANGUAGE plpgsql AS $$
DECLARE
  v_ledger_id UUID;
  v_existing_id UUID;
  v_scope UUID;
  v_scope_limit NUMERIC;
  v_scope_used NUMERIC;
BEGIN
  -- 1. Idempotency: check if request already exists
  SELECT id INTO v_existing_id FROM ai_inference_ledger WHERE idempotency_key = p_idempotency_key;
  IF v_existing_id IS NOT NULL THEN
    RETURN (v_existing_id, FALSE)::reservation_result;
  END IF;

  -- 2. Lock all applicable budget scopes IN DETERMINISTIC ORDER (prevents deadlocks)
  FOR v_scope IN
    SELECT unnest(p_scope_ids) AS sid ORDER BY sid
  LOOP
    SELECT limit_usd, (spent_usd + reserved_usd) INTO v_scope_limit, v_scope_used
    FROM ai_budget_scopes WHERE id = v_scope FOR UPDATE;

    IF v_scope_limit IS NULL THEN
      RAISE EXCEPTION 'Budget scope not found: %', v_scope;
    END IF;

    -- Check if this scope is disabled
    IF NOT (SELECT enabled FROM ai_budget_scopes WHERE id = v_scope) THEN
      RAISE EXCEPTION 'Budget scope disabled: %', v_scope;
    END IF;

    -- Check if adding this reservation would exceed the scope limit
    IF v_scope_used + p_reserved_cost_usd > v_scope_limit THEN
      -- Budget exceeded — return NULL result (no partial reservation)
      RETURN NULL;
    END IF;
  END LOOP;

  -- 3. All scopes have capacity — create the ledger entry
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
  ) RETURNING id INTO v_ledger_id;

  -- 4. Reserve budget in all applicable scopes + create junction records
  FOR v_scope IN
    SELECT unnest(p_scope_ids) AS sid ORDER BY sid
  LOOP
    UPDATE ai_budget_scopes
    SET reserved_usd = reserved_usd + p_reserved_cost_usd,
        updated_at = NOW()
    WHERE id = v_scope;

    INSERT INTO ai_ledger_scopes (ledger_id, scope_id, reserved_cost_usd)
    VALUES (v_ledger_id, v_scope, p_reserved_cost_usd);
  END LOOP;

  RETURN (v_ledger_id, TRUE)::reservation_result;
END;
$$;

GRANT EXECUTE ON FUNCTION reserve_inference_hierarchical TO service_role;
