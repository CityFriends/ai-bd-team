-- Competitor Intel Table
-- Stores intelligence about competitors/incumbents: protests, performance issues, awards

CREATE TABLE competitor_intel (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  agency_code TEXT,
  intel_type TEXT NOT NULL CHECK (intel_type IN ('protest', 'performance', 'award', 'debarment', 'general')),
  summary TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  confidence TEXT DEFAULT 'MEDIUM' CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  discovered_by TEXT,
  still_relevant BOOLEAN DEFAULT TRUE,
  discovered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for company name searches (case-insensitive)
CREATE INDEX idx_competitor_intel_company ON competitor_intel (LOWER(company_name));

-- Index for agency searches
CREATE INDEX idx_competitor_intel_agency ON competitor_intel (agency_code);

-- Index for recent discoveries
CREATE INDEX idx_competitor_intel_discovered ON competitor_intel (discovered_at DESC);

-- Index for relevant intel only
CREATE INDEX idx_competitor_intel_relevant ON competitor_intel (still_relevant) WHERE still_relevant = TRUE;
