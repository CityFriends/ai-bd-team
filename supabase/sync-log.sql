-- Sync Log Table
-- Tracks when data was synced from external sources

CREATE TABLE IF NOT EXISTS sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  record_count INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_source ON sync_log(source);
CREATE INDEX IF NOT EXISTS idx_sync_log_synced_at ON sync_log(synced_at DESC);

-- View recent syncs
-- SELECT * FROM sync_log ORDER BY synced_at DESC LIMIT 20;
