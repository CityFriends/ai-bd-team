-- ============================================================
-- Evidence Remediation: Surgical Removal of Unsupported Claims
--
-- Removes three specific unsupported claims from production data:
--   1. "88% increase in waiver submissions" (unverified attribution)
--   2. "95% instant approval rate" (no source)
--   3. "30K+ veterans helped" (program-scale, not FFTC outcome)
--
-- Removal-only: no replacement claims, no narrative rewrites.
-- Affects exactly 3 rows across 2 tables.
-- Single explicit transaction with assertions that abort on mismatch.
-- Captures exact original values for rollback before modification.
-- Does NOT re-seed data, run the update script, or use supabase db push.
--
-- NOTE: case_studies.outcomes is text[], not jsonb.
-- ============================================================

-- ============================================================
-- TRANSACTION: All-or-nothing with assertions
-- ============================================================
BEGIN;

-- ============================================================
-- 0. PRE-MODIFICATION ASSERTIONS
-- ============================================================
DO $$
BEGIN
  -- Row existence assertion: the target case_study must exist with
  -- the exact expected title and contain all 4 original outcomes.
  -- outcomes is text[], so use @> (array contains) operator.
  IF NOT EXISTS (
    SELECT 1 FROM case_studies
    WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c'
      AND title = 'Resolving Veteran Debt in Minutes'
      AND outcomes @> ARRAY[
        '88% increase in waiver submissions',
        '95% instant approval rate for Streamlined Waiver',
        'Veterans resolve debt in minutes instead of weeks',
        '30K+ veterans helped'
      ]
      AND array_length(outcomes, 1) = 4
  ) THEN
    RAISE EXCEPTION 'ABORT: case_studies row d9a7ca5d does not match expected pre-remediation state. Outcomes array does not contain all 4 expected entries.';
  END IF;

  -- Snippet 23618839 must exist and contain the exact unsupported sentences
  IF NOT EXISTS (
    SELECT 1 FROM proposal_snippets
    WHERE id = '23618839-647b-4d14-a681-681499f2045b'
      AND content LIKE '%Waiver submissions increased 88%'
      AND content LIKE '%delivers 95% instant approval%'
  ) THEN
    RAISE EXCEPTION 'ABORT: proposal_snippets row 23618839 does not match expected pre-remediation content.';
  END IF;

  -- Snippet 2dd5af3b must exist and contain the exact unsupported paragraph
  IF NOT EXISTS (
    SELECT 1 FROM proposal_snippets
    WHERE id = '2dd5af3b-c2e2-4d20-8884-73b85371825a'
      AND content LIKE '%Waiver submissions increased 88%'
      AND content LIKE '%Ninety-five percent of qualifying Veterans%'
  ) THEN
    RAISE EXCEPTION 'ABORT: proposal_snippets row 2dd5af3b does not match expected pre-remediation content.';
  END IF;
END $$;

-- ============================================================
-- 1. ROLLBACK ARTIFACT: Capture exact original values
-- ============================================================
-- Creates a durable, access-controlled table with the exact original
-- values. This table is NOT dropped by this migration.
CREATE TABLE IF NOT EXISTS _evidence_remediation_rollback_20261014 (
  table_name   text      NOT NULL,
  row_id       uuid      NOT NULL,
  column_name  text      NOT NULL,
  original_value text    NOT NULL,
  captured_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (table_name, row_id, column_name)
);

-- Restrict access to service_role only
REVOKE ALL ON _evidence_remediation_rollback_20261014 FROM PUBLIC;
REVOKE ALL ON _evidence_remediation_rollback_20261014 FROM anon;
REVOKE ALL ON _evidence_remediation_rollback_20261014 FROM authenticated;
GRANT ALL ON _evidence_remediation_rollback_20261014 TO service_role;

-- Capture case_studies.outcomes (as text representation of the text[] array)
INSERT INTO _evidence_remediation_rollback_20261014 (table_name, row_id, column_name, original_value)
SELECT 'case_studies', id, 'outcomes', outcomes::text
FROM case_studies
WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c'
ON CONFLICT DO NOTHING;

-- Capture proposal_snippets.content for both rows
INSERT INTO _evidence_remediation_rollback_20261014 (table_name, row_id, column_name, original_value)
SELECT 'proposal_snippets', id, 'content', content
FROM proposal_snippets
WHERE id IN ('23618839-647b-4d14-a681-681499f2045b', '2dd5af3b-c2e2-4d20-8884-73b85371825a')
ON CONFLICT DO NOTHING;

-- Assert we captured exactly 3 rollback rows
DO $$
DECLARE
  rollback_count integer;
BEGIN
  SELECT count(*) INTO rollback_count
  FROM _evidence_remediation_rollback_20261014;
  IF rollback_count <> 3 THEN
    RAISE EXCEPTION 'ABORT: Expected 3 rollback rows, found %. Rollback capture failed.', rollback_count;
  END IF;
END $$;

-- ============================================================
-- 2. case_studies: Remove unsupported outcomes from text[] array
-- ============================================================
-- Uses array_remove() to remove exactly 3 elements by value,
-- preserving all others including order.
UPDATE case_studies
SET outcomes = array_remove(
      array_remove(
        array_remove(
          outcomes,
          '88% increase in waiver submissions'
        ),
        '95% instant approval rate for Streamlined Waiver'
      ),
      '30K+ veterans helped'
    ),
    updated_at = NOW()
WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c'
  AND title = 'Resolving Veteran Debt in Minutes';

-- ============================================================
-- 3. proposal_snippets: Remove only unsupported sentence spans
-- ============================================================

-- Snippet 23618839 (Short): Remove the final two sentences.
-- Original ends with:
--   "...trauma-informed research protocols. Waiver submissions increased 88%.
--    The Streamlined Waiver, a Presidential Initiative, now delivers 95% instant approval."
-- After removal:
--   "...trauma-informed research protocols."
UPDATE proposal_snippets
SET content = regexp_replace(
      content,
      E' Waiver submissions increased 88%. The Streamlined Waiver, a Presidential Initiative, now delivers 95% instant approval\\.',
      '',
      'g'
    ),
    updated_at = NOW()
WHERE id = '23618839-647b-4d14-a681-681499f2045b'
  AND content LIKE '%Waiver submissions increased 88%';

-- Snippet 2dd5af3b (Full): Remove the final paragraph.
-- Original ends with:
--   "...know immediately it had been received.\n\nThe Streamlined Waiver, a Presidential
--    Initiative, offers fast-track debt forgiveness. Waiver submissions increased 88%.
--    Ninety-five percent of qualifying Veterans now receive instant approval."
-- After removal:
--   "...know immediately it had been received."
UPDATE proposal_snippets
SET content = regexp_replace(
      content,
      E'\n\nThe Streamlined Waiver, a Presidential Initiative, offers fast-track debt forgiveness\\. Waiver submissions increased 88%\\. Ninety-five percent of qualifying Veterans now receive instant approval\\.',
      '',
      'g'
    ),
    updated_at = NOW()
WHERE id = '2dd5af3b-c2e2-4d20-8884-73b85371825a'
  AND content LIKE '%Waiver submissions increased 88%';

-- ============================================================
-- 4. POST-MODIFICATION ASSERTIONS
-- ============================================================
DO $$
DECLARE
  cs_outcomes text[];
  cs_count integer;
  ps1_has_88 boolean;
  ps1_has_95 boolean;
  ps2_has_88 boolean;
  ps2_has_95 boolean;
  ps1_ends_with text;
  ps2_ends_with text;
BEGIN
  -- Assert case_studies outcomes contains exactly 1 verified entry
  SELECT outcomes, array_length(outcomes, 1)
  INTO cs_outcomes, cs_count
  FROM case_studies
  WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c';

  IF cs_count <> 1 THEN
    RAISE EXCEPTION 'ABORT: Expected 1 remaining outcome, found %. Outcomes: %', cs_count, cs_outcomes;
  END IF;

  IF NOT (cs_outcomes @> ARRAY['Veterans resolve debt in minutes instead of weeks']) THEN
    RAISE EXCEPTION 'ABORT: Verified outcome "Veterans resolve debt in minutes instead of weeks" is missing from outcomes.';
  END IF;

  -- Assert snippet 23618839 no longer contains unsupported claims
  SELECT
    content ILIKE '%88%',
    content ILIKE '%95% instant approval%',
    RIGHT(content, 40)
  INTO ps1_has_88, ps1_has_95, ps1_ends_with
  FROM proposal_snippets
  WHERE id = '23618839-647b-4d14-a681-681499f2045b';

  IF ps1_has_88 THEN
    RAISE EXCEPTION 'ABORT: Snippet 23618839 still contains "88%%" after remediation.';
  END IF;
  IF ps1_has_95 THEN
    RAISE EXCEPTION 'ABORT: Snippet 23618839 still contains "95%% instant approval" after remediation.';
  END IF;

  -- Assert snippet 2dd5af3b no longer contains unsupported claims
  SELECT
    content ILIKE '%88%',
    content ILIKE '%Ninety-five percent%',
    RIGHT(content, 40)
  INTO ps2_has_88, ps2_has_95, ps2_ends_with
  FROM proposal_snippets
  WHERE id = '2dd5af3b-c2e2-4d20-8884-73b85371825a';

  IF ps2_has_88 THEN
    RAISE EXCEPTION 'ABORT: Snippet 2dd5af3b still contains "88%%" after remediation.';
  END IF;
  IF ps2_has_95 THEN
    RAISE EXCEPTION 'ABORT: Snippet 2dd5af3b still contains "Ninety-five percent" after remediation.';
  END IF;

  RAISE NOTICE 'POST-REMEDIATION ASSERTIONS PASSED';
  RAISE NOTICE 'case_studies outcomes: %', cs_outcomes;
  RAISE NOTICE 'snippet 23618839 ends with: %', ps1_ends_with;
  RAISE NOTICE 'snippet 2dd5af3b ends with: %', ps2_ends_with;
END $$;

COMMIT;

-- ============================================================
-- ROLLBACK SCRIPT (run only if post-remediation values still match)
-- ============================================================
-- DO NOT run this as part of the migration. This is a separate
-- recovery script to execute only if rollback is needed.
--
-- Conflict guard: compares the exact current value of each row
-- against the expected post-remediation value derived from the
-- rollback artifact. If any row has been legitimately edited
-- since remediation, the rollback aborts to avoid overwriting.
--
-- BEGIN;
--
-- DO $$
-- DECLARE
--   expected_outcomes text[];
--   actual_outcomes text[];
--   expected_ps1 text;
--   actual_ps1 text;
--   expected_ps2 text;
--   actual_ps2 text;
-- BEGIN
--   -- Derive expected post-remediation outcomes from rollback artifact.
--   -- The original_value is the text[] cast to text. Parse it back and
--   -- remove the 3 unsupported claims.
--   SELECT array_remove(
--     array_remove(
--       array_remove(
--         original_value::text[],
--         '88% increase in waiver submissions'
--       ),
--       '95% instant approval rate for Streamlined Waiver'
--     ),
--     '30K+ veterans helped'
--   ) INTO expected_outcomes
--   FROM _evidence_remediation_rollback_20261014
--   WHERE table_name = 'case_studies'
--     AND row_id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c'
--     AND column_name = 'outcomes';
--
--   SELECT outcomes INTO actual_outcomes
--   FROM case_studies WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c';
--
--   IF actual_outcomes IS DISTINCT FROM expected_outcomes THEN
--     RAISE EXCEPTION 'ROLLBACK ABORT: case_studies outcomes have been modified since remediation. Expected: %, Actual: %',
--       expected_outcomes, actual_outcomes;
--   END IF;
--
--   -- Derive expected post-remediation snippet 23618839
--   SELECT regexp_replace(
--     original_value,
--     E' Waiver submissions increased 88%. The Streamlined Waiver, a Presidential Initiative, now delivers 95% instant approval\\.',
--     '', 'g'
--   ) INTO expected_ps1
--   FROM _evidence_remediation_rollback_20261014
--   WHERE table_name = 'proposal_snippets'
--     AND row_id = '23618839-647b-4d14-a681-681499f2045b';
--
--   SELECT content INTO actual_ps1
--   FROM proposal_snippets WHERE id = '23618839-647b-4d14-a681-681499f2045b';
--
--   IF actual_ps1 IS DISTINCT FROM expected_ps1 THEN
--     RAISE EXCEPTION 'ROLLBACK ABORT: proposal_snippets 23618839 has been modified since remediation.';
--   END IF;
--
--   -- Derive expected post-remediation snippet 2dd5af3b
--   SELECT regexp_replace(
--     original_value,
--     E'\n\nThe Streamlined Waiver, a Presidential Initiative, offers fast-track debt forgiveness\\. Waiver submissions increased 88%\\. Ninety-five percent of qualifying Veterans now receive instant approval\\.',
--     '', 'g'
--   ) INTO expected_ps2
--   FROM _evidence_remediation_rollback_20261014
--   WHERE table_name = 'proposal_snippets'
--     AND row_id = '2dd5af3b-c2e2-4d20-8884-73b85371825a';
--
--   SELECT content INTO actual_ps2
--   FROM proposal_snippets WHERE id = '2dd5af3b-c2e2-4d20-8884-73b85371825a';
--
--   IF actual_ps2 IS DISTINCT FROM expected_ps2 THEN
--     RAISE EXCEPTION 'ROLLBACK ABORT: proposal_snippets 2dd5af3b has been modified since remediation.';
--   END IF;
--
--   RAISE NOTICE 'ROLLBACK CONFLICT CHECK PASSED: all 3 rows match post-remediation state.';
-- END $$;
--
-- -- Restore case_studies.outcomes
-- UPDATE case_studies
-- SET outcomes = (
--       SELECT original_value::text[]
--       FROM _evidence_remediation_rollback_20261014
--       WHERE table_name = 'case_studies'
--         AND row_id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c'
--         AND column_name = 'outcomes'
--     ),
--     updated_at = NOW()
-- WHERE id = 'd9a7ca5d-cd41-4f81-ae21-b8355525eb4c';
--
-- -- Restore proposal_snippets.content (row 23618839)
-- UPDATE proposal_snippets
-- SET content = (
--       SELECT original_value
--       FROM _evidence_remediation_rollback_20261014
--       WHERE table_name = 'proposal_snippets'
--         AND row_id = '23618839-647b-4d14-a681-681499f2045b'
--         AND column_name = 'content'
--     ),
--     updated_at = NOW()
-- WHERE id = '23618839-647b-4d14-a681-681499f2045b';
--
-- -- Restore proposal_snippets.content (row 2dd5af3b)
-- UPDATE proposal_snippets
-- SET content = (
--       SELECT original_value
--       FROM _evidence_remediation_rollback_20261014
--       WHERE table_name = 'proposal_snippets'
--         AND row_id = '2dd5af3b-c2e2-4d20-8884-73b85371825a'
--         AND column_name = 'content'
--     ),
--     updated_at = NOW()
-- WHERE id = '2dd5af3b-c2e2-4d20-8884-73b85371825a';
--
-- COMMIT;
