-- Add status column to past_performance table
-- Tracks whether contracts are active, completed, or ending soon

ALTER TABLE past_performance
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

-- Add comment for clarity
COMMENT ON COLUMN past_performance.status IS 'Contract status: active, ending_soon, completed, terminated';

-- Update existing contracts based on pop_end dates
-- Contracts ending in future are active
UPDATE past_performance
SET status = 'active'
WHERE pop_end IS NOT NULL AND pop_end::date > CURRENT_DATE;

-- Contracts that have ended are completed
UPDATE past_performance
SET status = 'completed'
WHERE pop_end IS NOT NULL AND pop_end::date <= CURRENT_DATE;

-- Contracts ending within 6 months are "ending_soon"
UPDATE past_performance
SET status = 'ending_soon'
WHERE pop_end IS NOT NULL
  AND pop_end::date > CURRENT_DATE
  AND pop_end::date <= CURRENT_DATE + INTERVAL '6 months';
