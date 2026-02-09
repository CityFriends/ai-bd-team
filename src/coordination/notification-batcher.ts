/**
 * Smart Notification Batcher
 *
 * Batches notifications to reduce noise and respect user preferences:
 * - Groups related notifications (same agency, same topic)
 * - Respects quiet hours from user profiles
 * - Sends immediate alerts for high-priority items
 * - Batches low-priority items into digests
 *
 * Usage:
 *   import { queueNotification, flushNotifications } from './notification-batcher.js';
 *
 *   // Queue a notification
 *   await queueNotification({
 *     type: 'opportunity',
 *     priority: 'medium',
 *     title: 'New VA Opportunity',
 *     message: 'Found a matching opportunity...',
 *     metadata: { agency: 'VA', score: 75 },
 *   });
 *
 *   // Flush pending notifications (call periodically)
 *   await flushNotifications();
 */

import { App } from '@slack/bolt';
import { getSupabase, getUserProfile, type UserProfile } from '../integrations/supabase.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Notification priority levels
export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Notification {
  id?: string;
  type: 'opportunity' | 'competitor_alert' | 'deadline' | 'decision_needed' | 'digest' | 'general';
  priority: NotificationPriority;
  title: string;
  message: string;
  targetUser?: string; // Slack user ID, or undefined for channel
  metadata?: {
    agency?: string;
    noticeId?: string;
    score?: number;
    dueDate?: string;
    [key: string]: unknown;
  };
  createdAt?: string;
  sentAt?: string;
  batchedWith?: string[]; // IDs of notifications batched together
}

// In-memory queue for pending notifications
const pendingNotifications: Notification[] = [];

// Batch windows by priority (in minutes)
const BATCH_WINDOWS: Record<NotificationPriority, number> = {
  critical: 0,   // Send immediately
  high: 5,       // Batch for 5 minutes
  medium: 30,    // Batch for 30 minutes
  low: 120,      // Batch for 2 hours (or until next digest)
};

// Quiet hours check
function isInQuietHours(profile: UserProfile | null): boolean {
  if (!profile?.quiet_hours_start || !profile?.quiet_hours_end) {
    return false;
  }

  const now = new Date();
  const timezone = profile.timezone || 'America/Chicago';

  try {
    // Get current time in user's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const currentTime = formatter.format(now);
    const [currentHour, currentMinute] = currentTime.split(':').map(Number);
    const currentMinutes = currentHour * 60 + currentMinute;

    // Parse quiet hours
    const [startHour, startMinute] = profile.quiet_hours_start.split(':').map(Number);
    const [endHour, endMinute] = profile.quiet_hours_end.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch {
    return false;
  }
}

// Check if user wants this type of notification
function userWantsNotification(profile: UserProfile | null, notification: Notification): boolean {
  if (!profile) return true; // Default to sending if no profile

  // Check notification preferences
  if (notification.type === 'opportunity' && notification.metadata?.score) {
    const score = notification.metadata.score as number;
    // Only notify for hot opportunities if they've opted in
    if (score >= 80 && profile.notify_hot_opps === false) {
      return false;
    }
  }

  if (notification.type === 'competitor_alert' && profile.notify_competitor_alerts === false) {
    return false;
  }

  return true;
}

/**
 * Queue a notification for batching
 */
export async function queueNotification(notification: Notification): Promise<void> {
  const now = new Date().toISOString();

  const notif: Notification = {
    ...notification,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };

  // Critical notifications skip the queue
  if (notification.priority === 'critical') {
    console.log(`[Batcher] Critical notification - sending immediately: ${notification.title}`);
    // Don't batch, will be sent immediately in flush
  }

  pendingNotifications.push(notif);
  console.log(`[Batcher] Queued notification: ${notif.title} (priority: ${notif.priority})`);

  // Also persist to database for durability
  try {
    await getSupabase().from('notification_queue').insert({
      id: notif.id,
      type: notif.type,
      priority: notif.priority,
      title: notif.title,
      message: notif.message,
      target_user: notif.targetUser,
      metadata: notif.metadata,
      created_at: now,
    });
  } catch (err) {
    // Queue table might not exist, that's okay
    console.warn('[Batcher] Could not persist to database:', err);
  }
}

/**
 * Group notifications by type and agency for batching
 */
function groupNotifications(notifications: Notification[]): Map<string, Notification[]> {
  const groups = new Map<string, Notification[]>();

  for (const notif of notifications) {
    // Create group key based on type and agency
    const agency = notif.metadata?.agency || 'general';
    const key = `${notif.type}:${agency}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(notif);
  }

  return groups;
}

/**
 * Format a batch of notifications into a single message
 */
function formatBatchedMessage(notifications: Notification[]): string {
  if (notifications.length === 1) {
    return notifications[0].message;
  }

  const type = notifications[0].type;
  const agency = notifications[0].metadata?.agency;

  let header = '';
  switch (type) {
    case 'opportunity':
      header = agency
        ? `*📋 ${notifications.length} New ${agency} Opportunities*`
        : `*📋 ${notifications.length} New Opportunities*`;
      break;
    case 'competitor_alert':
      header = `*🚨 ${notifications.length} Competitor Alerts*`;
      break;
    case 'deadline':
      header = `*⏰ ${notifications.length} Upcoming Deadlines*`;
      break;
    default:
      header = `*📬 ${notifications.length} Updates*`;
  }

  const items = notifications.map(n => `• ${n.title}`).join('\n');

  return `${header}\n\n${items}\n\n_Use /pipeline for details_`;
}

/**
 * Send notifications via Slack
 */
async function sendNotification(
  app: App,
  message: string,
  targetUser?: string,
  threadTs?: string
): Promise<void> {
  try {
    if (targetUser) {
      // DM to specific user
      await app.client.chat.postMessage({
        channel: targetUser,
        text: message,
      });
    } else {
      // Post to channel
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: message,
        thread_ts: threadTs,
      });
    }
  } catch (err) {
    console.error('[Batcher] Failed to send notification:', err);
  }
}

/**
 * Flush pending notifications
 * Call this periodically (e.g., every 5 minutes)
 */
export async function flushNotifications(app?: App): Promise<number> {
  if (pendingNotifications.length === 0) {
    return 0;
  }

  console.log(`[Batcher] Flushing ${pendingNotifications.length} pending notifications`);

  const now = Date.now();
  const toSend: Notification[] = [];
  const toKeep: Notification[] = [];

  // Separate notifications ready to send vs still batching
  for (const notif of pendingNotifications) {
    const createdAt = new Date(notif.createdAt || now).getTime();
    const windowMs = BATCH_WINDOWS[notif.priority] * 60 * 1000;
    const readyToSend = (now - createdAt) >= windowMs;

    // Critical always goes immediately
    if (notif.priority === 'critical' || readyToSend) {
      toSend.push(notif);
    } else {
      toKeep.push(notif);
    }
  }

  // Update the queue
  pendingNotifications.length = 0;
  pendingNotifications.push(...toKeep);

  if (toSend.length === 0) {
    console.log('[Batcher] No notifications ready to send yet');
    return 0;
  }

  // If no app provided, just log
  if (!app) {
    console.log(`[Batcher] Would send ${toSend.length} notifications (no app provided)`);
    for (const notif of toSend) {
      console.log(`  - ${notif.title}`);
    }
    return toSend.length;
  }

  // Group by target user and type
  const byUser = new Map<string, Notification[]>();
  for (const notif of toSend) {
    const key = notif.targetUser || 'channel';
    if (!byUser.has(key)) {
      byUser.set(key, []);
    }
    byUser.get(key)!.push(notif);
  }

  let sentCount = 0;

  // Process each user's notifications
  for (const [target, notifications] of byUser) {
    // Check quiet hours for targeted notifications
    if (target !== 'channel') {
      const profile = await getUserProfile(target);

      // Skip if in quiet hours (unless critical)
      if (isInQuietHours(profile)) {
        const critical = notifications.filter(n => n.priority === 'critical');
        const nonCritical = notifications.filter(n => n.priority !== 'critical');

        // Only send critical during quiet hours
        if (critical.length > 0) {
          for (const notif of critical) {
            await sendNotification(app, notif.message, target);
            sentCount++;
          }
        }

        // Re-queue non-critical for later
        pendingNotifications.push(...nonCritical);
        console.log(`[Batcher] Re-queued ${nonCritical.length} notifications (quiet hours for ${target})`);
        continue;
      }

      // Filter by user preferences
      const wanted = notifications.filter(n => userWantsNotification(profile, n));
      if (wanted.length === 0) continue;

      // Group and batch
      const groups = groupNotifications(wanted);
      for (const [, groupNotifs] of groups) {
        const message = formatBatchedMessage(groupNotifs);
        await sendNotification(app, message, target);
        sentCount += groupNotifs.length;
      }
    } else {
      // Channel notifications - group by type/agency
      const groups = groupNotifications(notifications);
      for (const [, groupNotifs] of groups) {
        const message = formatBatchedMessage(groupNotifs);
        await sendNotification(app, message);
        sentCount += groupNotifs.length;
      }
    }
  }

  // Mark as sent in database
  const sentIds = toSend.map(n => n.id).filter(Boolean);
  if (sentIds.length > 0) {
    try {
      await getSupabase()
        .from('notification_queue')
        .update({ sent_at: new Date().toISOString() })
        .in('id', sentIds);
    } catch {
      // Ignore database errors
    }
  }

  console.log(`[Batcher] Sent ${sentCount} notifications`);
  return sentCount;
}

/**
 * Get pending notification count
 */
export function getPendingCount(): number {
  return pendingNotifications.length;
}

/**
 * Clear all pending notifications (for testing)
 */
export function clearPending(): void {
  pendingNotifications.length = 0;
}

/**
 * Create a daily digest of low-priority notifications
 */
export async function createDailyDigest(): Promise<Notification | null> {
  // Get all low-priority notifications from the last 24 hours
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('notification_queue')
      .select('*')
      .eq('priority', 'low')
      .is('sent_at', null)
      .gte('created_at', since);

    if (error || !data || data.length === 0) {
      return null;
    }

    // Group by type
    const byType: Record<string, any[]> = {};
    for (const notif of data) {
      const type = notif.type || 'general';
      if (!byType[type]) byType[type] = [];
      byType[type].push(notif);
    }

    // Format digest
    let digestMessage = '*📬 Daily Digest*\n\n';

    for (const [type, notifs] of Object.entries(byType)) {
      const emoji = type === 'opportunity' ? '📋' : type === 'competitor_alert' ? '🚨' : '📌';
      digestMessage += `*${emoji} ${type.replace('_', ' ').toUpperCase()}* (${notifs.length})\n`;
      for (const n of notifs.slice(0, 5)) {
        digestMessage += `• ${n.title}\n`;
      }
      if (notifs.length > 5) {
        digestMessage += `  _...and ${notifs.length - 5} more_\n`;
      }
      digestMessage += '\n';
    }

    digestMessage += '_Use /pipeline for full details_';

    // Mark these as sent
    await getSupabase()
      .from('notification_queue')
      .update({ sent_at: new Date().toISOString() })
      .in('id', data.map(n => n.id));

    return {
      type: 'digest',
      priority: 'low',
      title: 'Daily Digest',
      message: digestMessage,
      metadata: { count: data.length },
    };
  } catch (err) {
    console.error('[Batcher] Error creating digest:', err);
    return null;
  }
}
