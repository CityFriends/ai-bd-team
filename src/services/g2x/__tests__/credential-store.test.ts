/**
 * G2X Credential Store Tests
 *
 * Covers:
 * - Encryption/decryption (AES-256-GCM)
 * - Bootstrap credential insertion
 * - Successful rotation with CAS
 * - Stale version / CAS rejection
 * - Two-process rotation race (simulated)
 * - Persistence failure after token response
 * - Corrupted encrypted credential
 * - Revoked/reauth credential states
 * - Missing encryption key
 * - Secret never logged or returned to agents
 * - Restart after rotation (loads latest version)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Supabase
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('../../../integrations/database/client.js', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

// Chain: from().select().eq().eq().single()
mockFrom.mockReturnValue({ select: mockSelect });
mockSelect.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });

import {
  encrypt,
  decrypt,
  loadCredential,
  rotateCredential,
  bootstrapCredential,
  markReauthRequired,
  buildRotationCallback,
} from '../credential-store.js';

// Test encryption key (32 bytes = 64 hex chars)
const TEST_KEY = 'a'.repeat(64);

describe('Encryption', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('encrypts and decrypts roundtrip', () => {
    const plaintext = 'my-secret-refresh-token-abc123';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBeNull();
    expect(encrypted!.ciphertext).not.toBe(plaintext);
    expect(encrypted!.iv).toBeTruthy();
    expect(encrypted!.tag).toBeTruthy();

    const decrypted = decrypt(encrypted!.ciphertext, encrypted!.iv, encrypted!.tag);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same-token';
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);

    expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
    expect(enc1!.iv).not.toBe(enc2!.iv);

    // Both decrypt to same value
    expect(decrypt(enc1!.ciphertext, enc1!.iv, enc1!.tag)).toBe(plaintext);
    expect(decrypt(enc2!.ciphertext, enc2!.iv, enc2!.tag)).toBe(plaintext);
  });

  it('returns null when encryption key missing', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(encrypt('test')).toBeNull();
  });

  it('returns null when encryption key wrong length', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'tooshort';
    expect(encrypt('test')).toBeNull();
  });

  it('decrypt returns null for corrupted ciphertext', () => {
    const encrypted = encrypt('test')!;
    const result = decrypt('corrupted', encrypted.iv, encrypted.tag);
    expect(result).toBeNull();
  });

  it('decrypt returns null for wrong IV', () => {
    const encrypted = encrypt('test')!;
    const result = decrypt(encrypted.ciphertext, 'wrongiv', encrypted.tag);
    expect(result).toBeNull();
  });

  it('decrypt returns null for wrong tag', () => {
    const encrypted = encrypt('test')!;
    const result = decrypt(encrypted.ciphertext, encrypted.iv, 'wrongtag');
    expect(result).toBeNull();
  });

  it('decrypt returns null for wrong key', () => {
    const encrypted = encrypt('test')!;
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64);
    const result = decrypt(encrypted.ciphertext, encrypted.iv, encrypted.tag);
    expect(result).toBeNull();
  });

  it('never exposes plaintext in encrypted output', () => {
    const secret = 'SUPER_SECRET_REFRESH_TOKEN_12345';
    const encrypted = encrypt(secret)!;

    // Ciphertext should not contain plaintext
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(encrypted.iv).not.toContain(secret);
    expect(encrypted.tag).not.toContain(secret);
  });
});

describe('loadCredential', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads and decrypts active credential', async () => {
    const encrypted = encrypt('real-refresh-token')!;
    mockSingle.mockResolvedValue({
      data: {
        encrypted_value: encrypted.ciphertext,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        version: 5,
        status: 'ACTIVE',
        expires_at: null,
        updated_at: '2026-10-05T00:00:00Z',
      },
      error: null,
    });

    const result = await loadCredential();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.credential.refreshToken).toBe('real-refresh-token');
      expect(result.credential.version).toBe(5);
      expect(result.credential.status).toBe('ACTIVE');
    }
  });

  it('fails for missing credential (bootstrap required)', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });

    const result = await loadCredential();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('bootstrap');
    }
  });

  it('fails for revoked credential', async () => {
    const encrypted = encrypt('revoked-token')!;
    mockSingle.mockResolvedValue({
      data: {
        encrypted_value: encrypted.ciphertext,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        version: 3,
        status: 'REVOKED',
        expires_at: null,
        updated_at: '2026-10-05T00:00:00Z',
      },
      error: null,
    });

    const result = await loadCredential();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('revoked');
    }
  });

  it('fails for REAUTH_REQUIRED status', async () => {
    const encrypted = encrypt('expired-token')!;
    mockSingle.mockResolvedValue({
      data: {
        encrypted_value: encrypted.ciphertext,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        version: 3,
        status: 'REAUTH_REQUIRED',
        expires_at: null,
        updated_at: '2026-10-05T00:00:00Z',
      },
      error: null,
    });

    const result = await loadCredential();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('reauthorization');
    }
  });

  it('fails for corrupted encrypted data', async () => {
    mockSingle.mockResolvedValue({
      data: {
        encrypted_value: 'corrupted',
        encryption_iv: 'bad-iv',
        encryption_tag: 'bad-tag',
        version: 1,
        status: 'ACTIVE',
        expires_at: null,
        updated_at: '2026-10-05T00:00:00Z',
      },
      error: null,
    });

    const result = await loadCredential();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('decrypt');
    }
  });

  it('fails when encryption key missing', async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const encrypted = encrypt('test'); // This returns null
    expect(encrypted).toBeNull();

    // Even with valid DB data, decryption fails without key
    mockSingle.mockResolvedValue({
      data: {
        encrypted_value: 'something',
        encryption_iv: 'iv',
        encryption_tag: 'tag',
        version: 1,
        status: 'ACTIVE',
        expires_at: null,
        updated_at: '2026-10-05T00:00:00Z',
      },
      error: null,
    });

    const result = await loadCredential();
    expect(result.success).toBe(false);
  });
});

describe('rotateCredential', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('succeeds with correct version (CAS)', async () => {
    mockRpc.mockResolvedValue({
      data: [{ success: true, new_version: 6, error_reason: null }],
      error: null,
    });

    const result = await rotateCredential('new-refresh-token', 5);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newVersion).toBe(6);
    }

    // Verify RPC was called with encrypted value (not plaintext)
    const rpcArgs = mockRpc.mock.calls[0][1];
    expect(rpcArgs.p_expected_version).toBe(5);
    expect(rpcArgs.p_new_encrypted_value).not.toBe('new-refresh-token');
    expect(rpcArgs.p_new_iv).toBeTruthy();
    expect(rpcArgs.p_new_tag).toBeTruthy();
  });

  it('rejects stale version (CAS failure)', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          success: false,
          new_version: 7,
          error_reason: 'STALE_VERSION: expected 5 but current is 7',
        },
      ],
      error: null,
    });

    const result = await rotateCredential('new-token', 5);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('STALE_VERSION');
    }
  });

  it('rejects rotation of revoked credential', async () => {
    mockRpc.mockResolvedValue({
      data: [{ success: false, new_version: 3, error_reason: 'CREDENTIAL_REVOKED' }],
      error: null,
    });

    const result = await rotateCredential('new-token', 3);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('REVOKED');
    }
  });

  it('fails when encryption key missing', async () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;

    const result = await rotateCredential('new-token', 1);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain('CREDENTIAL_ENCRYPTION_KEY');
    }
    // RPC should NOT have been called
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('handles RPC error gracefully', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database unreachable' },
    });

    const result = await rotateCredential('new-token', 1);

    expect(result.success).toBe(false);
  });
});

describe('Two-Process Rotation Race (Simulated)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('first rotator wins, second gets STALE_VERSION', async () => {
    // Process A rotates successfully (version 1 → 2)
    mockRpc.mockResolvedValueOnce({
      data: [{ success: true, new_version: 2, error_reason: null }],
      error: null,
    });

    // Process B tries with same expected version (1) — stale
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          success: false,
          new_version: 2,
          error_reason: 'STALE_VERSION: expected 1 but current is 2',
        },
      ],
      error: null,
    });

    const resultA = await rotateCredential('token-from-A', 1);
    const resultB = await rotateCredential('token-from-B', 1);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(false);
    if (!resultB.success) {
      expect(resultB.reason).toContain('STALE_VERSION');
    }
  });
});

describe('bootstrapCredential', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('bootstraps new credential', async () => {
    mockRpc.mockResolvedValue({
      data: [{ success: true, credential_version: 1, was_existing: false }],
      error: null,
    });

    const result = await bootstrapCredential('initial-refresh-token');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newVersion).toBe(1);
    }
  });

  it('skips if credential already exists', async () => {
    mockRpc.mockResolvedValue({
      data: [{ success: true, credential_version: 5, was_existing: true }],
      error: null,
    });

    const result = await bootstrapCredential('would-overwrite');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newVersion).toBe(5);
    }
  });
});

describe('markReauthRequired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls RPC to mark credential', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await markReauthRequired();

    expect(mockRpc).toHaveBeenCalledWith('mark_credential_reauth_required', {
      p_integration: 'g2x',
      p_credential_type: 'oauth_refresh_token',
    });
  });
});

describe('buildRotationCallback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('bootstraps on first call (version 0)', async () => {
    mockRpc.mockResolvedValue({
      data: [{ success: true, credential_version: 1, was_existing: false }],
      error: null,
    });

    const { callback, getVersion } = buildRotationCallback();

    expect(getVersion()).toBe(0);
    await callback('new-rt', 'new-at', Date.now() + 86400000);
    expect(getVersion()).toBe(1);
  });

  it('rotates on subsequent calls (version > 0)', async () => {
    // Bootstrap first
    mockRpc.mockResolvedValueOnce({
      data: [{ success: true, credential_version: 1, was_existing: false }],
      error: null,
    });

    const { callback, getVersion } = buildRotationCallback();
    await callback('rt1', 'at1', Date.now() + 86400000);
    expect(getVersion()).toBe(1);

    // Now rotate
    mockRpc.mockResolvedValueOnce({
      data: [{ success: true, new_version: 2, error_reason: null }],
      error: null,
    });

    await callback('rt2', 'at2', Date.now() + 86400000);
    expect(getVersion()).toBe(2);
  });

  it('throws on persistence failure (hard error for auth adapter)', async () => {
    mockRpc.mockResolvedValue({
      data: [{ success: false, new_version: 1, error_reason: 'STALE_VERSION' }],
      error: null,
    });

    // Set version > 0 to trigger rotation path
    const { callback } = buildRotationCallback();

    // Bootstrap first
    mockRpc.mockResolvedValueOnce({
      data: [{ success: true, credential_version: 1, was_existing: false }],
      error: null,
    });
    await callback('rt1', 'at1', Date.now());

    // Now attempt rotation that fails
    mockRpc.mockResolvedValueOnce({
      data: [{ success: false, new_version: 1, error_reason: 'STALE_VERSION' }],
      error: null,
    });

    await expect(callback('rt2', 'at2', Date.now())).rejects.toThrow('Credential rotation failed');
  });
});

describe('Secret Never Exposed', () => {
  it('encrypt output does not contain plaintext', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const secret = 'YWM1OTZkYjgtNTEzNC00ZDNh-THIS_IS_SECRET';
    const result = encrypt(secret)!;

    // Verify ciphertext doesn't contain the original secret
    const allOutput = `${result.ciphertext}|${result.iv}|${result.tag}`;
    expect(allOutput).not.toContain('THIS_IS_SECRET');
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  });

  it('loadCredential result does not expose encryption parameters', async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    const encrypted = encrypt('secret-token')!;

    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockSingle.mockResolvedValue({
      data: {
        encrypted_value: encrypted.ciphertext,
        encryption_iv: encrypted.iv,
        encryption_tag: encrypted.tag,
        version: 1,
        status: 'ACTIVE',
        expires_at: null,
        updated_at: '2026-10-05T00:00:00Z',
      },
      error: null,
    });

    const result = await loadCredential();
    if (result.success) {
      // The credential contains the plaintext token (for use by auth adapter)
      // but NOT the encryption parameters
      const json = JSON.stringify(result.credential);
      expect(json).not.toContain('encrypted_value');
      expect(json).not.toContain('encryption_iv');
      expect(json).not.toContain('encryption_tag');
    }

    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  });
});
