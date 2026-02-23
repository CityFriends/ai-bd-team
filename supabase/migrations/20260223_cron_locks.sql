-- Distributed locks for cron jobs
-- Prevents duplicate runs when Railway has multiple replicas

CREATE TABLE IF NOT EXISTS cron_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key TEXT NOT NULL UNIQUE,  -- e.g., "patricia-standup:2026-02-23T16:00"
  job_name TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires ON cron_locks(expires_at);

-- Index for job lookup
CREATE INDEX IF NOT EXISTS idx_cron_locks_job ON cron_locks(job_name);

-- RLS (service role only)
ALTER TABLE cron_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to cron_locks"
  ON cron_locks FOR ALL
  USING (auth.role() = 'service_role');

-- Comment
COMMENT ON TABLE cron_locks IS 'Distributed locks to prevent duplicate cron job runs across Railway replicas';
