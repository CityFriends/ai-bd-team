-- ============================================================
-- HR Database Security — RLS and Access Policies
--
-- Target: Dedicated HR Supabase project (NOT the BD project)
--
-- SECURITY MODEL:
--   service_role: Full access (bypasses RLS). Used by the HR service.
--                 This is the HR project's service_role key, NOT the BD key.
--   authenticated: No access by default. Future: row-level self-service.
--   anon:          No access. HR data is never publicly exposed.
--
-- IMPORTANT: service_role bypasses RLS by design in Supabase.
-- Application-layer authorization (hr-auth.ts) is the primary access control.
-- RLS provides defense-in-depth against authenticated/anon access.
--
-- PRODUCTION HARDENING (post-M1):
--   1. Create a custom hr_app role with explicit grants per table
--   2. Revoke service_role usage from the application
--   3. Use the custom role for day-to-day operations
--   4. Reserve service_role for administrative migrations only
-- ============================================================

-- Enable RLS on all HR tables
ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_knowledge_sources ENABLE ROW LEVEL SECURITY;

-- service_role policies (HR service access)
CREATE POLICY "hr_service_employees" ON hr_employees
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "hr_service_roles" ON hr_user_roles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "hr_service_audit" ON hr_audit_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "hr_service_knowledge" ON hr_knowledge_sources
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Deny anon access explicitly (defense-in-depth)
CREATE POLICY "hr_deny_anon_employees" ON hr_employees
  FOR ALL TO anon USING (false);

CREATE POLICY "hr_deny_anon_roles" ON hr_user_roles
  FOR ALL TO anon USING (false);

CREATE POLICY "hr_deny_anon_audit" ON hr_audit_events
  FOR ALL TO anon USING (false);

CREATE POLICY "hr_deny_anon_knowledge" ON hr_knowledge_sources
  FOR ALL TO anon USING (false);

-- Deny authenticated access by default
-- Future: add row-level policies for employee self-service
CREATE POLICY "hr_deny_auth_employees" ON hr_employees
  FOR ALL TO authenticated USING (false);

CREATE POLICY "hr_deny_auth_roles" ON hr_user_roles
  FOR ALL TO authenticated USING (false);

CREATE POLICY "hr_deny_auth_audit" ON hr_audit_events
  FOR ALL TO authenticated USING (false);

CREATE POLICY "hr_deny_auth_knowledge" ON hr_knowledge_sources
  FOR ALL TO authenticated USING (false);
