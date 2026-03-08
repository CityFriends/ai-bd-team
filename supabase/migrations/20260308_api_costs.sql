-- API Cost Tracking
-- Stores Claude API usage for cost analysis and optimization

CREATE TABLE IF NOT EXISTS api_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who made the call
  agent TEXT,  -- NULL for system calls

  -- What type of call
  purpose TEXT NOT NULL CHECK (purpose IN (
    'thinking_session',
    'engagement_decision',
    'opportunity_analysis',
    'research',
    'outreach_draft',
    'conversation',
    'summarization',
    'other'
  )),

  -- Model info
  model TEXT NOT NULL,
  model_tier TEXT NOT NULL CHECK (model_tier IN ('haiku', 'sonnet', 'opus')),

  -- Token usage
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,

  -- Cost estimate in USD
  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,

  -- Performance
  duration_ms INTEGER,

  -- Additional context
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_api_costs_created_at ON api_costs(created_at DESC);
CREATE INDEX idx_api_costs_agent ON api_costs(agent) WHERE agent IS NOT NULL;
CREATE INDEX idx_api_costs_purpose ON api_costs(purpose);
CREATE INDEX idx_api_costs_model_tier ON api_costs(model_tier);

-- Function to get cost summary for a period
CREATE OR REPLACE FUNCTION get_cost_summary(
  since_hours INTEGER DEFAULT 24
)
RETURNS TABLE (
  total_cost NUMERIC,
  total_calls BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  cost_by_purpose JSONB,
  cost_by_model JSONB,
  cost_by_agent JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH costs AS (
    SELECT * FROM api_costs
    WHERE created_at >= NOW() - (since_hours || ' hours')::INTERVAL
  )
  SELECT
    COALESCE(SUM(estimated_cost_usd), 0)::NUMERIC AS total_cost,
    COUNT(*)::BIGINT AS total_calls,
    COALESCE(SUM(input_tokens), 0)::BIGINT AS total_input_tokens,
    COALESCE(SUM(output_tokens), 0)::BIGINT AS total_output_tokens,
    (
      SELECT jsonb_object_agg(purpose, row_to_json(t))
      FROM (
        SELECT purpose, COUNT(*) as calls, SUM(estimated_cost_usd) as cost
        FROM costs GROUP BY purpose
      ) t
    ) AS cost_by_purpose,
    (
      SELECT jsonb_object_agg(model, row_to_json(t))
      FROM (
        SELECT model, COUNT(*) as calls, SUM(estimated_cost_usd) as cost
        FROM costs GROUP BY model
      ) t
    ) AS cost_by_model,
    (
      SELECT jsonb_object_agg(COALESCE(agent, 'system'), row_to_json(t))
      FROM (
        SELECT agent, COUNT(*) as calls, SUM(estimated_cost_usd) as cost
        FROM costs GROUP BY agent
      ) t
    ) AS cost_by_agent
  FROM costs;
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE api_costs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "service_role_all_api_costs" ON api_costs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Comment
COMMENT ON TABLE api_costs IS 'Tracks Claude API usage for cost analysis and optimization';
