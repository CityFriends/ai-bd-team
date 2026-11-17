-- Migration 015: Post-Migration Verification Queries
-- C8X-107BB: Run these AFTER applying 015_date_aware_approvals.sql
--
-- All queries are SELECT-only (read-only verification)
-- Run each section separately and verify results match expected values

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 1: Schema Changes Applied
-- ═══════════════════════════════════════════════════════════════════════════

-- Check hr_knowledge_chunks has page_content_hash column
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'hr_knowledge_chunks'
  AND column_name = 'page_content_hash';
-- EXPECTED: page_content_hash | text | NO

-- Check hr_page_approvals has valid_from and valid_until columns
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'hr_page_approvals'
  AND column_name IN ('valid_from', 'valid_until')
ORDER BY column_name;
-- EXPECTED:
--   valid_from  | date | NO
--   valid_until | date | YES

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 2: Backfill Complete
-- ═══════════════════════════════════════════════════════════════════════════

-- All chunks have page_content_hash (no NULLs)
SELECT
  COUNT(*) as total_chunks,
  COUNT(page_content_hash) as with_hash,
  COUNT(*) - COUNT(page_content_hash) as missing_hash
FROM hr_knowledge_chunks;
-- EXPECTED: missing_hash = 0

-- All approvals have valid_from (no NULLs)
SELECT
  COUNT(*) as total_approvals,
  COUNT(valid_from) as with_valid_from,
  COUNT(*) - COUNT(valid_from) as missing_valid_from
FROM hr_page_approvals;
-- EXPECTED: missing_valid_from = 0

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 3: Functions Created
-- ═══════════════════════════════════════════════════════════════════════════

-- Check all new functions exist
SELECT
  routine_name,
  routine_type
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
-- EXPECTED: 5 rows (all functions present)

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 4: Indexes Created
-- ═══════════════════════════════════════════════════════════════════════════

SELECT indexname, tablename
FROM pg_indexes
WHERE indexname IN (
  'idx_chunks_page_content_hash',
  'idx_approvals_valid_dates'
);
-- EXPECTED: 2 rows (both indexes present)

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 5: Constraint Added
-- ═══════════════════════════════════════════════════════════════════════════

SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'chk_valid_date_range';
-- EXPECTED: 1 row with check clause for valid_until >= valid_from

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 6: Existing Approvals Backfilled Correctly
-- ═══════════════════════════════════════════════════════════════════════════

-- Existing approvals should have valid_from = approved_at::date and valid_until = NULL
SELECT
  COUNT(*) as total_active_approvals,
  COUNT(*) FILTER (WHERE valid_until IS NULL) as never_expires,
  COUNT(*) FILTER (WHERE valid_from = (approved_at AT TIME ZONE 'America/New_York')::DATE) as correct_valid_from
FROM hr_page_approvals
WHERE revoked_at IS NULL;
-- EXPECTED: total = never_expires = correct_valid_from (all backfilled correctly)

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 7: Existing Pages Still Retrievable
-- ═══════════════════════════════════════════════════════════════════════════

-- Count pages with effective approvals (should match pre-migration count)
SELECT COUNT(DISTINCT p.id) as retrievable_pages
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE p.sync_status = 'synced'
  AND NOT p.is_excluded
  AND a.revoked_at IS NULL
  AND a.valid_from <= hr_policy_date()
  AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date());
-- EXPECTED: 41 (or current count of approved pages)

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 8: PTO Page Status
-- ═══════════════════════════════════════════════════════════════════════════

-- Check PTO page approval status
SELECT
  p.id as page_id,
  p.title,
  p.content_hash as current_page_hash,
  a.id as approval_id,
  a.approved_content_hash,
  a.valid_from,
  a.valid_until,
  a.approved_at,
  (SELECT COUNT(*) FROM hr_knowledge_chunks c
   WHERE c.page_id = p.id AND c.page_content_hash = a.approved_content_hash) as chunk_count
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
WHERE p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%'
  AND a.revoked_at IS NULL
ORDER BY a.valid_from;
-- EXPECTED: 1 row for current PTO approval, valid_until = NULL

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 9: hr_policy_date() Works
-- ═══════════════════════════════════════════════════════════════════════════

SELECT hr_policy_date() as today_policy_date;
-- EXPECTED: Current date in America/New_York timezone

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 10: Date-Aware Retrieval Test
-- ═══════════════════════════════════════════════════════════════════════════

-- Test hr_search_knowledge_v2 returns results
SELECT COUNT(*) as search_results
FROM hr_search_knowledge_v2('U01SC2TNYKU', 'healthcare', 5);
-- EXPECTED: > 0 (search works)

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION COMPLETE
-- ═══════════════════════════════════════════════════════════════════════════
-- All verifications should pass before proceeding to PTO staging.
