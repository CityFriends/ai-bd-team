-- ============================================================
-- Denise Route Seed — Production
--
-- Inserts Denise task-type routes into ai_model_routing.
-- All routes are DISABLED by default — activation requires
-- separate authorization and feature-flag enablement.
--
-- These routes use Haiku 4.5 as the initial model. Migration
-- 20261014_haiku_55_pricing.sql will update them to Haiku 5.5.
-- Order: apply this BEFORE 20261014_haiku_55_pricing.sql.
-- ============================================================

INSERT INTO ai_model_routing (task_type, provider, model, max_output_tokens, max_input_tokens, max_cost_usd, enabled)
VALUES
  ('denise_capture_acquisition',        'anthropic', 'claude-haiku-4-5-20251001', 2048, 16000, 0.05, false),
  ('denise_clause_analysis',            'anthropic', 'claude-haiku-4-5-20251001', 2048, 16000, 0.05, false),
  ('denise_amendment_impact',           'anthropic', 'claude-sonnet-4-6',         2048, 16000, 0.05, false),
  ('denise_clarification_draft',        'anthropic', 'claude-haiku-4-5-20251001', 1024,  8000, 0.03, false),
  ('denise_evaluation_analysis',        'anthropic', 'claude-sonnet-4-6',         2048, 16000, 0.05, false),
  ('denise_regulatory_interpretation',  'anthropic', 'claude-haiku-4-5-20251001', 2048,  8000, 0.05, false)
ON CONFLICT (task_type) DO NOTHING;
