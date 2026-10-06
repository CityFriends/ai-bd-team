-- ============================================================
-- Forward-only RLS fix for system_controls
-- ============================================================
-- Historical migration 20260928_system_controls.sql was patched
-- to include RLS, but this forward migration idempotently ensures
-- RLS is correctly applied regardless of migration-history state.
--
-- Addresses Supabase Security Advisor alert: rls_disabled_in_public

-- Idempotently enable RLS
ALTER TABLE IF EXISTS system_controls ENABLE ROW LEVEL SECURITY;

-- Idempotently create service_role policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'system_controls'::regclass
      AND polname = 'service_role_system_controls'
  ) THEN
    CREATE POLICY service_role_system_controls
      ON system_controls FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Ensure service_role has access
GRANT ALL ON system_controls TO service_role;
