-- ============================================================
-- Audit Retention Cleanup
--
-- Removes expired raw_response content from validation-failure
-- audit records while preserving all financial, provenance,
-- and error metadata.
--
-- Policy: raw_response expires after 30 days (expires_at field).
-- Permanent: response_hash, error_type, errors, response_chars,
--            recorded_at, expires_at (as historical marker).
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_audit_responses(
  p_batch_size INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
  v_entry RECORD;
  v_updated_metadata JSONB;
  v_validation_failure JSONB;
BEGIN
  FOR v_entry IN
    SELECT id, metadata
    FROM ai_inference_ledger
    WHERE metadata IS NOT NULL
      AND metadata->'validation_failure'->>'expires_at' IS NOT NULL
      AND (metadata->'validation_failure'->>'expires_at')::timestamptz < NOW()
      AND metadata->'validation_failure'->>'raw_response' IS NOT NULL
    ORDER BY id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Remove raw_response from validation_failure, keep everything else
    v_validation_failure := v_entry.metadata->'validation_failure';
    v_validation_failure := v_validation_failure - 'raw_response';
    v_validation_failure := v_validation_failure || jsonb_build_object(
      'raw_response_expired', true,
      'expired_at', NOW()::text
    );

    -- Rebuild metadata preserving all other top-level keys
    v_updated_metadata := v_entry.metadata || jsonb_build_object(
      'validation_failure', v_validation_failure
    );

    UPDATE ai_inference_ledger
    SET metadata = v_updated_metadata
    WHERE id = v_entry.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_expired_audit_responses TO service_role;

COMMENT ON FUNCTION cleanup_expired_audit_responses IS
  'Removes expired raw_response from validation-failure audit records. '
  'Preserves response_hash, errors, financial data, and all other metadata. '
  'Idempotent: skips records where raw_response is already removed. '
  'Batch-limited with SKIP LOCKED for concurrent safety.';
