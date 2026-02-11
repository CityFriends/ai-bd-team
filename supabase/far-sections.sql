-- FAR Sections table for Federal Acquisition Regulation lookup
-- Run this in the Supabase SQL Editor

-- Create the far_sections table
CREATE TABLE IF NOT EXISTS far_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  part INTEGER NOT NULL DEFAULT 0,
  subpart TEXT,
  full_text TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_far_sections_section_number ON far_sections(section_number);
CREATE INDEX IF NOT EXISTS idx_far_sections_part ON far_sections(part);
CREATE INDEX IF NOT EXISTS idx_far_sections_subpart ON far_sections(subpart);

-- Create a text search index for full-text search
CREATE INDEX IF NOT EXISTS idx_far_sections_fulltext ON far_sections
  USING gin(to_tsvector('english', title || ' ' || full_text));

-- Add a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_far_sections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_far_sections_updated_at ON far_sections;
CREATE TRIGGER trigger_far_sections_updated_at
  BEFORE UPDATE ON far_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_far_sections_updated_at();

-- Enable Row Level Security
ALTER TABLE far_sections ENABLE ROW LEVEL SECURITY;

-- Restrict access to service role only
DROP POLICY IF EXISTS "Allow all operations on far_sections" ON far_sections;
DROP POLICY IF EXISTS "Service role has full access to far_sections" ON far_sections;
CREATE POLICY "Service role has full access to far_sections" ON far_sections
  FOR ALL USING (auth.role() = 'service_role');

-- Verify the table was created
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'far_sections'
ORDER BY ordinal_position;
