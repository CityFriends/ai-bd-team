-- ============================================================
-- Migration 013: Dedicated Shadow Reader Role
-- ============================================================
--
-- Creates the hr_shadow_reader PostgreSQL role for shadow discovery.
-- This role has SELECT-only access to specific HR tables required
-- for inventory discovery. It cannot modify any data.
--
-- Security model:
--   - LOGIN role with no elevated attributes
--   - No SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS
--   - No membership in elevated roles (service_role, postgres, etc.)
--   - SELECT only on: hr_notion_connections, hr_approved_roots,
--     hr_knowledge_pages, hr_page_approvals
--   - No INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   - No EXECUTE on mutation functions
--   - No access to sensitive tables (hr_signing_secrets, hr_employees)
--
-- Provisioning:
--   Password MUST be set separately via Supabase dashboard or:
--   ALTER ROLE hr_shadow_reader WITH PASSWORD '...';
--   Never embed credentials in migration files.
--
-- Depends on: Migrations 001-012
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- A. Create the dedicated shadow reader role
-- ════════════════════════════════════════════════════════════

-- Create role if not exists (idempotent)
DO $$ BEGIN
  CREATE ROLE hr_shadow_reader WITH LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN
  -- Role already exists; ensure attributes are correct
  ALTER ROLE hr_shadow_reader WITH
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS;
END $$;

-- ════════════════════════════════════════════════════════════
-- B. Revoke all default and inherited privileges
-- ════════════════════════════════════════════════════════════

-- Revoke PUBLIC schema CREATE (prevent object creation)
REVOKE CREATE ON SCHEMA public FROM hr_shadow_reader;

-- Grant only USAGE on public schema (required for SELECT)
GRANT USAGE ON SCHEMA public TO hr_shadow_reader;

-- Revoke any default table privileges that might exist
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr_shadow_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr_shadow_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM hr_shadow_reader;

-- ════════════════════════════════════════════════════════════
-- C. Grant SELECT-only on required tables
-- ════════════════════════════════════════════════════════════

-- hr_notion_connections: required to load connection configuration
GRANT SELECT ON public.hr_notion_connections TO hr_shadow_reader;

-- hr_approved_roots: required to load approved root pages
GRANT SELECT ON public.hr_approved_roots TO hr_shadow_reader;

-- hr_knowledge_pages: required to compare existing page states
GRANT SELECT ON public.hr_knowledge_pages TO hr_shadow_reader;

-- hr_page_approvals: required to check existing approvals
GRANT SELECT ON public.hr_page_approvals TO hr_shadow_reader;

-- ════════════════════════════════════════════════════════════
-- D. Explicitly deny access to sensitive tables
-- ════════════════════════════════════════════════════════════

-- hr_signing_secrets: NEVER accessible to shadow reader
REVOKE ALL ON public.hr_signing_secrets FROM hr_shadow_reader;

-- hr_employees: contains PII, not needed for shadow discovery
REVOKE ALL ON public.hr_employees FROM hr_shadow_reader;

-- hr_audit_events: not needed for shadow discovery
REVOKE ALL ON public.hr_audit_events FROM hr_shadow_reader;

-- hr_knowledge_chunks: contains actual content, not needed
REVOKE ALL ON public.hr_knowledge_chunks FROM hr_shadow_reader;

-- hr_sync_leases: not needed for shadow discovery
REVOKE ALL ON public.hr_sync_leases FROM hr_shadow_reader;

-- ════════════════════════════════════════════════════════════
-- E. Deny EXECUTE on all HR mutation functions
-- ════════════════════════════════════════════════════════════

-- Admin and employee management functions
REVOKE EXECUTE ON FUNCTION public.hr_is_authorized_admin(TEXT) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_check_idempotency(TEXT, TEXT) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_create_employee FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_update_employee FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_deactivate_employee FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_sync_bootstrap_admins(TEXT[]) FROM hr_shadow_reader;

-- Sync lease functions (migration 011)
REVOKE EXECUTE ON FUNCTION public.hr_acquire_sync_lease(TEXT, TEXT, INTEGER) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_renew_sync_lease(TEXT, TEXT, BIGINT, INTEGER) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_release_sync_lease(TEXT, TEXT, BIGINT) FROM hr_shadow_reader;

-- Publication lifecycle functions (migration 012)
REVOKE EXECUTE ON FUNCTION public.hr_publish_routine_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_suspend_changed_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_approve_compensation_batch(UUID, TEXT, TEXT) FROM hr_shadow_reader;

-- Sensitive policy approval functions (migration 012)
REVOKE EXECUTE ON FUNCTION public.hr_approve_sensitive_policy(UUID, TEXT) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_reject_sensitive_policy(UUID, TEXT) FROM hr_shadow_reader;

-- Knowledge approval functions (migration 008)
REVOKE EXECUTE ON FUNCTION public.hr_approve_knowledge_page(TEXT, UUID[], TEXT[]) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_revoke_knowledge_approval(TEXT, UUID) FROM hr_shadow_reader;

-- Retrieval functions (not needed for shadow discovery)
REVOKE EXECUTE ON FUNCTION public.hr_retrieve_knowledge(TEXT, TEXT, INT, INT) FROM hr_shadow_reader;
REVOKE EXECUTE ON FUNCTION public.hr_retrieve_knowledge_v2(TEXT, TEXT, INT, INT) FROM hr_shadow_reader;

-- ════════════════════════════════════════════════════════════
-- F. Prevent role escalation
-- ════════════════════════════════════════════════════════════

-- Ensure hr_shadow_reader is not a member of any elevated roles
-- (Supabase creates these roles; we must explicitly revoke membership)
DO $$ BEGIN
  REVOKE service_role FROM hr_shadow_reader;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE authenticator FROM hr_shadow_reader;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE authenticated FROM hr_shadow_reader;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  REVOKE anon FROM hr_shadow_reader;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Prevent hr_shadow_reader from granting its own privileges
REVOKE GRANT OPTION FOR ALL ON ALL TABLES IN SCHEMA public FROM hr_shadow_reader;

-- ════════════════════════════════════════════════════════════
-- G. RLS consideration
-- ════════════════════════════════════════════════════════════

-- Note: hr_shadow_reader does NOT have BYPASSRLS.
-- If RLS policies are enabled on the permitted tables, they will apply.
-- Current HR tables do not have RLS enabled for the shadow reader use case,
-- but this provides defense-in-depth if RLS is added later.

-- ════════════════════════════════════════════════════════════
-- H. Verification queries (for manual or automated checking)
-- ════════════════════════════════════════════════════════════

-- These queries can be run by the application to verify the role is
-- correctly configured. They are provided as comments for reference.

/*
-- 1. Verify role attributes
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = 'hr_shadow_reader';
-- Expected: all false except rolcanlogin

-- 2. Verify no elevated role membership
SELECT r.rolname AS member_of
FROM pg_auth_members m
JOIN pg_roles r ON m.roleid = r.oid
WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'hr_shadow_reader');
-- Expected: empty or only non-elevated roles

-- 3. Verify table privileges (should show SELECT only on 4 tables)
SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'hr_shadow_reader' AND table_schema = 'public';
-- Expected: 4 rows with SELECT on the permitted tables

-- 4. Verify no INSERT/UPDATE/DELETE privileges
SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'hr_shadow_reader'
  AND table_schema = 'public'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
-- Expected: empty

-- 5. Verify no function EXECUTE privileges on mutation functions
SELECT routine_name
FROM information_schema.routine_privileges
WHERE grantee = 'hr_shadow_reader' AND routine_schema = 'public';
-- Expected: empty or no mutation functions
*/

COMMIT;

-- ============================================================
-- Post-migration: Manual password provisioning required
-- ============================================================
--
-- After applying this migration, the role password must be set
-- via a separately authorized action:
--
--   ALTER ROLE hr_shadow_reader WITH PASSWORD '<secure-password>';
--
-- The password should be:
--   - Generated securely (e.g., openssl rand -base64 32)
--   - Stored in the deployment secrets manager
--   - Never committed to source control
--
-- Connection string format:
--   postgresql://hr_shadow_reader.<project-ref>:<password>@<host>:<port>/postgres
-- ============================================================
