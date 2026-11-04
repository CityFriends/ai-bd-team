-- ============================================================
-- Migration 010: Retrieval Temp-Table Hardening
--
-- Replaces caller-visible temporary tables in both retrieval
-- functions with typed in-memory arrays. This eliminates the
-- attack surface identified in C8X-60:
--
--   F1: Caller-created temp table with incompatible columns
--       causes unhandled errors (denial of service).
--   F2: Caller-defined CHECK constraints cause error DETAIL
--       to expose retrieved row content.
--   F3: Caller-attached triggers on pre-created temp tables
--       (not exploitable under current search_path, but the
--       defense is accidental, not by design).
--
-- Both functions are replaced using CREATE OR REPLACE FUNCTION.
-- Return signatures, parameter defaults, authorization logic,
-- identity verification, audit-before-return semantics, and
-- EXECUTE grants are preserved exactly.
--
-- CHANGE SUMMARY:
--   - No CREATE TEMP TABLE, TRUNCATE, DROP TABLE, or DELETE
--     against caller-visible temporary relations.
--   - Results accumulated in typed PL/pgSQL arrays.
--   - search_path changed to pg_catalog, public, pg_temp
--     (explicitly positions pg_temp last; pg_catalog first).
--   - p_limit clamped to [0, 100] to bound memory allocation.
--     Owner-approved: default remains 5, maximum is 100.
--
-- PREREQUISITES:
--   Migrations 001-009 must be applied before this migration.
--   Validated at runtime: migration raises an error if
--   hr_retrieve_knowledge_v2 does not exist or has an
--   incompatible return schema (exact 9-column check).
--
-- DEPLOYMENT ORDER:
--   1. Apply migration 010.
--   2. Verify both functions with disposable PostgreSQL tests.
--   3. No TypeScript changes required.
--
-- TARGET: HR Supabase project vzrlnshdxrupukzhfllf
-- DO NOT execute against bvgtfadggtgnakrxvuim (BD)
--
-- ROLLBACK:
--   To restore the original temp-table implementations:
--     1. Re-apply migration 007 section 6 (hr_retrieve_knowledge).
--     2. Re-apply migration 009 (hr_retrieve_knowledge_v2).
--     3. Optionally DROP the composite types:
--        DROP TYPE IF EXISTS public._hr_retrieval_row_v2;
--        DROP TYPE IF EXISTS public._hr_retrieval_row;
--        (Check for dependencies first with pg_depend.)
--   WARNING: Rollback reintroduces the temp-table security weakness.
-- ============================================================

-- ============================================================
-- 0. Prerequisite: migration 009 must have been applied
--    with the exact expected v2 return schema.
--
-- Validates existence AND exact return-column schema using
-- pg_proc catalog metadata (proallargtypes, proargnames,
-- proargmodes). This prevents partial migration if a
-- malformed predecessor exists.
--
-- Must execute BEFORE any type creation or function replacement
-- to avoid leaving a partial migration state.
-- ============================================================

DO $prereq$
DECLARE
  v_fn_oid OID;
  v_all_types OID[];
  v_arg_names TEXT[];
  v_arg_modes "char"[];
  v_out_names TEXT[];
  v_out_types TEXT[];
  v_expected_names TEXT[] := ARRAY[
    'content_text', 'heading_path', 'first_block_id',
    'title', 'page_url', 'notion_page_id',
    'last_verified_at', 'access_classification', 'chunk_id'
  ];
  v_expected_types TEXT[] := ARRAY[
    'text', 'text[]', 'text',
    'text', 'text', 'text',
    'timestamp with time zone', 'text', 'uuid'
  ];
  v_i INT;
BEGIN
  -- Step 1: Verify the function exists
  v_fn_oid := to_regprocedure('public.hr_retrieve_knowledge_v2(text,text,integer,integer)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 010 requires migration 009: '
      'public.hr_retrieve_knowledge_v2(text,text,integer,integer) does not exist. '
      'Apply migration 009 first.';
  END IF;

  -- Step 2: Retrieve the function's full argument metadata
  SELECT p.proallargtypes, p.proargnames, p.proargmodes
  INTO v_all_types, v_arg_names, v_arg_modes
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_fn_oid;

  -- proallargtypes is NULL for functions with only input args (no RETURNS TABLE).
  -- A valid v2 function created by migration 009 must have output columns.
  IF v_all_types IS NULL OR v_arg_modes IS NULL THEN
    RAISE EXCEPTION 'Migration 010: hr_retrieve_knowledge_v2 exists but does not have '
      'RETURNS TABLE output columns. Expected 9 output columns (migration 009 schema). '
      'The existing function may have an incompatible return type.';
  END IF;

  -- Step 3: Extract output columns (mode = 't' for TABLE output)
  -- Collect output column names and formatted types in order.
  v_out_names := ARRAY[]::TEXT[];
  v_out_types := ARRAY[]::TEXT[];

  FOR v_i IN 1..array_length(v_arg_modes, 1) LOOP
    IF v_arg_modes[v_i] = 't' THEN
      v_out_names := v_out_names || v_arg_names[v_i];
      v_out_types := v_out_types || pg_catalog.format_type(v_all_types[v_i], NULL);
    END IF;
  END LOOP;

  -- Step 4: Validate exactly 9 output columns
  IF array_length(v_out_names, 1) IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'Migration 010: hr_retrieve_knowledge_v2 has % output columns, expected 9. '
      'The existing function has an incompatible return schema.',
      COALESCE(array_length(v_out_names, 1), 0);
  END IF;

  -- Step 5: Validate exact column names in order
  IF v_out_names IS DISTINCT FROM v_expected_names THEN
    RAISE EXCEPTION 'Migration 010: hr_retrieve_knowledge_v2 output column names do not match. '
      'Expected: %, Got: %.',
      v_expected_names, v_out_names;
  END IF;

  -- Step 6: Validate exact column types in order
  IF v_out_types IS DISTINCT FROM v_expected_types THEN
    RAISE EXCEPTION 'Migration 010: hr_retrieve_knowledge_v2 output column types do not match. '
      'Expected: %, Got: %.',
      v_expected_types, v_out_types;
  END IF;
END $prereq$;

-- ============================================================
-- 1. Internal composite types for typed array storage
--
-- These types carry the return columns plus an internal page_id
-- used for the audit-before-return loop. page_id is never
-- included in the function's RETURNS TABLE and is not emitted.
--
-- Idempotency: if the type already exists, validate that its
-- attributes match the expected definition. Raise an error on
-- mismatch rather than silently accepting an incompatible type.
-- ============================================================

DO $type_v1$
DECLARE
  v_typrelid OID;
  v_expected_attrs TEXT[] := ARRAY[
    'content_text:text',
    'heading_path:text[]',
    'first_block_id:text',
    'title:text',
    'page_url:text',
    'notion_page_id:text',
    'last_verified_at:timestamp with time zone',
    'access_classification:text',
    'page_id:uuid'
  ];
  v_actual_attrs TEXT[];
BEGIN
  -- Check if the type already exists as a composite type in public schema.
  -- Use typrelid (the implicit relation OID) for pg_attribute lookups.
  SELECT t.typrelid INTO v_typrelid
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.typname = '_hr_retrieval_row'
    AND t.typtype = 'c';  -- composite type

  IF v_typrelid IS NULL THEN
    -- Type does not exist: create it
    CREATE TYPE public._hr_retrieval_row AS (
      content_text       TEXT,
      heading_path       TEXT[],
      first_block_id     TEXT,
      title              TEXT,
      page_url           TEXT,
      notion_page_id     TEXT,
      last_verified_at   TIMESTAMPTZ,
      access_classification TEXT,
      page_id            UUID
    );
  ELSE
    -- Type exists: validate its attributes match exactly.
    -- pg_attribute rows for composite types reference typrelid, not the type OID.
    SELECT array_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod)
                     ORDER BY a.attnum)
    INTO v_actual_attrs
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = v_typrelid
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_actual_attrs IS DISTINCT FROM v_expected_attrs THEN
      RAISE EXCEPTION 'Type public._hr_retrieval_row exists but has incompatible attributes. '
        'Expected: %, Got: %. '
        'Manual resolution required (DROP TYPE or correct the definition).',
        v_expected_attrs, v_actual_attrs;
    END IF;
    -- Attributes match: type is compatible, nothing to do
  END IF;
END $type_v1$;

DO $type_v2$
DECLARE
  v_typrelid OID;
  v_expected_attrs TEXT[] := ARRAY[
    'content_text:text',
    'heading_path:text[]',
    'first_block_id:text',
    'title:text',
    'page_url:text',
    'notion_page_id:text',
    'last_verified_at:timestamp with time zone',
    'access_classification:text',
    'chunk_id:uuid',
    'page_id:uuid'
  ];
  v_actual_attrs TEXT[];
BEGIN
  SELECT t.typrelid INTO v_typrelid
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.typname = '_hr_retrieval_row_v2'
    AND t.typtype = 'c';

  IF v_typrelid IS NULL THEN
    CREATE TYPE public._hr_retrieval_row_v2 AS (
      content_text       TEXT,
      heading_path       TEXT[],
      first_block_id     TEXT,
      title              TEXT,
      page_url           TEXT,
      notion_page_id     TEXT,
      last_verified_at   TIMESTAMPTZ,
      access_classification TEXT,
      chunk_id           UUID,
      page_id            UUID
    );
  ELSE
    SELECT array_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid, a.atttypmod)
                     ORDER BY a.attnum)
    INTO v_actual_attrs
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = v_typrelid
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_actual_attrs IS DISTINCT FROM v_expected_attrs THEN
      RAISE EXCEPTION 'Type public._hr_retrieval_row_v2 exists but has incompatible attributes. '
        'Expected: %, Got: %. '
        'Manual resolution required (DROP TYPE or correct the definition).',
        v_expected_attrs, v_actual_attrs;
    END IF;
  END IF;
END $type_v2$;

-- ============================================================
-- 2. hr_retrieve_knowledge — hardened (no temp tables)
--
-- Preserves: 8-column return, identity verification, all
-- authorization, audit-before-return, fail-closed behavior.
-- ============================================================

CREATE OR REPLACE FUNCTION hr_retrieve_knowledge(
  p_identity_token TEXT,
  p_query TEXT,
  p_freshness_minutes INT DEFAULT 30,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  content_text TEXT, heading_path TEXT[], first_block_id TEXT,
  title TEXT, page_url TEXT, notion_page_id TEXT,
  last_verified_at TIMESTAMPTZ, access_classification TEXT
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
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
  -- In-memory result storage (replaces temp table)
  v_results public._hr_retrieval_row[];
  v_row public._hr_retrieval_row;
  v_safe_limit INT;
  v_audit_failed BOOLEAN := false;
  v_pers_page_id UUID;
  v_pers_np_id TEXT;
  v_pers_page_ids UUID[];
  v_i INT;
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
  --    extensions.hmac: pgcrypto on Supabase installs into the extensions schema.
  --    Schema-qualified to prevent pg_temp shadowing and match Supabase layout.
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

  -- Determine access basis for audit
  IF v_is_admin THEN v_access_basis := 'admin';
  ELSIF v_is_active THEN v_access_basis := 'employee';
  END IF;

  -- Generate a correlation ID for this retrieval batch
  v_correlation_id := gen_random_uuid()::text;

  -- 9. Materialize authorized results into typed array (no temp table)
  SELECT array_agg(
    ROW(
      sub.content_text, sub.heading_path, sub.first_block_id,
      sub.title, sub.page_url, sub.notion_page_id,
      sub.last_verified_at, sub.access_classification,
      sub.page_id
    )::public._hr_retrieval_row
  )
  INTO v_results
  FROM (
    SELECT c.content_text, c.heading_path, c.first_block_id,
           p.title, p.page_url, p.notion_page_id,
           p.last_verified_at, p.access_classification, p.id AS page_id
    FROM public.hr_knowledge_chunks c
    JOIN public.hr_knowledge_pages p ON c.page_id = p.id
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
      AND (
        p.access_classification != 'employee_safe'
        OR EXISTS(SELECT 1 FROM public.hr_page_approvals a
          WHERE a.knowledge_page_id = p.id
            AND a.approved_content_hash = p.content_hash
            AND a.revoked_at IS NULL)
      )
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

  -- Empty results: return immediately
  IF v_results IS NULL THEN RETURN; END IF;

  -- 10. Collect distinct personalized page IDs for audit
  SELECT array_agg(DISTINCT (r).page_id)
  INTO v_pers_page_ids
  FROM unnest(v_results) AS r
  WHERE (r).access_classification = 'personalized';

  -- 11. Audit every personalized page BEFORE returning content.
  --
  --     Audit parity with migration 007:
  --     - Each distinct personalized page_id gets one audit INSERT.
  --     - Each INSERT is wrapped in BEGIN...EXCEPTION (implicit savepoint).
  --     - Previously successful audit INSERTs persist (savepoint released).
  --     - On first failure: flag is set, loop exits immediately.
  --       No further audit attempts for remaining pages.
  --     - ALL personalized results are suppressed (not just the failed page).
  --     - Employee_safe and hr_restricted results are still returned.
  IF v_pers_page_ids IS NOT NULL THEN
    FOREACH v_pers_page_id IN ARRAY v_pers_page_ids LOOP
      -- Determine specific access basis for supervisor vs direct grant
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

      -- Look up notion_page_id for audit metadata
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
        -- Audit write failed: suppress ALL personalized results.
        -- Previously successful audit INSERTs for earlier pages remain
        -- committed (PL/pgSQL EXCEPTION uses implicit savepoints —
        -- only the failed INSERT is rolled back, not earlier iterations).
        -- No further audit attempts are made.
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
    -- Emit via output parameters (RETURNS TABLE columns)
    content_text         := (v_row).content_text;
    heading_path         := (v_row).heading_path;
    first_block_id       := (v_row).first_block_id;
    title                := (v_row).title;
    page_url             := (v_row).page_url;
    notion_page_id       := (v_row).notion_page_id;
    last_verified_at     := (v_row).last_verified_at;
    access_classification := (v_row).access_classification;
    RETURN NEXT;
  END LOOP;
END; $fn$;

-- ============================================================
-- 3. hr_retrieve_knowledge_v2 — hardened (no temp tables)
--
-- Preserves: 9-column return (+ chunk_id UUID), identity
-- verification, all authorization, audit-before-return,
-- fail-closed behavior.
-- ============================================================

CREATE OR REPLACE FUNCTION hr_retrieve_knowledge_v2(
  p_identity_token TEXT,
  p_query TEXT,
  p_freshness_minutes INT DEFAULT 30,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  content_text TEXT, heading_path TEXT[], first_block_id TEXT,
  title TEXT, page_url TEXT, notion_page_id TEXT,
  last_verified_at TIMESTAMPTZ, access_classification TEXT,
  chunk_id UUID
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
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
  -- In-memory result storage (replaces temp table)
  v_results public._hr_retrieval_row_v2[];
  v_row public._hr_retrieval_row_v2;
  v_safe_limit INT;
  v_audit_failed BOOLEAN := false;
  v_pers_page_id UUID;
  v_pers_np_id TEXT;
  v_pers_page_ids UUID[];
  v_i INT;
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
  --    extensions.hmac: pgcrypto on Supabase installs into the extensions schema.
  --    Schema-qualified to prevent pg_temp shadowing and match Supabase layout.
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

  -- Determine access basis for audit
  IF v_is_admin THEN v_access_basis := 'admin';
  ELSIF v_is_active THEN v_access_basis := 'employee';
  END IF;

  -- Generate a correlation ID for this retrieval batch
  v_correlation_id := gen_random_uuid()::text;

  -- 9. Materialize authorized results into typed array (no temp table)
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
    FROM public.hr_knowledge_chunks c
    JOIN public.hr_knowledge_pages p ON c.page_id = p.id
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
      AND (
        p.access_classification != 'employee_safe'
        OR EXISTS(SELECT 1 FROM public.hr_page_approvals a
          WHERE a.knowledge_page_id = p.id
            AND a.approved_content_hash = p.content_hash
            AND a.revoked_at IS NULL)
      )
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

  -- Empty results: return immediately
  IF v_results IS NULL THEN RETURN; END IF;

  -- 10. Collect distinct personalized page IDs for audit
  SELECT array_agg(DISTINCT (r).page_id)
  INTO v_pers_page_ids
  FROM unnest(v_results) AS r
  WHERE (r).access_classification = 'personalized';

  -- 11. Audit every personalized page BEFORE returning content.
  --
  --     Audit parity with migration 009 (identical to 007):
  --     - Each distinct personalized page_id gets one audit INSERT.
  --     - Each INSERT is wrapped in BEGIN...EXCEPTION (implicit savepoint).
  --     - Previously successful audit INSERTs persist (savepoint released).
  --     - On first failure: flag is set, loop exits immediately.
  --       No further audit attempts for remaining pages.
  --     - ALL personalized results are suppressed (not just the failed page).
  --     - Employee_safe and hr_restricted results are still returned.
  IF v_pers_page_ids IS NOT NULL THEN
    FOREACH v_pers_page_id IN ARRAY v_pers_page_ids LOOP
      -- Determine specific access basis for supervisor vs direct grant
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

      -- Look up notion_page_id for audit metadata
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
        -- Audit write failed: suppress ALL personalized results.
        -- Previously successful audit INSERTs for earlier pages remain
        -- committed (PL/pgSQL EXCEPTION uses implicit savepoints —
        -- only the failed INSERT is rolled back, not earlier iterations).
        -- No further audit attempts are made.
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
    -- Emit via output parameters (RETURNS TABLE columns)
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
END; $fn$;

-- ============================================================
-- 4. Re-state function permissions (defense-in-depth)
--
-- CREATE OR REPLACE preserves existing grants, but explicit
-- re-statement documents the intended permission model and
-- protects against accidental grant changes.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.hr_retrieve_knowledge(TEXT, TEXT, INT, INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_retrieve_knowledge(TEXT, TEXT, INT, INT)
  TO service_role, hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_retrieve_knowledge_v2(TEXT, TEXT, INT, INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_retrieve_knowledge_v2(TEXT, TEXT, INT, INT)
  TO service_role, hr_reader;
