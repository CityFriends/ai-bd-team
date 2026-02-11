-- Seen Awards table - tracks awards we've already reported
-- Used by the award monitor to avoid duplicate reporting

CREATE TABLE IF NOT EXISTS seen_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id TEXT UNIQUE NOT NULL,
  vendor_name TEXT NOT NULL,
  agency_code TEXT NOT NULL,
  amount NUMERIC,
  seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reported_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_seen_awards_contract_id ON seen_awards(contract_id);
CREATE INDEX IF NOT EXISTS idx_seen_awards_agency_code ON seen_awards(agency_code);
CREATE INDEX IF NOT EXISTS idx_seen_awards_seen_at ON seen_awards(seen_at);

-- Row Level Security
ALTER TABLE seen_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to seen_awards" ON seen_awards
  FOR ALL USING (auth.role() = 'service_role');

-- Clean up old records (keep last 90 days)
-- Run periodically: DELETE FROM seen_awards WHERE seen_at < NOW() - INTERVAL '90 days';
