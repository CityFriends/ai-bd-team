/**
 * Notification Processor — Dormant Delivery Loop
 *
 * Processes pending notifications from the outbox with bounded retry.
 * Dormant unless HR_APPROVAL_NOTIFICATIONS_ENABLED=true.
 * Does NOT start on application boot in this phase.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimNotification,
  markDelivered,
  scheduleRetry,
  supersededNotification,
  type PendingNotification,
} from './notification-outbox.js';
import { isApprovalNotificationsEnabled } from './approval-notifications.js';

export interface NotificationProcessorConfig {
  db: SupabaseClient;
  ownerSlackId: string;
  /** Slack client for sending DMs. */
  slackClient: {
    conversations: { open(opts: { users: string }): Promise<{ channel?: { id?: string } }> };
    chat: { postMessage(opts: any): Promise<{ ts?: string }> };
  };
  /** Build message content from a notification. */
  buildMessage: (notification: PendingNotification) => Promise<{
    text: string;
    blocks: import('@slack/types').KnownBlock[];
  } | null>;
  /** Called on permanent delivery failure. */
  onPermanentFailure?: (notificationId: string, error: string) => void;
}

/**
 * Process a single due notification.
 * Returns 'delivered', 'retrying', 'exhausted', 'skipped', or 'disabled'.
 */
export async function processOneNotification(
  config: NotificationProcessorConfig,
  notificationId: string
): Promise<string> {
  if (!isApprovalNotificationsEnabled()) return 'disabled';

  // 1. Atomically claim the notification
  const notification = await claimNotification(config.db, notificationId);
  if (!notification) return 'skipped'; // already claimed or not pending

  // 2. Build the message
  let message: { text: string; blocks: import('@slack/types').KnownBlock[] } | null;
  try {
    message = await config.buildMessage(notification);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const retryResult = await scheduleRetry(config.db, notificationId, `build_error: ${errMsg}`);
    if (retryResult === 'exhausted') {
      config.onPermanentFailure?.(notificationId, errMsg);
    }
    return retryResult;
  }

  if (!message) {
    // Review/batch no longer actionable — supersede
    await supersededNotification(config.db, notification.referenceType, notification.referenceId);
    return 'skipped';
  }

  // 3. Send the DM
  try {
    const dm = await config.slackClient.conversations.open({ users: config.ownerSlackId });
    const channelId = dm.channel?.id;
    if (!channelId) {
      const retryResult = await scheduleRetry(config.db, notificationId, 'dm_channel_not_found');
      if (retryResult === 'exhausted') config.onPermanentFailure?.(notificationId, 'dm_channel_not_found');
      return retryResult;
    }

    const result = await config.slackClient.chat.postMessage({
      channel: channelId,
      text: message.text,
      blocks: message.blocks,
    });

    // 4. Mark delivered
    await markDelivered(config.db, notificationId, channelId, result.ts || '');
    return 'delivered';
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // Check for Slack rate limiting
    if (errMsg.includes('rate_limited') || errMsg.includes('Retry-After')) {
      // Parse Retry-After if available, otherwise use default
      const retryResult = await scheduleRetry(config.db, notificationId, `rate_limited: ${errMsg}`);
      if (retryResult === 'exhausted') config.onPermanentFailure?.(notificationId, errMsg);
      return retryResult;
    }

    const retryResult = await scheduleRetry(config.db, notificationId, errMsg);
    if (retryResult === 'exhausted') config.onPermanentFailure?.(notificationId, errMsg);
    return retryResult;
  }
}

/**
 * Process all due notifications.
 * Returns count of processed notifications.
 */
export async function processDueNotifications(
  config: NotificationProcessorConfig
): Promise<{ delivered: number; retried: number; failed: number }> {
  if (!isApprovalNotificationsEnabled()) {
    return { delivered: 0, retried: 0, failed: 0 };
  }

  const counts = { delivered: 0, retried: 0, failed: 0 };

  // Find due notifications
  const { data: due } = await config.db
    .from('hr_notification_outbox')
    .select('id')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(10); // Process at most 10 per cycle

  for (const { id } of due || []) {
    const result = await processOneNotification(config, id);
    if (result === 'delivered') counts.delivered++;
    else if (result === 'retrying') counts.retried++;
    else if (result === 'exhausted') counts.failed++;
  }

  return counts;
}
