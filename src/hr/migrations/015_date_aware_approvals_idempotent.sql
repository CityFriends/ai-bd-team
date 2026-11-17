-- Migration 015: Date-Aware HR Content Approvals (IDEMPOTENT VERSION)
-- C8X-107AZ: Support effective dates for policy versioning
-- C8X-107BD: Fixed for safe re-execution
--
-- This migration enables:
-- 1. Multiple content versions per page (by content_hash)
-- 2. Date-ranged approvals (valid_from, valid_until)
-- 3. Future-dated policy staging
-- 4. Automatic version switching at effective date
--
-- Timezone: America/New_York (FFTC company policy timezone)
--
-- IDEMPOTENT: Safe to run multiple times. All operations check for
-- existing objects before creating them.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Add content_hash to hr_knowledge_chunks for version separation
-- ═══════════════════════════════════════════════════════════════════════════

-- Add page_content_hash column to track which version chunks belong to
ALTER TABLE hr_knowledge_chunks
ADD COLUMN IF NOT EXISTS page_content_hash TEXT;

-- Backfill existing chunks with their page's current content_hash
-- (WHERE clause makes this idempotent - skips already-backfilled rows)
UPDATE hr_knowledge_chunks c
SET page_content_hash = p.content_hash
FROM hr_knowledge_pages p
WHERE c.page_id = p.id
  AND c.page_content_hash IS NULL;

-- Make column NOT NULL after backfill (safe to run multiple times)
-- Note: PostgreSQL allows SET NOT NULL on already-NOT-NULL columns
ALTER TABLE hr_knowledge_chunks
ALTER COLUMN page_content_hash SET NOT NULL;

-- Create index for version-aware chunk retrieval
CREATE INDEX IF NOT EXISTS idx_chunks_page_content_hash
ON hr_knowledge_chunks(page_id, page_content_hash);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Add date range columns to hr_page_approvals
-- ═══════════════════════════════════════════════════════════════════════════

-- valid_from: when this approval becomes effective (business date)
ALTER TABLE hr_page_approvals
ADD COLUMN IF NOT EXISTS valid_from DATE;

-- valid_until: when this approval expires (NULL = never expires)
ALTER TABLE hr_page_approvals
ADD COLUMN IF NOT EXISTS valid_until DATE;

-- Backfill existing approvals: effective from approval date, never expires
-- (WHERE clause makes this idempotent - skips already-backfilled rows)
UPDATE hr_page_approvals
SET valid_from = (approved_at AT TIME ZONE 'America/New_York')::DATE
WHERE valid_from IS NULL;

-- Make valid_from NOT NULL after backfill (safe to run multiple times)
ALTER TABLE hr_page_approvals
ALTER COLUMN valid_from SET NOT NULL;

-- Add constraint: valid_until must be after valid_from (if set)
-- IDEMPOTENT: Use DO block to check constraint via pg_constraint with table OID
-- SAFE: Verifies existing constraint has expected definition, fails if different
DO $$
DECLARE
  v_table_oid OID;
  v_existing_def TEXT;
  v_expected_pattern TEXT := '%valid_until IS NULL%valid_until >= valid_from%';
BEGIN
  -- Get the table OID for hr_page_approvals
  SELECT c.oid INTO v_table_oid
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'hr_page_approvals'
    AND n.nspname = 'public';

  -- Check if constraint exists on this specific table
  SELECT pg_get_constraintdef(con.oid) INTO v_existing_def
  FROM pg_constraint con
  WHERE con.conrelid = v_table_oid
    AND con.conname = 'chk_valid_date_range'
    AND con.contype = 'c';  -- 'c' = check constraint

  IF v_existing_def IS NULL THEN
    -- Constraint doesn't exist, create it
    ALTER TABLE hr_page_approvals
    ADD CONSTRAINT chk_valid_date_range
    CHECK (valid_until IS NULL OR valid_until >= valid_from);
    RAISE NOTICE 'Created constraint chk_valid_date_range';
  ELSIF v_existing_def LIKE v_expected_pattern THEN
    -- Constraint exists with expected definition, skip
    RAISE NOTICE 'Constraint chk_valid_date_range already exists with correct definition';
  ELSE
    -- Constraint exists but with DIFFERENT definition - fail safely
    RAISE EXCEPTION 'MIGRATION SAFETY CHECK FAILED: Constraint chk_valid_date_range exists but has unexpected definition. Expected pattern: %. Found: %. Manual intervention required.',
      v_expected_pattern, v_existing_def;
  END IF;
END
$$;

-- Index for date-range queries
CREATE INDEX IF NOT EXISTS idx_approvals_valid_dates
ON hr_page_approvals(knowledge_page_id, valid_from, valid_until)
WHERE revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Helper function for policy timezone
-- ═══════════════════════════════════════════════════════════════════════════

-- Returns current business date in company policy timezone
CREATE OR REPLACE FUNCTION hr_policy_date()
RETURNS DATE
LANGUAGE SQL
STABLE
AS $$
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Create date-aware retrieval function
-- ═══════════════════════════════════════════════════════════════════════════

-- Retrieves chunks for a page, respecting effective dates
-- p_as_of_date: NULL = current date, or specific date for testing
-- p_include_upcoming: TRUE = also return future-dated versions (labeled)
CREATE OR REPLACE FUNCTION hr_get_effective_chunks(
  p_page_id UUID,
  p_as_of_date DATE DEFAULT NULL,
  p_include_upcoming BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  chunk_id UUID,
  chunk_index INTEGER,
  content_text TEXT,
  content_hash TEXT,
  page_content_hash TEXT,
  heading_path TEXT[],
  first_block_id TEXT,
  is_current BOOLEAN,
  is_upcoming BOOLEAN,
  valid_from DATE,
  valid_until DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_as_of DATE := COALESCE(p_as_of_date, hr_policy_date());
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.chunk_index,
    c.content_text,
    c.content_hash,
    c.page_content_hash,
    c.heading_path,
    c.first_block_id,
    -- is_current: approval is active on the as_of_date
    (a.valid_from <= v_as_of AND (a.valid_until IS NULL OR a.valid_until >= v_as_of)) AS is_current,
    -- is_upcoming: approval starts after as_of_date
    (a.valid_from > v_as_of) AS is_upcoming,
    a.valid_from,
    a.valid_until
  FROM hr_knowledge_chunks c
  JOIN hr_page_approvals a ON a.knowledge_page_id = c.page_id
                          AND a.approved_content_hash = c.page_content_hash
  WHERE c.page_id = p_page_id
    AND a.revoked_at IS NULL
    AND (
      -- Current policy: effective on as_of_date
      (a.valid_from <= v_as_of AND (a.valid_until IS NULL OR a.valid_until >= v_as_of))
      OR
      -- Upcoming policy: include if requested
      (p_include_upcoming AND a.valid_from > v_as_of)
    )
  ORDER BY a.valid_from DESC, c.chunk_index ASC;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Date-aware search function (replaces or augments hr_search_knowledge)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION hr_search_knowledge_v2(
  p_user_id TEXT,
  p_query TEXT,
  p_limit INTEGER DEFAULT 10,
  p_as_of_date DATE DEFAULT NULL,
  p_include_upcoming BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  chunk_id UUID,
  page_id UUID,
  title TEXT,
  content_text TEXT,
  page_url TEXT,
  chunk_index INTEGER,
  page_content_hash TEXT,
  is_current BOOLEAN,
  is_upcoming BOOLEAN,
  valid_from DATE,
  rank REAL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_as_of DATE := COALESCE(p_as_of_date, hr_policy_date());
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    p.id AS page_id,
    p.title,
    c.content_text,
    p.page_url,
    c.chunk_index,
    c.page_content_hash,
    -- is_current: effective on as_of_date
    (a.valid_from <= v_as_of AND (a.valid_until IS NULL OR a.valid_until >= v_as_of)) AS is_current,
    -- is_upcoming: starts after as_of_date
    (a.valid_from > v_as_of) AS is_upcoming,
    a.valid_from,
    -- ILIKE rank (simple text match scoring)
    CASE
      WHEN c.content_text ILIKE '%' || p_query || '%' THEN 1.0
      ELSE 0.5
    END AS rank
  FROM hr_knowledge_pages p
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
                          AND a.approved_content_hash = c.page_content_hash
  WHERE a.revoked_at IS NULL
    AND p.is_excluded = FALSE
    AND (
      -- Current policy
      (a.valid_from <= v_as_of AND (a.valid_until IS NULL OR a.valid_until >= v_as_of))
      OR
      -- Upcoming if requested
      (p_include_upcoming AND a.valid_from > v_as_of)
    )
    AND c.content_text ILIKE '%' || p_query || '%'
  ORDER BY
    -- Current policies first
    (a.valid_from <= v_as_of) DESC,
    rank DESC,
    a.valid_from ASC
  LIMIT p_limit;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Date-aware approval function
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION hr_approve_knowledge_page_v2(
  p_admin TEXT,
  p_page_id UUID,
  p_content_hash TEXT,
  p_valid_from DATE,
  p_valid_until DATE DEFAULT NULL,
  p_supersedes_approval_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  v_page RECORD;
  v_new_approval_id UUID;
  v_policy_date DATE := hr_policy_date();
BEGIN
  -- 1. Verify page exists
  SELECT id, content_hash INTO v_page
  FROM hr_knowledge_pages
  WHERE id = p_page_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'page_not_found');
  END IF;

  -- 2. Verify content hash matches stored content OR chunks exist for this hash
  IF NOT EXISTS (
    SELECT 1 FROM hr_knowledge_chunks
    WHERE page_id = p_page_id AND page_content_hash = p_content_hash
  ) THEN
    RETURN json_build_object('error', 'content_not_synced');
  END IF;

  -- 3. Validate date range
  IF p_valid_until IS NOT NULL AND p_valid_until < p_valid_from THEN
    RETURN json_build_object('error', 'invalid_date_range');
  END IF;

  -- 4. If superseding, set valid_until on the superseded approval (ATOMIC)
  IF p_supersedes_approval_id IS NOT NULL THEN
    UPDATE hr_page_approvals
    SET valid_until = p_valid_from - INTERVAL '1 day'
    WHERE id = p_supersedes_approval_id
      AND revoked_at IS NULL
      AND knowledge_page_id = p_page_id;

    IF NOT FOUND THEN
      RETURN json_build_object('error', 'superseded_approval_not_found');
    END IF;
  END IF;

  -- 5. Create new approval
  INSERT INTO hr_page_approvals (
    knowledge_page_id,
    approved_content_hash,
    approved_by,
    approved_at,
    valid_from,
    valid_until
  ) VALUES (
    p_page_id,
    p_content_hash,
    p_admin,
    NOW(),
    p_valid_from,
    p_valid_until
  )
  RETURNING id INTO v_new_approval_id;

  RETURN json_build_object(
    'approval_id', v_new_approval_id,
    'valid_from', p_valid_from,
    'valid_until', p_valid_until,
    'is_future', p_valid_from > v_policy_date
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6b: Atomic future-dated policy staging with supersession
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Atomically stages a future-dated policy that supersedes the current approval.
-- Both updates happen in a single transaction - either both succeed or both fail.
--
-- This function:
-- 1. Verifies the current approval exists and is active
-- 2. Verifies the new content hash has synced chunks
-- 3. Sets valid_until on current approval to (new_valid_from - 1 day)
-- 4. Creates new approval with specified valid_from
-- 5. All changes are atomic (single transaction)

CREATE OR REPLACE FUNCTION hr_stage_future_policy(
  p_admin TEXT,
  p_page_id UUID,
  p_new_content_hash TEXT,
  p_new_valid_from DATE,
  p_current_approval_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  v_current_approval RECORD;
  v_new_approval_id UUID;
  v_policy_date DATE := hr_policy_date();
BEGIN
  -- 1. Verify new_valid_from is in the future
  IF p_new_valid_from <= v_policy_date THEN
    RETURN json_build_object('error', 'valid_from_must_be_future');
  END IF;

  -- 2. Verify current approval exists and is active
  SELECT id, knowledge_page_id, approved_content_hash, valid_from, valid_until
  INTO v_current_approval
  FROM hr_page_approvals
  WHERE id = p_current_approval_id
    AND knowledge_page_id = p_page_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'current_approval_not_found');
  END IF;

  -- 3. Verify current approval is currently effective (not already expired)
  IF v_current_approval.valid_until IS NOT NULL AND v_current_approval.valid_until < v_policy_date THEN
    RETURN json_build_object('error', 'current_approval_already_expired');
  END IF;

  -- 4. Verify new content has synced chunks
  IF NOT EXISTS (
    SELECT 1 FROM hr_knowledge_chunks
    WHERE page_id = p_page_id AND page_content_hash = p_new_content_hash
  ) THEN
    RETURN json_build_object('error', 'new_content_not_synced');
  END IF;

  -- 5. ATOMIC: Set expiration on current approval
  UPDATE hr_page_approvals
  SET valid_until = p_new_valid_from - INTERVAL '1 day'
  WHERE id = p_current_approval_id;

  -- 6. ATOMIC: Create new future-dated approval
  INSERT INTO hr_page_approvals (
    knowledge_page_id,
    approved_content_hash,
    approved_by,
    approved_at,
    valid_from,
    valid_until
  ) VALUES (
    p_page_id,
    p_new_content_hash,
    p_admin,
    NOW(),
    p_new_valid_from,
    NULL  -- No expiration
  )
  RETURNING id INTO v_new_approval_id;

  RETURN json_build_object(
    'success', true,
    'current_approval_id', p_current_approval_id,
    'current_valid_until', p_new_valid_from - INTERVAL '1 day',
    'new_approval_id', v_new_approval_id,
    'new_valid_from', p_new_valid_from,
    'staged_hash', p_new_content_hash
  );
END;
$$;

-- Grant to service role (GRANT is idempotent)
GRANT EXECUTE ON FUNCTION hr_stage_future_policy(TEXT, UUID, TEXT, DATE, UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Update production retrieval RPC with date-aware filtering
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CRITICAL: This modifies hr_retrieve_knowledge_v2 to:
-- 1. Join chunks on page_content_hash = approved_content_hash
-- 2. Filter approvals by valid_from/valid_until date range
-- 3. Prevent future-dated content from leaking into current retrieval
--
-- Changes from original:
-- - Line ~89: Added date filter to approval EXISTS check
-- - Line ~93: Join chunks via page_content_hash matching effective approval
--
-- Preserves ALL existing security: identity token verification, employee
-- resolution, scope validation, audit logging, root checks.

CREATE OR REPLACE FUNCTION public.hr_retrieve_knowledge_v2(
  p_identity_token text,
  p_query text,
  p_freshness_minutes integer DEFAULT 30,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(
  content_text text,
  heading_path text[],
  first_block_id text,
  title text,
  page_url text,
  notion_page_id text,
  last_verified_at timestamp with time zone,
  access_classification text,
  chunk_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_secret TEXT;
  v_parts TEXT[];
  v_payload_b64 TEXT;
  v_sig_provided TEXT;
  v_sig_expected TEXT;
  v_payload JSONB;
  v_slack_id TEXT;
  v_exp BIGINT;
  v_iat BIGINT;
  v_now BIGINT;
  v_employee_id UUID;
  v_is_active BOOLEAN := false;
  v_is_admin BOOLEAN;
  v_access_basis TEXT;
  v_correlation_id TEXT;
  v_results public._hr_retrieval_row_v2[];
  v_row public._hr_retrieval_row_v2;
  v_safe_limit INT;
  v_audit_failed BOOLEAN := false;
  v_pers_page_id UUID;
  v_pers_np_id TEXT;
  v_pers_page_ids UUID[];
  v_i INT;
  -- NEW: Policy date for date-aware filtering
  v_policy_date DATE := hr_policy_date();
BEGIN
  -- 0. Clamp p_limit to safe bounds [0, 100]; NULL defaults to 5
  v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 5), 0), 100);

  -- 1. Get signing secret (only function owner can read this table)
  SELECT secret_value INTO v_secret
  FROM public.hr_signing_secrets
  WHERE secret_name = 'identity_hmac' AND is_active = true
  LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  -- 2. Parse token: base64_payload.hex_signature
  v_parts := string_to_array(p_identity_token, '.');
  IF v_parts IS NULL OR array_length(v_parts, 1) != 2 THEN RETURN; END IF;
  v_payload_b64 := v_parts[1];
  v_sig_provided := v_parts[2];
  IF v_payload_b64 IS NULL OR v_sig_provided IS NULL THEN RETURN; END IF;

  -- 3. Verify HMAC-SHA256 signature
  BEGIN
    v_sig_expected := encode(
      extensions.hmac(decode(v_payload_b64, 'base64'), v_secret::bytea, 'sha256'),
      'hex'
    );
  EXCEPTION WHEN OTHERS THEN RETURN; END;

  IF v_sig_provided != v_sig_expected THEN RETURN; END IF;

  -- 4. Decode payload
  BEGIN
    v_payload := convert_from(decode(v_payload_b64, 'base64'), 'UTF8')::jsonb;
  EXCEPTION WHEN OTHERS THEN RETURN; END;

  v_slack_id := v_payload->>'sub';
  v_exp := (v_payload->>'exp')::bigint;
  v_iat := (v_payload->>'iat')::bigint;
  v_now := extract(epoch FROM now())::bigint;

  IF v_slack_id IS NULL OR v_exp IS NULL OR v_iat IS NULL THEN RETURN; END IF;

  -- 5. Validate: audience and purpose
  IF v_payload->>'aud' != 'hr_retrieve' THEN RETURN; END IF;

  -- 6. Validate: expiration (30s window)
  IF v_exp < v_now THEN RETURN; END IF;

  -- 7. Validate: not too old (60s max age)
  IF v_iat < v_now - 60 THEN RETURN; END IF;

  -- 8. Resolve identity
  SELECT id INTO v_employee_id
  FROM public.hr_employees
  WHERE slack_user_id = v_slack_id AND employment_status = 'active';
  v_is_active := (v_employee_id IS NOT NULL);
  v_is_admin := public.hr_is_authorized_admin(v_slack_id);

  IF NOT v_is_active AND NOT v_is_admin THEN RETURN; END IF;

  IF v_is_admin THEN v_access_basis := 'admin';
  ELSIF v_is_active THEN v_access_basis := 'employee';
  END IF;

  v_correlation_id := gen_random_uuid()::text;

  -- 9. Materialize authorized results into typed array
  --
  -- KEY CHANGES FOR DATE-AWARE RETRIEVAL:
  -- - Join chunks via page_content_hash matching the EFFECTIVE approval
  -- - Filter approvals by valid_from <= today AND (valid_until IS NULL OR valid_until >= today)
  -- - This prevents future-dated content from appearing in current retrieval
  --
  SELECT array_agg(
    ROW(
      sub.content_text, sub.heading_path, sub.first_block_id,
      sub.title, sub.page_url, sub.notion_page_id,
      sub.last_verified_at, sub.access_classification,
      sub.chunk_id, sub.page_id
    )::public._hr_retrieval_row_v2
  )
  INTO v_results
  FROM (
    SELECT c.content_text, c.heading_path, c.first_block_id,
           p.title, p.page_url, p.notion_page_id,
           p.last_verified_at, p.access_classification,
           c.id AS chunk_id, p.id AS page_id
    FROM public.hr_knowledge_pages p
    -- Join to effective approval first (determines which content version is active)
    JOIN public.hr_page_approvals a ON a.knowledge_page_id = p.id
      AND a.revoked_at IS NULL
      -- DATE-AWARE: Only approvals effective on current policy date
      AND a.valid_from <= v_policy_date
      AND (a.valid_until IS NULL OR a.valid_until >= v_policy_date)
    -- Join chunks matching the APPROVED content hash (not page.content_hash)
    JOIN public.hr_knowledge_chunks c ON c.page_id = p.id
      AND c.page_content_hash = a.approved_content_hash
    JOIN public.hr_approved_roots ar ON p.approved_root_id = ar.id
    JOIN public.hr_notion_connections conn ON p.connection_id = conn.id
    LEFT JOIN public.hr_knowledge_sources s ON p.source_id = s.id
    WHERE p.sync_status = 'synced' AND NOT p.is_excluded
      AND p.last_verified_at > NOW() - make_interval(mins => p_freshness_minutes)
      AND conn.is_active AND ar.is_active
      AND ar.connection_id = conn.id
      AND p.access_classification = ar.access_classification
      AND ((conn.scope = 'employee'   AND p.access_classification = 'employee_safe')
        OR (conn.scope = 'onboarding' AND p.access_classification = 'personalized')
        OR (conn.scope = 'admin'      AND p.access_classification = 'hr_restricted'))
      AND (s.id IS NULL OR s.approval_status = 'approved')
      AND (s.id IS NULL OR s.is_authoritative = false OR s.source_type = 'handbook_pdf')
      AND c.content_text ILIKE '%' || p_query || '%'
      AND (
        v_is_admin
        OR p.access_classification = 'employee_safe'
        OR (p.access_classification = 'personalized' AND v_is_active
            AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
              JOIN public.hr_employees ge ON g.employee_id = ge.id
              WHERE g.knowledge_page_id = p.id AND g.revoked_at IS NULL
                AND ge.employment_status = 'active' AND g.employee_id = v_employee_id))
        OR (p.access_classification = 'personalized' AND v_is_active
            AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
              JOIN public.hr_employees ge ON g.employee_id = ge.id
              JOIN public.hr_supervisor_assignments sa ON sa.employee_id = g.employee_id
              WHERE g.knowledge_page_id = p.id AND g.revoked_at IS NULL
                AND ge.employment_status = 'active'
                AND sa.supervisor_id = v_employee_id AND sa.revoked_at IS NULL))
      )
    ORDER BY p.last_verified_at DESC
    LIMIT v_safe_limit
  ) sub;

  IF v_results IS NULL THEN RETURN; END IF;

  -- 10. Collect distinct personalized page IDs for audit
  SELECT array_agg(DISTINCT (r).page_id)
  INTO v_pers_page_ids
  FROM unnest(v_results) AS r
  WHERE (r).access_classification = 'personalized';

  -- 11. Audit every personalized page BEFORE returning content
  IF v_pers_page_ids IS NOT NULL THEN
    FOREACH v_pers_page_id IN ARRAY v_pers_page_ids LOOP
      IF v_is_admin THEN
        v_access_basis := 'admin';
      ELSIF EXISTS(
        SELECT 1 FROM public.hr_supervisor_assignments sa
        WHERE sa.supervisor_id = v_employee_id AND sa.revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
            WHERE g.knowledge_page_id = v_pers_page_id
              AND g.employee_id = sa.employee_id AND g.revoked_at IS NULL)
      ) THEN
        v_access_basis := 'supervisor';
      ELSE
        v_access_basis := 'direct_grant';
      END IF;

      SELECT (r).notion_page_id INTO v_pers_np_id
      FROM unnest(v_results) AS r
      WHERE (r).page_id = v_pers_page_id
      LIMIT 1;

      BEGIN
        INSERT INTO public.hr_audit_events (
          event_type, actor_type, actor_id, target_type, target_id,
          action, outcome, correlation_id, metadata
        ) VALUES (
          'PERSONALIZED_RETRIEVAL', 'human', v_slack_id,
          'knowledge_page', v_pers_page_id::text,
          'retrieve_personalized', 'success', v_correlation_id,
          jsonb_build_object('access_basis', v_access_basis,
                             'notion_page_id', v_pers_np_id)
        );
      EXCEPTION WHEN OTHERS THEN
        v_audit_failed := true;
        EXIT;
      END;
    END LOOP;
  END IF;

  -- 12. Return results, suppressing personalized if audit failed
  FOR v_i IN 1..array_length(v_results, 1) LOOP
    v_row := v_results[v_i];
    IF v_audit_failed AND (v_row).access_classification = 'personalized' THEN
      CONTINUE;
    END IF;
    content_text         := (v_row).content_text;
    heading_path         := (v_row).heading_path;
    first_block_id       := (v_row).first_block_id;
    title                := (v_row).title;
    page_url             := (v_row).page_url;
    notion_page_id       := (v_row).notion_page_id;
    last_verified_at     := (v_row).last_verified_at;
    access_classification := (v_row).access_classification;
    chunk_id             := (v_row).chunk_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 8: Grant permissions for shadow reader (all GRANTs are idempotent)
-- ═══════════════════════════════════════════════════════════════════════════

-- Shadow reader needs EXECUTE on the new functions
GRANT EXECUTE ON FUNCTION hr_policy_date() TO hr_shadow_reader;
GRANT EXECUTE ON FUNCTION hr_get_effective_chunks(UUID, DATE, BOOLEAN) TO hr_shadow_reader;
GRANT EXECUTE ON FUNCTION hr_search_knowledge_v2(TEXT, TEXT, INTEGER, DATE, BOOLEAN) TO hr_shadow_reader;

-- Service role needs approval function
GRANT EXECUTE ON FUNCTION hr_approve_knowledge_page_v2(TEXT, UUID, TEXT, DATE, DATE, UUID) TO service_role;

COMMIT;
