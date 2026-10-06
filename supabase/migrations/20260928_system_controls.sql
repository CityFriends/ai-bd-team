-- System Controls table for runtime configuration
-- Used by the global AI kill switch and feature flags
CREATE TABLE IF NOT EXISTS system_controls (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insert default: AI disabled (fail closed)
INSERT INTO system_controls (key, value, description, updated_by)
VALUES (
  'ai_enabled',
  'false'::jsonb,
  'Global AI execution toggle. When false, no LLM inference requests leave the application.',
  'migration'
)
ON CONFLICT (key) DO NOTHING;

-- Insert default: Autonomous AI disabled
INSERT INTO system_controls (key, value, description, updated_by)
VALUES (
  'autonomous_ai_enabled',
  'false'::jsonb,
  'Controls whether scheduled/cron AI jobs can execute. Independent of global AI toggle.',
  'migration'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Row Level Security — service_role only
-- ============================================================
-- This table controls AI execution. It MUST NOT be accessible
-- to anon or authenticated roles via the Data API.

ALTER TABLE system_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_system_controls"
  ON system_controls FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON system_controls TO service_role;

COMMENT ON TABLE system_controls IS
  'Runtime AI controls (kill switch, feature flags). Service-role only. '
  'anon/authenticated access blocked by RLS.';
