-- Migration: Add cache metrics table for persistent cache statistics
-- Tracks hit/miss counts by cache type and hour for monitoring and optimization

-- Cache metrics table
CREATE TABLE IF NOT EXISTS cache_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_type TEXT NOT NULL, -- 'research', 'response', 'analysis', 'tool'
  hour_bucket TIMESTAMPTZ NOT NULL, -- Truncated to hour
  hits INTEGER DEFAULT 0,
  misses INTEGER DEFAULT 0,
  total_queries INTEGER DEFAULT 0,
  avg_similarity REAL, -- For semantic cache hits
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cache_type, hour_bucket)
);

-- Index for querying by time range
CREATE INDEX IF NOT EXISTS idx_cache_metrics_hour
ON cache_metrics(hour_bucket DESC);

-- Index for querying by cache type
CREATE INDEX IF NOT EXISTS idx_cache_metrics_type
ON cache_metrics(cache_type);

-- RLS
ALTER TABLE cache_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to cache_metrics" ON cache_metrics
  FOR ALL USING (auth.role() = 'service_role');

-- Function to record cache hits/misses atomically
CREATE OR REPLACE FUNCTION record_cache_stat(
  p_cache_type TEXT,
  p_is_hit BOOLEAN,
  p_similarity REAL DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_hour_bucket TIMESTAMPTZ;
BEGIN
  -- Truncate to current hour
  v_hour_bucket := date_trunc('hour', NOW());

  INSERT INTO cache_metrics (cache_type, hour_bucket, hits, misses, total_queries, avg_similarity)
  VALUES (
    p_cache_type,
    v_hour_bucket,
    CASE WHEN p_is_hit THEN 1 ELSE 0 END,
    CASE WHEN p_is_hit THEN 0 ELSE 1 END,
    1,
    p_similarity
  )
  ON CONFLICT (cache_type, hour_bucket) DO UPDATE SET
    hits = cache_metrics.hits + CASE WHEN p_is_hit THEN 1 ELSE 0 END,
    misses = cache_metrics.misses + CASE WHEN p_is_hit THEN 0 ELSE 1 END,
    total_queries = cache_metrics.total_queries + 1,
    avg_similarity = CASE
      WHEN p_is_hit AND p_similarity IS NOT NULL THEN
        COALESCE((cache_metrics.avg_similarity * cache_metrics.hits + p_similarity) / (cache_metrics.hits + 1), p_similarity)
      ELSE cache_metrics.avg_similarity
    END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to get cache stats for a time range
CREATE OR REPLACE FUNCTION get_cache_stats(
  p_hours_back INTEGER DEFAULT 24,
  p_cache_type TEXT DEFAULT NULL
) RETURNS TABLE (
  cache_type TEXT,
  total_hits BIGINT,
  total_misses BIGINT,
  total_queries BIGINT,
  hit_rate REAL,
  avg_similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cm.cache_type,
    SUM(cm.hits)::BIGINT AS total_hits,
    SUM(cm.misses)::BIGINT AS total_misses,
    SUM(cm.total_queries)::BIGINT AS total_queries,
    CASE WHEN SUM(cm.total_queries) > 0
      THEN SUM(cm.hits)::REAL / SUM(cm.total_queries)::REAL
      ELSE 0
    END AS hit_rate,
    AVG(cm.avg_similarity)::REAL
  FROM cache_metrics cm
  WHERE cm.hour_bucket >= NOW() - (p_hours_back || ' hours')::INTERVAL
    AND (p_cache_type IS NULL OR cm.cache_type = p_cache_type)
  GROUP BY cm.cache_type;
END;
$$ LANGUAGE plpgsql;

-- Comment
COMMENT ON TABLE cache_metrics IS 'Hourly aggregated cache hit/miss statistics by cache type';
COMMENT ON FUNCTION record_cache_stat IS 'Atomically records a cache hit or miss with upsert';
COMMENT ON FUNCTION get_cache_stats IS 'Returns aggregated cache statistics for monitoring';
