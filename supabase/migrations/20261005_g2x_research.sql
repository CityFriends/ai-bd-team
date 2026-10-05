-- ============================================================
-- G2X GovCon Research Integration — Normalized Storage
-- ============================================================
--
-- G2X is a read-only research/enrichment source.
-- It is NOT workflow orchestration, agent memory authority,
-- opportunity scoring authority, or a replacement for Supabase.
--
-- Tables store:
-- 1. Raw + normalized provider data with provenance
-- 2. Document inventory with version/amendment tracking
-- 3. Extracted evidence with page/section references
-- 4. G2X-specific usage accounting (separate from LLM budget)
-- 5. Tool inventory snapshots for audit
--
-- Provenance model: G2X is the retrieval provider, NOT the
-- source authority. For solicitation requirements, provenance
-- traces to: Document → Version → Page/Section, with G2X
-- recorded as the retrieval mechanism.
--
-- Raw payload retention has bounded size controls:
-- - MAX 256 KB for metadata/small records (JSONB inline)
-- - Larger payloads are truncated with hash reference
--
-- This migration targets the COMMISSIONING environment only.
-- Production database receives zero G2X commissioning writes.
-- ============================================================

-- ============================================================
-- External Source Records (Raw + Normalized)
-- ============================================================

CREATE TABLE IF NOT EXISTS external_source_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Provider identity
  provider TEXT NOT NULL CHECK (provider IN ('g2x', 'sam_gov', 'usaspending', 'fpds')),
  dataset TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  record_type TEXT NOT NULL,

  -- Timestamps
  source_updated_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Integrity
  content_hash TEXT NOT NULL,

  -- Raw payload (bounded: applications must enforce MAX_RAW_PAYLOAD_BYTES)
  -- Oversized payloads should be truncated with content_hash preserved
  raw_payload JSONB,

  -- Normalization tracking
  normalization_version INTEGER NOT NULL DEFAULT 1,

  -- Uniqueness: same record with same content is not re-inserted
  CONSTRAINT uq_external_source_record
    UNIQUE (provider, dataset, provider_record_id, content_hash)
);

CREATE INDEX idx_external_source_provider_record
  ON external_source_records (provider, provider_record_id);

CREATE INDEX idx_external_source_retrieved
  ON external_source_records (retrieved_at DESC);

ALTER TABLE external_source_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_external_source_records"
  ON external_source_records FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE external_source_records IS
  'Immutable raw + normalized provider data. Raw payload bounded to ~256KB. '
  'Content hash ensures deduplication. Normalization version tracks schema evolution.';

-- ============================================================
-- Opportunity Source Links
-- ============================================================

CREATE TABLE IF NOT EXISTS opportunity_source_links (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Links to existing opportunities table
  opportunity_id UUID NOT NULL,
  external_source_record_id UUID NOT NULL REFERENCES external_source_records(id),

  -- Relationship metadata
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'primary_source', 'enrichment', 'cross_reference', 'amendment', 'related'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_opportunity_source_link
    UNIQUE (opportunity_id, external_source_record_id, relationship_type)
);

CREATE INDEX idx_opp_source_link_opp
  ON opportunity_source_links (opportunity_id);

CREATE INDEX idx_opp_source_link_record
  ON opportunity_source_links (external_source_record_id);

ALTER TABLE opportunity_source_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_opportunity_source_links"
  ON opportunity_source_links FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE opportunity_source_links IS
  'Links external source records to internal opportunities with relationship type and confidence.';

-- ============================================================
-- Source Documents
-- ============================================================

CREATE TABLE IF NOT EXISTS source_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Provider identity
  provider TEXT NOT NULL,
  provider_document_id TEXT NOT NULL,

  -- Link to opportunity (via external source record)
  opportunity_id UUID,

  -- Document metadata
  title TEXT,
  filename TEXT,
  document_type TEXT, -- SOW, RFP, Amendment, Attachment, etc.

  -- Current version pointer
  current_version_id UUID, -- FK added after source_document_versions created

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_source_document
    UNIQUE (provider, provider_document_id)
);

CREATE INDEX idx_source_doc_opp
  ON source_documents (opportunity_id);

ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_source_documents"
  ON source_documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE source_documents IS
  'Document inventory per opportunity. Tracks solicitation documents, SOWs, amendments. '
  'Current version pointer updated when new versions are discovered; superseded versions remain auditable.';

-- ============================================================
-- Source Document Versions
-- ============================================================

CREATE TABLE IF NOT EXISTS source_document_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Parent document
  source_document_id UUID NOT NULL REFERENCES source_documents(id),

  -- Version identity
  provider_version TEXT,
  checksum TEXT,
  readiness TEXT NOT NULL CHECK (readiness IN ('READY', 'PROCESSING', 'NOT_AVAILABLE', 'UNKNOWN'))
    DEFAULT 'UNKNOWN',

  -- Amendment tracking
  amendment_of UUID REFERENCES source_document_versions(id),

  -- Lifecycle
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ, -- NULL = current version

  -- Additional metadata (bounded)
  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_doc_version_doc
  ON source_document_versions (source_document_id);

CREATE INDEX idx_source_doc_version_current
  ON source_document_versions (source_document_id)
  WHERE superseded_at IS NULL;

ALTER TABLE source_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_source_document_versions"
  ON source_document_versions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Add FK from source_documents.current_version_id
ALTER TABLE source_documents
  ADD CONSTRAINT fk_source_doc_current_version
  FOREIGN KEY (current_version_id) REFERENCES source_document_versions(id);

COMMENT ON TABLE source_document_versions IS
  'Document version/amendment tracking. New versions do not overwrite prior versions; '
  'superseded_at is set on the old version. Checksum validated where provider supplies it.';

-- ============================================================
-- Source Evidence (Extracted Content with Provenance)
-- ============================================================

CREATE TABLE IF NOT EXISTS source_evidence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Parent version
  source_document_version_id UUID NOT NULL REFERENCES source_document_versions(id),

  -- Evidence metadata
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('EXTRACTED_TEXT', 'REQUIREMENT', 'METADATA')),

  -- Content (bounded: applications must enforce MAX_ATTACHMENT_TEXT_BYTES)
  content TEXT NOT NULL,

  -- Provenance pointers — traces to solicitation, NOT to G2X
  page_number INTEGER,
  section TEXT,
  bbox JSONB, -- {x, y, width, height} if supplied by provider

  -- Integrity
  content_hash TEXT NOT NULL,

  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_evidence_version
  ON source_evidence (source_document_version_id);

ALTER TABLE source_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_source_evidence"
  ON source_evidence FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE source_evidence IS
  'Extracted evidence with full provenance chain: opportunity → document → version → page/section. '
  'G2X is the retrieval provider, not the source authority. Content bounded to ~512KB.';

-- ============================================================
-- External Usage Ledger (G2X-Specific, Separate from LLM Budget)
-- ============================================================

CREATE TABLE IF NOT EXISTS external_usage_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Request identity
  request_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Correlation
  workflow_id TEXT,
  agent_capability TEXT,

  -- Tool invocation
  tool TEXT NOT NULL,
  query_hash TEXT NOT NULL,

  -- Results (records ALL attempts including failures)
  records_returned INTEGER NOT NULL DEFAULT 0,
  records_billable_known INTEGER, -- NULL = unknown billing consumption
  pages INTEGER NOT NULL DEFAULT 0,

  -- Transport
  http_status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,

  -- Source references
  source_record_ids TEXT[] DEFAULT '{}',
  document_bytes INTEGER,

  -- Metered AI classification
  metered_ai_classification TEXT NOT NULL CHECK (metered_ai_classification IN (
    'NONE', 'CONFIRMED_METERED', 'SUSPECTED_METERED', 'UNKNOWN'
  )) DEFAULT 'NONE',

  -- Consumption tracking
  estimated_monthly_consumption INTEGER,

  -- Outcome
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_external_usage_timestamp
  ON external_usage_ledger (timestamp DESC);

CREATE INDEX idx_external_usage_tool
  ON external_usage_ledger (tool);

CREATE INDEX idx_external_usage_workflow
  ON external_usage_ledger (workflow_id)
  WHERE workflow_id IS NOT NULL;

ALTER TABLE external_usage_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_external_usage_ledger"
  ON external_usage_ledger FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE external_usage_ledger IS
  'G2X-specific usage accounting, separate from LLM budget. Records ALL attempts '
  'including failures (429, 503, auth, schema mismatch, etc.). records_billable_known '
  'is NULL when actual billing consumption cannot be determined.';

-- ============================================================
-- G2X Tool Inventory Snapshots (Audit Trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS g2x_tool_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Tool identity
  tool_name TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Full schema snapshot (not just hash)
  input_schema JSONB NOT NULL,
  input_schema_hash TEXT NOT NULL,

  -- Classification
  classification TEXT NOT NULL CHECK (classification IN (
    'ALLOWED', 'DENIED_UNKNOWN', 'DENIED_MUTATING', 'DENIED_METERED_AI', 'DENIED_METERED_OR_UNKNOWN'
  )),
  classification_reason TEXT NOT NULL,

  -- Discovery context
  discovered_at TIMESTAMPTZ NOT NULL,
  endpoint TEXT NOT NULL,
  integration_version TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_g2x_tool_inventory_name
  ON g2x_tool_inventory (tool_name);

CREATE INDEX idx_g2x_tool_inventory_discovered
  ON g2x_tool_inventory (discovered_at DESC);

ALTER TABLE g2x_tool_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_g2x_tool_inventory"
  ON g2x_tool_inventory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE g2x_tool_inventory IS
  'Full tool inventory snapshots from G2X tools/list discovery. Preserves complete schema '
  'for audit of what was authorized. Each discovery run creates new entries.';

-- ============================================================
-- Grants
-- ============================================================

GRANT ALL ON external_source_records TO service_role;
GRANT ALL ON opportunity_source_links TO service_role;
GRANT ALL ON source_documents TO service_role;
GRANT ALL ON source_document_versions TO service_role;
GRANT ALL ON source_evidence TO service_role;
GRANT ALL ON external_usage_ledger TO service_role;
GRANT ALL ON g2x_tool_inventory TO service_role;
