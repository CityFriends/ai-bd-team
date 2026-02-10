-- Cron Job Runs Table
-- Tracks execution of scheduled jobs for monitoring and debugging

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  duration_ms INTEGER,
  error_message TEXT,
  items_processed INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying recent runs
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_started_at ON cron_job_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job_name ON cron_job_runs(job_name);
CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status ON cron_job_runs(status);

-- View for monitoring job health
CREATE OR REPLACE VIEW job_health_summary AS
SELECT
  job_name,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
  ROUND(AVG(duration_ms)) as avg_duration_ms,
  MAX(started_at) as last_run_at,
  MAX(started_at) FILTER (WHERE status = 'completed') as last_success_at
FROM cron_job_runs
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY job_name
ORDER BY job_name;

-- RLS Policies (if needed)
ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can manage cron_job_runs"
  ON cron_job_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE cron_job_runs IS 'Tracks execution of scheduled cron jobs for monitoring and debugging';
