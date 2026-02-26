-- Create proposal_snippets table
CREATE TABLE IF NOT EXISTS proposal_snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_study_id UUID REFERENCES case_studies(id) ON DELETE SET NULL,
  snippet_type TEXT NOT NULL CHECK (snippet_type IN ('past_performance', 'capability', 'technical_approach', 'management', 'staffing', 'differentiator', 'transition')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER GENERATED ALWAYS AS (array_length(regexp_split_to_array(content, '\s+'), 1)) STORED,
  tags TEXT[] DEFAULT '{}',
  audience TEXT CHECK (audience IN ('general', 'technical', 'executive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_proposal_snippets_case_study ON proposal_snippets(case_study_id);
CREATE INDEX idx_proposal_snippets_type ON proposal_snippets(snippet_type);
CREATE INDEX idx_proposal_snippets_tags ON proposal_snippets USING GIN(tags);

-- RLS
ALTER TABLE proposal_snippets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON proposal_snippets FOR ALL USING (true);

COMMENT ON TABLE proposal_snippets IS 'Reusable proposal language snippets linked to case studies';
