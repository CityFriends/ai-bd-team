/**
 * HMAC-SHA256 Identity Token Tests
 *
 * Verifies token creation, verification, and rejection of invalid tokens.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createIdentityToken, verifyIdentityToken } from '../auth/identity-token.js';

const SECRET = 'test-secret-key-32-bytes-minimum';

describe('Identity Token — createIdentityToken', () => {
  it('creates a token with correct format (base64.hex)', () => {
    const token = createIdentityToken('U_ALICE', SECRET);
    expect(token).toContain('.');
    const [payloadB64, sig] = token.split('.');
    expect(payloadB64.length).toBeGreaterThan(0);
    expect(sig).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex = 64 chars
  });

  it('payload contains required fields', () => {
    const token = createIdentityToken('U_ALICE', SECRET);
    const [payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    expect(payload.sub).toBe('U_ALICE');
    expect(payload.aud).toBe('hr_retrieve');
    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');
    expect(payload.exp - payload.iat).toBe(30);
  });

  it('throws on empty slackUserId', () => {
    expect(() => createIdentityToken('', SECRET)).toThrow('required');
  });

  it('throws on empty signingSecret', () => {
    expect(() => createIdentityToken('U_ALICE', '')).toThrow('required');
  });

  it('different users produce different tokens', () => {
    const t1 = createIdentityToken('U_ALICE', SECRET);
    const t2 = createIdentityToken('U_BOB', SECRET);
    expect(t1).not.toBe(t2);
  });
});

describe('Identity Token — verifyIdentityToken', () => {
  it('verifies a valid token', () => {
    const token = createIdentityToken('U_ALICE', SECRET);
    const payload = verifyIdentityToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('U_ALICE');
    expect(payload!.aud).toBe('hr_retrieve');
  });

  it('rejects token with wrong secret', () => {
    const token = createIdentityToken('U_ALICE', SECRET);
    expect(verifyIdentityToken(token, 'wrong-secret')).toBeNull();
  });

  it('rejects token with tampered signature', () => {
    const token = createIdentityToken('U_ALICE', SECRET);
    const corrupted = token.slice(0, -4) + 'dead';
    expect(verifyIdentityToken(corrupted, SECRET)).toBeNull();
  });

  it('rejects expired token', () => {
    // Mock Date.now to return future time (past token expiry)
    const now = Date.now();
    const token = createIdentityToken('U_ALICE', SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000); // 60s later
    expect(verifyIdentityToken(token, SECRET)).toBeNull();
    vi.restoreAllMocks();
  });

  it('rejects token with wrong audience', () => {
    // Create a token with a custom audience by manually constructing
    const { createHmac } = require('crypto');
    const payload = JSON.stringify({
      sub: 'U_ALICE',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 30,
      aud: 'wrong_audience',
    });
    const b64 = Buffer.from(payload).toString('base64');
    const sig = createHmac('sha256', SECRET).update(Buffer.from(b64, 'base64')).digest('hex');
    expect(verifyIdentityToken(`${b64}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects null token', () => {
    expect(verifyIdentityToken(null as unknown as string, SECRET)).toBeNull();
  });

  it('rejects empty token', () => {
    expect(verifyIdentityToken('', SECRET)).toBeNull();
  });

  it('rejects malformed token (no dot)', () => {
    expect(verifyIdentityToken('nodottoken', SECRET)).toBeNull();
  });

  it('rejects token with empty payload', () => {
    expect(verifyIdentityToken('.abcdef1234567890', SECRET)).toBeNull();
  });

  it('rejects null secret', () => {
    const token = createIdentityToken('U_ALICE', SECRET);
    expect(verifyIdentityToken(token, null as unknown as string)).toBeNull();
  });
});
