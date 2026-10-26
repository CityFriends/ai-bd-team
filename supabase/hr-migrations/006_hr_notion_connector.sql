-- ============================================================
-- HR Notion Knowledge Connector — Schema and Security
--
-- Tables for Notion connections, approved roots, knowledge pages,
-- content chunks, and sync checkpoints.
--
-- Security:
--   - RLS enabled on all tables, service_role only
--   - Webhook secrets stored in Railway env vars (referenced by name)
--   - Connection auth failure blocks retrieval immediately
--   - Approved roots determine classification, not connection scope
--
-- Target: Dedicated HR Supabase project (NOT the BD project)
-- DO NOT execute against bvgtfadggtgnakrxvuim
-- ============================================================

-- Notion integration connections
CREATE TABLE IF NOT EXISTS hr_notion_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_name TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('employee', 'admin')),
  env_var_name TEXT NOT NULL CHECK (env_var_name LIKE 'HR_%'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  webhook_secret_env TEXT CHECK (webhook_secret_env IS NULL OR webhook_secret_env LIKE 'HR_%'),
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN (
    'success', 'partial', 'error', 'running'
  )),
  last_sync_error TEXT,
  last_auth_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Approved content roots — explicit boundaries
CREATE TABLE IF NOT EXISTS hr_approved_roots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES hr_notion_connections(id),
  notion_page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  access_classification TEXT NOT NULL
    CHECK (access_classification IN ('employee_safe', 'hr_restricted')),
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(connection_id, notion_page_id)
);

-- Indexed Notion pages
CREATE TABLE IF NOT EXISTS hr_knowledge_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES hr_notion_connections(id),
  approved_root_id UUID NOT NULL REFERENCES hr_approved_roots(id),
  source_id UUID REFERENCES hr_knowledge_sources(id),
  notion_page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_notion_id TEXT,
  page_url TEXT,
  access_classification TEXT NOT NULL
    CHECK (access_classification IN ('employee_safe', 'hr_restricted')),
  content_hash TEXT,
  notion_last_edited TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'error', 'revoked', 'excluded')),
  sync_error TEXT,
  is_excluded BOOLEAN NOT NULL DEFAULT false,
  exclusion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, notion_page_id)
);

CREATE INDEX idx_kp_retrieval
  ON hr_knowledge_pages(access_classification, sync_status)
  WHERE sync_status = 'synced' AND NOT is_excluded;
CREATE INDEX idx_kp_verification
  ON hr_knowledge_pages(last_verified_at)
  WHERE sync_status NOT IN ('revoked', 'excluded');

-- Content chunks with block-level citation support
CREATE TABLE IF NOT EXISTS hr_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES hr_knowledge_pages(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  notion_block_ids TEXT[] NOT NULL DEFAULT '{}',
  heading_path TEXT[] NOT NULL DEFAULT '{}',
  first_block_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(page_id, chunk_index)
);

CREATE INDEX idx_chunks_page ON hr_knowledge_chunks(page_id);

-- Sync checkpoints for observability
CREATE TABLE IF NOT EXISTS hr_sync_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES hr_notion_connections(id),
  sync_type TEXT NOT NULL CHECK (sync_type IN (
    'full', 'incremental', 'verification', 'webhook'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  pages_discovered INT DEFAULT 0,
  pages_updated INT DEFAULT 0,
  pages_revoked INT DEFAULT 0,
  pages_excluded INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error TEXT,
  trigger_event_id TEXT
);

-- ============================================================
-- Retrieval RPC — enforces all authorization at database level
-- ============================================================

CREATE OR REPLACE FUNCTION hr_retrieve_knowledge(
  p_allowed_classifications TEXT[],
  p_query TEXT,
  p_freshness_minutes INT DEFAULT 30,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  content_text TEXT,
  heading_path TEXT[],
  first_block_id TEXT,
  title TEXT,
  page_url TEXT,
  notion_page_id TEXT,
  last_verified_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.content_text,
    c.heading_path,
    c.first_block_id,
    p.title,
    p.page_url,
    p.notion_page_id,
    p.last_verified_at
  FROM public.hr_knowledge_chunks c
  JOIN public.hr_knowledge_pages p ON c.page_id = p.id
  JOIN public.hr_approved_roots ar ON p.approved_root_id = ar.id
  JOIN public.hr_notion_connections conn ON p.connection_id = conn.id
  LEFT JOIN public.hr_knowledge_sources s ON p.source_id = s.id
  WHERE p.access_classification = ANY(p_allowed_classifications)
    AND p.sync_status = 'synced'
    AND NOT p.is_excluded
    AND p.last_verified_at > NOW() - make_interval(mins => p_freshness_minutes)
    AND conn.is_active = true
    AND ar.is_active = true
    -- Ownership: root belongs to the same connection as the page
    AND ar.connection_id = conn.id
    -- Classification consistency: page matches its root's current classification
    AND p.access_classification = ar.access_classification
    -- Scope enforcement: employee connections serve only employee_safe content
    AND (
      (conn.scope = 'employee' AND p.access_classification = 'employee_safe')
      OR conn.scope = 'admin'
    )
    -- Source approval (when a source record exists)
    AND (s.id IS NULL OR s.approval_status = 'approved')
    AND (s.id IS NULL OR s.is_authoritative = false OR s.source_type = 'handbook_pdf')
    -- Text search
    AND c.content_text ILIKE '%' || p_query || '%'
  ORDER BY p.last_verified_at DESC
  LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION hr_retrieve_knowledge FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_retrieve_knowledge TO service_role;

-- ============================================================
-- RLS — service_role only, deny anon and authenticated
-- ============================================================

ALTER TABLE hr_notion_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_approved_roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_knowledge_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_sync_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_service_connections" ON hr_notion_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "hr_service_roots" ON hr_approved_roots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "hr_service_pages" ON hr_knowledge_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "hr_service_chunks" ON hr_knowledge_chunks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "hr_service_checkpoints" ON hr_sync_checkpoints
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "hr_deny_anon_connections" ON hr_notion_connections FOR ALL TO anon USING (false);
CREATE POLICY "hr_deny_anon_roots" ON hr_approved_roots FOR ALL TO anon USING (false);
CREATE POLICY "hr_deny_anon_pages" ON hr_knowledge_pages FOR ALL TO anon USING (false);
CREATE POLICY "hr_deny_anon_chunks" ON hr_knowledge_chunks FOR ALL TO anon USING (false);
CREATE POLICY "hr_deny_anon_checkpoints" ON hr_sync_checkpoints FOR ALL TO anon USING (false);

CREATE POLICY "hr_deny_auth_connections" ON hr_notion_connections FOR ALL TO authenticated USING (false);
CREATE POLICY "hr_deny_auth_roots" ON hr_approved_roots FOR ALL TO authenticated USING (false);
CREATE POLICY "hr_deny_auth_pages" ON hr_knowledge_pages FOR ALL TO authenticated USING (false);
CREATE POLICY "hr_deny_auth_chunks" ON hr_knowledge_chunks FOR ALL TO authenticated USING (false);
CREATE POLICY "hr_deny_auth_checkpoints" ON hr_sync_checkpoints FOR ALL TO authenticated USING (false);
