-- Migration: Fix Security Linter Issues
-- Date: 2026-03-18
-- Fixes:
--   1. RLS policy on proposal_snippets is overly permissive (USING true)
--   2. 23 functions have mutable search_path
--   3. pg_trgm extension in public schema (optional)
--   4. api_costs table RLS not enabled (if not already fixed)

-- ============================================
-- 1. FIX OVERLY PERMISSIVE RLS POLICY
-- ============================================

-- Drop the overly permissive policy on proposal_snippets
DROP POLICY IF EXISTS "Allow all for service role" ON proposal_snippets;
DROP POLICY IF EXISTS "Allow all" ON proposal_snippets;

-- Create proper service_role-only policy
CREATE POLICY "Service role has full access to proposal_snippets" ON proposal_snippets
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================
-- 2. FIX api_costs RLS (in case migration wasn't applied)
-- ============================================

ALTER TABLE IF EXISTS api_costs ENABLE ROW LEVEL SECURITY;

-- Only create policy if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_costs'
    AND policyname = 'service_role_all_api_costs'
  ) THEN
    CREATE POLICY "service_role_all_api_costs" ON api_costs
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ============================================
-- 3. FIX FUNCTION SEARCH_PATH ISSUES
-- All functions need SET search_path = public
-- ============================================

-- Note: We use ALTER FUNCTION to add the search_path setting
-- This is safer than recreating functions as it preserves grants and dependencies

-- From 20260227_workflow_instances.sql
ALTER FUNCTION get_breached_workflows() SET search_path = public;

-- From 20260308_agent_feed.sql
ALTER FUNCTION update_feed_post_engagement() SET search_path = public;
ALTER FUNCTION update_feed_post_reply_count() SET search_path = public;
ALTER FUNCTION match_feed_posts(VECTOR(1536), FLOAT, INT) SET search_path = public;

-- From 20260212_agent_events.sql
ALTER FUNCTION claim_events(TEXT, INTEGER) SET search_path = public;
ALTER FUNCTION publish_event(TEXT, TEXT, JSONB, TEXT, UUID, INTEGER, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) SET search_path = public;
ALTER FUNCTION complete_event(UUID, BOOLEAN, JSONB, TEXT) SET search_path = public;
ALTER FUNCTION get_pending_events(TEXT, INTEGER) SET search_path = public;
ALTER FUNCTION get_event_chain(UUID) SET search_path = public;
ALTER FUNCTION expire_stale_events() SET search_path = public;

-- From 20260212_team_playbook.sql
ALTER FUNCTION propose_rule(TEXT, TEXT, TEXT, JSONB, TEXT, NUMERIC) SET search_path = public;
ALTER FUNCTION apply_rule(UUID, TEXT, TEXT, TEXT, JSONB) SET search_path = public;
ALTER FUNCTION update_rule_outcomes(UUID, UUID, BOOLEAN) SET search_path = public;
ALTER FUNCTION get_applicable_directives(TEXT, TEXT[], TEXT) SET search_path = public;
ALTER FUNCTION get_active_rules(TEXT, NUMERIC) SET search_path = public;
ALTER FUNCTION retire_rule(UUID, TEXT) SET search_path = public;
ALTER FUNCTION adopt_rule(UUID) SET search_path = public;
ALTER FUNCTION override_rule(UUID, TEXT, TEXT, TEXT) SET search_path = public;
ALTER FUNCTION check_rule_health() SET search_path = public;

-- From 20260308_action_layer.sql
ALTER FUNCTION get_deliverables_summary(INTEGER) SET search_path = public;

-- From 20260227_match_agent_memories.sql
ALTER FUNCTION match_agent_memories(VECTOR(1536), FLOAT, INT) SET search_path = public;

-- From 20260309_opportunity_discussions.sql
ALTER FUNCTION get_discussion_for_opportunity(UUID) SET search_path = public;
ALTER FUNCTION get_pending_discussions(INTEGER) SET search_path = public;


-- ============================================
-- 4. MOVE pg_trgm TO extensions SCHEMA (OPTIONAL)
-- ============================================
-- Note: This is lower priority and may require superuser
-- Uncomment if you want to run this (requires reconnecting clients)

-- CREATE SCHEMA IF NOT EXISTS extensions;
-- DROP EXTENSION IF EXISTS pg_trgm;
-- CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
-- This requires updating search_path: ALTER DATABASE postgres SET search_path = public, extensions;


-- ============================================
-- VERIFICATION QUERIES
-- Run these after migration to verify fixes
-- ============================================

-- Check RLS status:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Check function search_path:
-- SELECT proname, proconfig FROM pg_proc
-- WHERE pronamespace = 'public'::regnamespace
-- AND proconfig IS NOT NULL;

-- Check permissive policies:
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND qual = 'true';
