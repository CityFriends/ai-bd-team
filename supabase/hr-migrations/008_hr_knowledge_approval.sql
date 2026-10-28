-- ============================================================
-- Migration 008: Content-Version Publication Approval
--
-- Builds on 006-007. Adds version-based approval for employee-safe
-- Notion knowledge. A page is retrievable only when its current
-- content hash matches the approved hash.
--
-- Synchronization never grants approval. An authorized HR admin
-- must explicitly approve the exact content version. Content changes
-- automatically invalidate approval until reapproved.
--
-- Personalized pages use grants (not approval) — unchanged.
-- HR-restricted pages are admin-only — unchanged.
--
-- Target: HR Supabase project vzrlnshdxrupukzhfllf
-- DO NOT execute against bvgtfadggtgnakrxvuim (BD)
-- ============================================================

-- ============================================================
-- 1. Publication approval table
-- ============================================================

CREATE TABLE IF NOT EXISTS hr_page_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_page_id UUID NOT NULL REFERENCES hr_knowledge_pages(id) ON DELETE RESTRICT,
  approved_content_hash TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  UNIQUE(knowledge_page_id, approved_content_hash)
);

CREATE INDEX idx_approval_page
  ON hr_page_approvals(knowledge_page_id)
  WHERE revoked_at IS NULL;

-- ============================================================
-- 2. Approval RPC — admin-only, version-locked
-- ============================================================

CREATE OR REPLACE FUNCTION hr_approve_knowledge_page(
  p_admin TEXT,
  p_page_ids UUID[],
  p_content_hashes TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_count INT := 0;
  v_i INT;
  v_page_id UUID;
  v_hash TEXT;
  v_current_hash TEXT;
  v_classification TEXT;
  v_is_excluded BOOLEAN;
  v_sync_status TEXT;
  v_sensitivity TEXT;
BEGIN
  -- 1. Verify admin authorization
  IF NOT public.hr_is_authorized_admin(p_admin) THEN
    RETURN jsonb_build_object('error', 'Not authorized', 'approved', 0);
  END IF;

  -- 2. Validate input arrays
  IF p_page_ids IS NULL OR p_content_hashes IS NULL
     OR array_length(p_page_ids, 1) IS NULL
     OR array_length(p_page_ids, 1) != array_length(p_content_hashes, 1) THEN
    RETURN jsonb_build_object('error', 'page_ids and content_hashes must be non-empty arrays of equal length', 'approved', 0);
  END IF;

  IF array_length(p_page_ids, 1) > 100 THEN
    RETURN jsonb_build_object('error', 'Maximum 100 pages per approval batch', 'approved', 0);
  END IF;

  -- 3. Approve each page individually
  FOR v_i IN 1..array_length(p_page_ids, 1) LOOP
    v_page_id := p_page_ids[v_i];
    v_hash := p_content_hashes[v_i];

    -- Fetch current page state
    SELECT content_hash, access_classification, is_excluded, sync_status, sensitivity_watermark
    INTO v_current_hash, v_classification, v_is_excluded, v_sync_status, v_sensitivity
    FROM public.hr_knowledge_pages WHERE id = v_page_id;

    -- Skip: page not found
    IF v_current_hash IS NULL THEN CONTINUE; END IF;

    -- Reject: not employee_safe (personalized uses grants, not approval)
    IF v_classification != 'employee_safe' THEN CONTINUE; END IF;

    -- Reject: excluded, revoked, quarantined, or sensitivity-watermarked
    IF v_is_excluded OR v_sync_status IN ('revoked', 'excluded') OR v_sensitivity IS NOT NULL THEN CONTINUE; END IF;

    -- Reject: stale hash (content changed since admin reviewed)
    IF v_current_hash != v_hash THEN CONTINUE; END IF;

    -- Reject: not yet synced
    IF v_sync_status != 'synced' THEN CONTINUE; END IF;

    -- Revoke prior approval for this page (if any)
    UPDATE public.hr_page_approvals
    SET revoked_at = NOW(), revoked_by = p_admin
    WHERE knowledge_page_id = v_page_id AND revoked_at IS NULL;

    -- Create new approval for the current content version
    INSERT INTO public.hr_page_approvals (knowledge_page_id, approved_content_hash, approved_by)
    VALUES (v_page_id, v_hash, p_admin)
    ON CONFLICT (knowledge_page_id, approved_content_hash) DO UPDATE
      SET revoked_at = NULL, revoked_by = NULL, approved_at = NOW(), approved_by = p_admin;

    -- Audit
    INSERT INTO public.hr_audit_events (
      event_type, actor_type, actor_id, target_type, target_id,
      action, outcome, metadata
    ) VALUES (
      'PAGE_APPROVAL', 'human', p_admin, 'knowledge_page', v_page_id::text,
      'approve_knowledge_page', 'success',
      jsonb_build_object('content_hash', v_hash)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('error', NULL, 'approved', v_count);
END; $fn$;

-- ============================================================
-- 3. Revocation RPC — admin-only
-- ============================================================

CREATE OR REPLACE FUNCTION hr_revoke_knowledge_approval(
  p_admin TEXT,
  p_page_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.hr_is_authorized_admin(p_admin) THEN
    RETURN jsonb_build_object('error', 'Not authorized');
  END IF;

  UPDATE public.hr_page_approvals
  SET revoked_at = NOW(), revoked_by = p_admin
  WHERE knowledge_page_id = p_page_id AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'No active approval found');
  END IF;

  INSERT INTO public.hr_audit_events (
    event_type, actor_type, actor_id, target_type, target_id,
    action, outcome
  ) VALUES (
    'PAGE_APPROVAL_REVOKED', 'human', p_admin, 'knowledge_page', p_page_id::text,
    'revoke_knowledge_approval', 'success'
  );

  RETURN jsonb_build_object('error', NULL, 'revoked', true);
END; $fn$;

-- ============================================================
-- 4. Grants and RLS
-- ============================================================

REVOKE EXECUTE ON FUNCTION hr_approve_knowledge_page(TEXT, UUID[], TEXT[]) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_approve_knowledge_page(TEXT, UUID[], TEXT[]) TO service_role;
REVOKE EXECUTE ON FUNCTION hr_approve_knowledge_page(TEXT, UUID[], TEXT[]) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION hr_revoke_knowledge_approval(TEXT, UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_revoke_knowledge_approval(TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION hr_revoke_knowledge_approval(TEXT, UUID) FROM hr_reader;

ALTER TABLE hr_page_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY svc_approvals ON hr_page_approvals FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deny_anon_approvals ON hr_page_approvals FOR ALL TO anon USING (false);
CREATE POLICY deny_auth_approvals ON hr_page_approvals FOR ALL TO authenticated USING (false);
