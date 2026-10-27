-- ============================================================
-- Migration 007: Personalized Access, Sensitivity Quarantine,
--                Least-Privilege Retrieval, Signed Identity
--
-- Builds on 001-006. Preserves committed migration 006 unchanged.
--
-- Tables: hr_supervisor_assignments, hr_personal_page_grants,
--         hr_sensitivity_watermarks, hr_signing_secrets
-- Triggers: root scope enforcement, sensitivity watermark,
--           watermark immutability
-- Functions: hr_retrieve_knowledge (identity-verified, replaces 006 version)
-- Role: hr_reader (least-privilege retrieval)
--
-- Target: HR Supabase project vzrlnshdxrupukzhfllf
-- DO NOT execute against bvgtfadggtgnakrxvuim (BD)
-- ============================================================

-- Ensure pgcrypto is available (Supabase enables by default)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. New tables
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_supervisor_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES hr_employees(id),
  supervisor_id UUID NOT NULL REFERENCES hr_employees(id),
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  CHECK (employee_id != supervisor_id)
);
CREATE UNIQUE INDEX uq_supervisor_active
  ON hr_supervisor_assignments(employee_id, supervisor_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_sup_by_sup
  ON hr_supervisor_assignments(supervisor_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS hr_personal_page_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES hr_employees(id),
  knowledge_page_id UUID NOT NULL REFERENCES hr_knowledge_pages(id),
  grant_type TEXT NOT NULL CHECK (grant_type IN (
    'onboarding_board', 'personal_development', 'assigned_resource'
  )),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT
);
CREATE UNIQUE INDEX uq_grant_active
  ON hr_personal_page_grants(employee_id, knowledge_page_id)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_grants_emp
  ON hr_personal_page_grants(employee_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_grants_page
  ON hr_personal_page_grants(knowledge_page_id) WHERE revoked_at IS NULL;

-- Permanent sensitivity record (append-only)
-- ON DELETE RESTRICT: a page with a sensitivity watermark cannot be deleted.
-- This prevents watermark bypass via delete-reinsert of the parent page.
CREATE TABLE IF NOT EXISTS hr_sensitivity_watermarks (
  page_id UUID NOT NULL REFERENCES hr_knowledge_pages(id) ON DELETE RESTRICT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  marked_by TEXT NOT NULL DEFAULT 'system',
  PRIMARY KEY (page_id)
);

-- Identity signing secrets (readable only by function owner)
CREATE TABLE IF NOT EXISTS hr_signing_secrets (
  secret_name TEXT PRIMARY KEY,
  secret_value TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Sensitivity watermark column on knowledge pages
-- ============================================================

ALTER TABLE hr_knowledge_pages
  ADD COLUMN IF NOT EXISTS sensitivity_watermark TEXT DEFAULT NULL
  CHECK (sensitivity_watermark IS NULL OR sensitivity_watermark IN ('personalized'));

-- ============================================================
-- 3. Amend constraints for 3-integration model
-- ============================================================

ALTER TABLE hr_notion_connections
  DROP CONSTRAINT hr_notion_connections_scope_check;
ALTER TABLE hr_notion_connections
  ADD CONSTRAINT hr_notion_connections_scope_check
  CHECK (scope IN ('employee', 'onboarding', 'admin'));

ALTER TABLE hr_approved_roots
  DROP CONSTRAINT hr_approved_roots_access_classification_check;
ALTER TABLE hr_approved_roots
  ADD CONSTRAINT hr_approved_roots_access_classification_check
  CHECK (access_classification IN ('employee_safe', 'hr_restricted', 'personalized'));

ALTER TABLE hr_knowledge_pages
  DROP CONSTRAINT hr_knowledge_pages_access_classification_check;
ALTER TABLE hr_knowledge_pages
  ADD CONSTRAINT hr_knowledge_pages_access_classification_check
  CHECK (access_classification IN ('employee_safe', 'hr_restricted', 'personalized'));

-- ============================================================
-- 4. Root scope enforcement trigger
-- ============================================================

CREATE OR REPLACE FUNCTION hr_enforce_root_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE v_scope TEXT;
BEGIN
  SELECT scope INTO v_scope
  FROM public.hr_notion_connections WHERE id = NEW.connection_id;
  IF (v_scope = 'employee' AND NEW.access_classification != 'employee_safe')
  OR (v_scope = 'onboarding' AND NEW.access_classification != 'personalized')
  OR (v_scope = 'admin' AND NEW.access_classification != 'hr_restricted') THEN
    RAISE EXCEPTION 'Root classification "%" does not match connection scope "%"',
      NEW.access_classification, v_scope;
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS trg_root_scope_check ON hr_approved_roots;
CREATE TRIGGER trg_root_scope_check
  BEFORE INSERT OR UPDATE ON hr_approved_roots
  FOR EACH ROW EXECUTE FUNCTION hr_enforce_root_scope();

-- ============================================================
-- 5. Sensitivity watermark triggers
-- ============================================================

-- BEFORE trigger: quarantine on sensitivity downgrade (modifies NEW)
CREATE OR REPLACE FUNCTION hr_check_sensitivity_before()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
DECLARE v_has_watermark BOOLEAN;
BEGIN
  -- On INSERT of a personalized page, set the column watermark
  IF TG_OP = 'INSERT' AND NEW.access_classification = 'personalized' THEN
    NEW.sensitivity_watermark := 'personalized';
  END IF;

  -- Check if page already has a permanent watermark (relevant for UPDATE)
  SELECT EXISTS(
    SELECT 1 FROM public.hr_sensitivity_watermarks WHERE page_id = NEW.id
  ) INTO v_has_watermark;

  -- Quarantine if watermarked and being downgraded from personalized
  IF v_has_watermark AND NEW.access_classification != 'personalized' THEN
    NEW.is_excluded := true;
    NEW.exclusion_reason := 'sensitivity_downgrade_quarantined';
    NEW.sync_status := 'excluded';
    NEW.sensitivity_watermark := 'personalized';
  END IF;

  RETURN NEW;
END; $fn$;

-- AFTER trigger: register watermark in append-only table (row exists now)
CREATE OR REPLACE FUNCTION hr_register_sensitivity_watermark()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.access_classification = 'personalized' THEN
    INSERT INTO public.hr_sensitivity_watermarks (page_id, marked_by)
    VALUES (NEW.id, 'system')
    ON CONFLICT (page_id) DO NOTHING;
  END IF;
  RETURN NULL; -- AFTER trigger return value is ignored
END; $fn$;

DROP TRIGGER IF EXISTS trg_sensitivity_watermark ON hr_knowledge_pages;
DROP TRIGGER IF EXISTS trg_watermark_immutable ON hr_knowledge_pages;
DROP TRIGGER IF EXISTS trg_page_sensitivity_check ON hr_knowledge_pages;
DROP TRIGGER IF EXISTS trg_sensitivity_before ON hr_knowledge_pages;
DROP TRIGGER IF EXISTS trg_sensitivity_after ON hr_knowledge_pages;

CREATE TRIGGER trg_sensitivity_before
  BEFORE INSERT OR UPDATE ON hr_knowledge_pages
  FOR EACH ROW EXECUTE FUNCTION hr_check_sensitivity_before();

CREATE TRIGGER trg_sensitivity_after
  AFTER INSERT OR UPDATE ON hr_knowledge_pages
  FOR EACH ROW EXECUTE FUNCTION hr_register_sensitivity_watermark();

-- Watermark table: block all UPDATE and DELETE unconditionally
CREATE OR REPLACE FUNCTION hr_watermark_no_modify()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'Sensitivity watermarks are permanent and cannot be modified or deleted.';
END; $fn$;

CREATE TRIGGER trg_watermark_no_update
  BEFORE UPDATE ON hr_sensitivity_watermarks
  FOR EACH ROW EXECUTE FUNCTION hr_watermark_no_modify();

CREATE TRIGGER trg_watermark_no_delete
  BEFORE DELETE ON hr_sensitivity_watermarks
  FOR EACH ROW EXECUTE FUNCTION hr_watermark_no_modify();

-- ============================================================
-- 6. Replace retrieval RPC with signed-identity version
-- ============================================================

DROP FUNCTION IF EXISTS hr_retrieve_knowledge(TEXT[], TEXT, INT, INT);

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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
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
  v_personalized_page RECORD;
BEGIN
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
  --    public.hmac: pgcrypto function, schema-qualified to prevent pg_temp shadowing
  BEGIN
    v_sig_expected := encode(
      public.hmac(decode(v_payload_b64, 'base64'), v_secret::bytea, 'sha256'),
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

  -- 9. Materialize results into temp table for audit-before-return
  CREATE TEMP TABLE IF NOT EXISTS _hr_retrieval_results (
    content_text TEXT, heading_path TEXT[], first_block_id TEXT,
    title TEXT, page_url TEXT, notion_page_id TEXT,
    last_verified_at TIMESTAMPTZ, access_classification TEXT,
    page_id UUID
  ) ON COMMIT DROP;
  TRUNCATE _hr_retrieval_results;

  INSERT INTO _hr_retrieval_results
  SELECT c.content_text, c.heading_path, c.first_block_id,
         p.title, p.page_url, p.notion_page_id,
         p.last_verified_at, p.access_classification, p.id
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
  ORDER BY p.last_verified_at DESC LIMIT p_limit;

  -- 10. Audit every personalized page BEFORE returning content.
  --     If audit fails, personalized content is not returned.
  FOR v_personalized_page IN
    SELECT DISTINCT r.page_id, r.notion_page_id AS np_id
    FROM _hr_retrieval_results r
    WHERE r.access_classification = 'personalized'
  LOOP
    -- Determine specific access basis for supervisor vs direct grant
    IF v_is_admin THEN
      v_access_basis := 'admin';
    ELSIF EXISTS(
      SELECT 1 FROM public.hr_supervisor_assignments sa
      WHERE sa.supervisor_id = v_employee_id AND sa.revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
          WHERE g.knowledge_page_id = v_personalized_page.page_id
            AND g.employee_id = sa.employee_id AND g.revoked_at IS NULL)
    ) THEN
      v_access_basis := 'supervisor';
    ELSE
      v_access_basis := 'direct_grant';
    END IF;

    BEGIN
      INSERT INTO public.hr_audit_events (
        event_type, actor_type, actor_id, target_type, target_id,
        action, outcome, correlation_id, metadata
      ) VALUES (
        'PERSONALIZED_RETRIEVAL', 'human', v_slack_id,
        'knowledge_page', v_personalized_page.page_id::text,
        'retrieve_personalized', 'success', v_correlation_id,
        jsonb_build_object('access_basis', v_access_basis,
                           'notion_page_id', v_personalized_page.np_id)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Audit write failed: remove personalized results to prevent disclosure
      DELETE FROM _hr_retrieval_results rr
      WHERE rr.access_classification = 'personalized';
      -- Return only non-personalized (employee_safe) results
      RETURN QUERY
      SELECT r.content_text, r.heading_path, r.first_block_id,
             r.title, r.page_url, r.notion_page_id,
             r.last_verified_at, r.access_classification
      FROM _hr_retrieval_results r;
      RETURN;
    END;
  END LOOP;

  -- 11. Return all results (audit succeeded for any personalized rows)
  RETURN QUERY
  SELECT r.content_text, r.heading_path, r.first_block_id,
         r.title, r.page_url, r.notion_page_id,
         r.last_verified_at, r.access_classification
  FROM _hr_retrieval_results r;
END; $fn$;

-- ============================================================
-- 7. Least-privilege reader role
-- ============================================================

-- hr_reader role: password MUST be set manually via Supabase dashboard
-- or ALTER ROLE hr_reader WITH PASSWORD '...' before first use.
-- Never embed credentials in migration files.
DO $$ BEGIN
  CREATE ROLE hr_reader WITH LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO hr_reader;
GRANT EXECUTE ON FUNCTION hr_retrieve_knowledge(TEXT, TEXT, INT, INT) TO hr_reader;
-- hr_reader gets NO other grants: no SELECT, INSERT, UPDATE, DELETE on any table

-- Prevent hr_reader from creating objects in public schema.
REVOKE CREATE ON SCHEMA public FROM hr_reader;

-- Retrieval RPC: service_role and hr_reader only
REVOKE EXECUTE ON FUNCTION hr_retrieve_knowledge(TEXT, TEXT, INT, INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_retrieve_knowledge(TEXT, TEXT, INT, INT)
  TO service_role, hr_reader;

-- Signing secrets: only function owner (postgres) and service_role can read
REVOKE ALL ON hr_signing_secrets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON hr_signing_secrets FROM hr_reader;
GRANT SELECT, INSERT, UPDATE ON hr_signing_secrets TO service_role;

-- Deny hr_reader EXECUTE on all privileged RPCs from migrations 004-005.
-- These REVOKEs ensure hr_reader cannot call mutation or admin-check
-- functions even if PUBLIC retains EXECUTE (e.g., local test environments
-- where Supabase roles don't exist and the original REVOKEs fail).
REVOKE EXECUTE ON FUNCTION hr_is_authorized_admin(TEXT) FROM hr_reader;
REVOKE EXECUTE ON FUNCTION hr_check_idempotency(TEXT, TEXT) FROM hr_reader;
REVOKE EXECUTE ON FUNCTION hr_create_employee FROM hr_reader;
REVOKE EXECUTE ON FUNCTION hr_update_employee FROM hr_reader;
REVOKE EXECUTE ON FUNCTION hr_deactivate_employee FROM hr_reader;
REVOKE EXECUTE ON FUNCTION hr_sync_bootstrap_admins(TEXT[]) FROM hr_reader;

-- ============================================================
-- 8. RLS on all new tables
-- ============================================================

ALTER TABLE hr_supervisor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_personal_page_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_sensitivity_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_signing_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY svc_sup ON hr_supervisor_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY svc_grants ON hr_personal_page_grants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY svc_wm ON hr_sensitivity_watermarks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY svc_secrets ON hr_signing_secrets FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY deny_anon_sup ON hr_supervisor_assignments FOR ALL TO anon USING (false);
CREATE POLICY deny_anon_grants ON hr_personal_page_grants FOR ALL TO anon USING (false);
CREATE POLICY deny_anon_wm ON hr_sensitivity_watermarks FOR ALL TO anon USING (false);
CREATE POLICY deny_anon_secrets ON hr_signing_secrets FOR ALL TO anon USING (false);

CREATE POLICY deny_auth_sup ON hr_supervisor_assignments FOR ALL TO authenticated USING (false);
CREATE POLICY deny_auth_grants ON hr_personal_page_grants FOR ALL TO authenticated USING (false);
CREATE POLICY deny_auth_wm ON hr_sensitivity_watermarks FOR ALL TO authenticated USING (false);
CREATE POLICY deny_auth_secrets ON hr_signing_secrets FOR ALL TO authenticated USING (false);
