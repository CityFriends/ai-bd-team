-- Company Knowledge Base Schema (No pgvector)
-- Run this if you don't have pgvector enabled yet
-- The documents table with embeddings can be added later

-- ============================================
-- TABLE 1: company_profile
-- ============================================
CREATE TABLE IF NOT EXISTS company_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL UNIQUE,
  tagline TEXT,
  elevator_pitch TEXT,
  capabilities TEXT[],
  differentiators TEXT[],
  certifications TEXT[],
  set_asides TEXT[],
  naics_codes TEXT[],
  contract_vehicles TEXT[],
  agency_experience TEXT[],
  ideal_opportunity TEXT,
  no_bid_criteria TEXT[],
  team_size INTEGER,
  location TEXT,
  website TEXT,
  cage_code TEXT,
  uei TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 2: past_performance
-- ============================================
CREATE TABLE IF NOT EXISTS past_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_name TEXT NOT NULL,
  agency TEXT NOT NULL,
  sub_agency TEXT,
  contract_number TEXT,
  contract_vehicle TEXT,
  pop_start DATE,
  pop_end DATE,
  contract_value DECIMAL,
  our_role TEXT,
  prime_contractor TEXT,
  teaming_partners TEXT[],
  description TEXT,
  key_accomplishments TEXT[],
  relevant_naics TEXT[],
  tags TEXT[],
  client_contact_name TEXT,
  client_contact_email TEXT,
  client_contact_phone TEXT,
  cpar_rating TEXT,
  referenceable BOOLEAN DEFAULT true,
  lessons_learned TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 3: contacts
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  title TEXT,
  agency TEXT,
  sub_agency TEXT,
  email TEXT,
  phone TEXT,
  linkedin TEXT,
  relationship_strength INTEGER CHECK (relationship_strength BETWEEN 1 AND 5),
  how_we_know TEXT,
  last_contact_date DATE,
  notes TEXT,
  tags TEXT[],
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 4: teaming_partners
-- ============================================
CREATE TABLE IF NOT EXISTS teaming_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  website TEXT,
  capabilities TEXT[],
  certifications TEXT[],
  set_asides TEXT[],
  naics_codes TEXT[],
  past_work_together TEXT[],
  relationship_status TEXT,
  relationship_notes TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  nda_signed BOOLEAN DEFAULT false,
  teaming_agreement_signed BOOLEAN DEFAULT false,
  strengths TEXT[],
  weaknesses TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 5: labor_rates
-- ============================================
CREATE TABLE IF NOT EXISTS labor_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  labor_category TEXT NOT NULL,
  hourly_rate_low DECIMAL,
  hourly_rate_high DECIMAL,
  annual_salary_low DECIMAL,
  annual_salary_high DECIMAL,
  contract_vehicle TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 6: case_studies
-- ============================================
CREATE TABLE IF NOT EXISTS case_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  past_performance_id UUID REFERENCES past_performance(id),
  title TEXT NOT NULL,
  client TEXT,
  agency TEXT,
  challenge TEXT,
  approach TEXT,
  solution TEXT,
  outcomes TEXT[],
  client_quotes TEXT[],
  artifacts TEXT[],
  methods_used TEXT[],
  team_composition TEXT,
  duration TEXT,
  visuals_location TEXT,
  public_releasable BOOLEAN DEFAULT true,
  proposal_language TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 7: key_personnel
-- ============================================
CREATE TABLE IF NOT EXISTS key_personnel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT,
  bio TEXT,
  short_bio TEXT,
  education TEXT[],
  certifications TEXT[],
  years_experience INTEGER,
  specialties TEXT[],
  past_performance_ids UUID[],
  resume_location TEXT,
  photo_location TEXT,
  available BOOLEAN DEFAULT true,
  hourly_rate DECIMAL,
  labor_category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 8: proposal_content
-- ============================================
CREATE TABLE IF NOT EXISTS proposal_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[],
  last_used_date DATE,
  win_rate_when_used DECIMAL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE 9: lessons_learned
-- ============================================
CREATE TABLE IF NOT EXISTS lessons_learned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID,
  past_performance_id UUID,
  lesson_type TEXT,
  what_happened TEXT,
  what_we_learned TEXT,
  apply_when TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_past_performance_agency ON past_performance(agency);
CREATE INDEX IF NOT EXISTS idx_past_performance_tags ON past_performance USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_contacts_agency ON contacts(agency);
CREATE INDEX IF NOT EXISTS idx_teaming_partners_status ON teaming_partners(relationship_status);
CREATE INDEX IF NOT EXISTS idx_case_studies_methods ON case_studies USING GIN(methods_used);
CREATE INDEX IF NOT EXISTS idx_case_studies_outcomes ON case_studies USING GIN(outcomes);
CREATE INDEX IF NOT EXISTS idx_key_personnel_specialties ON key_personnel USING GIN(specialties);
CREATE INDEX IF NOT EXISTS idx_proposal_content_tags ON proposal_content USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_lessons_learned_tags ON lessons_learned USING GIN(tags);

-- ============================================
-- ROW LEVEL SECURITY
-- Restrict access to service_role only
-- ============================================
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE past_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaming_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons_learned ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to company_profile" ON company_profile
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to past_performance" ON past_performance
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to contacts" ON contacts
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to teaming_partners" ON teaming_partners
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to labor_rates" ON labor_rates
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to case_studies" ON case_studies
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to key_personnel" ON key_personnel
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to proposal_content" ON proposal_content
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to lessons_learned" ON lessons_learned
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- NOTE: To add the documents table with embeddings later:
-- 1. Enable pgvector: CREATE EXTENSION vector;
-- 2. Then run:
--
-- CREATE TABLE documents (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   title TEXT NOT NULL,
--   document_type TEXT,
--   source_file TEXT,
--   storage_url TEXT,
--   full_text TEXT,
--   embedding vector(1536),
--   related_table TEXT,
--   related_id UUID,
--   tags TEXT[],
--   created_at TIMESTAMPTZ DEFAULT NOW()
-- );
-- CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
-- ============================================
