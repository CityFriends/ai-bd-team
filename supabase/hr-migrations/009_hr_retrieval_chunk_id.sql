-- ============================================================
-- Migration 009: Versioned Retrieval with Chunk ID
--
-- Introduces hr_retrieve_knowledge_v2 which returns the stable
-- knowledge chunk UUID alongside all existing columns.
--
-- The original hr_retrieve_knowledge(TEXT, TEXT, INT, INT)
-- is preserved unchanged — no DROP, no ALTER.
--
-- The only functional difference is the additional chunk_id UUID
-- column in the return shape. All authorization, identity
-- verification, audit, classification, approval, and scope
-- enforcement logic is identical to the original in migration 007.
--
-- DEPLOYMENT ORDER:
--   1. Apply this migration to the HR Supabase project.
--   2. Verify hr_retrieve_knowledge_v2 exists and is callable
--      by hr_reader.
--   3. Deploy application code that calls _v2.
--
-- The original function remains callable until all callers have
-- migrated to _v2.
--
-- Target: HR Supabase project vzrlnshdxrupukzhfllf
-- DO NOT execute against bvgtfadggtgnakrxvuim (BD)
-- ============================================================

CREATE OR REPLACE FUNCTION hr_retrieve_knowledge_v2(
  p_identity_token TEXT,
  p_query TEXT,
  p_freshness_minutes INT DEFAULT 30,
  p_limit INT DEFAULT 5
)
RETURNS TABLE(
  content_text TEXT, heading_path TEXT[], first_block_id TEXT,
  title TEXT, page_url TEXT, notion_page_id TEXT,
  last_verified_at TIMESTAMPTZ, access_classification TEXT,
  chunk_id UUID
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_secret TEXT;
  v_parts TEXT[];
  v_payload_b64 TEXT;
  v_sig_provided TEXT;
  v_sig_expected TEXT;
  v_payload JSONB;
  v_slack_id TEXT;
  v_exp BIGINT;
  v_iat BIGINT;
  v_now BIGINT;
  v_employee_id UUID;
  v_is_active BOOLEAN := false;
  v_is_admin BOOLEAN;
  v_access_basis TEXT;
  v_correlation_id TEXT;
  v_personalized_page RECORD;
BEGIN
  -- 1. Get signing secret (only function owner can read this table)
  SELECT secret_value INTO v_secret
  FROM public.hr_signing_secrets
  WHERE secret_name = 'identity_hmac' AND is_active = true
  LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;

  -- 2. Parse token: base64_payload.hex_signature
  v_parts := string_to_array(p_identity_token, '.');
  IF v_parts IS NULL OR array_length(v_parts, 1) != 2 THEN RETURN; END IF;
  v_payload_b64 := v_parts[1];
  v_sig_provided := v_parts[2];
  IF v_payload_b64 IS NULL OR v_sig_provided IS NULL THEN RETURN; END IF;

  -- 3. Verify HMAC-SHA256 signature
  --    extensions.hmac: pgcrypto on Supabase installs into the extensions schema.
  --    Schema-qualified to prevent pg_temp shadowing and match Supabase layout.
  BEGIN
    v_sig_expected := encode(
      extensions.hmac(decode(v_payload_b64, 'base64'), v_secret::bytea, 'sha256'),
      'hex'
    );
  EXCEPTION WHEN OTHERS THEN RETURN; END;

  IF v_sig_provided != v_sig_expected THEN RETURN; END IF;

  -- 4. Decode payload
  BEGIN
    v_payload := convert_from(decode(v_payload_b64, 'base64'), 'UTF8')::jsonb;
  EXCEPTION WHEN OTHERS THEN RETURN; END;

  v_slack_id := v_payload->>'sub';
  v_exp := (v_payload->>'exp')::bigint;
  v_iat := (v_payload->>'iat')::bigint;
  v_now := extract(epoch FROM now())::bigint;

  IF v_slack_id IS NULL OR v_exp IS NULL OR v_iat IS NULL THEN RETURN; END IF;

  -- 5. Validate: audience and purpose
  IF v_payload->>'aud' != 'hr_retrieve' THEN RETURN; END IF;

  -- 6. Validate: expiration (30s window)
  IF v_exp < v_now THEN RETURN; END IF;

  -- 7. Validate: not too old (60s max age)
  IF v_iat < v_now - 60 THEN RETURN; END IF;

  -- 8. Resolve identity
  SELECT id INTO v_employee_id
  FROM public.hr_employees
  WHERE slack_user_id = v_slack_id AND employment_status = 'active';
  v_is_active := (v_employee_id IS NOT NULL);
  v_is_admin := public.hr_is_authorized_admin(v_slack_id);

  IF NOT v_is_active AND NOT v_is_admin THEN RETURN; END IF;

  -- Determine access basis for audit
  IF v_is_admin THEN v_access_basis := 'admin';
  ELSIF v_is_active THEN v_access_basis := 'employee';
  END IF;

  -- Generate a correlation ID for this retrieval batch
  v_correlation_id := gen_random_uuid()::text;

  -- 9. Materialize results into temp table for audit-before-return
  CREATE TEMP TABLE IF NOT EXISTS _hr_retrieval_results_v2 (
    content_text TEXT, heading_path TEXT[], first_block_id TEXT,
    title TEXT, page_url TEXT, notion_page_id TEXT,
    last_verified_at TIMESTAMPTZ, access_classification TEXT,
    chunk_id UUID,
    page_id UUID
  ) ON COMMIT DROP;
  TRUNCATE _hr_retrieval_results_v2;

  INSERT INTO _hr_retrieval_results_v2
  SELECT c.content_text, c.heading_path, c.first_block_id,
         p.title, p.page_url, p.notion_page_id,
         p.last_verified_at, p.access_classification,
         c.id AS chunk_id,
         p.id
  FROM public.hr_knowledge_chunks c
  JOIN public.hr_knowledge_pages p ON c.page_id = p.id
  JOIN public.hr_approved_roots ar ON p.approved_root_id = ar.id
  JOIN public.hr_notion_connections conn ON p.connection_id = conn.id
  LEFT JOIN public.hr_knowledge_sources s ON p.source_id = s.id
  WHERE p.sync_status = 'synced' AND NOT p.is_excluded
    AND p.last_verified_at > NOW() - make_interval(mins => p_freshness_minutes)
    AND conn.is_active AND ar.is_active
    AND ar.connection_id = conn.id
    AND p.access_classification = ar.access_classification
    AND ((conn.scope = 'employee'   AND p.access_classification = 'employee_safe')
      OR (conn.scope = 'onboarding' AND p.access_classification = 'personalized')
      OR (conn.scope = 'admin'      AND p.access_classification = 'hr_restricted'))
    AND (s.id IS NULL OR s.approval_status = 'approved')
    AND (s.id IS NULL OR s.is_authoritative = false OR s.source_type = 'handbook_pdf')
    -- Employee-safe pages require version-locked publication approval (migration 008).
    -- The content hash must match the approved hash, and the approval must not be revoked.
    -- Personalized and hr_restricted pages use grants/admin access, not approval.
    AND (
      p.access_classification != 'employee_safe'
      OR EXISTS(SELECT 1 FROM public.hr_page_approvals a
        WHERE a.knowledge_page_id = p.id
          AND a.approved_content_hash = p.content_hash
          AND a.revoked_at IS NULL)
    )
    AND c.content_text ILIKE '%' || p_query || '%'
    AND (
      v_is_admin
      OR p.access_classification = 'employee_safe'
      OR (p.access_classification = 'personalized' AND v_is_active
          AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
            JOIN public.hr_employees ge ON g.employee_id = ge.id
            WHERE g.knowledge_page_id = p.id AND g.revoked_at IS NULL
              AND ge.employment_status = 'active' AND g.employee_id = v_employee_id))
      OR (p.access_classification = 'personalized' AND v_is_active
          AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
            JOIN public.hr_employees ge ON g.employee_id = ge.id
            JOIN public.hr_supervisor_assignments sa ON sa.employee_id = g.employee_id
            WHERE g.knowledge_page_id = p.id AND g.revoked_at IS NULL
              AND ge.employment_status = 'active'
              AND sa.supervisor_id = v_employee_id AND sa.revoked_at IS NULL))
    )
  ORDER BY p.last_verified_at DESC LIMIT p_limit;

  -- 10. Audit every personalized page BEFORE returning content.
  --     If audit fails, personalized content is not returned.
  FOR v_personalized_page IN
    SELECT DISTINCT r.page_id, r.notion_page_id AS np_id
    FROM _hr_retrieval_results_v2 r
    WHERE r.access_classification = 'personalized'
  LOOP
    -- Determine specific access basis for supervisor vs direct grant
    IF v_is_admin THEN
      v_access_basis := 'admin';
    ELSIF EXISTS(
      SELECT 1 FROM public.hr_supervisor_assignments sa
      WHERE sa.supervisor_id = v_employee_id AND sa.revoked_at IS NULL
        AND EXISTS(SELECT 1 FROM public.hr_personal_page_grants g
          WHERE g.knowledge_page_id = v_personalized_page.page_id
            AND g.employee_id = sa.employee_id AND g.revoked_at IS NULL)
    ) THEN
      v_access_basis := 'supervisor';
    ELSE
      v_access_basis := 'direct_grant';
    END IF;

    BEGIN
      INSERT INTO public.hr_audit_events (
        event_type, actor_type, actor_id, target_type, target_id,
        action, outcome, correlation_id, metadata
      ) VALUES (
        'PERSONALIZED_RETRIEVAL', 'human', v_slack_id,
        'knowledge_page', v_personalized_page.page_id::text,
        'retrieve_personalized', 'success', v_correlation_id,
        jsonb_build_object('access_basis', v_access_basis,
                           'notion_page_id', v_personalized_page.np_id)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Audit write failed: remove personalized results to prevent disclosure
      DELETE FROM _hr_retrieval_results_v2 rr
      WHERE rr.access_classification = 'personalized';
      -- Return only non-personalized (employee_safe) results
      RETURN QUERY
      SELECT r.content_text, r.heading_path, r.first_block_id,
             r.title, r.page_url, r.notion_page_id,
             r.last_verified_at, r.access_classification,
             r.chunk_id
      FROM _hr_retrieval_results_v2 r;
      RETURN;
    END;
  END LOOP;

  -- 11. Return all results (audit succeeded for any personalized rows)
  RETURN QUERY
  SELECT r.content_text, r.heading_path, r.first_block_id,
         r.title, r.page_url, r.notion_page_id,
         r.last_verified_at, r.access_classification,
         r.chunk_id
  FROM _hr_retrieval_results_v2 r;
END; $fn$;

-- ============================================================
-- Permissions: mirror the original function exactly
-- ============================================================

-- Retrieval RPC: service_role and hr_reader only
REVOKE EXECUTE ON FUNCTION hr_retrieve_knowledge_v2(TEXT, TEXT, INT, INT)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION hr_retrieve_knowledge_v2(TEXT, TEXT, INT, INT)
  TO service_role, hr_reader;
