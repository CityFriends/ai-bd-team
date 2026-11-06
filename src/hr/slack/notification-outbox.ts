/**
 * Notification Outbox — Durable Slack Delivery with Retry
 *
 * Implements bounded exponential backoff for Slack DM delivery.
 * The notification record exists in the database before any Slack
 * API call. Failed delivery leaves the approval request pending.
 *
 * Dormant unless HR_APPROVAL_NOTIFICATIONS_ENABLED=true.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Retry Configuration ────────────────────────────────────

export interface RetryConfig {
  /** Base delay in milliseconds. Default: 60000 (1 minute). */
  baseDelayMs: number;
  /** Maximum delay in milliseconds. Default: 3600000 (1 hour). */
  maxDelayMs: number;
  /** Maximum attempts. Default: 10. */
  maxAttempts: number;
  /** Jitter factor (0-1). Default: 0.25. */
  jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  baseDelayMs: 60_000,
  maxDelayMs: 3_600_000,
  maxAttempts: 10,
  jitterFactor: 0.25,
};

/**
 * Compute the next retry delay using exponential backoff with jitter.
 */
export function computeNextDelay(
  attemptNumber: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attemptNumber - 1);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitter = capped * config.jitterFactor * Math.random();
  return Math.round(capped + jitter);
}

// ── Outbox Operations ──────────────────────────────────────

export interface PendingNotification {
  id: string;
  referenceType: 'policy_review' | 'batch_review';
  referenceId: string;
  attemptCount: number;
  maxAttempts: number;
}

/**
 * Create a notification entry in the outbox.
 * Idempotent: if an active notification already exists for this reference,
 * returns the existing ID.
 */
export async function createNotification(
  db: SupabaseClient,
  referenceType: 'policy_review' | 'batch_review',
  referenceId: string,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<string | null> {
  // Check for existing active notification
  const { data: existing } = await db
    .from('hr_notification_outbox')
    .select('id')
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)
    .in('status', ['pending', 'sending'])
    .single();

  if (existing) return existing.id;

  const { data, error } = await db
    .from('hr_notification_outbox')
    .insert({
      reference_type: referenceType,
      reference_id: referenceId,
      max_attempts: retryConfig.maxAttempts,
      next_attempt_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return null;
  return data?.id || null;
}

/**
 * Claim a pending notification for delivery.
 * Uses atomic status transition to prevent concurrent delivery.
 * Returns the notification if claimed, null if unavailable.
 */
export async function claimNotification(
  db: SupabaseClient,
  notificationId: string
): Promise<PendingNotification | null> {
  const { data, error } = await db
    .from('hr_notification_outbox')
    .update({
      status: 'sending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', notificationId)
    .eq('status', 'pending')
    .select('id, reference_type, reference_id, attempt_count, max_attempts')
    .single();

  if (error || !data) return null;
  return {
    id: data.id,
    referenceType: data.reference_type,
    referenceId: data.reference_id,
    attemptCount: data.attempt_count,
    maxAttempts: data.max_attempts,
  };
}

/**
 * Mark a notification as delivered.
 */
export async function markDelivered(
  db: SupabaseClient,
  notificationId: string,
  slackChannelId: string,
  slackMessageTs: string
): Promise<void> {
  await db
    .from('hr_notification_outbox')
    .update({
      status: 'delivered',
      slack_channel_id: slackChannelId,
      slack_message_ts: slackMessageTs,
      updated_at: new Date().toISOString(),
    })
    .eq('id', notificationId);
}

/**
 * Schedule a retry after a failed delivery attempt.
 * If max attempts exceeded, marks as failed.
 */
export async function scheduleRetry(
  db: SupabaseClient,
  notificationId: string,
  errorMessage: string,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<'retrying' | 'exhausted'> {
  // Fetch current state
  const { data } = await db
    .from('hr_notification_outbox')
    .select('attempt_count, max_attempts')
    .eq('id', notificationId)
    .single();

  if (!data) return 'exhausted';

  const newAttemptCount = (data.attempt_count || 0) + 1;

  if (newAttemptCount >= (data.max_attempts || retryConfig.maxAttempts)) {
    await db
      .from('hr_notification_outbox')
      .update({
        status: 'failed',
        attempt_count: newAttemptCount,
        last_error: errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', notificationId);
    return 'exhausted';
  }

  const delay = computeNextDelay(newAttemptCount, retryConfig);
  const nextAttempt = new Date(Date.now() + delay).toISOString();

  await db
    .from('hr_notification_outbox')
    .update({
      status: 'pending',
      attempt_count: newAttemptCount,
      next_attempt_at: nextAttempt,
      last_error: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', notificationId);

  return 'retrying';
}

/**
 * Supersede a notification (e.g., when content changes during pending delivery).
 */
export async function supersededNotification(
  db: SupabaseClient,
  referenceType: string,
  referenceId: string
): Promise<void> {
  await db
    .from('hr_notification_outbox')
    .update({
      status: 'superseded',
      updated_at: new Date().toISOString(),
    })
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)
    .in('status', ['pending', 'sending']);
}
