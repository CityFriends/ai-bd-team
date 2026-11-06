/**
 * HR Approval Notification Outbox
 *
 * Sends owner-only DM approval requests for sensitive policies and
 * compensation batches. Uses a durable outbox pattern: pending
 * approval exists in the database before any Slack notification.
 *
 * Dormant unless HR_APPROVAL_NOTIFICATIONS_ENABLED=true.
 *
 * Does not activate notifications in this phase.
 */

import type { KnownBlock, SectionBlock, ActionsBlock, DividerBlock, HeaderBlock } from '@slack/types';
import {
  ACTION_APPROVE_POLICY,
  ACTION_REJECT_POLICY,
  ACTION_APPROVE_BATCH,
  ACTION_REJECT_BATCH,
  ACTION_REVIEW_BATCH_PAGES,
} from './approval-actions.js';

export function isApprovalNotificationsEnabled(): boolean {
  return process.env.HR_APPROVAL_NOTIFICATIONS_ENABLED?.toLowerCase() === 'true';
}

// ── Message Builders ───────────────────────────────────────

export interface PolicyReviewInfo {
  reviewId: string;
  pageTitle: string;
  notionUrl: string;
  category: string;
  reason: string;
  contentHashShort: string;
  isUpdate: boolean;
}

/**
 * Build Block Kit message for a sensitive policy approval request.
 */
export function buildPolicyApprovalMessage(info: PolicyReviewInfo): {
  text: string;
  blocks: KnownBlock[];
} {
  const changeType = info.isUpdate ? '📝 Updated' : '🆕 New';

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📋 HR Policy Approval Required', emoji: true },
    } as HeaderBlock,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${changeType} *${info.pageTitle}*\n\n` +
          `*Classification:* ${info.category}\n` +
          `*Reason:* ${info.reason}\n` +
          `*Content hash:* \`${info.contentHashShort}\`\n` +
          `*Notion:* <${info.notionUrl}|View in Notion>`,
      },
    } as SectionBlock,
    { type: 'divider' } as DividerBlock,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve', emoji: true },
          style: 'primary',
          action_id: ACTION_APPROVE_POLICY,
          value: info.reviewId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject', emoji: true },
          style: 'danger',
          action_id: ACTION_REJECT_POLICY,
          value: info.reviewId,
        },
      ],
    } as ActionsBlock,
  ];

  return {
    text: `HR Policy Approval Required: ${info.pageTitle}`,
    blocks,
  };
}

export interface BatchReviewInfo {
  batchId: string;
  manifestDigest: string;
  pageCount: number;
  digestShort: string;
  sampleTitles: string[];
}

/**
 * Build Block Kit message for a compensation batch approval request.
 */
export function buildBatchApprovalMessage(info: BatchReviewInfo): {
  text: string;
  blocks: KnownBlock[];
} {
  const titleList = info.sampleTitles.slice(0, 10)
    .map((t) => `• ${t}`)
    .join('\n');
  const moreCount = info.pageCount - Math.min(info.sampleTitles.length, 10);

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '💰 Salary-Band Batch Approval Required', emoji: true },
    } as HeaderBlock,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${info.pageCount} salary-band pages* require approval.\n\n` +
          `*Batch ID:* \`${info.batchId.slice(0, 8)}…\`\n` +
          `*Manifest digest:* \`${info.digestShort}\`\n\n` +
          `⚠️ *All-or-nothing:* Approving this batch publishes all ${info.pageCount} pages. ` +
          `Rejecting leaves all pages unpublished.`,
      },
    } as SectionBlock,
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Included pages:*\n${titleList}` +
          (moreCount > 0 ? `\n_…and ${moreCount} more_` : ''),
      },
    } as SectionBlock,
    { type: 'divider' } as DividerBlock,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📋 Review All Pages', emoji: true },
          action_id: ACTION_REVIEW_BATCH_PAGES,
          value: `${info.batchId}:1`,
        },
      ],
    } as ActionsBlock,
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve Entire Batch', emoji: true },
          style: 'primary',
          action_id: ACTION_APPROVE_BATCH,
          value: `${info.batchId}:${info.manifestDigest}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject Entire Batch', emoji: true },
          style: 'danger',
          action_id: ACTION_REJECT_BATCH,
          value: info.batchId,
        },
      ],
    } as ActionsBlock,
  ];

  return {
    text: `Salary-Band Batch Approval Required: ${info.pageCount} pages`,
    blocks,
  };
}

// ── Notification Sender (Dormant) ──────────────────────────

export interface NotificationSender {
  sendPolicyReview(ownerSlackId: string, info: PolicyReviewInfo): Promise<{ ts?: string }>;
  sendBatchReview(ownerSlackId: string, info: BatchReviewInfo): Promise<{ ts?: string }>;
}

/**
 * Create a notification sender backed by the Slack client.
 * Returns a no-op sender when notifications are disabled.
 */
export function createNotificationSender(
  slackClient: any
): NotificationSender {
  if (!isApprovalNotificationsEnabled()) {
    return {
      async sendPolicyReview() { return {}; },
      async sendBatchReview() { return {}; },
    };
  }

  return {
    async sendPolicyReview(ownerSlackId, info) {
      const msg = buildPolicyApprovalMessage(info);
      const dm = await slackClient.conversations.open({ users: ownerSlackId });
      const channelId = dm.channel?.id;
      if (!channelId) return {};
      const result = await slackClient.chat.postMessage({
        channel: channelId,
        text: msg.text,
        blocks: msg.blocks,
      });
      return { ts: result.ts };
    },

    async sendBatchReview(ownerSlackId, info) {
      const msg = buildBatchApprovalMessage(info);
      const dm = await slackClient.conversations.open({ users: ownerSlackId });
      const channelId = dm.channel?.id;
      if (!channelId) return {};
      const result = await slackClient.chat.postMessage({
        channel: channelId,
        text: msg.text,
        blocks: msg.blocks,
      });
      return { ts: result.ts };
    },
  };
}
