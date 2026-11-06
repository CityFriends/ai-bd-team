-- ============================================================
-- Migration 012: Publication Functions and Security Hardening
-- ============================================================
--
-- Implements:
--   A. Lease-verified routine page publication
--   B. Sensitive page suspension
--   C. Admin-authorized compensation batch approval
--   D. Privilege hardening on existing HR tables
--
-- Security model:
--   - All SECURITY DEFINER functions have REVOKE FROM PUBLIC.
--   - Publication functions verify the sync lease fencing token.
--   - Batch approval verifies hr_is_authorized_admin().
--   - Hash reversion handled via ON CONFLICT upsert.
--   - Classification columns protected by table-level REVOKE.
--
-- Depends on: Migration 011
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- A. Lease-verified routine page publication
-- ════════════════════════════════════════════════════════════

-- Sync-worker path: REQUIRES valid lease credentials. No defaults.
CREATE OR REPLACE FUNCTION public.hr_publish_routine_page(
  p_page_id UUID,
  p_content_hash TEXT,
  p_lease_name TEXT,
  p_owner_token TEXT,
  p_fencing_token BIGINT,
  p_approved_by TEXT DEFAULT 'system:auto_publish'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page RECORD;
  v_lease RECORD;
BEGIN
  -- 0. Verify sync lease (MANDATORY for sync-worker publication)
  IF p_lease_name IS NULL OR p_owner_token IS NULL OR p_fencing_token IS NULL THEN
    RETURN 'lease_credentials_required';
  END IF;

  SELECT lease_name, owner_token, fencing_token, expires_at
  INTO v_lease
  FROM public.hr_sync_leases
  WHERE lease_name = p_lease_name
  FOR UPDATE;

  IF v_lease IS NULL THEN RETURN 'lease_not_found'; END IF;
  IF v_lease.owner_token != p_owner_token THEN RETURN 'lease_owner_mismatch'; END IF;
  IF v_lease.fencing_token != p_fencing_token THEN RETURN 'lease_fencing_mismatch'; END IF;
  IF v_lease.expires_at < NOW() THEN RETURN 'lease_expired'; END IF;

  -- 1. Lock and fetch the page
  SELECT id, content_hash, sync_status, is_excluded, publication_status,
         classification_category, classification_disposition, classified_content_hash,
         access_classification
  INTO v_page
  FROM public.hr_knowledge_pages
  WHERE id = p_page_id
  FOR UPDATE;

  IF v_page IS NULL THEN RETURN 'page_not_found'; END IF;

  -- 2. Verify content hash matches
  IF v_page.content_hash IS NULL OR v_page.content_hash != p_content_hash THEN
    RETURN 'content_hash_mismatch';
  END IF;

  -- 3. Verify page is synced and active
  IF v_page.sync_status != 'synced' THEN RETURN 'not_synced'; END IF;
  IF v_page.is_excluded THEN RETURN 'excluded'; END IF;

  -- 4. Verify persisted classification permits auto-publish
  IF v_page.classification_disposition IS NULL OR v_page.classification_disposition != 'auto_publish' THEN
    RETURN 'classification_not_auto_publish';
  END IF;
  IF v_page.classification_category IS NULL OR v_page.classification_category != 'routine_employee_safe' THEN
    RETURN 'classification_not_routine';
  END IF;
  IF v_page.classified_content_hash IS NULL OR v_page.classified_content_hash != p_content_hash THEN
    RETURN 'classification_stale';
  END IF;

  -- 5. Verify access classification
  IF v_page.access_classification != 'employee_safe' THEN
    RETURN 'not_employee_safe';
  END IF;

  -- 6. Revoke prior approvals, then upsert for exact hash
  --    ON CONFLICT handles the case where content reverts to a
  --    previously approved hash (UNIQUE constraint on page+hash).
  UPDATE public.hr_page_approvals
  SET revoked_at = NOW(), revoked_by = p_approved_by
  WHERE knowledge_page_id = p_page_id
    AND revoked_at IS NULL
    AND approved_content_hash != p_content_hash;

  INSERT INTO public.hr_page_approvals
    (knowledge_page_id, approved_content_hash, approved_by, approved_at)
  VALUES (p_page_id, p_content_hash, p_approved_by, NOW())
  ON CONFLICT (knowledge_page_id, approved_content_hash)
  DO UPDATE SET revoked_at = NULL, revoked_by = NULL,
               approved_by = p_approved_by, approved_at = NOW();

  -- 7. Update publication status
  UPDATE public.hr_knowledge_pages
  SET publication_status = 'auto_approved'
  WHERE id = p_page_id;

  -- 8. Audit event
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, metadata)
  VALUES ('PAGE_AUTO_PUBLISHED', 'system', p_approved_by, 'knowledge_page', p_page_id::text,
          'auto_publish', 'success',
          jsonb_build_object('content_hash', p_content_hash, 'category', v_page.classification_category));

  RETURN 'published';
END;
$$;

-- ════════════════════════════════════════════════════════════
-- B. Lease-verified sensitive page suspension
-- ════════════════════════════════════════════════════════════

-- Sync-worker path: REQUIRES valid lease credentials.
CREATE OR REPLACE FUNCTION public.hr_suspend_changed_page(
  p_page_id UUID,
  p_new_content_hash TEXT,
  p_lease_name TEXT,
  p_owner_token TEXT,
  p_fencing_token BIGINT,
  p_reason TEXT DEFAULT 'content_changed'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page RECORD;
  v_lease RECORD;
BEGIN
  -- 0. Verify sync lease (MANDATORY)
  IF p_lease_name IS NULL OR p_owner_token IS NULL OR p_fencing_token IS NULL THEN
    RETURN 'lease_credentials_required';
  END IF;

  SELECT lease_name, owner_token, fencing_token, expires_at
  INTO v_lease
  FROM public.hr_sync_leases
  WHERE lease_name = p_lease_name
  FOR UPDATE;

  IF v_lease IS NULL THEN RETURN 'lease_not_found'; END IF;
  IF v_lease.owner_token != p_owner_token THEN RETURN 'lease_owner_mismatch'; END IF;
  IF v_lease.fencing_token != p_fencing_token THEN RETURN 'lease_fencing_mismatch'; END IF;
  IF v_lease.expires_at < NOW() THEN RETURN 'lease_expired'; END IF;

  SELECT id, publication_status
  INTO v_page
  FROM public.hr_knowledge_pages
  WHERE id = p_page_id
  FOR UPDATE;

  IF v_page IS NULL THEN RETURN 'page_not_found'; END IF;
  IF v_page.publication_status = 'suspended' THEN RETURN 'already_suspended'; END IF;
  IF v_page.publication_status IN ('excluded', 'archived') THEN RETURN 'terminal_state'; END IF;

  -- Revoke existing approvals
  UPDATE public.hr_page_approvals
  SET revoked_at = NOW(), revoked_by = 'system:suspension'
  WHERE knowledge_page_id = p_page_id AND revoked_at IS NULL;

  -- Supersede pending review requests
  UPDATE public.hr_publication_queue
  SET status = 'superseded', resolved_at = NOW(), resolved_by = 'system:content_changed'
  WHERE knowledge_page_id = p_page_id AND status IN ('pending', 'sent');

  -- Suspend the page
  UPDATE public.hr_knowledge_pages
  SET publication_status = 'suspended'
  WHERE id = p_page_id;

  -- Audit
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, metadata)
  VALUES ('PAGE_SUSPENDED', 'system', 'system:sync', 'knowledge_page', p_page_id::text,
          'suspend', 'success',
          jsonb_build_object('reason', p_reason, 'new_hash', p_new_content_hash));

  RETURN 'suspended';
END;
$$;

-- ════════════════════════════════════════════════════════════
-- C. Admin-authorized compensation batch approval
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hr_approve_compensation_batch(
  p_batch_id UUID,
  p_manifest_digest TEXT,
  p_approved_by TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_entry RECORD;
  v_page RECORD;
  v_entry_count INT := 0;
  v_recomputed_digest TEXT;
  v_canonical TEXT;
BEGIN
  -- 0. Verify admin authorization
  IF NOT public.hr_is_authorized_admin(p_approved_by) THEN
    RETURN 'not_authorized';
  END IF;

  -- 1. Lock and verify batch
  SELECT id, manifest_digest, status, page_count
  INTO v_batch
  FROM public.hr_compensation_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF v_batch IS NULL THEN RETURN 'batch_not_found'; END IF;
  IF v_batch.status NOT IN ('pending', 'sent') THEN RETURN 'batch_not_pending'; END IF;

  -- 2. Verify submitted digest matches stored
  IF v_batch.manifest_digest != p_manifest_digest THEN
    RETURN 'digest_mismatch';
  END IF;

  -- 3. Recompute digest from actual entries using canonical format:
  --    Entries sorted by knowledge_page_id, each as "pageId:contentHash",
  --    joined by newline. SHA-256 of UTF-8 bytes, hex-encoded lowercase.
  --    This format is identical to TypeScript's computeManifestDigest().
  SELECT string_agg(e.knowledge_page_id::text || ':' || e.content_hash, E'\n' ORDER BY e.knowledge_page_id)
  INTO v_canonical
  FROM public.hr_compensation_batch_entries e
  WHERE e.batch_id = p_batch_id;

  IF v_canonical IS NULL THEN
    UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
    RETURN 'no_entries';
  END IF;

  v_recomputed_digest := encode(extensions.digest(v_canonical::bytea, 'sha256'), 'hex');

  IF v_recomputed_digest != v_batch.manifest_digest THEN
    UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
    RETURN 'manifest_entries_tampered';
  END IF;

  -- 4. Verify every entry page is still valid
  FOR v_entry IN
    SELECT e.knowledge_page_id, e.content_hash
    FROM public.hr_compensation_batch_entries e
    WHERE e.batch_id = p_batch_id
    ORDER BY e.knowledge_page_id
  LOOP
    v_entry_count := v_entry_count + 1;

    SELECT id, content_hash, sync_status, is_excluded, access_classification, publication_status
    INTO v_page
    FROM public.hr_knowledge_pages
    WHERE id = v_entry.knowledge_page_id
    FOR UPDATE;

    IF v_page IS NULL THEN
      UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
      RETURN 'entry_page_not_found:' || v_entry.knowledge_page_id;
    END IF;

    IF v_page.content_hash != v_entry.content_hash THEN
      UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
      RETURN 'entry_hash_mismatch:' || v_entry.knowledge_page_id;
    END IF;

    IF v_page.sync_status != 'synced' OR v_page.is_excluded THEN
      UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
      RETURN 'entry_not_eligible:' || v_entry.knowledge_page_id;
    END IF;

    IF v_page.access_classification != 'employee_safe' THEN
      UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
      RETURN 'entry_not_employee_safe:' || v_entry.knowledge_page_id;
    END IF;

    IF v_page.publication_status IN ('excluded', 'archived', 'quarantined') THEN
      UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
      RETURN 'entry_ineligible_status:' || v_entry.knowledge_page_id;
    END IF;
  END LOOP;

  IF v_entry_count != v_batch.page_count THEN
    UPDATE public.hr_compensation_batches SET status = 'invalidated', resolved_at = NOW() WHERE id = p_batch_id;
    RETURN 'entry_count_mismatch';
  END IF;

  -- 5. All entries valid — approve each page
  FOR v_entry IN
    SELECT e.knowledge_page_id, e.content_hash
    FROM public.hr_compensation_batch_entries e
    WHERE e.batch_id = p_batch_id
  LOOP
    -- Revoke prior approvals for different hashes
    UPDATE public.hr_page_approvals
    SET revoked_at = NOW(), revoked_by = p_approved_by
    WHERE knowledge_page_id = v_entry.knowledge_page_id
      AND revoked_at IS NULL
      AND approved_content_hash != v_entry.content_hash;

    -- Upsert approval (handles hash reversion safely)
    INSERT INTO public.hr_page_approvals
      (knowledge_page_id, approved_content_hash, approved_by, approved_at)
    VALUES (v_entry.knowledge_page_id, v_entry.content_hash, p_approved_by, NOW())
    ON CONFLICT (knowledge_page_id, approved_content_hash)
    DO UPDATE SET revoked_at = NULL, revoked_by = NULL,
                 approved_by = p_approved_by, approved_at = NOW();

    UPDATE public.hr_knowledge_pages
    SET publication_status = 'approved'
    WHERE id = v_entry.knowledge_page_id;
  END LOOP;

  -- 6. Mark batch approved
  UPDATE public.hr_compensation_batches
  SET status = 'approved', resolved_at = NOW(), resolved_by = p_approved_by
  WHERE id = p_batch_id;

  -- 7. Audit
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, metadata)
  VALUES ('BATCH_APPROVED', 'human', p_approved_by, 'compensation_batch', p_batch_id::text,
          'approve_batch', 'success',
          jsonb_build_object('page_count', v_entry_count, 'manifest_digest', p_manifest_digest));

  RETURN 'approved';
END;
$$;

-- ════════════════════════════════════════════════════════════
-- D. Atomic sensitive policy owner approval
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hr_approve_sensitive_policy(
  p_review_id UUID,
  p_approved_by TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review RECORD;
  v_page RECORD;
BEGIN
  -- 1. Verify admin authorization
  IF NOT public.hr_is_authorized_admin(p_approved_by) THEN
    RETURN 'not_authorized';
  END IF;

  -- 2. Lock review request
  SELECT id, knowledge_page_id, content_hash, status, review_type
  INTO v_review
  FROM public.hr_publication_queue
  WHERE id = p_review_id
  FOR UPDATE;

  IF v_review IS NULL THEN RETURN 'review_not_found'; END IF;
  IF v_review.status NOT IN ('pending', 'sent') THEN RETURN 'review_not_actionable'; END IF;
  IF v_review.review_type NOT IN ('new_sensitive_page', 'updated_sensitive_page', 'quarantine_review', 'manual_review') THEN
    RETURN 'wrong_review_type';
  END IF;

  -- 3. Lock page and verify eligibility
  SELECT id, content_hash, sync_status, is_excluded, access_classification, publication_status
  INTO v_page
  FROM public.hr_knowledge_pages
  WHERE id = v_review.knowledge_page_id
  FOR UPDATE;

  IF v_page IS NULL THEN RETURN 'page_not_found'; END IF;
  IF v_page.content_hash != v_review.content_hash THEN
    -- Content changed since review — supersede this request
    UPDATE public.hr_publication_queue
    SET status = 'superseded', resolved_at = NOW(), resolved_by = 'system:hash_changed'
    WHERE id = p_review_id;
    RETURN 'content_changed';
  END IF;
  IF v_page.sync_status != 'synced' THEN RETURN 'not_synced'; END IF;
  IF v_page.is_excluded THEN RETURN 'page_excluded'; END IF;
  IF v_page.access_classification != 'employee_safe' THEN RETURN 'not_employee_safe'; END IF;
  IF v_page.publication_status IN ('excluded', 'archived') THEN RETURN 'terminal_state'; END IF;

  -- 3b. Supersede any other active reviews for this page (this one wins)
  UPDATE public.hr_publication_queue
  SET status = 'superseded', resolved_at = NOW(), resolved_by = 'system:concurrent_approval'
  WHERE knowledge_page_id = v_review.knowledge_page_id
    AND id != p_review_id
    AND status IN ('pending', 'sent');

  -- 4. Revoke prior approvals for different hashes + upsert exact hash
  UPDATE public.hr_page_approvals
  SET revoked_at = NOW(), revoked_by = p_approved_by
  WHERE knowledge_page_id = v_review.knowledge_page_id
    AND revoked_at IS NULL
    AND approved_content_hash != v_review.content_hash;

  INSERT INTO public.hr_page_approvals
    (knowledge_page_id, approved_content_hash, approved_by, approved_at)
  VALUES (v_review.knowledge_page_id, v_review.content_hash, p_approved_by, NOW())
  ON CONFLICT (knowledge_page_id, approved_content_hash)
  DO UPDATE SET revoked_at = NULL, revoked_by = NULL,
               approved_by = p_approved_by, approved_at = NOW();

  -- 5. Update page status
  UPDATE public.hr_knowledge_pages
  SET publication_status = 'approved'
  WHERE id = v_review.knowledge_page_id;

  -- 6. Resolve review
  UPDATE public.hr_publication_queue
  SET status = 'approved', resolved_at = NOW(), resolved_by = p_approved_by
  WHERE id = p_review_id;

  -- 7. Audit
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, metadata)
  VALUES ('POLICY_APPROVED', 'human', p_approved_by, 'knowledge_page',
          v_review.knowledge_page_id::text, 'approve_policy', 'success',
          jsonb_build_object('review_id', p_review_id, 'content_hash', v_review.content_hash));

  RETURN 'approved';
END;
$$;

-- ════════════════════════════════════════════════════════════
-- E. Atomic sensitive policy owner rejection
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hr_reject_sensitive_policy(
  p_review_id UUID,
  p_rejected_by TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review RECORD;
  v_page RECORD;
BEGIN
  -- 1. Verify admin authorization
  IF NOT public.hr_is_authorized_admin(p_rejected_by) THEN
    RETURN 'not_authorized';
  END IF;

  -- 2. Lock review
  SELECT id, knowledge_page_id, content_hash, status, review_type, created_at
  INTO v_review
  FROM public.hr_publication_queue
  WHERE id = p_review_id
  FOR UPDATE;

  IF v_review IS NULL THEN RETURN 'review_not_found'; END IF;
  IF v_review.status NOT IN ('pending', 'sent') THEN RETURN 'review_not_actionable'; END IF;

  -- 3. Lock page
  SELECT id, publication_status, content_hash
  INTO v_page
  FROM public.hr_knowledge_pages
  WHERE id = v_review.knowledge_page_id
  FOR UPDATE;

  IF v_page IS NULL THEN RETURN 'page_not_found'; END IF;

  -- 4. Verify this review's hash matches the current page hash.
  --    A stale review (for an older content version) must not change
  --    the publication state established by a newer decision.
  IF v_page.content_hash != v_review.content_hash THEN
    -- Review is stale — supersede it without changing publication state
    UPDATE public.hr_publication_queue
    SET status = 'superseded', resolved_at = NOW(), resolved_by = 'system:stale_hash'
    WHERE id = p_review_id;
    RETURN 'review_stale';
  END IF;

  -- 5. Verify this review is the current active review for this page.
  --    If there is a newer active review, this one is outdated.
  IF EXISTS (
    SELECT 1 FROM public.hr_publication_queue
    WHERE knowledge_page_id = v_review.knowledge_page_id
      AND id != p_review_id
      AND status IN ('pending', 'sent')
      AND created_at > v_review.created_at
  ) THEN
    UPDATE public.hr_publication_queue
    SET status = 'superseded', resolved_at = NOW(), resolved_by = 'system:newer_review_exists'
    WHERE id = p_review_id;
    RETURN 'review_superseded';
  END IF;

  -- 6. Determine correct post-rejection status:
  --    - If page was suspended (previously approved, content changed) → stay suspended
  --    - If page was never published → quarantine
  --    - If page was already approved (by a concurrent action) → do not override
  IF v_page.publication_status = 'approved' OR v_page.publication_status = 'auto_approved' THEN
    -- Page was approved by a concurrent action — do not quarantine
    UPDATE public.hr_publication_queue
    SET status = 'superseded', resolved_at = NOW(), resolved_by = 'system:already_approved'
    WHERE id = p_review_id;
    RETURN 'already_approved';
  ELSIF v_page.publication_status = 'suspended' THEN
    NULL; -- Keep suspended
  ELSE
    UPDATE public.hr_knowledge_pages
    SET publication_status = 'quarantined'
    WHERE id = v_review.knowledge_page_id;
  END IF;

  -- 7. Resolve review
  UPDATE public.hr_publication_queue
  SET status = 'rejected', resolved_at = NOW(), resolved_by = p_rejected_by
  WHERE id = p_review_id;

  -- 6. Audit
  INSERT INTO public.hr_audit_events
    (event_type, actor_type, actor_id, target_type, target_id, action, outcome, metadata)
  VALUES ('POLICY_REJECTED', 'human', p_rejected_by, 'knowledge_page',
          v_review.knowledge_page_id::text, 'reject_policy', 'success',
          jsonb_build_object('review_id', p_review_id, 'prior_status', v_page.publication_status));

  RETURN 'rejected';
END;
$$;

-- ════════════════════════════════════════════════════════════
-- F. Batch entry immutability trigger
-- ════════════════════════════════════════════════════════════

-- Prevent modification of batch entries once the batch is no longer in 'pending' state.
-- Uses FOR UPDATE on the parent batch row to acquire a conflicting lock, preventing
-- concurrent finalization from changing the status while this trigger checks it.
-- Lock order: parent batch → entry row (trigger fires per entry row).
CREATE OR REPLACE FUNCTION public.hr_enforce_batch_entry_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_batch_status TEXT;
  v_batch_id UUID;
BEGIN
  -- Determine affected parent batch
  IF TG_OP = 'DELETE' THEN
    v_batch_id := OLD.batch_id;
  ELSE
    v_batch_id := NEW.batch_id;
  END IF;

  -- Acquire FOR UPDATE lock on parent batch row.
  -- This conflicts with the finalization UPDATE, ensuring serialization.
  SELECT status INTO v_batch_status
  FROM public.hr_compensation_batches
  WHERE id = v_batch_id
  FOR UPDATE;

  -- Allow mutations only during building phase
  IF v_batch_status IS NOT NULL AND v_batch_status != 'pending' THEN
    RAISE EXCEPTION 'Cannot modify batch entries: batch status is %', v_batch_status;
  END IF;

  -- For UPDATE changing batch_id, also lock the target batch
  IF TG_OP = 'UPDATE' AND NEW.batch_id != OLD.batch_id THEN
    DECLARE v_other_status TEXT;
    BEGIN
      -- Lock in deterministic order to avoid deadlocks
      IF NEW.batch_id > OLD.batch_id THEN
        SELECT status INTO v_other_status FROM public.hr_compensation_batches WHERE id = NEW.batch_id FOR UPDATE;
      ELSE
        -- Already locked OLD.batch_id above; lock NEW.batch_id
        SELECT status INTO v_other_status FROM public.hr_compensation_batches WHERE id = NEW.batch_id FOR UPDATE;
      END IF;
      IF v_other_status IS NOT NULL AND v_other_status != 'pending' THEN
        RAISE EXCEPTION 'Cannot move entry to batch: target batch status is %', v_other_status;
      END IF;
    END;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_batch_entry_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.hr_compensation_batch_entries
  FOR EACH ROW EXECUTE FUNCTION public.hr_enforce_batch_entry_immutability();

-- Prevent modification of batch manifest_digest and page_count after finalization.
CREATE OR REPLACE FUNCTION public.hr_enforce_batch_manifest_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow status transitions (pending→sent→approved/rejected) but protect manifest identity
  IF OLD.status != 'pending' THEN
    IF NEW.manifest_digest != OLD.manifest_digest THEN
      RAISE EXCEPTION 'Cannot modify manifest_digest after finalization';
    END IF;
    IF NEW.page_count != OLD.page_count THEN
      RAISE EXCEPTION 'Cannot modify page_count after finalization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_batch_manifest_immutability
  BEFORE UPDATE ON public.hr_compensation_batches
  FOR EACH ROW EXECUTE FUNCTION public.hr_enforce_batch_manifest_immutability();

-- ════════════════════════════════════════════════════════════
-- G. Privilege hardening
-- ════════════════════════════════════════════════════════════

-- Publication functions: service_role only
REVOKE EXECUTE ON FUNCTION public.hr_publish_routine_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_publish_routine_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_publish_routine_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_suspend_changed_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_suspend_changed_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_suspend_changed_page(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_approve_compensation_batch(UUID, TEXT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_approve_compensation_batch(UUID, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_approve_compensation_batch(UUID, TEXT, TEXT) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_approve_sensitive_policy(UUID, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_approve_sensitive_policy(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_approve_sensitive_policy(UUID, TEXT) FROM hr_reader;

REVOKE EXECUTE ON FUNCTION public.hr_reject_sensitive_policy(UUID, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_reject_sensitive_policy(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.hr_reject_sensitive_policy(UUID, TEXT) FROM hr_reader;

-- Harden existing HR tables: revoke ALL direct access from anon/authenticated.
-- RLS policies already deny access (qual = false), but revoking grants provides
-- defense-in-depth. service_role bypasses RLS; hr_reader uses RPCs only.
REVOKE ALL ON TABLE public.hr_knowledge_pages FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_knowledge_chunks FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_page_approvals FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_audit_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_approved_roots FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_notion_connections FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_knowledge_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_sensitivity_watermarks FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_sync_checkpoints FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_employees FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_personal_page_grants FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_supervisor_assignments FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_user_roles FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_bootstrap_admins FROM anon, authenticated;
REVOKE ALL ON TABLE public.hr_notification_outbox FROM anon, authenticated;

COMMIT;
