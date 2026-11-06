-- ============================================================
-- Migration 011: Publication Lifecycle for HQ Wiki Sync
-- ============================================================
--
-- Adds:
--   A. publication_status + classification columns on hr_knowledge_pages
--   B. hr_publication_queue table for pending reviews
--   C. hr_compensation_batches + hr_compensation_batch_entries
--   D. hr_sync_leases table with fencing-safe lease functions
--   E. Privilege revocation on all new tables and functions
--
-- Does NOT modify hr_retrieve_knowledge_v2 or hr_page_approvals.
-- Publication status is a workflow field, not an authorization gate.
-- Retrieval eligibility continues to require a valid content-hash
-- approval in hr_page_approvals.
--
-- Safe to apply: all changes are additive (new columns, new tables).
-- Existing 41 approved pages are migrated to 'approved' status.
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- A. Publication status + classification on hr_knowledge_pages
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.hr_knowledge_pages
  ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (publication_status IN (
    'pending',
    'auto_approved',
    'awaiting_review',
    'approved',
    'suspended',
    'quarantined',
    'excluded',
    'archived'
  ));

-- Classification decision persistence.
-- Only trusted application code (service_role) should write these.
-- The publication function verifies them before creating approvals.
ALTER TABLE public.hr_knowledge_pages
  ADD COLUMN classification_category TEXT;

ALTER TABLE public.hr_knowledge_pages
  ADD COLUMN classification_disposition TEXT;

ALTER TABLE public.hr_knowledge_pages
  ADD COLUMN classified_content_hash TEXT;

ALTER TABLE public.hr_knowledge_pages
  ADD COLUMN classified_at TIMESTAMPTZ;

CREATE INDEX idx_hr_pages_publication_status
  ON public.hr_knowledge_pages (publication_status)
  WHERE publication_status NOT IN ('excluded', 'archived');

-- Migrate existing 41 approved pages to 'approved' status.
UPDATE public.hr_knowledge_pages
SET publication_status = 'approved'
WHERE sync_status = 'synced'
  AND NOT is_excluded
  AND EXISTS (
    SELECT 1 FROM public.hr_page_approvals a
    WHERE a.knowledge_page_id = public.hr_knowledge_pages.id
      AND a.approved_content_hash = public.hr_knowledge_pages.content_hash
      AND a.revoked_at IS NULL
  );

UPDATE public.hr_knowledge_pages
SET publication_status = 'excluded'
WHERE is_excluded = true;

UPDATE public.hr_knowledge_pages
SET publication_status = 'archived'
WHERE sync_status = 'revoked';

-- ════════════════════════════════════════════════════════════
-- B. Publication review queue
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.hr_publication_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_page_id UUID NOT NULL REFERENCES public.hr_knowledge_pages(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  review_type TEXT NOT NULL CHECK (review_type IN (
    'new_sensitive_page', 'updated_sensitive_page',
    'salary_band_batch', 'quarantine_review', 'manual_review'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'approved', 'rejected', 'expired', 'superseded'
  )),
  reason TEXT,
  slack_channel_id TEXT,
  slack_message_ts TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE UNIQUE INDEX idx_hr_pub_queue_active_page
  ON public.hr_publication_queue (knowledge_page_id)
  WHERE status IN ('pending', 'sent');

CREATE INDEX idx_hr_pub_queue_status
  ON public.hr_publication_queue (status)
  WHERE status IN ('pending', 'sent');

-- ════════════════════════════════════════════════════════════
-- B2. Notification outbox for durable Slack delivery
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.hr_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Reference: either a publication_queue review or a compensation batch
  reference_type TEXT NOT NULL CHECK (reference_type IN ('policy_review', 'batch_review')),
  reference_id UUID NOT NULL,
  -- Delivery state
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sending', 'delivered', 'failed', 'superseded'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  -- Slack delivery tracking
  slack_channel_id TEXT,
  slack_message_ts TEXT,
  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active notification per reference
CREATE UNIQUE INDEX idx_hr_notif_outbox_active
  ON public.hr_notification_outbox (reference_type, reference_id)
  WHERE status IN ('pending', 'sending');

-- Find deliverable notifications efficiently
CREATE INDEX idx_hr_notif_outbox_pending
  ON public.hr_notification_outbox (next_attempt_at)
  WHERE status = 'pending';

-- ════════════════════════════════════════════════════════════
-- C. Compensation batch manifests
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.hr_compensation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_digest TEXT NOT NULL,
  page_count INTEGER NOT NULL CHECK (page_count > 0),
  excluded_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'approved', 'rejected', 'expired', 'invalidated'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  slack_channel_id TEXT,
  slack_message_ts TEXT
);

CREATE TABLE public.hr_compensation_batch_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.hr_compensation_batches(id) ON DELETE CASCADE,
  knowledge_page_id UUID NOT NULL REFERENCES public.hr_knowledge_pages(id),
  notion_page_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  validation_result TEXT NOT NULL CHECK (validation_result IN (
    'eligible', 'excluded', 'hash_mismatch', 'not_found'
  )),
  CONSTRAINT unique_batch_page UNIQUE (batch_id, knowledge_page_id)
);

CREATE INDEX idx_hr_comp_batch_entries_batch
  ON public.hr_compensation_batch_entries (batch_id);

-- ════════════════════════════════════════════════════════════
-- D. Sync lease with fencing-safe functions
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.hr_sync_leases (
  lease_name TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ,
  fencing_token BIGINT NOT NULL DEFAULT 1
);

-- Acquire: insert or take over expired lease. Monotonic fencing token.
CREATE OR REPLACE FUNCTION public.hr_acquire_sync_lease(
  p_lease_name TEXT,
  p_owner_token TEXT,
  p_duration_seconds INTEGER DEFAULT 300
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fencing_token BIGINT;
  v_capped_duration INTEGER;
BEGIN
  -- Cap duration to prevent unreasonable leases
  v_capped_duration := LEAST(GREATEST(p_duration_seconds, 1), 3600);

  INSERT INTO public.hr_sync_leases (lease_name, owner_token, expires_at, fencing_token)
  VALUES (p_lease_name, p_owner_token, NOW() + make_interval(secs => v_capped_duration), 1)
  ON CONFLICT (lease_name) DO UPDATE
    SET owner_token = p_owner_token,
        acquired_at = NOW(),
        expires_at = NOW() + make_interval(secs => v_capped_duration),
        renewed_at = NULL,
        fencing_token = public.hr_sync_leases.fencing_token + 1
    WHERE public.hr_sync_leases.expires_at < NOW()
  RETURNING fencing_token INTO v_fencing_token;

  RETURN v_fencing_token;
END;
$$;

-- Renew: extend an active lease (owner + fencing must match)
CREATE OR REPLACE FUNCTION public.hr_renew_sync_lease(
  p_lease_name TEXT,
  p_owner_token TEXT,
  p_fencing_token BIGINT,
  p_duration_seconds INTEGER DEFAULT 300
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.hr_sync_leases
  SET expires_at = NOW() + make_interval(secs => LEAST(GREATEST(p_duration_seconds, 1), 3600)),
      renewed_at = NOW()
  WHERE lease_name = p_lease_name
    AND owner_token = p_owner_token
    AND fencing_token = p_fencing_token
    AND expires_at > NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Release: expire lease (preserves row + monotonic fencing token)
CREATE OR REPLACE FUNCTION public.hr_release_sync_lease(
  p_lease_name TEXT,
  p_owner_token TEXT,
  p_fencing_token BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE public.hr_sync_leases
  SET expires_at = NOW() - INTERVAL '1 second',
      owner_token = 'released:' || p_owner_token
  WHERE lease_name = p_lease_name
    AND owner_token = p_owner_token
    AND fencing_token = p_fencing_token;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- E. Privilege hardening — MUST be in the same transaction
-- ════════════════════════════════════════════════════════════

-- Revoke broad table privileges from untrusted roles on NEW tables.
REVOKE ALL ON TABLE public.hr_publication_queue FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.hr_compensation_batches FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.hr_compensation_batch_entries FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.hr_sync_leases FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.hr_notification_outbox FROM anon, authenticated, PUBLIC;

-- Grant only to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_publication_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_compensation_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_compensation_batch_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_sync_leases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hr_notification_outbox TO service_role;

-- Lease functions: service_role only
REVOKE EXECUTE ON FUNCTION public.hr_acquire_sync_lease(TEXT, TEXT, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_acquire_sync_lease(TEXT, TEXT, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_acquire_sync_lease(TEXT, TEXT, INTEGER) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_renew_sync_lease(TEXT, TEXT, BIGINT, INTEGER) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_renew_sync_lease(TEXT, TEXT, BIGINT, INTEGER) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_renew_sync_lease(TEXT, TEXT, BIGINT, INTEGER) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_release_sync_lease(TEXT, TEXT, BIGINT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_release_sync_lease(TEXT, TEXT, BIGINT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_release_sync_lease(TEXT, TEXT, BIGINT) FROM hr_reader;

COMMIT;
