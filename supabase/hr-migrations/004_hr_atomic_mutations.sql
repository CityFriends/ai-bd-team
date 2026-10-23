-- ============================================================
-- HR Atomic Employee Mutations with Integrated Authorization
--
-- Each mutation executes in a single transaction:
--   1. Verify actor is an authorized admin
--   2. Check idempotency — return prior result if key+fingerprint match,
--      reject if key exists but fingerprint differs
--   3. Perform the employee mutation
--   4. Record the audit event with request fingerprint
--   5. Commit atomically
--
-- IDEMPOTENCY FINGERPRINT:
--   Each request is canonicalized as: action|target_id|sorted_field=value pairs
--   Then hashed with SHA-256. The fingerprint is stored with the audit event.
--   Replay: same key + same fingerprint → return prior result.
--   Mismatch: same key + different fingerprint → reject.
--   Concurrent: unique index on idempotency_key → only one wins.
--
-- SECURITY:
--   - SECURITY DEFINER with SET search_path = public
--   - Schema-qualified table references
--   - EXECUTE restricted to service_role
--   - No dynamic SQL
--
-- Target: Dedicated HR Supabase project (NOT the BD project)
-- DO NOT execute against bvgtfadggtgnakrxvuim
-- ============================================================

-- Bootstrap authorization table for M1.
CREATE TABLE IF NOT EXISTS hr_bootstrap_admins (
  slack_user_id TEXT PRIMARY KEY,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hr_bootstrap_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hr_service_bootstrap" ON hr_bootstrap_admins
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "hr_deny_anon_bootstrap" ON hr_bootstrap_admins
  FOR ALL TO anon USING (false);
CREATE POLICY "hr_deny_auth_bootstrap" ON hr_bootstrap_admins
  FOR ALL TO authenticated USING (false);

-- ============================================================
-- Helper: check admin authorization
-- ============================================================
CREATE OR REPLACE FUNCTION hr_is_authorized_admin(p_actor_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.hr_bootstrap_admins WHERE slack_user_id = p_actor_id
  ) OR EXISTS(
    SELECT 1 FROM public.hr_user_roles
    WHERE slack_user_id = p_actor_id
      AND role IN ('owner', 'hr_admin')
      AND revoked_at IS NULL
  );
$$;

-- ============================================================
-- Helper: check idempotency key + fingerprint
-- Returns: NULL if no prior event (proceed), 'match' if safe replay,
--          or an error message string if fingerprint mismatch.
-- ============================================================
CREATE OR REPLACE FUNCTION hr_check_idempotency(
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT
)
RETURNS TABLE(status TEXT, prior_target_id TEXT, prior_outcome TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN ae.request_fingerprint IS DISTINCT FROM p_request_fingerprint
        THEN 'fingerprint_mismatch'
      ELSE 'match'
    END AS status,
    ae.target_id AS prior_target_id,
    ae.outcome AS prior_outcome
  FROM public.hr_audit_events ae
  WHERE ae.idempotency_key = p_idempotency_key
  LIMIT 1;
$$;

-- ============================================================
-- Create Employee
-- ============================================================
CREATE OR REPLACE FUNCTION hr_create_employee(
  p_actor_id TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT,
  p_full_name TEXT,
  p_employment_status TEXT,
  p_slack_user_id TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_preferred_name TEXT DEFAULT NULL,
  p_employment_classification TEXT DEFAULT NULL,
  p_work_state TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_contract_assignment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id UUID;
  v_idemp RECORD;
  v_result JSONB;
BEGIN
  -- 1. Authorization
  IF NOT hr_is_authorized_admin(p_actor_id) THEN
    INSERT INTO public.hr_audit_events
      (event_type, actor_type, actor_id, action, outcome, idempotency_key, request_fingerprint)
    VALUES
      ('EMPLOYEE_CREATE', 'human', p_actor_id, 'create_employee', 'denied', p_idempotency_key, p_request_fingerprint)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN jsonb_build_object('error', 'Not authorized', 'employee', NULL);
  END IF;

  -- 2. Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_idemp FROM hr_check_idempotency(p_idempotency_key, p_request_fingerprint);
    IF v_idemp IS NOT NULL THEN
      IF v_idemp.status = 'fingerprint_mismatch' THEN
        RETURN jsonb_build_object('error', 'Idempotency key already used for a different request', 'employee', NULL);
      END IF;
      -- Match: return prior result if successful
      IF v_idemp.prior_outcome = 'success' AND v_idemp.prior_target_id IS NOT NULL THEN
        SELECT jsonb_build_object('error', NULL, 'employee', row_to_json(e)::jsonb)
        INTO v_result FROM public.hr_employees e WHERE e.id = v_idemp.prior_target_id::uuid;
        IF v_result IS NOT NULL THEN RETURN v_result; END IF;
      END IF;
      -- Prior denied/failed: allow retry
    END IF;
  END IF;

  -- 3. Insert employee
  INSERT INTO public.hr_employees (
    full_name, employment_status, slack_user_id, email, preferred_name,
    employment_classification, work_state, start_date, contract_assignment,
    is_synthetic, created_by, updated_by
  ) VALUES (
    p_full_name, p_employment_status, p_slack_user_id, p_email, p_preferred_name,
    p_employment_classification, p_work_state, p_start_date, p_contract_assignment,
    true, p_actor_id, p_actor_id
  ) RETURNING id INTO v_emp_id;

  -- 4. Audit (same transaction)
  INSERT INTO public.hr_audit_events (
    event_type, actor_type, actor_id, target_type, target_id,
    action, outcome, idempotency_key, request_fingerprint, metadata
  ) VALUES (
    'EMPLOYEE_CREATE', 'human', p_actor_id, 'employee', v_emp_id::text,
    'create_employee', 'success', p_idempotency_key, p_request_fingerprint,
    jsonb_build_object('synthetic', true)
  );

  -- 5. Return
  SELECT jsonb_build_object('error', NULL, 'employee', row_to_json(e)::jsonb)
  INTO v_result FROM public.hr_employees e WHERE e.id = v_emp_id;
  RETURN v_result;
END;
$$;

-- ============================================================
-- Update Employee
-- ============================================================
CREATE OR REPLACE FUNCTION hr_update_employee(
  p_actor_id TEXT,
  p_employee_id UUID,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT,
  p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idemp RECORD;
  v_result JSONB;
BEGIN
  -- 1. Authorization
  IF NOT hr_is_authorized_admin(p_actor_id) THEN
    INSERT INTO public.hr_audit_events
      (event_type, actor_type, actor_id, target_type, target_id, action, outcome, idempotency_key, request_fingerprint)
    VALUES
      ('EMPLOYEE_UPDATE', 'human', p_actor_id, 'employee', p_employee_id::text, 'update_employee', 'denied', p_idempotency_key, p_request_fingerprint)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN jsonb_build_object('error', 'Not authorized', 'employee', NULL);
  END IF;

  -- 2. Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_idemp FROM hr_check_idempotency(p_idempotency_key, p_request_fingerprint);
    IF v_idemp IS NOT NULL THEN
      IF v_idemp.status = 'fingerprint_mismatch' THEN
        RETURN jsonb_build_object('error', 'Idempotency key already used for a different request', 'employee', NULL);
      END IF;
      IF v_idemp.prior_outcome = 'success' AND v_idemp.prior_target_id IS NOT NULL THEN
        SELECT jsonb_build_object('error', NULL, 'employee', row_to_json(e)::jsonb)
        INTO v_result FROM public.hr_employees e WHERE e.id = v_idemp.prior_target_id::uuid;
        IF v_result IS NOT NULL THEN RETURN v_result; END IF;
      END IF;
    END IF;
  END IF;

  -- 3. Update
  UPDATE public.hr_employees SET
    full_name = COALESCE(p_updates->>'full_name', full_name),
    preferred_name = CASE WHEN p_updates ? 'preferred_name' THEN p_updates->>'preferred_name' ELSE preferred_name END,
    employment_status = COALESCE(p_updates->>'employment_status', employment_status),
    employment_classification = CASE WHEN p_updates ? 'employment_classification' THEN p_updates->>'employment_classification' ELSE employment_classification END,
    work_state = CASE WHEN p_updates ? 'work_state' THEN p_updates->>'work_state' ELSE work_state END,
    start_date = CASE WHEN p_updates ? 'start_date' THEN (p_updates->>'start_date')::date ELSE start_date END,
    end_date = CASE WHEN p_updates ? 'end_date' THEN (p_updates->>'end_date')::date ELSE end_date END,
    contract_assignment = CASE WHEN p_updates ? 'contract_assignment' THEN p_updates->>'contract_assignment' ELSE contract_assignment END,
    email = CASE WHEN p_updates ? 'email' THEN p_updates->>'email' ELSE email END,
    slack_user_id = CASE WHEN p_updates ? 'slack_user_id' THEN p_updates->>'slack_user_id' ELSE slack_user_id END,
    updated_by = p_actor_id, updated_at = NOW()
  WHERE id = p_employee_id AND is_synthetic = true;

  IF NOT FOUND THEN
    INSERT INTO public.hr_audit_events
      (event_type, actor_type, actor_id, target_type, target_id, action, outcome, idempotency_key, request_fingerprint)
    VALUES
      ('EMPLOYEE_UPDATE', 'human', p_actor_id, 'employee', p_employee_id::text, 'update_employee', 'failure', p_idempotency_key, p_request_fingerprint)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN jsonb_build_object('error', 'Employee not found or not synthetic', 'employee', NULL);
  END IF;

  -- 4. Audit
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, idempotency_key, request_fingerprint)
  VALUES
    ('EMPLOYEE_UPDATE', 'human', p_actor_id, 'employee', p_employee_id::text, 'update_employee', 'success', p_idempotency_key, p_request_fingerprint);

  -- 5. Return
  SELECT jsonb_build_object('error', NULL, 'employee', row_to_json(e)::jsonb)
  INTO v_result FROM public.hr_employees e WHERE e.id = p_employee_id;
  RETURN v_result;
END;
$$;

-- ============================================================
-- Deactivate Employee
-- ============================================================
CREATE OR REPLACE FUNCTION hr_deactivate_employee(
  p_actor_id TEXT,
  p_employee_id UUID,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idemp RECORD;
BEGIN
  -- 1. Authorization
  IF NOT hr_is_authorized_admin(p_actor_id) THEN
    INSERT INTO public.hr_audit_events
      (event_type, actor_type, actor_id, target_type, target_id, action, outcome, idempotency_key, request_fingerprint)
    VALUES
      ('EMPLOYEE_DEACTIVATE', 'human', p_actor_id, 'employee', p_employee_id::text, 'deactivate_employee', 'denied', p_idempotency_key, p_request_fingerprint)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN jsonb_build_object('error', 'Not authorized', 'success', false);
  END IF;

  -- 2. Idempotency
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_idemp FROM hr_check_idempotency(p_idempotency_key, p_request_fingerprint);
    IF v_idemp IS NOT NULL THEN
      IF v_idemp.status = 'fingerprint_mismatch' THEN
        RETURN jsonb_build_object('error', 'Idempotency key already used for a different request', 'success', false);
      END IF;
      IF v_idemp.prior_outcome = 'success' THEN
        RETURN jsonb_build_object('error', NULL, 'success', true);
      END IF;
    END IF;
  END IF;

  -- 3. Deactivate
  UPDATE public.hr_employees SET
    employment_status = 'inactive', updated_by = p_actor_id, updated_at = NOW()
  WHERE id = p_employee_id AND is_synthetic = true;

  IF NOT FOUND THEN
    INSERT INTO public.hr_audit_events
      (event_type, actor_type, actor_id, target_type, target_id, action, outcome, idempotency_key, request_fingerprint)
    VALUES
      ('EMPLOYEE_DEACTIVATE', 'human', p_actor_id, 'employee', p_employee_id::text, 'deactivate_employee', 'failure', p_idempotency_key, p_request_fingerprint)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    RETURN jsonb_build_object('error', 'Employee not found or not synthetic', 'success', false);
  END IF;

  -- 4. Audit
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, idempotency_key, request_fingerprint)
  VALUES
    ('EMPLOYEE_DEACTIVATE', 'human', p_actor_id, 'employee', p_employee_id::text, 'deactivate_employee', 'success', p_idempotency_key, p_request_fingerprint);

  RETURN jsonb_build_object('error', NULL, 'success', true);
END;
$$;

-- ============================================================
-- Security: restrict execution to service_role
-- ============================================================
REVOKE EXECUTE ON FUNCTION hr_is_authorized_admin(TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_is_authorized_admin(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION hr_check_idempotency(TEXT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_check_idempotency(TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION hr_create_employee FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_create_employee TO service_role;

REVOKE EXECUTE ON FUNCTION hr_update_employee FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_update_employee TO service_role;

REVOKE EXECUTE ON FUNCTION hr_deactivate_employee FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_deactivate_employee TO service_role;
