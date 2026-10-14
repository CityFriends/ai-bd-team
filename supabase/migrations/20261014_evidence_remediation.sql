-- ============================================================
-- Evidence Remediation: Remove Unsupported Performance Claims
--
-- Removes three specific unsupported claims from production data:
--   1. "88% increase in waiver submissions" (unverified attribution)
--   2. "95% instant approval rate" (no source)
--   3. "30K+ veterans helped" (program-scale, not FFTC outcome)
--
-- Affects exactly 3 rows across 2 tables.
-- Does NOT re-seed data or run the update script.
-- Transaction-safe: all-or-nothing via Management API.
-- ============================================================

-- ============================================================
-- PREFLIGHT: Verify exact rows before modification
-- ============================================================
-- Run these SELECTs independently before applying the migration:
--
-- SELECT id, title, outcomes FROM case_studies
-- WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c';
-- Expected: title = 'Resolving Veteran Debt in Minutes', outcomes contains '88%'
--
-- SELECT id, LEFT(content, 50), (content ILIKE '%88%') AS has_88
-- FROM proposal_snippets
-- WHERE id IN ('23618839-647b-4d14-a681-681499f2045b', '2dd5af3b-c2e2-4d20-8884-73b85371825a');
-- Expected: 2 rows, both has_88 = true

-- ============================================================
-- 1. case_studies: Remove unsupported outcomes
-- ============================================================
UPDATE case_studies
SET outcomes = '["Veterans resolve debt in minutes instead of weeks"]'::jsonb,
    updated_at = NOW()
WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c'
  AND title = 'Resolving Veteran Debt in Minutes';

-- ============================================================
-- 2. proposal_snippets: Remove unsupported claims from content
-- ============================================================

-- Snippet 23618839: Remove the final two sentences containing 88% and 95%
UPDATE proposal_snippets
SET content = 'We redesigned the VA''s debt resolution process so Veterans can check balances, request waivers, and resolve debt online in minutes instead of weeks. We ran co-design sessions with Veterans including those with PTSD and TBI, identified 66 issues in the existing form, and developed trauma-informed research protocols.',
    updated_at = NOW()
WHERE id = '23618839-647b-4d14-a681-681499f2045b'
  AND content ILIKE '%88%';

-- Snippet 2dd5af3b: Remove the final paragraph containing 88% and 95%
UPDATE proposal_snippets
SET content = 'Veterans who fell behind on VA debt faced a system designed to lose them. The path to relief meant completing a Financial Status Report, printing it, mailing it, then drafting a separate document to request a waiver or repayment plan. Veterans had no way to track progress. If the form had errors, they started over. Many gave up. Those who persisted often lost wages to garnishments and faced unnecessary charge-offs.

The existing digital eFSR form had 66 issues ranging from accessibility failures to confusing patterns. Our team fixed the most urgent and began deeper research. Previous research had barely involved Veterans. We introduced co-design sessions with Veterans including those with PTSD, TBI, and cognitive impairments.

Those conversations were hard. Participants described financial hardship that went beyond usability feedback. We worked with VA clinicians to develop trauma-informed research protocols: how moderators responded in difficult moments, how participants could step back, and what support was available afterward.

Eight studies produced behavioral archetypes that revealed who the system had been missing. The archetypes shaped every design decision. We tested prototypes across web and mobile with Veterans using screen readers and alternate input devices. We replaced legal jargon with plain language, shortened the form, and automated eligibility checks. We connected the platform to VA''s Debt Management Center, Health Resource Center, and VBMS. For the first time, Veterans could submit a form and know immediately it had been received.',
    updated_at = NOW()
WHERE id = '2dd5af3b-c2e2-4d20-8884-73b85371825a'
  AND content ILIKE '%88%';

-- ============================================================
-- POSTFLIGHT: Verify changes
-- ============================================================
-- Run these SELECTs after applying:
--
-- SELECT id, outcomes FROM case_studies
-- WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c';
-- Expected: outcomes = '["Veterans resolve debt in minutes instead of weeks"]'
--
-- SELECT id, (content ILIKE '%88%') AS has_88, (content ILIKE '%95%') AS has_95
-- FROM proposal_snippets
-- WHERE id IN ('23618839-647b-4d14-a681-681499f2045b', '2dd5af3b-c2e2-4d20-8884-73b85371825a');
-- Expected: both has_88 = false, both has_95 = false
