-- ============================================================
-- Shadow Capability Qualification Column
--
-- Adds a nullable JSONB column for shadow-mode capability-based
-- qualification results. This column is written by the collector
-- but does NOT influence pipeline_decision, fit_score, review
-- tasks, Slack notifications, or any operational behavior.
--
-- Shadow-only: results are for offline analysis and validation.
-- The capability reference is DRAFT_PENDING_OWNER_REVIEW.
--
-- Single column addition. No constraints, no indexes, no triggers.
-- Safe to drop without affecting any production behavior.
-- ============================================================

BEGIN;

-- Verify the column does not already exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_opportunities'
      AND column_name = 'capability_qualification'
  ) THEN
    RAISE EXCEPTION 'ABORT: capability_qualification column already exists.';
  END IF;
END $$;

ALTER TABLE pipeline_opportunities
ADD COLUMN capability_qualification jsonb;

COMMENT ON COLUMN pipeline_opportunities.capability_qualification IS
  'Shadow-mode capability-based qualification (DRAFT). Does not influence pipeline_decision or scoring.';

COMMIT;
