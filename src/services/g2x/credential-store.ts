/**
 * G2X Encrypted Credential Store
 *
 * Provides durable, encrypted storage for G2X OAuth refresh tokens
 * with atomic rotation and multi-instance safety.
 *
 * Encryption: AES-256-GCM using CREDENTIAL_ENCRYPTION_KEY env var.
 * Storage: external_integration_credentials Supabase table.
 * Rotation: CAS (compare-and-swap) with row-level locking via RPC.
 *
 * Security invariants:
 * - Plaintext tokens NEVER stored in database
 * - Encryption key is a separate Railway secret
 * - Tokens NEVER logged, returned to agents, or included in evidence
 * - Decryption happens only in this module
 * - Failed decryption → G2X_AUTH_REQUIRED (fail closed)
 *
 * Multi-instance safety:
 * - SELECT FOR UPDATE in rotate_integration_credential RPC
 * - Only one process wins the rotation lock
 * - Losers get STALE_VERSION and must re-read
 * - In-memory deduplication handles same-process concurrency
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { logger } from '../../lib/logger.js';
import { getSupabase } from '../../integrations/database/client.js';

const log = logger.child({ service: 'G2XCredentialStore' });

const INTEGRATION = 'g2x';
const CREDENTIAL_TYPE = 'oauth_refresh_token';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits

// ============================================================
// Types
// ============================================================

export interface StoredCredential {
  refreshToken: string;
  version: number;
  status: 'ACTIVE' | 'REAUTH_REQUIRED' | 'REVOKED';
  expiresAt: string | null;
  updatedAt: string;
}

export type CredentialStoreResult =
  | { success: true; credential: StoredCredential }
  | { success: false; reason: string };

export type RotationResult =
  | { success: true; newVersion: number }
  | { success: false; reason: string };

// ============================================================
// Encryption
// ============================================================

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyHex) {
    log.warn('CREDENTIAL_ENCRYPTION_KEY not set — credential store unavailable');
    return null;
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    log.error(
      { keyLength: key.length },
      'CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)'
    );
    return null;
  }
  return key;
}

export function encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } | null {
  const key = getEncryptionKey();
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(ciphertext: string, ivBase64: string, tagBase64: string): string | null {
  const key = getEncryptionKey();
  if (!key) return null;

  try {
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Credential decryption failed — corrupted or wrong key'
    );
    return null;
  }
}

// ============================================================
// Credential Operations
// ============================================================

/**
 * Load the current G2X refresh token from the encrypted store.
 * Returns the decrypted token with version for CAS rotation.
 *
 * Fail-closed: any failure returns reason, never falls back.
 */
export async function loadCredential(): Promise<CredentialStoreResult> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('external_integration_credentials')
    .select(
      'encrypted_value, encryption_iv, encryption_tag, version, status, expires_at, updated_at'
    )
    .eq('integration', INTEGRATION)
    .eq('credential_type', CREDENTIAL_TYPE)
    .single();

  if (error || !data) {
    if (error?.code === 'PGRST116') {
      // No rows returned
      return {
        success: false,
        reason: 'No G2X credential in store — bootstrap required',
      };
    }
    return {
      success: false,
      reason: `Database error loading credential: ${error?.message || 'no data'}`,
    };
  }

  if (data.status === 'REVOKED') {
    return {
      success: false,
      reason: 'G2X credential has been revoked — reauthorization required',
    };
  }

  if (data.status === 'REAUTH_REQUIRED') {
    return {
      success: false,
      reason: 'G2X credential requires reauthorization',
    };
  }

  // Decrypt
  const plaintext = decrypt(data.encrypted_value, data.encryption_iv, data.encryption_tag);

  if (!plaintext) {
    return {
      success: false,
      reason: 'Failed to decrypt G2X credential — check CREDENTIAL_ENCRYPTION_KEY',
    };
  }

  return {
    success: true,
    credential: {
      refreshToken: plaintext,
      version: data.version,
      status: data.status,
      expiresAt: data.expires_at,
      updatedAt: data.updated_at,
    },
  };
}

/**
 * Atomically rotate the G2X refresh token.
 *
 * Uses CAS (compare-and-swap) with row-level locking:
 * - expectedVersion must match current version (prevents stale writes)
 * - SELECT FOR UPDATE prevents concurrent rotation across instances
 * - New credential persisted in same transaction as version bump
 *
 * Multi-instance safety: two instances attempting rotation simultaneously:
 * - Instance A acquires row lock, reads version N
 * - Instance B blocks on row lock
 * - Instance A writes version N+1, releases lock
 * - Instance B reads version N+1, its expected version N is stale → rejected
 * - Instance B re-reads and uses the already-rotated credential
 */
export async function rotateCredential(
  newRefreshToken: string,
  expectedVersion: number,
  expiresAt?: Date
): Promise<RotationResult> {
  // Encrypt the new token
  const encrypted = encrypt(newRefreshToken);
  if (!encrypted) {
    return {
      success: false,
      reason: 'Failed to encrypt new credential — CREDENTIAL_ENCRYPTION_KEY missing or invalid',
    };
  }

  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('rotate_integration_credential', {
    p_integration: INTEGRATION,
    p_credential_type: CREDENTIAL_TYPE,
    p_expected_version: expectedVersion,
    p_new_encrypted_value: encrypted.ciphertext,
    p_new_iv: encrypted.iv,
    p_new_tag: encrypted.tag,
    p_new_expires_at: expiresAt?.toISOString() || null,
  });

  if (error) {
    log.error({ error: error.message }, 'Credential rotation RPC failed');
    return {
      success: false,
      reason: `Rotation RPC error: ${error.message}`,
    };
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result?.success) {
    const reason = result?.error_reason || 'Unknown rotation error';
    log.warn(
      { reason, expectedVersion, currentVersion: result?.new_version },
      'Credential rotation rejected'
    );
    return { success: false, reason };
  }

  log.info({ newVersion: result.new_version }, 'G2X credential rotated successfully');

  return { success: true, newVersion: result.new_version };
}

/**
 * Bootstrap: insert initial G2X credential.
 * Does NOT overwrite if one already exists.
 *
 * Used for first-time setup only. Normal operation uses loadCredential + rotateCredential.
 */
export async function bootstrapCredential(
  refreshToken: string,
  expiresAt?: Date,
  metadata?: Record<string, unknown>
): Promise<RotationResult> {
  const encrypted = encrypt(refreshToken);
  if (!encrypted) {
    return {
      success: false,
      reason: 'Failed to encrypt credential — CREDENTIAL_ENCRYPTION_KEY missing or invalid',
    };
  }

  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('bootstrap_integration_credential', {
    p_integration: INTEGRATION,
    p_credential_type: CREDENTIAL_TYPE,
    p_encrypted_value: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_tag: encrypted.tag,
    p_expires_at: expiresAt?.toISOString() || null,
    p_metadata: metadata || {},
  });

  if (error) {
    log.error({ error: error.message }, 'Credential bootstrap RPC failed');
    return { success: false, reason: `Bootstrap RPC error: ${error.message}` };
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (result?.was_existing) {
    log.info('G2X credential already exists — bootstrap skipped');
  } else {
    log.info('G2X credential bootstrapped successfully');
  }

  return {
    success: true,
    newVersion: result?.credential_version || 1,
  };
}

/**
 * Mark G2X credential as requiring reauthorization.
 * Called when refresh token is invalid/revoked.
 */
export async function markReauthRequired(): Promise<void> {
  const supabase = getSupabase();
  await supabase.rpc('mark_credential_reauth_required', {
    p_integration: INTEGRATION,
    p_credential_type: CREDENTIAL_TYPE,
  });
  log.warn('G2X credential marked as REAUTH_REQUIRED');
}

/**
 * Build the token rotation callback for G2XAuthAdapter.
 * This is the bridge between the auth adapter and the credential store.
 *
 * Returns a TokenPersistCallback that:
 * 1. Encrypts the new refresh token
 * 2. Atomically rotates via CAS
 * 3. Fails hard if persistence fails (auth adapter treats this as error)
 */
export function buildRotationCallback(): {
  callback: (newRefreshToken: string, _newAccessToken: string, expiresAt: number) => Promise<void>;
  getVersion: () => number;
} {
  let currentVersion = 0;

  return {
    callback: async (
      newRefreshToken: string,
      _newAccessToken: string,
      expiresAt: number
    ): Promise<void> => {
      if (currentVersion === 0) {
        // First call — version not yet loaded. This happens during bootstrap
        // when loadCredential wasn't called first. Try bootstrap instead.
        const result = await bootstrapCredential(newRefreshToken, new Date(expiresAt));
        if (result.success) {
          currentVersion = result.newVersion;
          return;
        }
        throw new Error(`Credential bootstrap failed: ${result.reason}`);
      }

      const result = await rotateCredential(newRefreshToken, currentVersion, new Date(expiresAt));

      if (!result.success) {
        // Hard failure — auth adapter must know persistence failed
        throw new Error(`Credential rotation failed: ${result.reason}`);
      }

      currentVersion = result.newVersion;
    },

    getVersion: () => currentVersion,
  };
}
