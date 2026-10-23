-- ============================================================
-- HR Atomic Bootstrap Administrator Synchronization
--
-- Replaces the multi-step JS delete+upsert with a single
-- transactional RPC that atomically sets the desired admin list.
--
-- Safety:
--   - Advisory lock prevents concurrent interleaving
--   - Rejects empty, null, duplicate, or malformed IDs
--   - Inserts missing admins, removes stale ones, in one transaction
--   - Idempotent: repeated calls with same list are no-ops
--   - GET DIAGNOSTICS captures actual row counts
--   - SECURITY DEFINER with SET search_path = public
--   - EXECUTE restricted to service_role
--   - No dynamic SQL
--
-- Advisory lock key: 8008135 (fixed, dedicated to HR bootstrap sync)
--
-- Target: Dedicated HR Supabase project (NOT the BD project)
-- DO NOT execute against bvgtfadggtgnakrxvuim
-- ============================================================

CREATE OR REPLACE FUNCTION hr_sync_bootstrap_admins(
  p_desired_ids TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_added INT := 0;
  v_removed INT := 0;
  v_id TEXT;
  v_distinct_ids TEXT[];
BEGIN
  -- ============================================================
  -- 1. Input validation
  -- ============================================================

  -- Reject null or empty array
  IF p_desired_ids IS NULL
     OR array_length(p_desired_ids, 1) IS NULL
     OR array_length(p_desired_ids, 1) = 0
  THEN
    RETURN jsonb_build_object(
      'error', 'Cannot sync an empty administrator list',
      'added', 0, 'removed', 0
    );
  END IF;

  -- Reject null or blank elements
  FOREACH v_id IN ARRAY p_desired_ids LOOP
    IF v_id IS NULL OR btrim(v_id) = '' THEN
      RETURN jsonb_build_object(
        'error', 'Administrator list contains null or blank entries',
        'added', 0, 'removed', 0
      );
    END IF;
  END LOOP;

  -- Reject IDs that don't match Slack user ID format: U followed by 4+ alphanumeric chars
  FOREACH v_id IN ARRAY p_desired_ids LOOP
    IF v_id !~ '^U[A-Z0-9]{4,}$' THEN
      RETURN jsonb_build_object(
        'error', 'Administrator list contains an invalid Slack user ID',
        'added', 0, 'removed', 0
      );
    END IF;
  END LOOP;

  -- Deduplicate and reject if duplicates were present
  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_distinct_ids FROM unnest(p_desired_ids) AS u;
  IF array_length(v_distinct_ids, 1) != array_length(p_desired_ids, 1) THEN
    RETURN jsonb_build_object(
      'error', 'Administrator list contains duplicate IDs',
      'added', 0, 'removed', 0
    );
  END IF;

  -- ============================================================
  -- 2. Serialize concurrent calls with advisory lock
  --    Key 8008135 is dedicated to HR bootstrap sync.
  --    pg_advisory_xact_lock is released automatically at transaction end.
  -- ============================================================
  PERFORM pg_advisory_xact_lock(8008135);

  -- ============================================================
  -- 3. Atomic sync: remove stale, insert missing
  --    GET DIAGNOSTICS captures the actual affected row count.
  -- ============================================================

  -- Remove admins no longer in the desired list
  DELETE FROM public.hr_bootstrap_admins
  WHERE slack_user_id != ALL(v_distinct_ids);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Insert admins not yet present (idempotent via ON CONFLICT)
  INSERT INTO public.hr_bootstrap_admins (slack_user_id)
  SELECT unnest(v_distinct_ids)
  ON CONFLICT (slack_user_id) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  RETURN jsonb_build_object('error', NULL, 'added', v_added, 'removed', v_removed);
END;
$$;

REVOKE EXECUTE ON FUNCTION hr_sync_bootstrap_admins(TEXT[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_sync_bootstrap_admins(TEXT[]) TO service_role;

COMMENT ON FUNCTION hr_sync_bootstrap_admins IS
  'Atomically sync the bootstrap admin list. Validates IDs, serializes via advisory lock, rejects empty/invalid lists. service_role only.';
