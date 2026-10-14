-- ============================================================
-- Denise Task Claims — Concurrent execution protection
--
-- Durable claim/lease mechanism ensuring at most one active
-- inference execution per idempotency key. Prevents concurrent
-- duplicate deliveries from producing two provider calls.
-- ============================================================

CREATE TABLE IF NOT EXISTS denise_task_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT UNIQUE NOT NULL,

  status TEXT NOT NULL DEFAULT 'CLAIMED' CHECK (status IN (
    'CLAIMED',     -- Lease active, inference in progress
    'COMPLETED',   -- Inference succeeded, result persisted
    'FAILED',      -- Inference failed definitively (no retry)
    'AMBIGUOUS',   -- Provider outcome uncertain (budget stays reserved)
    'EXPIRED'      -- Lease expired without completion
  )),

  -- Lease management
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '120 seconds'),
  completed_at TIMESTAMPTZ,

  -- Result references (populated on COMPLETED)
  analysis_id UUID,
  evaluation_model_id UUID,
  ledger_id UUID,
  cost_usd NUMERIC(10,6) DEFAULT 0,

  -- Error tracking
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_denise_claims_key ON denise_task_claims(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_denise_claims_status ON denise_task_claims(status) WHERE status = 'CLAIMED';

COMMENT ON TABLE denise_task_claims IS 'Denise task claims — concurrent execution protection with explicit lease expiry';

-- ============================================================
-- Atomic claim: returns claim_id if this caller wins the lease.
-- Returns NULL if another caller already holds the lease or task is done.
-- Expired leases are recovered (re-claimed) atomically.
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

    -- CLAIMED but lease expired: recover
    IF v_existing.status = 'CLAIMED' AND v_existing.lease_expires_at < NOW() THEN
      UPDATE denise_task_claims SET
        status = 'EXPIRED',
        updated_at = NOW()
      WHERE id = v_existing.id;
      -- Fall through to create new claim
    -- CLAIMED and lease active: reject (another caller owns it)
    ELSIF v_existing.status = 'CLAIMED' THEN
      RETURN QUERY SELECT v_existing.id, 'LEASE_HELD'::TEXT, NULL::UUID;
      RETURN;
    END IF;

    -- FAILED/AMBIGUOUS/EXPIRED: do NOT auto-retry
    -- Ambiguous means provider outcome unknown — auto-retry risks double-charge
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

-- ============================================================
-- Complete a claim: marks as COMPLETED with result references
-- ============================================================
CREATE OR REPLACE FUNCTION complete_denise_eval_claim(
  p_claim_id UUID,
  p_analysis_id UUID,
  p_eval_model_id UUID,
  p_ledger_id UUID,
  p_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE denise_task_claims SET
    status = 'COMPLETED',
    completed_at = NOW(),
    analysis_id = p_analysis_id,
    evaluation_model_id = p_eval_model_id,
    ledger_id = p_ledger_id,
    cost_usd = p_cost_usd,
    updated_at = NOW()
  WHERE id = p_claim_id AND status = 'CLAIMED';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Mark a claim as AMBIGUOUS (uncertain provider outcome)
-- ============================================================
CREATE OR REPLACE FUNCTION mark_denise_eval_ambiguous(
  p_claim_id UUID,
  p_error_code TEXT,
  p_error_message TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE denise_task_claims SET
    status = 'AMBIGUOUS',
    error_code = p_error_code,
    error_message = p_error_message,
    updated_at = NOW()
  WHERE id = p_claim_id AND status = 'CLAIMED';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Mark a claim as FAILED (definitive failure, no retry)
-- ============================================================
CREATE OR REPLACE FUNCTION fail_denise_eval_claim(
  p_claim_id UUID,
  p_error_code TEXT,
  p_error_message TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE denise_task_claims SET
    status = 'FAILED',
    error_code = p_error_code,
    error_message = p_error_message,
    completed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_claim_id AND status = 'CLAIMED';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RLS + grants
-- ============================================================
ALTER TABLE denise_task_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_denise_claims" ON denise_task_claims;
CREATE POLICY "service_role_denise_claims" ON denise_task_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON denise_task_claims TO service_role;

GRANT EXECUTE ON FUNCTION claim_denise_eval_task TO service_role;
GRANT EXECUTE ON FUNCTION complete_denise_eval_claim TO service_role;
GRANT EXECUTE ON FUNCTION mark_denise_eval_ambiguous TO service_role;
GRANT EXECUTE ON FUNCTION fail_denise_eval_claim TO service_role;
