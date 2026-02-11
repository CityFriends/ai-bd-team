-- Table for tracking news items that David has already reported
-- Prevents duplicate news postings

CREATE TABLE IF NOT EXISTS seen_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  relevance_score INTEGER,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for URL lookups (deduplication checks)
CREATE INDEX IF NOT EXISTS idx_seen_news_url ON seen_news(url);

-- Index for cleanup queries (removing old entries)
CREATE INDEX IF NOT EXISTS idx_seen_news_seen_at ON seen_news(seen_at);

-- Enable RLS
ALTER TABLE seen_news ENABLE ROW LEVEL SECURITY;

-- Service role only policy (matches our security pattern)
CREATE POLICY "Service role access for seen_news"
  ON seen_news
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE seen_news IS 'Tracks news items that David has already reported to prevent duplicates';
