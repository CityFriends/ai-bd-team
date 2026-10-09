-- Denise-specific Slack emergency stop — database control
-- Independent of global AI kill switch. Checked at every Denise
-- Slack action and delivery boundary with fail-closed semantics.
--
-- Emergency stop: UPDATE system_controls SET value = 'false'::jsonb WHERE key = 'denise_slack_enabled';
-- Latency: ~5 seconds (negative cache TTL in application code).

INSERT INTO system_controls (key, value, description, updated_by)
VALUES (
  'denise_slack_enabled',
  'false'::jsonb,
  'Denise Slack dispatch and action processing. Independent of global AI toggle. Emergency stop: set to false.',
  'migration'
)
ON CONFLICT (key) DO NOTHING;
