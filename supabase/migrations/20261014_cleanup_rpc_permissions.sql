-- ============================================================
-- Restrict cleanup_expired_audit_responses to service_role only
--
-- PostgreSQL grants EXECUTE to PUBLIC by default on new functions.
-- This migration removes the default grant, leaving only the
-- explicit service_role grant from the original M9 migration.
--
-- Idempotent: safe to run multiple times.
-- Does NOT invoke the function, alter its body, or delete data.
-- ============================================================

REVOKE EXECUTE ON FUNCTION cleanup_expired_audit_responses(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_expired_audit_responses(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION cleanup_expired_audit_responses(integer) FROM authenticated;

-- Ensure service_role retains access
GRANT EXECUTE ON FUNCTION cleanup_expired_audit_responses(integer) TO service_role;
