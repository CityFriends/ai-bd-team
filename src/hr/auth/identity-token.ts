/**
 * HMAC-SHA256 Signed Identity Tokens
 *
 * Creates short-lived tokens that the hr_retrieve_knowledge RPC
 * verifies inside a SECURITY DEFINER function. The signing secret
 * is shared between the application (env var) and the database
 * (hr_signing_secrets table).
 *
 * Token format: base64(JSON payload).hex(HMAC-SHA256 signature)
 *
 * Payload fields:
 *   sub — Slack user ID
 *   iat — issued-at (epoch seconds)
 *   exp — expiration (epoch seconds, iat + 30s)
 *   aud — "hr_retrieve" (purpose binding)
 */

import { createHmac } from 'crypto';

const TOKEN_LIFETIME_SECONDS = 30;
const AUDIENCE = 'hr_retrieve';

export interface IdentityTokenPayload {
  sub: string;
  iat: number;
  exp: number;
  aud: string;
}

/**
 * Create a signed identity token for a Slack user.
 * The token is valid for 30 seconds.
 */
export function createIdentityToken(slackUserId: string, signingSecret: string): string {
  if (!slackUserId || !signingSecret) {
    throw new Error('slackUserId and signingSecret are required');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: IdentityTokenPayload = {
    sub: slackUserId,
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    aud: AUDIENCE,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const sig = createHmac('sha256', signingSecret)
    .update(Buffer.from(payloadB64, 'base64'))
    .digest('hex');

  return `${payloadB64}.${sig}`;
}

/**
 * Verify and decode a signed identity token.
 * Returns the decoded payload or null if invalid/expired.
 * Used for application-layer pre-validation (the database also verifies).
 */
export function verifyIdentityToken(
  token: string,
  signingSecret: string
): IdentityTokenPayload | null {
  if (!token || !signingSecret) return null;

  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = token.substring(0, dotIndex);
  const sigProvided = token.substring(dotIndex + 1);
  if (!payloadB64 || !sigProvided) return null;

  // Verify signature
  const sigExpected = createHmac('sha256', signingSecret)
    .update(Buffer.from(payloadB64, 'base64'))
    .digest('hex');

  if (sigProvided !== sigExpected) return null;

  // Decode payload
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64').toString('utf8')
    ) as IdentityTokenPayload;

    if (!payload.sub || !payload.iat || !payload.exp || !payload.aud) return null;
    if (payload.aud !== AUDIENCE) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;
    if (payload.iat < now - 60) return null;

    return payload;
  } catch {
    return null;
  }
}
