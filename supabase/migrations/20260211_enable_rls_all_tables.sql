-- Migration: Enable Row Level Security on ALL tables
-- Date: 2026-02-11
-- Fixes: Supabase security alert - 24 tables with RLS disabled in public schema
--
-- CRITICAL SECURITY FIX: Without RLS, anyone with the anon key can read/write all data
-- in these tables via PostgREST. This migration enables RLS and restricts access to
-- service_role only (backend access).

-- ============================================
-- COMPANY KNOWLEDGE BASE TABLES (10 tables)
-- ============================================

-- company_profile
ALTER TABLE IF EXISTS company_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to company_profile" ON company_profile;
CREATE POLICY "Service role has full access to company_profile" ON company_profile
  FOR ALL USING (auth.role() = 'service_role');

-- past_performance
ALTER TABLE IF EXISTS past_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to past_performance" ON past_performance;
CREATE POLICY "Service role has full access to past_performance" ON past_performance
  FOR ALL USING (auth.role() = 'service_role');

-- contacts
ALTER TABLE IF EXISTS contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to contacts" ON contacts;
CREATE POLICY "Service role has full access to contacts" ON contacts
  FOR ALL USING (auth.role() = 'service_role');

-- teaming_partners
ALTER TABLE IF EXISTS teaming_partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to teaming_partners" ON teaming_partners;
CREATE POLICY "Service role has full access to teaming_partners" ON teaming_partners
  FOR ALL USING (auth.role() = 'service_role');

-- labor_rates
ALTER TABLE IF EXISTS labor_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to labor_rates" ON labor_rates;
CREATE POLICY "Service role has full access to labor_rates" ON labor_rates
  FOR ALL USING (auth.role() = 'service_role');

-- case_studies
ALTER TABLE IF EXISTS case_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to case_studies" ON case_studies;
CREATE POLICY "Service role has full access to case_studies" ON case_studies
  FOR ALL USING (auth.role() = 'service_role');

-- key_personnel
ALTER TABLE IF EXISTS key_personnel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to key_personnel" ON key_personnel;
CREATE POLICY "Service role has full access to key_personnel" ON key_personnel
  FOR ALL USING (auth.role() = 'service_role');

-- proposal_content
ALTER TABLE IF EXISTS proposal_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to proposal_content" ON proposal_content;
CREATE POLICY "Service role has full access to proposal_content" ON proposal_content
  FOR ALL USING (auth.role() = 'service_role');

-- lessons_learned
ALTER TABLE IF EXISTS lessons_learned ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to lessons_learned" ON lessons_learned;
CREATE POLICY "Service role has full access to lessons_learned" ON lessons_learned
  FOR ALL USING (auth.role() = 'service_role');

-- documents
ALTER TABLE IF EXISTS documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to documents" ON documents;
CREATE POLICY "Service role has full access to documents" ON documents
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- STANDALONE TABLES (5 tables)
-- ============================================

-- agency_forecasts
ALTER TABLE IF EXISTS agency_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to agency_forecasts" ON agency_forecasts;
CREATE POLICY "Service role has full access to agency_forecasts" ON agency_forecasts
  FOR ALL USING (auth.role() = 'service_role');

-- competitor_intel
ALTER TABLE IF EXISTS competitor_intel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to competitor_intel" ON competitor_intel;
CREATE POLICY "Service role has full access to competitor_intel" ON competitor_intel
  FOR ALL USING (auth.role() = 'service_role');

-- seen_awards
ALTER TABLE IF EXISTS seen_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to seen_awards" ON seen_awards;
CREATE POLICY "Service role has full access to seen_awards" ON seen_awards
  FOR ALL USING (auth.role() = 'service_role');

-- sync_log
ALTER TABLE IF EXISTS sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to sync_log" ON sync_log;
CREATE POLICY "Service role has full access to sync_log" ON sync_log
  FOR ALL USING (auth.role() = 'service_role');

-- system_feedback
ALTER TABLE IF EXISTS system_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to system_feedback" ON system_feedback;
CREATE POLICY "Service role has full access to system_feedback" ON system_feedback
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- USER PROFILES TABLE (from migration 002)
-- ============================================

ALTER TABLE IF EXISTS user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to user_profiles" ON user_profiles;
CREATE POLICY "Service role has full access to user_profiles" ON user_profiles
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- FIX OVERLY PERMISSIVE POLICIES
-- These had USING (true) which allows anyone access
-- ============================================

-- far_sections - fix overly permissive policy
DROP POLICY IF EXISTS "Allow all operations on far_sections" ON far_sections;
DROP POLICY IF EXISTS "Service role has full access to far_sections" ON far_sections;
CREATE POLICY "Service role has full access to far_sections" ON far_sections
  FOR ALL USING (auth.role() = 'service_role');

-- cron_job_runs - fix overly permissive policy
DROP POLICY IF EXISTS "Service role can manage cron_job_runs" ON cron_job_runs;
DROP POLICY IF EXISTS "Service role has full access to cron_job_runs" ON cron_job_runs;
CREATE POLICY "Service role has full access to cron_job_runs" ON cron_job_runs
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================
-- CATCH-ALL FOR OTHER TABLES IN PUBLIC SCHEMA
-- These may exist in Supabase but not in SQL files
-- ============================================

-- seen_opportunities (referenced in migrations but CREATE not found)
ALTER TABLE IF EXISTS seen_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role has full access to seen_opportunities" ON seen_opportunities;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seen_opportunities' AND table_schema = 'public') THEN
    EXECUTE 'CREATE POLICY "Service role has full access to seen_opportunities" ON seen_opportunities FOR ALL USING (auth.role() = ''service_role'')';
  END IF;
END $$;

-- team_activity_log (defined in multiple places, ensure RLS)
-- Note: Already has RLS in 20240209_autonomous_workflow.sql but check the standalone version
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_activity_log' AND policyname = 'Service role has full access to team_activity_log'
  ) THEN
    EXECUTE 'CREATE POLICY "Service role has full access to team_activity_log" ON team_activity_log FOR ALL USING (auth.role() = ''service_role'')';
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- Policy may already exist
END $$;


-- ============================================
-- VERIFICATION QUERY
-- Run this after migration to verify all tables have RLS
-- ============================================
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
