/**
 * Notion Webhook Handler — Signed, Idempotent
 *
 * Verifies HMAC-SHA256 signatures using per-connection secrets from
 * Railway env vars. Deduplicates events by ID. Routes to sync operations.
 *
 * Webhook secrets are NEVER stored in the database.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data?: { page_id?: string; parent?: { page_id?: string } };
}

export interface WebhookConnection {
  id: string;
  webhookSecretEnv: string | null;
  scope: string;
}

export interface WebhookResult {
  status: number;
  connectionId: string | null;
  eventType: string | null;
  action: 'processed' | 'duplicate' | 'invalid_signature' | 'no_page_id' | 'unknown_event';
}

/**
 * Verify webhook signature against each connection's secret.
 * Returns the matching connection ID, or null if no match.
 *
 * Secrets are read from env vars — never from the database.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  connections: WebhookConnection[]
): string | null {
  if (!signature || !rawBody) return null;

  for (const conn of connections) {
    if (!conn.webhookSecretEnv) continue;
    const secret = process.env[conn.webhookSecretEnv];
    if (!secret) continue;

    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        return conn.id;
      }
    } catch {
      // Length mismatch or invalid hex — not a match
      continue;
    }
  }

  return null;
}

/**
 * Process a verified webhook event. Returns the action taken.
 *
 * Idempotency: duplicate event IDs return 'duplicate' with no processing.
 */
export function routeWebhookEvent(
  event: WebhookEvent,
  processedEventIds: Set<string>
): { action: WebhookResult['action']; pageId: string | null } {
  // Idempotency check
  if (processedEventIds.has(event.id)) {
    return { action: 'duplicate', pageId: null };
  }
  processedEventIds.add(event.id);

  // Bound the dedup set
  if (processedEventIds.size > 10000) {
    const entries = Array.from(processedEventIds);
    for (let i = 0; i < 5000; i++) processedEventIds.delete(entries[i]);
  }

  const pageId = event.data?.page_id || null;

  switch (event.type) {
    case 'page.content_updated':
    case 'page.created':
    case 'page.moved':
    case 'page.deleted':
      if (!pageId) return { action: 'no_page_id', pageId: null };
      return { action: 'processed', pageId };
    default:
      return { action: 'unknown_event', pageId: null };
  }
}
