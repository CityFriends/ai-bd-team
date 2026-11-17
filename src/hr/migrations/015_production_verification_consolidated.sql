-- ═══════════════════════════════════════════════════════════════════════════
-- C8X-107BC: Production Retrieval Verification (CONSOLIDATED)
-- ═══════════════════════════════════════════════════════════════════════════
-- Single query returning all verification results in one table.
-- All operations are READ-ONLY.

WITH
-- V1: Count of retrievable pages
v1_retrievable AS (
  SELECT
    COUNT(DISTINCT p.id) as cnt
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE p.sync_status = 'synced'
    AND NOT p.is_excluded
    AND a.revoked_at IS NULL
    AND a.valid_from <= hr_policy_date()
    AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
),

-- V2: PTO approval status
v2_pto AS (
  SELECT
    p.id as page_id,
    p.title,
    a.id as approval_id,
    a.approved_content_hash,
    a.valid_from,
    a.valid_until,
    CASE
      WHEN a.valid_from <= hr_policy_date()
           AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
      THEN 'CURRENT_EFFECTIVE'
      WHEN a.valid_from > hr_policy_date()
      THEN 'FUTURE_STAGED'
      ELSE 'EXPIRED'
    END as approval_status
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
    AND a.revoked_at IS NULL
  ORDER BY a.valid_from DESC
  LIMIT 1
),

-- V3: PTO chunk count
v3_pto_chunks AS (
  SELECT COUNT(c.id) as cnt
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
    AND a.revoked_at IS NULL
    AND a.valid_from <= hr_policy_date()
    AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
),

-- V4: Healthcare page status
v4_healthcare AS (
  SELECT
    p.title,
    COUNT(c.id) as chunk_count
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE p.title ILIKE '%Healthcare%'
    AND a.revoked_at IS NULL
    AND a.valid_from <= hr_policy_date()
    AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
  GROUP BY p.title
  LIMIT 1
),

-- V5: Future PTO count
v5_future_pto AS (
  SELECT COUNT(*) as cnt
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
    AND a.revoked_at IS NULL
    AND a.valid_from > hr_policy_date()
),

-- V6: Policy date check
v6_policy_date AS (
  SELECT
    hr_policy_date() as policy_date,
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE as expected_date
),

-- V7: PTO content sample
v7_pto_sample AS (
  SELECT
    LEFT(c.content_text, 80) as sample
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE (p.title ILIKE '%PTO%' OR p.title ILIKE '%Paid Time Off%')
    AND a.revoked_at IS NULL
    AND a.valid_from <= hr_policy_date()
    AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
  ORDER BY c.chunk_index
  LIMIT 1
),

-- V8: Healthcare content sample
v8_healthcare_sample AS (
  SELECT
    LEFT(c.content_text, 80) as sample
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE p.title ILIKE '%Healthcare%'
    AND a.revoked_at IS NULL
    AND a.valid_from <= hr_policy_date()
    AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
  ORDER BY c.chunk_index
  LIMIT 1
),

-- V9: Approvals summary
v9_summary AS (
  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE valid_until IS NULL) as never_expires,
    COUNT(*) FILTER (WHERE valid_from > hr_policy_date()) as future_staged
  FROM hr_page_approvals
  WHERE revoked_at IS NULL
),

-- V10: All pages retrievable check
v10_all_pages AS (
  SELECT
    COUNT(*) as total_approved,
    COUNT(*) FILTER (
      WHERE a.valid_from <= hr_policy_date()
        AND (a.valid_until IS NULL OR a.valid_until >= hr_policy_date())
    ) as currently_retrievable
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  WHERE p.sync_status = 'synced'
    AND NOT p.is_excluded
    AND a.revoked_at IS NULL
)

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL CONSOLIDATED RESULTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

SELECT * FROM (
  SELECT
    'V1_RETRIEVABLE_COUNT' as test_name,
    CASE WHEN v1.cnt >= 41 THEN 'PASS' WHEN v1.cnt >= 33 THEN 'WARN' ELSE 'FAIL' END as status,
    v1.cnt::TEXT as actual_value,
    '>=41' as expected_value,
    'Total pages accessible via date-aware retrieval' as details
  FROM v1_retrievable v1

  UNION ALL

  SELECT
    'V2_PTO_APPROVAL',
    CASE
      WHEN v2.approval_status = 'CURRENT_EFFECTIVE' AND v2.valid_until IS NULL THEN 'PASS'
      WHEN v2.approval_status = 'CURRENT_EFFECTIVE' THEN 'WARN'
      ELSE 'FAIL'
    END,
    COALESCE(v2.approval_status || ', valid_until=' || COALESCE(v2.valid_until::TEXT, 'NULL'), 'NO_PTO_FOUND'),
    'CURRENT_EFFECTIVE, valid_until=NULL',
    'PTO page has current approval without expiration'
  FROM v2_pto v2

  UNION ALL

  SELECT
    'V3_PTO_CHUNKS',
    CASE WHEN v3.cnt > 0 THEN 'PASS' ELSE 'FAIL' END,
    v3.cnt::TEXT,
    '>0',
    'PTO chunks match approved content hash'
  FROM v3_pto_chunks v3

  UNION ALL

  SELECT
    'V4_HEALTHCARE',
    CASE WHEN COALESCE(v4.chunk_count, 0) > 0 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(v4.chunk_count::TEXT, '0'),
    '>0',
    'Healthcare Benefits page is retrievable: ' || COALESCE(v4.title, 'NOT_FOUND')
  FROM v4_healthcare v4

  UNION ALL

  SELECT
    'V5_NO_FUTURE_PTO',
    CASE WHEN v5.cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
    v5.cnt::TEXT,
    '0',
    'No future-dated PTO approval exists yet'
  FROM v5_future_pto v5

  UNION ALL

  SELECT
    'V6_POLICY_DATE',
    CASE WHEN v6.policy_date = v6.expected_date THEN 'PASS' ELSE 'FAIL' END,
    v6.policy_date::TEXT,
    v6.expected_date::TEXT,
    'hr_policy_date() returns correct America/New_York date'
  FROM v6_policy_date v6

  UNION ALL

  SELECT
    'V7_PTO_CONTENT',
    CASE WHEN v7.sample IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(LEFT(v7.sample, 60) || '...', 'NO_CONTENT'),
    'Content exists',
    'PTO content preview'
  FROM v7_pto_sample v7

  UNION ALL

  SELECT
    'V8_HEALTHCARE_CONTENT',
    CASE WHEN v8.sample IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(LEFT(v8.sample, 60) || '...', 'NO_CONTENT'),
    'Content exists',
    'Healthcare content preview'
  FROM v8_healthcare_sample v8

  UNION ALL

  SELECT
    'V9_APPROVALS_SUMMARY',
    CASE WHEN v9.future_staged = 0 THEN 'PASS' ELSE 'INFO' END,
    'total=' || v9.total || ', never_expires=' || v9.never_expires || ', future=' || v9.future_staged,
    'future=0',
    'No future-staged approvals exist'
  FROM v9_summary v9

  UNION ALL

  SELECT
    'V10_ALL_RETRIEVABLE',
    CASE WHEN v10.total_approved = v10.currently_retrievable THEN 'PASS' ELSE 'WARN' END,
    v10.currently_retrievable::TEXT || '/' || v10.total_approved::TEXT,
    'All approved pages retrievable',
    'Currently retrievable vs total approved pages'
  FROM v10_all_pages v10
) results
ORDER BY test_name;
