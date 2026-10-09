/**
 * Denise Slack Adapter — Controlled Acquisition Intelligence Notifications
 *
 * Dedicated Slack integration for Denise. Uses existing bot-factory
 * infrastructure. Posts only material, evidence-backed findings.
 *
 * NOT an autonomous conversational agent.
 * NOT activated in production during commissioning.
 */

import { getAgentTokens } from '../../lib/bot-factory.js';
import { getFeatureFlag, FEATURE_FLAGS } from '../../config/ai-controls.js';
import { getMainChannelId } from '../../config/channels.js';
import type { SupabaseClient } from './types.js';
import type { DeniseSlackPayload } from './slack-surface.js';

// ============================================================
// FEATURE FLAGS
// ============================================================

export function isDeniseSlackEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.DENISE_SLACK_ENABLED);
}

// ============================================================
// IDENTITY CONFIGURATION
// ============================================================

export interface DeniseSlackConfig {
  configured: boolean;
  botToken: string | null;
  appToken: string | null;
  channelId: string | null;
  error?: string;
}

export function getDeniseSlackConfig(): DeniseSlackConfig {
  const tokens = getAgentTokens('denise');
  if (!tokens) {
    return { configured: false, botToken: null, appToken: null, channelId: null, error: 'Missing DENISE_BOT_TOKEN or DENISE_APP_TOKEN' };
  }
  let channelId: string | null = null;
  try { channelId = getMainChannelId(); } catch { /* optional */ }

  return { configured: true, botToken: tokens.botToken, appToken: tokens.appToken, channelId };
}

// ============================================================
// NOTIFICATION QUALIFICATION
// ============================================================

export type NotificationCategory =
  | 'MATERIAL_AMENDMENT'
  | 'CRITICAL_COMPLIANCE_RISK'
  | 'SUBMISSION_CONFLICT'
  | 'HIGH_SEVERITY_RESTRICTION'
  | 'TEAMING_CONSTRAINT'
  | 'LEGAL_REVIEW_REQUIRED'
  | 'CAPTURE_REASSESSMENT';

const HIGH_SEVERITY_SET = new Set(['CRITICAL', 'HIGH']);

export interface NotificationCandidate {
  opportunityId: string;
  category: NotificationCategory;
  severity: string;
  findingSummary: string;
  sourceEvidenceId?: string;
  artifactId: string;
  artifactVersion: number;
  coverageStatus: string;
  legalReviewRequired: boolean;
  idempotencyKey: string;
}

/**
 * Determine whether a finding qualifies for proactive notification.
 * Only material, high-severity, evidence-backed findings qualify.
 */
export function qualifiesForNotification(candidate: NotificationCandidate): {
  qualifies: boolean;
  reason: string;
} {
  if (!isDeniseSlackEnabled()) {
    return { qualifies: false, reason: 'DENISE_SLACK_ENABLED is false' };
  }
  if (!HIGH_SEVERITY_SET.has(candidate.severity) && candidate.category !== 'LEGAL_REVIEW_REQUIRED') {
    return { qualifies: false, reason: `Severity ${candidate.severity} does not qualify` };
  }
  if (!candidate.artifactId) {
    return { qualifies: false, reason: 'No artifact ID — finding not persisted' };
  }
  return { qualifies: true, reason: 'Material high-severity finding with evidence' };
}

// ============================================================
// MESSAGE FORMATTING
// ============================================================

export interface DeniseSlackMessage {
  channel: string;
  text: string;
  blocks: unknown[];
  metadata: {
    notificationCategory: NotificationCategory;
    opportunityId: string;
    artifactId: string;
    artifactVersion: number;
    legalReviewRequired: boolean;
    coverageStatus: string;
    idempotencyKey: string;
  };
}

/**
 * Format a notification message with proper category separation.
 * Distinguishes source facts from interpretations.
 * Preserves PARTIAL coverage and LEGAL_REVIEW_REQUIRED warnings.
 */
export function formatNotificationMessage(
  candidate: NotificationCandidate,
  channelId: string
): DeniseSlackMessage {
  const headerEmoji = candidate.legalReviewRequired ? ':warning:' : ':memo:';
  const headerText = `DENISE — ${candidate.category.replace(/_/g, ' ')}`;

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${headerEmoji} ${headerText}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Finding:* ${candidate.findingSummary}\n*Severity:* ${candidate.severity}`,
      },
    },
  ];

  // Coverage and legal warnings
  const warnings: string[] = [];
  if (candidate.coverageStatus === 'PARTIAL') {
    warnings.push(':information_source: Coverage is PARTIAL — bounded analysis');
  }
  if (candidate.legalReviewRequired) {
    warnings.push(':scales: LEGAL REVIEW REQUIRED — this is not legal advice');
  }
  if (warnings.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: warnings.join('\n') }],
    });
  }

  // Source reference
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Opportunity: ${candidate.opportunityId} · Artifact: ${candidate.artifactId} v${candidate.artifactVersion}`,
    }],
  });

  // Human actions
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Acknowledge' },
        action_id: 'denise_acknowledge',
        value: JSON.stringify({ artifactId: candidate.artifactId, idempotencyKey: candidate.idempotencyKey }),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Request Review' },
        action_id: 'denise_request_review',
        value: JSON.stringify({ artifactId: candidate.artifactId, opportunityId: candidate.opportunityId }),
      },
    ],
  });

  return {
    channel: channelId,
    text: `${headerText}: ${candidate.findingSummary}`,
    blocks,
    metadata: {
      notificationCategory: candidate.category,
      opportunityId: candidate.opportunityId,
      artifactId: candidate.artifactId,
      artifactVersion: candidate.artifactVersion,
      legalReviewRequired: candidate.legalReviewRequired,
      coverageStatus: candidate.coverageStatus,
      idempotencyKey: candidate.idempotencyKey,
    },
  };
}

// ============================================================
// DELIVERY
// ============================================================

export type DeliveryStatus = 'DELIVERED' | 'DUPLICATE' | 'SUPPRESSED' | 'FAILED' | 'AMBIGUOUS' | 'DISABLED';

export interface DeliveryResult {
  status: DeliveryStatus;
  slackTs: string | null;
  slackChannel: string | null;
  reason: string;
}

/**
 * Record a notification delivery attempt durably.
 * Uses denise_task_claims for idempotency.
 * Does NOT actually call the Slack API — that requires live credentials.
 */
export async function recordDeliveryAttempt(
  supabase: SupabaseClient,
  candidate: NotificationCandidate,
  slackTs: string | null,
  status: DeliveryStatus,
  errorMessage?: string
): Promise<void> {
  const claimKey = `denise-slack-${candidate.idempotencyKey}`;
  const { data: claimResult } = await supabase.rpc('claim_denise_eval_task', {
    p_idempotency_key: claimKey, p_lease_seconds: 30,
  });

  if (claimResult?.[0]?.claim_status === 'COMPLETED') return; // Already delivered
  if (claimResult?.[0]?.claim_status === 'CLAIMED') {
    const claimId = claimResult[0].claim_id;
    if (status === 'DELIVERED' || status === 'DUPLICATE' || status === 'SUPPRESSED') {
      await supabase.rpc('complete_denise_eval_claim', {
        p_claim_id: claimId, p_analysis_id: candidate.artifactId,
        p_eval_model_id: null, p_ledger_id: null, p_cost_usd: 0,
      });
    } else if (status === 'AMBIGUOUS') {
      await supabase.rpc('mark_denise_eval_ambiguous', {
        p_claim_id: claimId, p_error_code: 'SLACK_AMBIGUOUS',
        p_error_message: errorMessage || 'Slack delivery outcome uncertain',
      });
    } else {
      await supabase.rpc('fail_denise_eval_claim', {
        p_claim_id: claimId, p_error_code: 'SLACK_FAILED',
        p_error_message: errorMessage || 'Delivery failed',
      });
    }
  }
}

// ============================================================
// ACTION HANDLERS (for button interactions)
// ============================================================

export interface SlackActionContext {
  userId: string;
  channelId: string;
  actionId: string;
  value: string;
  triggerId: string;
}

/**
 * Handle an acknowledgment action from a verified Slack user.
 */
export async function handleAcknowledge(
  supabase: SupabaseClient,
  context: SlackActionContext
): Promise<{ success: boolean; message: string }> {
  let parsed: { artifactId?: string; idempotencyKey?: string };
  try { parsed = JSON.parse(context.value); } catch {
    return { success: false, message: 'Invalid action payload' };
  }
  if (!parsed.artifactId) return { success: false, message: 'Missing artifact ID' };

  const ackKey = `denise-ack-${parsed.idempotencyKey || parsed.artifactId}-${context.userId}`;
  const { data } = await supabase.rpc('claim_denise_eval_task', {
    p_idempotency_key: ackKey, p_lease_seconds: 10,
  });

  if (data?.[0]?.claim_status === 'COMPLETED') {
    return { success: true, message: 'Already acknowledged' };
  }
  if (data?.[0]?.claim_status === 'CLAIMED') {
    await supabase.rpc('complete_denise_eval_claim', {
      p_claim_id: data[0].claim_id, p_analysis_id: parsed.artifactId,
      p_eval_model_id: null, p_ledger_id: null, p_cost_usd: 0,
    });
  }

  return { success: true, message: `Acknowledged by ${context.userId}` };
}

/**
 * Handle a "Request Review" action from a verified Slack user.
 * Does NOT create specialist tasks — just records the request durably.
 */
export async function handleRequestReview(
  supabase: SupabaseClient,
  context: SlackActionContext
): Promise<{ success: boolean; message: string }> {
  let parsed: { artifactId?: string; opportunityId?: string };
  try { parsed = JSON.parse(context.value); } catch {
    return { success: false, message: 'Invalid action payload' };
  }
  if (!parsed.artifactId) return { success: false, message: 'Missing artifact ID' };

  const reviewKey = `denise-review-${parsed.artifactId}-${context.userId}`;
  const { data } = await supabase.rpc('claim_denise_eval_task', {
    p_idempotency_key: reviewKey, p_lease_seconds: 10,
  });

  if (data?.[0]?.claim_status === 'COMPLETED') {
    return { success: true, message: 'Review already requested' };
  }
  if (data?.[0]?.claim_status === 'CLAIMED') {
    await supabase.rpc('complete_denise_eval_claim', {
      p_claim_id: data[0].claim_id, p_analysis_id: parsed.artifactId,
      p_eval_model_id: null, p_ledger_id: null, p_cost_usd: 0,
    });
  }

  return { success: true, message: `Review requested by ${context.userId} for ${parsed.artifactId}` };
}
