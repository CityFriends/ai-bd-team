-- ============================================================
-- Milestone 2: Maya Pipeline — Canonical Opportunity Model
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  source TEXT NOT NULL,              -- 'sam_gov', 'gsa_ebuy', 'forecast', etc.
  source_id TEXT NOT NULL,           -- Source-specific ID (e.g., SAM noticeId)
  solicitation_number TEXT,

  -- Content
  title TEXT NOT NULL,
  description TEXT,
  synopsis TEXT,

  -- Organization
  agency TEXT,
  sub_agency TEXT,
  office TEXT,

  -- Classification
  notice_type TEXT,
  naics TEXT,
  psc TEXT,
  set_aside TEXT,
  set_aside_description TEXT,

  -- Timeline
  posted_date TEXT,
  response_deadline TEXT,

  -- Value
  estimated_value NUMERIC,

  -- Geography & Access
  place_of_performance TEXT,
  vehicle TEXT,
  source_url TEXT,

  -- Attachments
  attachments JSONB DEFAULT '[]',

  -- Status
  active BOOLEAN DEFAULT TRUE,
  archived BOOLEAN DEFAULT FALSE,
  cancelled BOOLEAN DEFAULT FALSE,

  -- Change detection
  raw_hash TEXT NOT NULL,
  material_hash TEXT NOT NULL,

  -- Pipeline processing
  pipeline_decision TEXT CHECK (pipeline_decision IN (
    'HARD_EXCLUDE', 'PASS', 'WATCH',
    'MAYA_QUICK_REVIEW', 'MAYA_FULL_REVIEW'
  )),
  fit_score INTEGER,
  fit_score_breakdown JSONB,
  strategic_override_rules TEXT[],
  past_performance_matches JSONB,

  -- Maya review results
  maya_quick_review JSONB,
  maya_full_review JSONB,

  -- Tracking
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_scored_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,

  -- Raw payload
  raw_payload JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source, source_id)
);

-- Indexes
CREATE INDEX idx_pipeline_opp_source ON pipeline_opportunities(source, source_id);
CREATE INDEX idx_pipeline_opp_solicitation ON pipeline_opportunities(solicitation_number) WHERE solicitation_number IS NOT NULL;
CREATE INDEX idx_pipeline_opp_decision ON pipeline_opportunities(pipeline_decision);
CREATE INDEX idx_pipeline_opp_score ON pipeline_opportunities(fit_score DESC) WHERE fit_score IS NOT NULL;
CREATE INDEX idx_pipeline_opp_agency ON pipeline_opportunities(agency);
CREATE INDEX idx_pipeline_opp_deadline ON pipeline_opportunities(response_deadline);
CREATE INDEX idx_pipeline_opp_material ON pipeline_opportunities(material_hash);

-- ============================================================
-- Scoring weights configuration (data, not code)
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_scoring_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_name TEXT NOT NULL DEFAULT 'default' UNIQUE,
  weights JSONB NOT NULL,
  thresholds JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO pipeline_scoring_config (config_name, weights, thresholds) VALUES
  ('default',
   '{"capabilityFit":25,"pastPerformance":20,"agencyFit":15,"setAsideAdvantage":10,"revenueRoleQuality":10,"naicsPscFit":5,"vehicleAccessFit":5,"primeSuitability":5,"timingViability":5}'::jsonb,
   '{"passArchive":39,"storeWatch":59,"quickReview":79,"fullReview":100}'::jsonb)
ON CONFLICT (config_name) DO NOTHING;

-- RLS
ALTER TABLE pipeline_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_scoring_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_pipeline_opportunities" ON pipeline_opportunities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_pipeline_scoring_config" ON pipeline_scoring_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE pipeline_opportunities IS 'Canonical opportunity model. Single source of truth for all opportunity data across sources.';
COMMENT ON TABLE pipeline_scoring_config IS 'Configurable scoring weights and thresholds. Data, not code.';
