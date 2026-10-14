-- ============================================================
-- Denise Regulatory Interpretations — immutable, versioned
-- ============================================================

CREATE TABLE IF NOT EXISTS regulatory_interpretations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source evidence
  regulatory_evidence_id UUID NOT NULL REFERENCES regulatory_evidence(id),
  evidence_content_hash TEXT NOT NULL,
  regulation TEXT NOT NULL,
  provision_id TEXT NOT NULL,

  -- Solicitation context (optional)
  opportunity_id TEXT,
  solicitation_evidence_ids TEXT[] DEFAULT '{}',
  clause_register_entry_id UUID,

  -- Interpretation
  interpretation_question TEXT NOT NULL,
  source_facts JSONB NOT NULL DEFAULT '[]',
  regulatory_context JSONB NOT NULL DEFAULT '[]',
  interpretations JSONB NOT NULL DEFAULT '[]',
  operational_implications JSONB NOT NULL DEFAULT '[]',
  uncertainties JSONB NOT NULL DEFAULT '[]',
  unresolved_questions JSONB NOT NULL DEFAULT '[]',

  -- Ownership and impact
  suggested_owner TEXT,
  impact_areas TEXT[] DEFAULT '{}',
  legal_review_required BOOLEAN NOT NULL DEFAULT false,
  legal_review_reason TEXT,
  confidence TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  -- Coverage and status
  coverage_status TEXT NOT NULL DEFAULT 'COMPLETE' CHECK (coverage_status IN ('COMPLETE', 'PARTIAL', 'INCOMPLETE')),
  historical_authority_status TEXT DEFAULT 'CURRENT' CHECK (historical_authority_status IN ('CURRENT', 'HISTORICAL_UNVERIFIED', 'NOT_APPLICABLE')),

  -- Model provenance
  model_id TEXT,
  prompt_version TEXT DEFAULT '1.0',
  gateway_ledger_id UUID,

  -- Versioning
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id UUID REFERENCES regulatory_interpretations(id),

  -- Audit
  workflow_phase TEXT CHECK (workflow_phase IN ('CAPTURE', 'PURSUIT')),
  created_by TEXT NOT NULL DEFAULT 'denise',
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_interp_evidence ON regulatory_interpretations(regulatory_evidence_id);
CREATE INDEX IF NOT EXISTS idx_reg_interp_provision ON regulatory_interpretations(regulation, provision_id);
CREATE INDEX IF NOT EXISTS idx_reg_interp_opportunity ON regulatory_interpretations(opportunity_id);

COMMENT ON TABLE regulatory_interpretations IS 'Denise regulatory interpretations — immutable, versioned, traceable to verified evidence';

-- Immutability trigger
CREATE OR REPLACE FUNCTION prevent_regulatory_interpretation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'regulatory_interpretations rows are immutable — create a new version with supersedes_id';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_regulatory_interpretation_immutable') THEN
    CREATE TRIGGER trg_regulatory_interpretation_immutable
      BEFORE UPDATE ON regulatory_interpretations
      FOR EACH ROW
      EXECUTE FUNCTION prevent_regulatory_interpretation_mutation();
  END IF;
END $$;

-- RLS
ALTER TABLE regulatory_interpretations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_reg_interp" ON regulatory_interpretations;
CREATE POLICY "service_role_reg_interp" ON regulatory_interpretations FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT ALL ON regulatory_interpretations TO service_role;
GRANT EXECUTE ON FUNCTION prevent_regulatory_interpretation_mutation TO service_role;
