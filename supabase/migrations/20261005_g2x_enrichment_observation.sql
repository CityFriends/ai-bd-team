-- ============================================================
-- G2X Enrichment Observation Window
-- ============================================================
-- Tracks Maya G2X enrichment usage with bounded limits.
-- Separate from Maya LLM observation window and James window.

CREATE TABLE IF NOT EXISTS g2x_enrichment_observation (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETE')) DEFAULT 'ACTIVE',

  -- Limits
  max_enrichments INTEGER NOT NULL DEFAULT 10,
  max_total_calls INTEGER NOT NULL DEFAULT 60,
  max_total_records INTEGER NOT NULL DEFAULT 5000,

  -- Counters
  enrichments_completed INTEGER NOT NULL DEFAULT 0,
  total_g2x_calls INTEGER NOT NULL DEFAULT 0,
  total_records INTEGER NOT NULL DEFAULT 0,

  -- Lifecycle
  stop_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE g2x_enrichment_observation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_g2x_enrichment_observation"
  ON g2x_enrichment_observation FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON g2x_enrichment_observation TO service_role;

COMMENT ON TABLE g2x_enrichment_observation IS
  'G2X enrichment observation window for Maya. Separate from Maya LLM and James observation windows. '
  'Limits: max 10 enrichments, 60 G2X calls, 5000 records.';
