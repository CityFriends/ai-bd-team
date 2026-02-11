-- Agency Forecasts Table
-- Stores upcoming opportunities from agency procurement forecast pages

CREATE TABLE IF NOT EXISTS agency_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency TEXT NOT NULL,
  sub_agency TEXT,
  title TEXT,
  description TEXT,
  estimated_release DATE,
  estimated_value TEXT,
  naics_code TEXT,
  set_aside TEXT,
  contract_type TEXT,
  contact_name TEXT,
  contact_email TEXT,
  source_url TEXT,
  relevance_score INTEGER, -- Maya scores based on our keywords
  notes TEXT,
  last_checked TIMESTAMPTZ,
  status TEXT DEFAULT 'upcoming', -- upcoming, released, cancelled
  sam_gov_link TEXT, -- once it hits SAM.gov
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forecasts_agency ON agency_forecasts(agency);
CREATE INDEX IF NOT EXISTS idx_forecasts_release ON agency_forecasts(estimated_release);
CREATE INDEX IF NOT EXISTS idx_forecasts_relevance ON agency_forecasts(relevance_score);
CREATE INDEX IF NOT EXISTS idx_forecasts_status ON agency_forecasts(status);

-- Row Level Security
ALTER TABLE agency_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to agency_forecasts" ON agency_forecasts
  FOR ALL USING (auth.role() = 'service_role');

-- Sample queries:
-- High relevance upcoming: SELECT * FROM agency_forecasts WHERE relevance_score >= 70 AND status = 'upcoming' ORDER BY estimated_release;
-- By agency: SELECT * FROM agency_forecasts WHERE agency = 'VA' AND status = 'upcoming';
-- Recently updated: SELECT * FROM agency_forecasts ORDER BY updated_at DESC LIMIT 20;
