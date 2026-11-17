-- ═══════════════════════════════════════════════════════════════════════════
-- C8X-107BE: PTO Staging Precondition Verification (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this BEFORE executing the staging script.
-- All queries are SELECT-only.

WITH
-- Expected values
config AS (
  SELECT
    '6d4f0bca-7a5a-4ac0-aace-bdef28eb6a5f'::UUID as pto_page_id,
    '95134666fecfe00bf4b2dcf1de9f18c4828bc5fa6dc54d21ce0834615816a6dc' as expected_current_hash,
    'db855a8c483626745e4b3467be7977518b02b1009c1217ee1d3a1d59f3bb65d6' as expected_future_hash
),

-- P2: Current PTO approval
current_approval AS (
  SELECT
    a.id as approval_id,
    a.approved_content_hash,
    a.valid_from,
    a.valid_until,
    a.approved_by,
    a.approved_at
  FROM hr_page_approvals a, config c
  WHERE a.knowledge_page_id = c.pto_page_id
    AND a.revoked_at IS NULL
    AND a.valid_from <= CURRENT_DATE
    AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE)
  ORDER BY a.valid_from DESC
  LIMIT 1
),

-- P4: Future PTO approval check
future_approval AS (
  SELECT COUNT(*) as cnt
  FROM hr_page_approvals a, config c
  WHERE a.knowledge_page_id = c.pto_page_id
    AND a.revoked_at IS NULL
    AND a.valid_from > CURRENT_DATE
),

-- Current chunks count
current_chunks AS (
  SELECT COUNT(*) as cnt
  FROM hr_knowledge_chunks c, config cfg
  WHERE c.page_id = cfg.pto_page_id
    AND c.page_content_hash = cfg.expected_current_hash
),

-- Check if future chunks already exist
future_chunks AS (
  SELECT COUNT(*) as cnt
  FROM hr_knowledge_chunks c, config cfg
  WHERE c.page_id = cfg.pto_page_id
    AND c.page_content_hash = cfg.expected_future_hash
),

-- Total retrievable pages
total_pages AS (
  SELECT COUNT(DISTINCT p.id) as cnt
  FROM hr_knowledge_pages p
  JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
  JOIN hr_knowledge_chunks c ON c.page_id = p.id
    AND c.page_content_hash = a.approved_content_hash
  WHERE p.sync_status = 'synced'
    AND NOT p.is_excluded
    AND a.revoked_at IS NULL
    AND a.valid_from <= CURRENT_DATE
    AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE)
)

-- ═══════════════════════════════════════════════════════════════════════════
-- CONSOLIDATED RESULTS
-- ═══════════════════════════════════════════════════════════════════════════

SELECT * FROM (
  SELECT
    'P2_CURRENT_APPROVAL' as test_name,
    CASE
      WHEN ca.approval_id IS NOT NULL
           AND ca.approved_content_hash = cfg.expected_current_hash
      THEN 'PASS'
      ELSE 'FAIL'
    END as status,
    COALESCE(ca.approval_id::TEXT, 'NOT_FOUND') as approval_id,
    COALESCE(ca.approved_content_hash, 'N/A') as content_hash,
    COALESCE(ca.valid_from::TEXT, 'N/A') as valid_from,
    COALESCE(ca.valid_until::TEXT, 'NULL') as valid_until,
    'Current PTO approval exists with expected hash' as description
  FROM config cfg
  LEFT JOIN current_approval ca ON TRUE

  UNION ALL

  SELECT
    'P4_NO_FUTURE_APPROVAL',
    CASE WHEN fa.cnt = 0 THEN 'PASS' ELSE 'FAIL' END,
    fa.cnt::TEXT,
    'N/A',
    'N/A',
    'N/A',
    'No future-dated PTO approval exists'
  FROM future_approval fa

  UNION ALL

  SELECT
    'P5_CURRENT_CHUNKS',
    CASE WHEN cc.cnt > 0 THEN 'PASS' ELSE 'FAIL' END,
    cc.cnt::TEXT,
    'N/A',
    'N/A',
    'N/A',
    'Current PTO chunks exist'
  FROM current_chunks cc

  UNION ALL

  SELECT
    'P6_FUTURE_CHUNKS_ABSENT',
    CASE WHEN fc.cnt = 0 THEN 'PASS' ELSE 'WARN' END,
    fc.cnt::TEXT,
    'N/A',
    'N/A',
    'N/A',
    'Future PTO chunks do not yet exist (0 expected before staging)'
  FROM future_chunks fc

  UNION ALL

  SELECT
    'P7_TOTAL_PAGES',
    CASE WHEN tp.cnt >= 41 THEN 'PASS' ELSE 'WARN' END,
    tp.cnt::TEXT,
    'N/A',
    'N/A',
    'N/A',
    'Total retrievable pages before staging'
  FROM total_pages tp

) results
ORDER BY test_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- CURRENT APPROVAL DETAILS (for staging script input)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT
  'STAGING_INPUT' as info_type,
  a.id as current_approval_id,
  a.approved_content_hash as current_hash,
  p.notion_page_id,
  'db855a8c483626745e4b3467be7977518b02b1009c1217ee1d3a1d59f3bb65d6' as target_future_hash,
  '2027-01-01' as target_valid_from
FROM hr_knowledge_pages p
JOIN hr_page_approvals a ON a.knowledge_page_id = p.id
WHERE p.id = '6d4f0bca-7a5a-4ac0-aace-bdef28eb6a5f'
  AND a.revoked_at IS NULL
  AND a.valid_from <= CURRENT_DATE
  AND (a.valid_until IS NULL OR a.valid_until >= CURRENT_DATE);
