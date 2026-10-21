-- ============================================================
-- Fix: Add unique constraint on slack_opportunity_briefs.opportunity_id
--
-- Root cause: postOpportunityBrief used .upsert({ onConflict: 'opportunity_id' })
-- but no unique constraint existed, causing PostgreSQL error 42P10.
-- The upsert always failed silently, leaving zero brief rows persisted.
-- This meant Slack messages were posted but button lookups always failed.
--
-- Production state at time of writing: table is empty (0 rows).
-- No destructive deduplication is needed. The unique index creation is
-- safe on an empty table and will prevent future duplicates.
--
-- If duplicates exist at migration time (e.g. from interim activity),
-- the CREATE UNIQUE INDEX will fail, requiring manual inspection:
--   SELECT opportunity_id, COUNT(*) FROM slack_opportunity_briefs
--   GROUP BY opportunity_id HAVING COUNT(*) > 1;
-- Resolve manually before re-running.
-- ============================================================

-- Add the unique constraint (will fail safely if duplicates exist)
CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_briefs_opportunity_id
ON slack_opportunity_briefs(opportunity_id);

COMMENT ON INDEX uq_slack_briefs_opportunity_id IS
  'Each opportunity has at most one Slack brief. Required by postOpportunityBrief upsert.';
