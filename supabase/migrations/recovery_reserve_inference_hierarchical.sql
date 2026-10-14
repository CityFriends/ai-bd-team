CREATE OR REPLACE FUNCTION public.reserve_inference_hierarchical(p_idempotency_key text, p_agent_id text, p_purpose text, p_task_type text, p_provider text, p_model text, p_model_tier text, p_estimated_input_tokens integer, p_max_input_tokens integer, p_max_output_tokens integer, p_reserved_cost_usd numeric, p_scope_ids uuid[], p_workflow_id text DEFAULT NULL::text, p_task_id text DEFAULT NULL::text, p_opportunity_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS reservation_result
 LANGUAGE plpgsql
AS $function$
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
$function$


-- Restore EXECUTE grant
GRANT EXECUTE ON FUNCTION reserve_inference_hierarchical TO service_role;

-- Recovery script: restores the exact production RPC definition as of 2026-10-14T15:13:29Z
-- DO NOT apply unless the ambiguous-spend fix migration caused a regression.
