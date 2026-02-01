-- Add Notion page ID columns to enable sync tracking

-- Add to seen_opportunities
ALTER TABLE seen_opportunities
ADD COLUMN IF NOT EXISTS notion_page_id TEXT,
ADD COLUMN IF NOT EXISTS decision TEXT,
ADD COLUMN IF NOT EXISTS decision_date DATE,
ADD COLUMN IF NOT EXISTS decision_rationale TEXT;

-- Add to agency_forecasts
ALTER TABLE agency_forecasts
ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- Add to system_feedback
ALTER TABLE system_feedback
ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- Add notion_hub_config to company_profile for storing hub IDs
ALTER TABLE company_profile
ADD COLUMN IF NOT EXISTS notion_hub_config JSONB;

-- Create index for efficient sync queries
CREATE INDEX IF NOT EXISTS idx_seen_opps_notion ON seen_opportunities(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_notion ON agency_forecasts(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_feedback_notion ON system_feedback(notion_page_id);
