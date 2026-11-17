-- ═══════════════════════════════════════════════════════════════════════════
-- C8X-107BC: Production Retrieval Verification (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run after migration 015 is confirmed COMPLETE.
-- All queries are SELECT-only. No writes.
--
-- Verifies:
-- 1. All 41 approved pages remain accessible via date-aware retrieval
-- 2. PTO page is retrievable with current content
-- 3. Healthcare Benefits is retrievable
-- 4. No future-dated PTO approval exists yet

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 1: Count of Retrievable Pages (Date-Aware Path)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V1_RETRIEVABLE_COUNT' as test,
  COUNT(DISTINCT p.id) as retrievable_pages,
  CASE
    WHEN COUNT(DISTINCT p.id) >= 41 THEN 'PASS'
    WHEN COUNT(DISTINCT p.id) >= 33 THEN 'WARN_FEWER_THAN_EXPECTED'
    ELSE 'FAIL'
  END as result,
  41 as expected_minimum,
  'All approved pages accessible via date-aware retrieval' as description
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE p.sync_status = 'synced'
  AND NOT p.is_excluded
  AND a.revoked_at IS NULL
  AND a.valid_from <= hr_policy_date()
  AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date());

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 2: PTO Page Current Approval Status
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V2_PTO_APPROVAL' as test,
  p.id as page_id,
  p.title,
  a.id as approval_id,
  a.approved_content_hash,
  a.valid_from,
  a.valid_until,
  a.approved_at,
  a.approved_by,
  CASE
    WHEN a.valid_from <= hr_policy_date()
         AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
    THEN 'CURRENT_EFFECTIVE'
    WHEN a.valid_from > hr_policy_date()
    THEN 'FUTURE_STAGED'
    ELSE 'EXPIRED_OR_INVALID'
  END as approval_status,
  CASE
    WHEN a.valid_until IS NULL THEN 'PASS'
    ELSE 'CHECK_EXPIRATION'
  END as result
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
  AND a.revoked_at IS NULL
ORDER BY a.valid_from DESC;
-- EXPECTED: 1 row with CURRENT_EFFECTIVE, valid_until = NULL

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 3: PTO Page Chunk Count (Current Version)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V3_PTO_CHUNKS' as test,
  p.title,
  a.approved_content_hash,
  COUNT(c.id) as chunk_count,
  CASE
    WHEN COUNT(c.id) > 0 THEN 'PASS'
    ELSE 'FAIL_NO_CHUNKS'
  END as result,
  'PTO page has chunks matching approved content hash' as description
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
  AND a.revoked_at IS NULL
  AND a.valid_from <= hr_policy_date()
  AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
GROUP BY p.title, a.approved_content_hash;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 4: Healthcare Benefits Page Status
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V4_HEALTHCARE' as test,
  p.id as page_id,
  p.title,
  a.id as approval_id,
  a.valid_from,
  a.valid_until,
  COUNT(c.id) as chunk_count,
  CASE
    WHEN COUNT(c.id) > 0
         AND a.valid_from <= hr_policy_date()
         AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
    THEN 'PASS'
    ELSE 'FAIL'
  END as result,
  'Healthcare Benefits page is retrievable' as description
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE p.title ILIKE '%Healthcare%Benefits%'
  AND a.revoked_at IS NULL
  AND a.valid_from <= hr_policy_date()
  AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
GROUP BY p.id, p.title, a.id, a.valid_from, a.valid_until;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 5: No Future-Dated PTO Approval Exists
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V5_NO_FUTURE_PTO' as test,
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS'
    ELSE 'FAIL_FUTURE_PTO_EXISTS'
  END as result,
  COUNT(*) as future_approvals_count,
  'No future-dated PTO approval should exist yet' as description
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
  AND a.revoked_at IS NULL
  AND a.valid_from > hr_policy_date();
-- EXPECTED: 0 future approvals

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 6: Date-Aware Retrieval Function Test
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V6_POLICY_DATE_FUNCTION' as test,
  hr_policy_date() as current_policy_date,
  CASE
    WHEN hr_policy_date() = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE
    THEN 'PASS'
    ELSE 'FAIL'
  END as result,
  'hr_policy_date() returns correct America/New_York date' as description;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 7: Sample Content Retrieval (PTO)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V7_PTO_CONTENT_SAMPLE' as test,
  p.title,
  c.chunk_index,
  LEFT(c.content_text, 100) as content_preview,
  c.page_content_hash,
  'PASS' as result
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
  AND a.revoked_at IS NULL
  AND a.valid_from <= hr_policy_date()
  AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
ORDER BY c.chunk_index
LIMIT 3;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 8: Sample Content Retrieval (Healthcare)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V8_HEALTHCARE_CONTENT_SAMPLE' as test,
  p.title,
  c.chunk_index,
  LEFT(c.content_text, 100) as content_preview,
  c.page_content_hash,
  'PASS' as result
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
JOIN hr_knowledge_chunks c ON c.page_id = p.id
  AND c.page_content_hash = a.approved_content_hash
WHERE p.title ILIKE '%Healthcare%Benefits%'
  AND a.revoked_at IS NULL
  AND a.valid_from <= hr_policy_date()
  AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
ORDER BY c.chunk_index
LIMIT 3;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 9: All Active Approvals Summary
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V9_APPROVALS_SUMMARY' as test,
  COUNT(*) as total_active_approvals,
  COUNT(*) FILTER (WHERE valid_until IS NULL) as never_expires,
  COUNT(*) FILTER (WHERE valid_from <= hr_policy_date()) as currently_effective,
  COUNT(*) FILTER (WHERE valid_from > hr_policy_date()) as future_staged,
  CASE
    WHEN COUNT(*) FILTER (WHERE valid_from > hr_policy_date()) = 0 THEN 'PASS_NO_FUTURE'
    ELSE 'INFO_FUTURE_EXISTS'
  END as result
FROM hr_page_approvals
WHERE revoked_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION 10: Full Page List with Retrieval Status
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'V10_PAGE_LIST' as test,
  p.title,
  p.access_classification,
  a.valid_from,
  a.valid_until,
  CASE
    WHEN a.valid_from <= hr_policy_date()
         AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
    THEN 'RETRIEVABLE'
    ELSE 'NOT_RETRIEVABLE'
  END as status
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
WHERE p.sync_status = 'synced'
  AND NOT p.is_excluded
  AND a.revoked_at IS NULL
ORDER BY p.title;

-- ═══════════════════════════════════════════════════════════════════════════
-- SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '═══════════════════════════════════════════════════════════════' as summary;
SELECT 'C8X-107BC: PRODUCTION RETRIEVAL VERIFICATION' as summary;
SELECT 'All V1-V9 tests should show PASS.' as summary;
SELECT 'V10 provides full page inventory.' as summary;
SELECT '═══════════════════════════════════════════════════════════════' as summary;
