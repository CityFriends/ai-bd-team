-- ═══════════════════════════════════════════════════════════════════════════
-- C8X-107BD: Post-Migration Verification (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this AFTER successfully applying 015_date_aware_approvals_idempotent.sql
-- All queries are SELECT-only.

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 1: All Schema Changes Applied
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V1_SCHEMA' as test,
  CASE WHEN COUNT(*) = 3 THEN 'PASS' ELSE 'FAIL' END as result,
  COUNT(*) as actual,
  3 as expected,
  'All 3 columns exist (page_content_hash, valid_from, valid_until)' as description
FROM information_schema.columns
WHERE (table_name = 'hr_knowledge_chunks' AND column_name = 'page_content_hash')
   OR (table_name = 'hr_page_approvals' AND column_name IN ('valid_from', 'valid_until'));

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 2: Backfill Complete (No NULLs)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V2_BACKFILL' as test,
  CASE WHEN chunks_null = 0 AND approvals_null = 0 THEN 'PASS' ELSE 'FAIL' END as result,
  chunks_null as chunks_missing_hash,
  approvals_null as approvals_missing_valid_from,
  'No NULL values in required columns' as description
FROM (
  SELECT
    (SELECT COUNT(*) FROM hr_knowledge_chunks WHERE page_content_hash IS NULL) as chunks_null,
    (SELECT COUNT(*) FROM hr_page_approvals WHERE valid_from IS NULL) as approvals_null
) sub;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 3: Constraint Exists
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V3_CONSTRAINT' as test,
  CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END as result,
  COUNT(*) as actual,
  1 as expected,
  'chk_valid_date_range constraint exists' as description
FROM information_schema.check_constraints
WHERE constraint_name = 'chk_valid_date_range';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 4: Indexes Created
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V4_INDEXES' as test,
  CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END as result,
  COUNT(*) as actual,
  2 as expected,
  'Both indexes created' as description
FROM pg_indexes
WHERE indexname IN ('idx_chunks_page_content_hash', 'idx_approvals_valid_dates');

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 5: All Functions Created
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V5_FUNCTIONS' as test,
  CASE WHEN COUNT(*) = 5 THEN 'PASS' ELSE 'FAIL' END as result,
  COUNT(*) as actual,
  5 as expected,
  'All 5 date-aware functions exist' as description
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'hr_policy_date',
    'hr_get_effective_chunks',
    'hr_search_knowledge_v2',
    'hr_approve_knowledge_page_v2',
    'hr_stage_future_policy'
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 6: hr_policy_date() Works
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V6_POLICY_DATE' as test,
  CASE WHEN hr_policy_date() IS NOT NULL THEN 'PASS' ELSE 'FAIL' END as result,
  hr_policy_date() as today_policy_date,
  'hr_policy_date() returns current date in America/New_York' as description;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 7: hr_retrieve_knowledge_v2 is Date-Aware
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V7_RETRIEVAL_RPC' as test,
  CASE
    WHEN routine_definition LIKE '%hr_policy_date()%'
         AND routine_definition LIKE '%v_policy_date%'
    THEN 'PASS'
    ELSE 'FAIL'
  END as result,
  'hr_retrieve_knowledge_v2 contains date-aware filtering' as description
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'hr_retrieve_knowledge_v2';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 8: Retrievable Page Count (Critical Regression Test)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V8_RETRIEVAL_COUNT' as test,
  CASE WHEN retrievable_pages >= 33 THEN 'PASS' ELSE 'FAIL' END as result,
  retrievable_pages as actual,
  '>=33' as expected,
  'Existing approved pages remain retrievable' as description
FROM (
  SELECT COUNT(DISTINCT p.id) as retrievable_pages
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE p.sync_status = 'synced'
    AND NOT p.is_excluded
    AND a.revoked_at IS NULL
    AND a.valid_from <= hr_policy_date()
    AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
) sub;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 9: PTO Page Status
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V9_PTO_PAGE' as test,
  CASE
    WHEN COUNT(*) >= 1 AND bool_and(valid_until IS NULL) THEN 'PASS'
    ELSE 'CHECK'
  END as result,
  COUNT(*) as approvals_count,
  'PTO page has approval with valid_until = NULL' as description
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
  AND a.revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 10: Grants Applied
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V10_GRANTS' as test,
  CASE WHEN COUNT(*) >= 4 THEN 'PASS' ELSE 'FAIL' END as result,
  COUNT(*) as grant_count,
  'Grants applied for hr_shadow_reader and service_role' as description
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'hr_policy_date',
    'hr_get_effective_chunks',
    'hr_search_knowledge_v2',
    'hr_approve_knowledge_page_v2',
    'hr_stage_future_policy'
  )
  AND grantee IN ('hr_shadow_reader', 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '═══════════════════════════════════════════════════' as summary;
SELECT 'MIGRATION 015 VERIFICATION COMPLETE' as summary;
SELECT 'All tests should show PASS. Any FAIL requires investigation.' as summary;
SELECT '═══════════════════════════════════════════════════' as summary;
