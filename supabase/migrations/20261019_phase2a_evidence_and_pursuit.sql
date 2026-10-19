-- ============================================================
-- Phase 2A/2B: Evidence Persistence and Pursuit Recommendations
--
-- 1. opportunity_evidence — per-document extraction results with
--    audit trail, caching, and change detection.
-- 2. pursuit_recommendation — shadow-only JSONB column on
--    pipeline_opportunities for deterministic pursuit advice.
--
-- Shadow-only: pursuit recommendations do not influence
-- pipeline_decision, review tasks, or Slack behavior.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. opportunity_evidence table
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunity_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES pipeline_opportunities(id) ON DELETE CASCADE,
  document_url text NOT NULL,
  document_name text,
  content_hash text,
  content_type text,
  extraction_method text,
  extracted_text text,
  extracted_chars integer DEFAULT 0,
  priority_score integer DEFAULT 1,
  size_bytes integer,
  page_count integer,
  truncated boolean DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  error_reason text,
  retrieved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (opportunity_id, document_url)
);

CREATE INDEX IF NOT EXISTS idx_evidence_opportunity
  ON opportunity_evidence(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_evidence_content_hash
  ON opportunity_evidence(content_hash) WHERE content_hash IS NOT NULL;

COMMENT ON TABLE opportunity_evidence IS
  'Per-document extraction results from SAM.gov attachments. Supports caching and change detection.';

REVOKE ALL ON opportunity_evidence FROM anon;
REVOKE ALL ON opportunity_evidence FROM authenticated;
GRANT ALL ON opportunity_evidence TO service_role;

-- ============================================================
-- 2. pursuit_recommendation column on pipeline_opportunities
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pipeline_opportunities'
      AND column_name = 'pursuit_recommendation'
  ) THEN
    ALTER TABLE pipeline_opportunities
    ADD COLUMN pursuit_recommendation jsonb;
  END IF;
END $$;

COMMENT ON COLUMN pipeline_opportunities.pursuit_recommendation IS
  'Shadow-mode pursuit recommendation (PURSUE_PRIME/EXPLORE_TEAMING/MONITOR/DECLINE). Does not influence pipeline_decision.';

COMMIT;
