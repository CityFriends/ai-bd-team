-- ============================================================
-- Haiku 5.5 Pricing and Denise Route Migration
--
-- Pricing: $0.10/$0.50 per MTok (prompts ≤100K tokens)
-- Model: claude-haiku-5-5 (Active, not sooner than Oct 7, 2027)
-- Tokenizer: ~30% more tokens for same text vs Haiku 4.5
-- Thinking: Adaptive (always-on), tokens billed as output
-- ============================================================

-- Pricing for claude-haiku-5-5 (base tier, prompts ≤100K tokens)
INSERT INTO ai_model_pricing (provider, model, input_price_per_million, output_price_per_million, tier)
VALUES ('anthropic', 'claude-haiku-5-5', 0.10, 0.50, 'haiku-5-5')
ON CONFLICT (provider, model, effective_from) DO NOTHING;

-- Update Denise routes from haiku-4-5 to haiku-5-5
-- maxOutputTokens increased to 4096 to accommodate adaptive thinking
-- Routes remain disabled — activation requires separate authorization
UPDATE ai_model_routing
SET model = 'claude-haiku-5-5',
    max_output_tokens = 4096,
    updated_at = NOW()
WHERE task_type IN (
  'denise_capture_acquisition',
  'denise_clause_analysis',
  'denise_clarification_draft',
  'denise_regulatory_interpretation'
)
AND model = 'claude-haiku-4-5-20251001';
