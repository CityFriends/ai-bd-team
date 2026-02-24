-- Add our_value column to past_performance table
-- This tracks FFTC's actual earnings/portion vs the total contract value
-- Example: Total contract = $50M, our_value = $5M (as subcontractor)

ALTER TABLE past_performance
ADD COLUMN IF NOT EXISTS our_value NUMERIC;

-- Add comment for clarity
COMMENT ON COLUMN past_performance.our_value IS 'FFTC actual earnings/portion of the contract (may differ from total contract_value when subcontracting)';
COMMENT ON COLUMN past_performance.contract_value IS 'Total contract value (full contract, not just our portion)';
