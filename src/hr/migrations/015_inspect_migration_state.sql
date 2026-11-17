-- ═══════════════════════════════════════════════════════════════════════════
-- C8X-107BD: Inspect Production Migration State (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this BEFORE attempting migration 015 again.
-- All queries are SELECT-only.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Check hr_knowledge_chunks columns
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CHUNKS_COLUMNS' as check_type,
       column_name,
       data_type,
       is_nullable,
       CASE WHEN column_name = 'page_content_hash' AND is_nullable = 'NO'
            THEN 'OK' ELSE 'INCOMPLETE' END as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hr_knowledge_chunks'
  AND column_name = 'page_content_hash';
-- EXPECTED after migration: page_content_hash | text | NO | OK

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Check hr_page_approvals columns
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'APPROVALS_COLUMNS' as check_type,
       column_name,
       data_type,
       is_nullable,
       CASE
         WHEN column_name = 'valid_from' AND is_nullable = 'NO' THEN 'OK'
         WHEN column_name = 'valid_until' AND is_nullable = 'YES' THEN 'OK'
         ELSE 'INCOMPLETE'
       END as status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'hr_page_approvals'
  AND column_name IN ('valid_from', 'valid_until')
ORDER BY column_name;
-- EXPECTED after migration:
--   valid_from  | date | NO  | OK
--   valid_until | date | YES | OK

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Check constraint exists AND verify its definition
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CONSTRAINT_CHECK' as check_type,
       con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as constraint_definition,
       CASE
         WHEN pg_get_constraintdef(con.oid) LIKE '%valid_until IS NULL%valid_until >= valid_from%'
         THEN 'CORRECT_DEFINITION'
         ELSE 'UNEXPECTED_DEFINITION'
       END as status
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'hr_page_approvals'
  AND n.nspname = 'public'
  AND con.conname = 'chk_valid_date_range'
  AND con.contype = 'c';
-- EXPECTED after migration: 1 row with CORRECT_DEFINITION

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Check indexes exist
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'INDEXES_CHECK' as check_type,
       indexname,
       tablename,
       'EXISTS' as status
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_chunks_page_content_hash', 'idx_approvals_valid_dates');
-- EXPECTED after migration: 2 rows

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Check helper functions exist
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'FUNCTIONS_CHECK' as check_type,
       routine_name,
       'EXISTS' as status
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'hr_policy_date',
    'hr_get_effective_chunks',
    'hr_search_knowledge_v2',
    'hr_approve_knowledge_page_v2',
    'hr_stage_future_policy'
  )
ORDER BY routine_name;
-- EXPECTED after migration: 5 rows

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Check backfill status - chunks
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CHUNKS_BACKFILL' as check_type,
       COUNT(*) as total_chunks,
       COUNT(page_content_hash) as with_hash,
       COUNT(*) FILTER (WHERE page_content_hash IS NULL) as null_hash,
       CASE
         WHEN COUNT(*) FILTER (WHERE page_content_hash IS NULL) = 0 THEN 'COMPLETE'
         ELSE 'INCOMPLETE'
       END as status
FROM hr_knowledge_chunks;
-- EXPECTED after migration: null_hash = 0, status = COMPLETE

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Check backfill status - approvals
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'APPROVALS_BACKFILL' as check_type,
       COUNT(*) as total_approvals,
       COUNT(valid_from) as with_valid_from,
       COUNT(*) FILTER (WHERE valid_from IS NULL) as null_valid_from,
       CASE
         WHEN COUNT(*) FILTER (WHERE valid_from IS NULL) = 0 THEN 'COMPLETE'
         ELSE 'INCOMPLETE'
       END as status
FROM hr_page_approvals;
-- EXPECTED after migration: null_valid_from = 0, status = COMPLETE

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. CRITICAL: Check hr_retrieve_knowledge_v2 is DATE-AWARE version
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the most important check - distinguishes PARTIAL from COMPLETE
SELECT 'RETRIEVAL_RPC_CHECK' as check_type,
       routine_name,
       CASE
         WHEN routine_definition LIKE '%v_policy_date DATE := hr_policy_date()%'
              AND routine_definition LIKE '%a.valid_from <= v_policy_date%'
              AND routine_definition LIKE '%a.valid_until IS NULL OR a.valid_until >= v_policy_date%'
         THEN 'DATE_AWARE_VERSION'
         WHEN routine_definition LIKE '%hr_policy_date%'
         THEN 'PARTIAL_UPDATE'
         ELSE 'ORIGINAL_VERSION'
       END as version_status,
       CASE
         WHEN routine_definition LIKE '%v_policy_date DATE := hr_policy_date()%'
              AND routine_definition LIKE '%a.valid_from <= v_policy_date%'
         THEN 'Migration 015 retrieval function is ACTIVE'
         ELSE 'WARNING: Production retrieval is NOT date-aware - migration incomplete!'
       END as description
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'hr_retrieve_knowledge_v2';
-- EXPECTED after migration: DATE_AWARE_VERSION

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Check grants on new functions
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'GRANTS_CHECK' as check_type,
       routine_name,
       grantee,
       privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'hr_policy_date',
    'hr_get_effective_chunks',
    'hr_search_knowledge_v2',
    'hr_approve_knowledge_page_v2',
    'hr_stage_future_policy'
  )
  AND grantee IN ('hr_shadow_reader', 'service_role')
ORDER BY routine_name, grantee;
-- EXPECTED: Multiple rows for shadow_reader and service_role

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Count retrievable pages (critical functionality test)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'RETRIEVAL_TEST' as check_type,
       COUNT(DISTINCT p.id) as retrievable_pages,
       CASE
         WHEN COUNT(DISTINCT p.id) >= 33 THEN 'OK'
         ELSE 'WARNING: Fewer pages than expected'
       END as status
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE p.sync_status = 'synced'
  AND NOT p.is_excluded
  AND a.revoked_at IS NULL
  AND a.valid_from <= CURRENT_DATE
  AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE);
-- EXPECTED: >= 33 (existing approved pages)

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPREHENSIVE SUMMARY: Migration Status Determination
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  'MIGRATION_STATUS' as check_type,
  CASE
    -- COMPLETE: All schema objects exist AND retrieval RPC is date-aware
    WHEN columns_exist
         AND constraint_exists
         AND constraint_correct
         AND indexes_exist
         AND functions_exist
         AND retrieval_is_date_aware
         AND backfill_complete
    THEN 'COMPLETE'

    -- PARTIAL_SCHEMA_ONLY: Schema objects exist but retrieval RPC not updated
    WHEN (columns_exist OR constraint_exists OR indexes_exist OR functions_exist)
         AND NOT retrieval_is_date_aware
    THEN 'PARTIAL_SCHEMA_ONLY'

    -- PARTIAL_CONSTRAINT_WRONG: Constraint exists but has wrong definition
    WHEN constraint_exists AND NOT constraint_correct
    THEN 'PARTIAL_CONSTRAINT_MISMATCH'

    -- PARTIAL_BACKFILL: Schema exists but backfill incomplete
    WHEN columns_exist AND NOT backfill_complete
    THEN 'PARTIAL_BACKFILL_INCOMPLETE'

    -- PARTIAL_OTHER: Some objects exist
    WHEN columns_exist OR constraint_exists OR indexes_exist OR functions_exist
    THEN 'PARTIAL_OTHER'

    -- NOT_STARTED: Nothing exists
    ELSE 'NOT_STARTED'
  END as status,

  columns_exist,
  constraint_exists,
  constraint_correct,
  indexes_exist,
  functions_exist,
  retrieval_is_date_aware,
  backfill_complete,

  CASE
    WHEN columns_exist
         AND constraint_exists
         AND constraint_correct
         AND indexes_exist
         AND functions_exist
         AND retrieval_is_date_aware
         AND backfill_complete
    THEN 'Migration 015 is fully applied. No action needed.'

    WHEN (columns_exist OR constraint_exists OR indexes_exist OR functions_exist)
         AND NOT retrieval_is_date_aware
    THEN 'CRITICAL: Schema objects exist but hr_retrieve_knowledge_v2 is NOT date-aware. Run idempotent migration to complete.'

    WHEN constraint_exists AND NOT constraint_correct
    THEN 'ERROR: Constraint exists with unexpected definition. Manual investigation required.'

    WHEN columns_exist AND NOT backfill_complete
    THEN 'Backfill incomplete. Run idempotent migration to complete.'

    ELSE 'Run idempotent migration (015_date_aware_approvals_idempotent.sql).'
  END as recommended_action

FROM (
  SELECT
    -- Check all 3 columns exist
    (SELECT COUNT(*) = 3 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'hr_knowledge_chunks' AND column_name = 'page_content_hash')
            OR (table_name = 'hr_page_approvals' AND column_name IN ('valid_from', 'valid_until')))
    ) as columns_exist,

    -- Check constraint exists
    (SELECT COUNT(*) = 1 FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'hr_page_approvals' AND n.nspname = 'public'
       AND con.conname = 'chk_valid_date_range' AND con.contype = 'c'
    ) as constraint_exists,

    -- Check constraint has correct definition
    (SELECT COALESCE(
       (SELECT pg_get_constraintdef(con.oid) LIKE '%valid_until IS NULL%valid_until >= valid_from%'
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'hr_page_approvals' AND n.nspname = 'public'
          AND con.conname = 'chk_valid_date_range' AND con.contype = 'c'),
       false)
    ) as constraint_correct,

    -- Check both indexes exist
    (SELECT COUNT(*) = 2 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN ('idx_chunks_page_content_hash', 'idx_approvals_valid_dates')
    ) as indexes_exist,

    -- Check all 5 functions exist
    (SELECT COUNT(*) = 5 FROM information_schema.routines
     WHERE routine_schema = 'public'
       AND routine_name IN ('hr_policy_date', 'hr_get_effective_chunks',
                            'hr_search_knowledge_v2', 'hr_approve_knowledge_page_v2',
                            'hr_stage_future_policy')
    ) as functions_exist,

    -- CRITICAL: Check hr_retrieve_knowledge_v2 has date-aware filtering
    (SELECT COALESCE(
       (SELECT routine_definition LIKE '%v_policy_date DATE := hr_policy_date()%'
               AND routine_definition LIKE '%a.valid_from <= v_policy_date%'
               AND routine_definition LIKE '%a.valid_until IS NULL OR a.valid_until >= v_policy_date%'
        FROM information_schema.routines
        WHERE routine_schema = 'public' AND routine_name = 'hr_retrieve_knowledge_v2'),
       false)
    ) as retrieval_is_date_aware,

    -- Check backfill is complete (no NULLs in required columns)
    (SELECT
       (SELECT COUNT(*) FROM hr_knowledge_chunks WHERE page_content_hash IS NULL) = 0
       AND (SELECT COUNT(*) FROM hr_page_approvals WHERE valid_from IS NULL) = 0
    ) as backfill_complete
) sub;
