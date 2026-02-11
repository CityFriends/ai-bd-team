-- Seen eBuy Opportunities table
-- Tracks GSA eBuy opportunities we've already processed to avoid duplicates

CREATE TABLE IF NOT EXISTS seen_ebuy_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT UNIQUE NOT NULL,  -- e.g., RFI1795215, RFQ123456
  title TEXT NOT NULL,
  status TEXT,  -- NEW REQUEST, Q&A ADDED, AMENDED, CANCELED
  due_date TEXT,
  ebuy_url TEXT,
  score INTEGER,
  decision TEXT,  -- go, pass, null
  seen_at TIMESTAMPTZ DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_seen_ebuy_request_id ON seen_ebuy_opportunities(request_id);
CREATE INDEX IF NOT EXISTS idx_seen_ebuy_seen_at ON seen_ebuy_opportunities(seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_seen_ebuy_decision ON seen_ebuy_opportunities(decision);

-- Row Level Security
ALTER TABLE seen_ebuy_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to seen_ebuy_opportunities" ON seen_ebuy_opportunities
  FOR ALL USING (auth.role() = 'service_role');
