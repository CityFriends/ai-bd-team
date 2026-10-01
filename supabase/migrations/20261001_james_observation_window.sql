-- ============================================================
-- James Production Observation Window
-- Durable accounting for controlled activation limits.
-- Survives process restart and redeployment.
-- ============================================================

CREATE TABLE IF NOT EXISTS james_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')),

  max_captures INTEGER NOT NULL DEFAULT 3,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 0.75,

  completed_captures INTEGER NOT NULL DEFAULT 0,
  cumulative_actual_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  cumulative_reserved_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,

  stop_reason TEXT,
  last_capture_id UUID,
  last_ledger_id UUID,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE james_observation_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_observation" ON james_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Atomic: Claim an observation slot for a capture
-- Returns TRUE if slot was claimed, FALSE if window exhausted.
-- Concurrency-safe via SELECT FOR UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_observation_slot(
  p_capture_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window RECORD;
BEGIN
  -- Lock the active observation window
  SELECT * INTO v_window
  FROM james_observation_windows
  WHERE status = 'ACTIVE'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_window IS NULL THEN
    -- No active window — James not authorized
    RETURN FALSE;
  END IF;

  -- Check capture count
  IF v_window.completed_captures >= v_window.max_captures THEN
    UPDATE james_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_CAPTURES_REACHED',
      stopped_at = NOW(), updated_at = NOW()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  -- Check spend (reserved + actual + proposed)
  IF v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd > v_window.max_cumulative_spend_usd THEN
    UPDATE james_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_SPEND_REACHED',
      stopped_at = NOW(), updated_at = NOW()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  -- Claim the slot
  UPDATE james_observation_windows SET
    completed_captures = completed_captures + 1,
    cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
    last_capture_id = p_capture_id,
    updated_at = NOW()
  WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Settle an observation slot after James inference completes
-- ============================================================
CREATE OR REPLACE FUNCTION settle_observation_slot(
  p_capture_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window_id UUID;
BEGIN
  SELECT id INTO v_window_id
  FROM james_observation_windows
  WHERE status IN ('ACTIVE', 'STOPPED')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_window_id IS NOT NULL THEN
    UPDATE james_observation_windows SET
      cumulative_reserved_spend_usd = GREATEST(cumulative_reserved_spend_usd - p_reserved_cost_usd, 0),
      cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
      last_ledger_id = p_ledger_id,
      updated_at = NOW()
    WHERE id = v_window_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION claim_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_observation_slot TO service_role;

COMMENT ON TABLE james_observation_windows IS 'Durable production observation limits for James controlled activation.';
COMMENT ON FUNCTION claim_observation_slot IS 'Atomic: claim one capture slot, checking count + spend limits. Concurrency-safe.';

-- ============================================================
-- Maya Production Observation Window
-- Same pattern as James — durable, concurrency-safe limits.
-- ============================================================

CREATE TABLE IF NOT EXISTS maya_observation_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')),

  max_reviews INTEGER NOT NULL DEFAULT 5,
  max_cumulative_spend_usd NUMERIC(10,4) NOT NULL DEFAULT 0.10,

  completed_reviews INTEGER NOT NULL DEFAULT 0,
  cumulative_actual_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  cumulative_reserved_spend_usd NUMERIC(10,6) NOT NULL DEFAULT 0,

  stop_reason TEXT,
  last_task_id UUID,
  last_ledger_id UUID,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE maya_observation_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_maya_observation" ON maya_observation_windows FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION claim_maya_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_window RECORD;
BEGIN
  SELECT * INTO v_window
  FROM maya_observation_windows
  WHERE status = 'ACTIVE'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_window IS NULL THEN
    RETURN TRUE; -- No observation window = no limit enforced
  END IF;

  IF v_window.completed_reviews >= v_window.max_reviews THEN
    UPDATE maya_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_REVIEWS_REACHED',
      stopped_at = NOW(), updated_at = NOW()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  IF v_window.cumulative_actual_spend_usd + v_window.cumulative_reserved_spend_usd + p_reserved_cost_usd > v_window.max_cumulative_spend_usd THEN
    UPDATE maya_observation_windows SET
      status = 'STOPPED', stop_reason = 'MAX_SPEND_REACHED',
      stopped_at = NOW(), updated_at = NOW()
    WHERE id = v_window.id;
    RETURN FALSE;
  END IF;

  UPDATE maya_observation_windows SET
    completed_reviews = completed_reviews + 1,
    cumulative_reserved_spend_usd = cumulative_reserved_spend_usd + p_reserved_cost_usd,
    last_task_id = p_task_id,
    updated_at = NOW()
  WHERE id = v_window.id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION settle_maya_observation_slot(
  p_task_id UUID,
  p_reserved_cost_usd NUMERIC,
  p_actual_cost_usd NUMERIC,
  p_ledger_id UUID
) RETURNS VOID AS $$
DECLARE
  v_window_id UUID;
BEGIN
  SELECT id INTO v_window_id
  FROM maya_observation_windows
  WHERE status IN ('ACTIVE', 'STOPPED')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_window_id IS NOT NULL THEN
    UPDATE maya_observation_windows SET
      cumulative_reserved_spend_usd = GREATEST(cumulative_reserved_spend_usd - p_reserved_cost_usd, 0),
      cumulative_actual_spend_usd = cumulative_actual_spend_usd + p_actual_cost_usd,
      last_ledger_id = p_ledger_id,
      updated_at = NOW()
    WHERE id = v_window_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION claim_maya_observation_slot TO service_role;
GRANT EXECUTE ON FUNCTION settle_maya_observation_slot TO service_role;

COMMENT ON TABLE maya_observation_windows IS 'Durable production observation limits for Maya controlled activation.';
