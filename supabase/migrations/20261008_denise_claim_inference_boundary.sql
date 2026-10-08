-- ============================================================
-- Denise Claim Inference Boundary — Crash-safe provider-attempt tracking
--
-- Adds a durable provider-attempt boundary to denise_task_claims.
-- Before any Gateway/provider call, inference_attempted is set TRUE.
-- Expired-lease recovery checks this flag:
--   inference_attempted = FALSE → safe re-claim
--   inference_attempted = TRUE  → AMBIGUOUS (no second provider call)
-- ============================================================

-- Add inference_attempted column
ALTER TABLE denise_task_claims
  ADD COLUMN IF NOT EXISTS inference_attempted BOOLEAN NOT NULL DEFAULT FALSE;

-- Add gateway_idempotency_key for cross-reference to ledger
ALTER TABLE denise_task_claims
  ADD COLUMN IF NOT EXISTS gateway_idempotency_key TEXT;

-- ============================================================
-- Mark inference attempted — called BEFORE Gateway dispatch
-- Atomic: only succeeds if claim is still CLAIMED (owns lease)
-- ============================================================
CREATE OR REPLACE FUNCTION mark_denise_inference_attempted(
  p_claim_id UUID,
  p_gateway_idempotency_key TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE denise_task_claims SET
    inference_attempted = TRUE,
    gateway_idempotency_key = p_gateway_idempotency_key,
    updated_at = NOW()
  WHERE id = p_claim_id AND status = 'CLAIMED';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION mark_denise_inference_attempted TO service_role;

-- ============================================================
-- Replace claim_denise_eval_task with inference-boundary-aware version
-- ============================================================
CREATE OR REPLACE FUNCTION claim_denise_eval_task(
  p_idempotency_key TEXT,
  p_lease_seconds INTEGER DEFAULT 120
) RETURNS TABLE(claim_id UUID, claim_status TEXT, existing_analysis_id UUID) AS $$
DECLARE
  v_existing RECORD;
  v_new_id UUID;
BEGIN
  -- Check for existing claim (SELECT FOR UPDATE to prevent race)
  SELECT * INTO v_existing
    FROM denise_task_claims
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

  IF FOUND THEN
    -- COMPLETED: return existing result
    IF v_existing.status = 'COMPLETED' THEN
      RETURN QUERY SELECT v_existing.id, v_existing.status, v_existing.analysis_id;
      RETURN;
    END IF;

    -- CLAIMED but lease expired: check inference boundary
    IF v_existing.status = 'CLAIMED' AND v_existing.lease_expires_at < NOW() THEN
      IF v_existing.inference_attempted THEN
        -- UNSAFE: provider call may have been dispatched
        -- Transition to AMBIGUOUS — never re-claim after attempted inference
        UPDATE denise_task_claims SET
          status = 'AMBIGUOUS',
          error_code = 'LEASE_EXPIRED_AFTER_INFERENCE_ATTEMPT',
          error_message = 'Lease expired after inference was attempted. Provider outcome uncertain. Manual review required.',
          updated_at = NOW()
        WHERE id = v_existing.id;
        RETURN QUERY SELECT v_existing.id, 'AMBIGUOUS'::TEXT, NULL::UUID;
        RETURN;
      ELSE
        -- SAFE: inference was never attempted, re-claim in place
        UPDATE denise_task_claims SET
          status = 'CLAIMED',
          claimed_at = NOW(),
          lease_expires_at = NOW() + (p_lease_seconds || ' seconds')::INTERVAL,
          inference_attempted = FALSE,
          gateway_idempotency_key = NULL,
          error_code = NULL,
          error_message = NULL,
          updated_at = NOW()
        WHERE id = v_existing.id;
        RETURN QUERY SELECT v_existing.id, 'CLAIMED'::TEXT, NULL::UUID;
        RETURN;
      END IF;

    -- CLAIMED and lease active: reject (another caller owns it)
    ELSIF v_existing.status = 'CLAIMED' THEN
      RETURN QUERY SELECT v_existing.id, 'LEASE_HELD'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    -- FAILED/AMBIGUOUS/EXPIRED: do NOT auto-retry
    IF v_existing.status IN ('FAILED', 'AMBIGUOUS') THEN
      RETURN QUERY SELECT v_existing.id, v_existing.status, v_existing.analysis_id;
      RETURN;
    END IF;
  END IF;

  -- Create new claim
  INSERT INTO denise_task_claims (
    idempotency_key, status, lease_expires_at
  ) VALUES (
    p_idempotency_key, 'CLAIMED', NOW() + (p_lease_seconds || ' seconds')::INTERVAL
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT v_new_id, 'CLAIMED'::TEXT, NULL::UUID;
  ELSE
    -- Lost the race to another concurrent INSERT
    SELECT * INTO v_existing
      FROM denise_task_claims
      WHERE idempotency_key = p_idempotency_key;
    RETURN QUERY SELECT v_existing.id, 'LEASE_HELD'::TEXT, NULL::UUID;
  END IF;
END;
$$ LANGUAGE plpgsql;
