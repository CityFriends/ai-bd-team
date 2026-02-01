-- Add strategic context fields to company_profile
-- Run this in Supabase SQL editor

ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS strategic_goals TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS capability_gaps TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS growth_areas TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS innovation_initiatives TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS risk_tolerance TEXT;

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'company_profile'
AND column_name IN ('strategic_goals', 'capability_gaps', 'growth_areas', 'innovation_initiatives', 'risk_tolerance');
