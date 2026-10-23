-- ============================================================
-- HR Knowledge Source Registry
--
-- Tracks handbooks, Notion pages, regulatory sources, and memos.
-- Distinguishes employee-safe from restricted/compensation content.
-- Notion content does not become authoritative automatically.
-- The approved PDF handbook is the authoritative policy source.
--
-- Target: Dedicated HR Supabase project (NOT the BD project)
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_type TEXT NOT NULL CHECK (source_type IN (
    'handbook_pdf', 'notion_page', 'regulatory', 'internal_memo'
  )),

  source_name TEXT NOT NULL,
  source_url TEXT,
  source_version TEXT,
  content_hash TEXT,

  effective_date DATE,

  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN (
    'draft', 'pending_review', 'approved', 'superseded', 'withdrawn'
  )),

  -- Authority: is this source authoritative company policy?
  -- Only approved handbook_pdf sources should be authoritative.
  is_authoritative BOOLEAN NOT NULL DEFAULT false,

  -- Access classification: controls who can see derived content
  access_classification TEXT NOT NULL DEFAULT 'employee_safe' CHECK (access_classification IN (
    'employee_safe',        -- Safe for any employee to see
    'hr_restricted',        -- HR admins and owners only
    'compensation_restricted'  -- Owners only (salary data)
  )),

  approved_by TEXT,
  approved_at TIMESTAMPTZ,

  -- Synchronization metadata
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT CHECK (sync_status IN ('pending', 'synced', 'error', 'skipped')),
  sync_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hr_knowledge_type ON hr_knowledge_sources(source_type);
CREATE INDEX idx_hr_knowledge_status ON hr_knowledge_sources(approval_status);
CREATE INDEX idx_hr_knowledge_access ON hr_knowledge_sources(access_classification);

-- Constraint: only handbook_pdf can be authoritative
-- Notion content must go through explicit approval to become authoritative
ALTER TABLE hr_knowledge_sources ADD CONSTRAINT chk_authoritative_source
  CHECK (
    is_authoritative = false
    OR source_type = 'handbook_pdf'
    OR approval_status = 'approved'
  );

COMMENT ON TABLE hr_knowledge_sources IS
  'Knowledge source registry. Tracks approval status and access classification. '
  'Notion content is NOT automatically authoritative.';
