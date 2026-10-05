-- ============================================================
-- External Integration Credential Store
-- ============================================================
--
-- Secure, durable storage for rotating OAuth credentials
-- used by external integration adapters (G2X, Gmail, etc.).
--
-- Security:
-- - Values encrypted at application layer (AES-256-GCM)
-- - Encryption key is a separate Railway secret (CREDENTIAL_ENCRYPTION_KEY)
-- - Database stores only ciphertext + IV + auth tag
-- - Service-role-only access (no anon key access)
-- - RLS enabled, service_role policy only
-- - Never returned through normal application APIs
-- - Never exposed to agents, Slack, memory, or evidence
--
-- Atomic rotation:
-- - version column for CAS (compare-and-swap)
-- - Atomic RPC function enforces version check
-- - Concurrent rotators: only one wins, others get stale version error
-- - Persist-before-complete: new credential saved before refresh considered done
--
-- Multi-instance safety:
-- - SELECT FOR UPDATE prevents concurrent rotation
-- - Version increment is atomic within the RPC transaction
-- - Two instances attempting refresh: one wins lock, other waits and reads updated value
-- ============================================================

CREATE TABLE IF NOT EXISTS external_integration_credentials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Integration identity
  integration TEXT NOT NULL,
  credential_type TEXT NOT NULL,

  -- Encrypted credential (AES-256-GCM ciphertext)
  -- Application layer encrypts/decrypts using CREDENTIAL_ENCRYPTION_KEY
  encrypted_value TEXT NOT NULL,

  -- Cryptographic parameters stored alongside ciphertext
  -- IV (initialization vector) and auth tag for AES-256-GCM
  encryption_iv TEXT NOT NULL,
  encryption_tag TEXT NOT NULL,

  -- CAS version for atomic rotation
  version BIGINT NOT NULL DEFAULT 1,

  -- Lifecycle
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REAUTH_REQUIRED', 'REVOKED')) DEFAULT 'ACTIVE',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,

  -- Non-secret metadata only (NEVER put tokens/keys here)
  metadata JSONB DEFAULT '{}',

  -- Unique: one credential per integration+type
  CONSTRAINT uq_integration_credential UNIQUE (integration, credential_type)
);

CREATE INDEX idx_ext_cred_integration ON external_integration_credentials (integration);
CREATE INDEX idx_ext_cred_status ON external_integration_credentials (status) WHERE status = 'ACTIVE';

ALTER TABLE external_integration_credentials ENABLE ROW LEVEL SECURITY;

-- Service-role ONLY — no anon access, no agent access
CREATE POLICY "service_role_ext_credentials"
  ON external_integration_credentials FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE external_integration_credentials IS
  'Encrypted external integration credentials. Values are AES-256-GCM ciphertext. '
  'Application layer handles encryption/decryption. Never expose to agents, Slack, logs, or evidence.';

-- ============================================================
-- Atomic Credential Rotation (CAS / Compare-And-Swap)
-- ============================================================
--
-- Guarantees:
-- 1. Only one rotator wins per version (SELECT FOR UPDATE)
-- 2. Stale writers rejected (version must match)
-- 3. New credential persisted atomically before returning success
-- 4. Multi-instance safe via row-level lock
--

CREATE OR REPLACE FUNCTION rotate_integration_credential(
  p_integration TEXT,
  p_credential_type TEXT,
  p_expected_version BIGINT,
  p_new_encrypted_value TEXT,
  p_new_iv TEXT,
  p_new_tag TEXT,
  p_new_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  new_version BIGINT,
  error_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_version BIGINT;
  v_current_status TEXT;
BEGIN
  -- Lock the row for update (prevents concurrent rotation)
  SELECT version, status
  INTO v_current_version, v_current_status
  FROM external_integration_credentials
  WHERE integration = p_integration
    AND credential_type = p_credential_type
  FOR UPDATE;

  -- Credential doesn't exist
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::BIGINT, 'CREDENTIAL_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- Version mismatch (stale writer)
  IF v_current_version != p_expected_version THEN
    RETURN QUERY SELECT false, v_current_version,
      ('STALE_VERSION: expected ' || p_expected_version || ' but current is ' || v_current_version)::TEXT;
    RETURN;
  END IF;

  -- Credential is revoked (cannot rotate)
  IF v_current_status = 'REVOKED' THEN
    RETURN QUERY SELECT false, v_current_version, 'CREDENTIAL_REVOKED'::TEXT;
    RETURN;
  END IF;

  -- Perform atomic rotation
  UPDATE external_integration_credentials
  SET encrypted_value = p_new_encrypted_value,
      encryption_iv = p_new_iv,
      encryption_tag = p_new_tag,
      version = v_current_version + 1,
      status = 'ACTIVE',
      updated_at = now(),
      expires_at = p_new_expires_at,
      metadata = COALESCE(p_metadata, metadata)
  WHERE integration = p_integration
    AND credential_type = p_credential_type;

  RETURN QUERY SELECT true, (v_current_version + 1)::BIGINT, NULL::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION rotate_integration_credential TO service_role;

COMMENT ON FUNCTION rotate_integration_credential IS
  'Atomic credential rotation with CAS version check and row-level locking. '
  'Concurrent rotators: one wins the lock, others get STALE_VERSION. '
  'Persist-before-complete: new credential saved in same transaction as version bump.';

-- ============================================================
-- Bootstrap / Upsert (for initial credential insertion)
-- ============================================================

CREATE OR REPLACE FUNCTION bootstrap_integration_credential(
  p_integration TEXT,
  p_credential_type TEXT,
  p_encrypted_value TEXT,
  p_iv TEXT,
  p_tag TEXT,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
  success BOOLEAN,
  credential_version BIGINT,
  was_existing BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_version BIGINT;
BEGIN
  -- Check if credential already exists
  SELECT version INTO v_existing_version
  FROM external_integration_credentials
  WHERE integration = p_integration
    AND credential_type = p_credential_type
  FOR UPDATE;

  IF FOUND THEN
    -- Already exists — do NOT overwrite. Return existing version.
    RETURN QUERY SELECT true, v_existing_version, true;
    RETURN;
  END IF;

  -- Insert new credential
  INSERT INTO external_integration_credentials (
    integration, credential_type,
    encrypted_value, encryption_iv, encryption_tag,
    version, status, expires_at, metadata
  ) VALUES (
    p_integration, p_credential_type,
    p_encrypted_value, p_iv, p_tag,
    1, 'ACTIVE', p_expires_at, p_metadata
  );

  RETURN QUERY SELECT true, 1::BIGINT, false;
END;
$$;

GRANT EXECUTE ON FUNCTION bootstrap_integration_credential TO service_role;

-- ============================================================
-- Mark credential as requiring reauth
-- ============================================================

CREATE OR REPLACE FUNCTION mark_credential_reauth_required(
  p_integration TEXT,
  p_credential_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE external_integration_credentials
  SET status = 'REAUTH_REQUIRED',
      updated_at = now()
  WHERE integration = p_integration
    AND credential_type = p_credential_type;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_credential_reauth_required TO service_role;
