-- ============================================================
-- Migration 014: RLS Policies for hr_shadow_reader
-- ============================================================
--
-- Adds SELECT-only RLS policies for the hr_shadow_reader role on
-- the four metadata tables required for shadow discovery.
--
-- Context:
--   Migration 013 created the hr_shadow_reader role with:
--     - GRANT SELECT on 4 tables (hr_notion_connections, hr_approved_roots,
--       hr_knowledge_pages, hr_page_approvals)
--     - No BYPASSRLS attribute (correct for least-privilege)
--
--   However, all four tables have RLS enabled with policies only for
--   service_role (USING true), anon (USING false), and authenticated
--   (USING false). Since hr_shadow_reader has no policy and no BYPASSRLS,
--   PostgreSQL returns zero rows.
--
-- Solution:
--   Add four SELECT-only policies for hr_shadow_reader. These policies:
--     - Apply to SELECT only (FOR SELECT)
--     - Use USING (true) to permit all rows
--     - Do NOT grant INSERT/UPDATE/DELETE (no WITH CHECK clause)
--     - Do NOT modify existing policies
--     - Do NOT change the role's BYPASSRLS attribute
--
-- Security review:
--   The four tables contain only discovery metadata:
--     - hr_notion_connections: connection config, env var names (not values)
--     - hr_approved_roots: approved root page IDs and classifications
--     - hr_knowledge_pages: page metadata and content hashes (not content)
--     - hr_page_approvals: approval records
--
--   Actual sensitive data is stored in:
--     - hr_signing_secrets (not accessible)
--     - hr_employees (not accessible)
--     - hr_knowledge_chunks (not accessible - contains actual content)
--
--   The shadow reader cannot access these tables (no privilege, no policy).
--
-- Depends on: Migration 013 (hr_shadow_reader role creation)
-- Target: HR Supabase project vzrlnshdxrupukzhfllf
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- A. Verify prerequisites exist
-- ════════════════════════════════════════════════════════════

-- Fail if hr_shadow_reader role doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr_shadow_reader') THEN
    RAISE EXCEPTION 'Required role hr_shadow_reader does not exist. Apply migration 013 first.';
  END IF;
END $$;

-- Fail if required tables don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hr_notion_connections') THEN
    RAISE EXCEPTION 'Required table hr_notion_connections does not exist.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hr_approved_roots') THEN
    RAISE EXCEPTION 'Required table hr_approved_roots does not exist.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hr_knowledge_pages') THEN
    RAISE EXCEPTION 'Required table hr_knowledge_pages does not exist.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hr_page_approvals') THEN
    RAISE EXCEPTION 'Required table hr_page_approvals does not exist.';
  END IF;
END $$;

-- Fail if RLS is not enabled (policies would be no-ops)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hr_notion_connections' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on hr_notion_connections. Cannot add policy.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hr_approved_roots' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on hr_approved_roots. Cannot add policy.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hr_knowledge_pages' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on hr_knowledge_pages. Cannot add policy.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hr_page_approvals' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on hr_page_approvals. Cannot add policy.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- B. Create SELECT-only RLS policies for hr_shadow_reader
-- ════════════════════════════════════════════════════════════

-- Policy for hr_notion_connections
-- Allows shadow reader to see all connection metadata for discovery
CREATE POLICY hr_shadow_reader_select_connections
  ON public.hr_notion_connections
  FOR SELECT
  TO hr_shadow_reader
  USING (true);

-- Policy for hr_approved_roots
-- Allows shadow reader to see all approved roots for classification
CREATE POLICY hr_shadow_reader_select_roots
  ON public.hr_approved_roots
  FOR SELECT
  TO hr_shadow_reader
  USING (true);

-- Policy for hr_knowledge_pages
-- Allows shadow reader to see all page metadata for inventory comparison
CREATE POLICY hr_shadow_reader_select_pages
  ON public.hr_knowledge_pages
  FOR SELECT
  TO hr_shadow_reader
  USING (true);

-- Policy for hr_page_approvals
-- Allows shadow reader to see all approval records for status checking
CREATE POLICY hr_shadow_reader_select_approvals
  ON public.hr_page_approvals
  FOR SELECT
  TO hr_shadow_reader
  USING (true);

-- ════════════════════════════════════════════════════════════
-- C. Verification (informational, does not block migration)
-- ════════════════════════════════════════════════════════════

-- Log the new policies for verification
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE policyname LIKE 'hr_shadow_reader_select_%';

  RAISE NOTICE 'Migration 014: Created % RLS policies for hr_shadow_reader', v_count;
END $$;

COMMIT;

-- ============================================================
-- Post-migration verification queries (run as hr_shadow_reader)
-- ============================================================
--
-- After applying this migration, verify from the shadow reader
-- connection that data is now visible:
--
--   SELECT COUNT(*) FROM hr_notion_connections;
--   SELECT COUNT(*) FROM hr_approved_roots;
--   SELECT COUNT(*) FROM hr_knowledge_pages;
--   SELECT COUNT(*) FROM hr_page_approvals;
--
-- Expected: Non-zero counts matching service_role counts
--
-- Also verify mutations are still denied:
--
--   INSERT INTO hr_knowledge_pages (id) VALUES (gen_random_uuid());
--   -- Expected: ERROR permission denied
--
-- ============================================================
