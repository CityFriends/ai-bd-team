-- Migration: Add tool result caching table
-- Caches API tool results to reduce external calls and improve performance

CREATE TABLE IF NOT EXISTS tool_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  query_hash TEXT NOT NULL UNIQUE, -- Deterministic hash of tool name + params
  params JSONB NOT NULL,
  result JSONB NOT NULL,
  source_citation TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ
);

-- Index for fast lookup by hash
CREATE INDEX IF NOT EXISTS idx_tool_cache_hash
ON tool_cache(query_hash);

-- Index for expiry cleanup
CREATE INDEX IF NOT EXISTS idx_tool_cache_expires
ON tool_cache(expires_at);

-- Index for tool statistics
CREATE INDEX IF NOT EXISTS idx_tool_cache_tool_name
ON tool_cache(tool_name);

-- RLS
ALTER TABLE tool_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to tool_cache" ON tool_cache
  FOR ALL USING (auth.role() = 'service_role');

-- Comment
COMMENT ON TABLE tool_cache IS 'Caches tool API results to reduce external calls. TTL varies by tool type.';
