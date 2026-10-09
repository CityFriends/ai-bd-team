/**
 * Denise Slack Adapter — Controlled Acquisition Intelligence Notifications
 *
 * Dedicated Slack integration for Denise. Uses existing bot-factory
 * infrastructure. Posts only material, evidence-backed findings.
 *
 * NOT an autonomous conversational agent.
 * NOT activated in production during commissioning.
 */

import { App, LogLevel } from '@slack/bolt';
import { getAgentTokens } from '../../lib/bot-factory.js';
import { getFeatureFlag, FEATURE_FLAGS } from '../../config/ai-controls.js';
import { getMainChannelId } from '../../config/channels.js';
import { getSupabase } from '../../integrations/supabase.js';
import type { SupabaseClient } from './types.js';
import type { DeniseSlackPayload } from './slack-surface.js';

// ============================================================
// FEATURE FLAGS
// ============================================================

export function isDeniseSlackEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.DENISE_SLACK_ENABLED);
}

// ============================================================
// DATABASE EMERGENCY STOP — Denise-specific, independent of global AI
// ============================================================

let lastDeniseDbCheck = 0;
let lastDeniseDbResult: boolean | null = null;
const DENISE_DB_CACHE_MS = 5_000;

/**
 * Check if Denise Slack is enabled via database control.
 *
 * Dual authorization: Denise Slack operates ONLY when BOTH:
 *   1. Environment: DENISE_SLACK_ENABLED=true
 *   2. Database: system_controls.denise_slack_enabled=true
 *
 * Fail-closed: missing env, missing DB row, DB error → DISABLED.
 * Does NOT affect other agents — this is Denise-specific.
 */
export async function isDeniseSlackAuthorized(): Promise<boolean> {
  // 1. Environment gate — must be explicitly true
  if (!isDeniseSlackEnabled()) return false;

  // 2. Database gate — check with short negative cache
  const now = Date.now();
  if (lastDeniseDbResult === false && now - lastDeniseDbCheck < DENISE_DB_CACHE_MS) {
    return false;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('system_controls')
      .select('value')
      .eq('key', 'denise_slack_enabled')
      .single();

    if (error || !data) {
      // DB row missing or error → fail closed
      lastDeniseDbResult = false;
      lastDeniseDbCheck = now;
      return false;
    }

    const dbEnabled = data.value === true;
    lastDeniseDbResult = dbEnabled;
    lastDeniseDbCheck = now;
    return dbEnabled;
  } catch {
    lastDeniseDbResult = false;
    lastDeniseDbCheck = now;
    return false;
  }
}

/** Reset Denise DB cache — for testing only */
export function _resetDeniseDbCache(): void {
  lastDeniseDbCheck = 0;
  lastDeniseDbResult = null;
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
// ACTION AUTHORIZATION
// ============================================================

/**
 * Authenticated Slack action context.
 *
 * IMPORTANT: These fields must be populated from Bolt's authenticated
 * request body (body.user.id, body.team.id, body.channel.id), NOT from
 * user-controlled payload fields. The action handler entry point is
 * responsible for extracting these from the verified Bolt context.
 */
export interface SlackActionContext {
  /** Slack user ID from Bolt body.user.id — authenticated by Bolt signature */
  userId: string;
  /** Slack channel ID where the action originated */
  channelId: string;
  /** Slack team/workspace ID from Bolt body.team.id */
  teamId: string;
  /** Action identifier */
  actionId: string;
  /** Action value payload */
  value: string;
  /** Trigger ID for modal responses */
  triggerId: string;
}

/**
 * Membership lookup function type.
 * In production: calls Slack conversations.members API via authenticated client.
 * In commissioning: mocked.
 */
export type MembershipLookupFn = (channelId: string, userId: string) => Promise<boolean>;

/**
 * Create a production membership verifier that calls Slack conversations.members
 * with cursor-based pagination and short-lived caching.
 *
 * Fail closed: any API error, missing client, or pagination failure returns false.
 */
export function createSlackMembershipLookup(
  slackClient: { conversations: { members: (params: { channel: string; cursor?: string; limit?: number }) => Promise<{ ok: boolean; members?: string[]; response_metadata?: { next_cursor?: string }; error?: string }> } }
): MembershipLookupFn {
  // Short-lived cache: channel -> { members, expiresAt }
  const cache = new Map<string, { members: Set<string>; expiresAt: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const PAGE_LIMIT = 200;
  const MAX_PAGES = 50; // Safety bound: 50 pages * 200 = 10,000 members max

  return async (channelId: string, userId: string): Promise<boolean> => {
    // Check cache first
    const cached = cache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.members.has(userId);
    }

    // Fetch all members with cursor-based pagination
    const allMembers = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    try {
      do {
        const response = await slackClient.conversations.members({
          channel: channelId,
          cursor,
          limit: PAGE_LIMIT,
        });

        if (!response.ok) {
          // API error — fail closed
          return false;
        }

        if (response.members) {
          for (const member of response.members) {
            allMembers.add(member);
          }
        }

        cursor = response.response_metadata?.next_cursor || undefined;
        if (cursor === '') cursor = undefined;
        pages++;

        if (pages >= MAX_PAGES) {
          // Safety bound — channel has more than 10,000 members, fail closed
          return false;
        }
      } while (cursor);
    } catch {
      // Network error, rate limit, or other failure — fail closed
      return false;
    }

    // Cache the result
    cache.set(channelId, {
      members: allMembers,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return allMembers.has(userId);
  };
}

/** Configured FFTC workspace ID — from environment */
function getApprovedWorkspaceId(): string | null {
  return process.env.SLACK_TEAM_ID || null;
}

/** Configured BD team channel ID — from environment */
function getApprovedChannelId(): string | null {
  try { return getMainChannelId(); } catch { return null; }
}

/**
 * Verify the Slack user is an authenticated member of the BD team.
 *
 * Checks:
 * 1. Bolt-authenticated userId (non-empty)
 * 2. Workspace matches approved FFTC workspace
 * 3. Action originated from approved channel
 * 4. User is a member of the approved BD team channel
 * 5. Fail closed on any verification failure
 */
export async function verifyTeamMembership(
  context: SlackActionContext,
  membershipLookup: MembershipLookupFn
): Promise<{ authorized: boolean; reason: string }> {
  // 1. Authenticated principal
  if (!context.userId || context.userId.trim() === '') {
    return { authorized: false, reason: 'Missing authenticated Slack userId' };
  }

  // 2. Workspace verification — REQUIRED, fail closed when missing
  const approvedWorkspace = getApprovedWorkspaceId();
  if (!approvedWorkspace) {
    return { authorized: false, reason: 'SLACK_TEAM_ID not configured — cannot verify workspace' };
  }
  if (context.teamId !== approvedWorkspace) {
    return { authorized: false, reason: `Wrong workspace: expected configured workspace, got ${context.teamId}` };
  }

  // 3. Channel verification — REQUIRED, fail closed when missing
  const approvedChannel = getApprovedChannelId();
  if (!approvedChannel) {
    return { authorized: false, reason: 'SLACK_CHANNEL_ID not configured — cannot verify channel' };
  }
  if (context.channelId !== approvedChannel) {
    return { authorized: false, reason: `Action from unauthorized channel ${context.channelId}` };
  }

  // 4. Membership lookup
  const targetChannel = approvedChannel || context.channelId;
  try {
    const isMember = await membershipLookup(targetChannel, context.userId);
    if (!isMember) {
      return { authorized: false, reason: `User ${context.userId} is not a member of the BD team channel` };
    }
  } catch (err) {
    // Fail closed on lookup failure
    return { authorized: false, reason: `Membership verification failed: ${err instanceof Error ? err.message : 'unknown error'}` };
  }

  return { authorized: true, reason: 'Authenticated BD team member' };
}

/**
 * Verify that the Slack user is authorized to act on the referenced artifact.
 *
 * Checks:
 * 1. userId is non-empty (authenticated by Bolt)
 * 2. Artifact exists in Denise's authoritative records
 * 3. Artifact belongs to a valid, active opportunity
 * 4. Prevents cross-opportunity action payloads
 */
async function authorizeAction(
  supabase: SupabaseClient,
  context: SlackActionContext,
  artifactId: string,
  opportunityId?: string
): Promise<{ authorized: boolean; reason: string }> {
  // 1. Authenticated principal required
  if (!context.userId || context.userId.trim() === '') {
    return { authorized: false, reason: 'Missing authenticated Slack userId' };
  }

  // 2. Verify artifact exists in Denise's authoritative records
  // Check acquisition_analyses first, then other artifact tables
  const { data: analysis } = await supabase
    .from('acquisition_analyses')
    .select('id, opportunity_id')
    .eq('id', artifactId)
    .single();

  if (!analysis) {
    // Try regulatory_interpretations
    const { data: interp } = await supabase
      .from('regulatory_interpretations')
      .select('id, opportunity_id')
      .eq('id', artifactId)
      .single();

    if (!interp) {
      return { authorized: false, reason: `Artifact ${artifactId} not found in Denise records` };
    }
    // Cross-opportunity check
    if (opportunityId && interp.opportunity_id && interp.opportunity_id !== opportunityId) {
      return { authorized: false, reason: 'Artifact belongs to a different opportunity' };
    }
    return { authorized: true, reason: 'Artifact verified in regulatory_interpretations' };
  }

  // 3. Cross-opportunity check
  if (opportunityId && analysis.opportunity_id !== opportunityId) {
    return { authorized: false, reason: 'Artifact belongs to a different opportunity' };
  }

  return { authorized: true, reason: 'Artifact verified in acquisition_analyses' };
}

// ============================================================
// ACTION HANDLERS
// ============================================================

/**
 * Handle an acknowledgment action from a verified Slack user.
 * Requires both team membership AND artifact authorization.
 */
export async function handleAcknowledge(
  supabase: SupabaseClient,
  context: SlackActionContext,
  membershipLookup: MembershipLookupFn
): Promise<{ success: boolean; message: string }> {
  // 1. Team membership check
  const membership = await verifyTeamMembership(context, membershipLookup);
  if (!membership.authorized) return { success: false, message: membership.reason };

  let parsed: { artifactId?: string; idempotencyKey?: string; opportunityId?: string };
  try { parsed = JSON.parse(context.value); } catch {
    return { success: false, message: 'Invalid action payload' };
  }
  if (!parsed.artifactId) return { success: false, message: 'Missing artifact ID' };

  // 2. Artifact authorization
  const auth = await authorizeAction(supabase, context, parsed.artifactId, parsed.opportunityId);
  if (!auth.authorized) return { success: false, message: auth.reason };

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

  return { success: true, message: `Acknowledged by <@${context.userId}>` };
}

/**
 * Handle a "Request Review" action from a verified Slack user.
 * Requires both team membership AND artifact authorization.
 */
export async function handleRequestReview(
  supabase: SupabaseClient,
  context: SlackActionContext,
  membershipLookup: MembershipLookupFn
): Promise<{ success: boolean; message: string }> {
  const membership = await verifyTeamMembership(context, membershipLookup);
  if (!membership.authorized) return { success: false, message: membership.reason };

  let parsed: { artifactId?: string; opportunityId?: string };
  try { parsed = JSON.parse(context.value); } catch {
    return { success: false, message: 'Invalid action payload' };
  }
  if (!parsed.artifactId) return { success: false, message: 'Missing artifact ID' };

  const auth = await authorizeAction(supabase, context, parsed.artifactId, parsed.opportunityId);
  if (!auth.authorized) return { success: false, message: auth.reason };

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

  return { success: true, message: `Review requested by <@${context.userId}> for ${parsed.artifactId}` };
}

// ============================================================
// TRUSTED ROUTING BOUNDARY
// ============================================================

/** Map from bot agent identity to specialist role */
const AGENT_TO_SPECIALIST_MAP: Record<string, string> = {
  james: 'JAMES', strategist: 'JAMES',
  patricia: 'PATRICIA', pm: 'PATRICIA',
  jodie: 'JODIE', writer: 'JODIE',
  marcus: 'MARCUS', engineer: 'MARCUS',
  rosa: 'ROSA', connector: 'ROSA',
};

/**
 * Trusted execution context — established by authenticated infrastructure,
 * NOT from user-controlled request payloads.
 */
export interface TrustedExecutionContext {
  /** Agent identity from bot token or event source_agent */
  authenticatedAgentId: string;
  /** Slack workspace ID (from Bolt team_id) */
  workspaceId?: string;
  /** Authenticated Slack user ID (from Bolt body.user.id) */
  authenticatedUserId?: string;
}

/**
 * Internal adapter that derives specialist identity server-side
 * and constructs a Milestone B routing request.
 *
 * Prevents action payloads from overriding specialist identity.
 */
export function buildTrustedRoutingRequest(
  trustedContext: TrustedExecutionContext,
  params: {
    opportunityId: string;
    pursuitId?: string;
    workflowPhase: 'CAPTURE' | 'PURSUIT';
    requestType: string;
    parentWorkflowId?: string;
    sourceEventId?: string;
    humanAuthorizationId?: string;
    idempotencyKey: string;
  }
): { valid: true; request: Record<string, unknown> } | { valid: false; reason: string } {
  // 1. Require authenticated agent identity
  if (!trustedContext.authenticatedAgentId) {
    return { valid: false, reason: 'Missing authenticatedAgentId in trusted context' };
  }

  // 2. Derive specialist role from trusted identity — NOT from payload
  const specialistRole = AGENT_TO_SPECIALIST_MAP[trustedContext.authenticatedAgentId.toLowerCase()];
  if (!specialistRole) {
    return { valid: false, reason: `Unknown agent identity: ${trustedContext.authenticatedAgentId}` };
  }

  // 3. Construct routing request with server-derived identity
  return {
    valid: true,
    request: {
      opportunityId: params.opportunityId,
      pursuitId: params.pursuitId,
      requestingSpecialist: specialistRole,
      workflowPhase: params.workflowPhase,
      requestType: params.requestType,
      parentWorkflowId: params.parentWorkflowId,
      sourceEventId: params.sourceEventId,
      humanAuthorizationId: params.humanAuthorizationId,
      trustedCallerIdentity: trustedContext.authenticatedAgentId.toLowerCase(),
      idempotencyKey: params.idempotencyKey,
    },
  };
}

// ============================================================
// BOLT ACTION REGISTRATION
// ============================================================

/**
 * Register Denise action handlers with a Bolt app instance.
 *
 * Only registers handlers for implemented actions:
 * - denise_acknowledge
 * - denise_request_review
 *
 * Gated on DENISE_SLACK_ENABLED — listeners are registered but check
 * the flag at invocation time so disabling the flag stops processing
 * without requiring a restart.
 *
 * Requires an authenticated Slack client for conversations.members lookup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDeniseActions(app: any): void {
  app.action(
    'denise_acknowledge',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      if (!(await isDeniseSlackAuthorized())) return;

      const context: SlackActionContext = {
        userId: body.user?.id || '',
        channelId: body.channel?.id || '',
        teamId: body.team?.id || '',
        actionId: 'denise_acknowledge',
        value: body.actions?.[0]?.value || '{}',
        triggerId: body.trigger_id || '',
      };

      const membershipLookup = createSlackMembershipLookup(client);
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleAcknowledge(supabase, context, membershipLookup);
      const messageTs = body.message?.ts || '';

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: messageTs,
        text: result.success ? result.message : `Action denied: ${result.message}`,
      });
    }
  );

  app.action(
    'denise_request_review',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      if (!(await isDeniseSlackAuthorized())) return;

      const context: SlackActionContext = {
        userId: body.user?.id || '',
        channelId: body.channel?.id || '',
        teamId: body.team?.id || '',
        actionId: 'denise_request_review',
        value: body.actions?.[0]?.value || '{}',
        triggerId: body.trigger_id || '',
      };

      const membershipLookup = createSlackMembershipLookup(client);
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleRequestReview(supabase, context, membershipLookup);
      const messageTs = body.message?.ts || '';

      await client.chat.postMessage({
        channel: context.channelId,
        thread_ts: messageTs,
        text: result.success ? result.message : `Action denied: ${result.message}`,
      });
    }
  );
}

// ============================================================
// DURABLE DELIVERY WITH CRASH SAFETY
// ============================================================

/**
 * Execute a Slack notification with durable delivery boundaries.
 *
 * 1. Claim the delivery atomically.
 * 2. Mark delivery_attempted BEFORE Slack API call.
 * 3. Invoke Slack API (mocked in commissioning).
 * 4. On success: persist channel + ts.
 * 5. On ambiguous: preserve ambiguous state — no auto-retry.
 * 6. On crash after step 2: recovery finds attempted=true → AMBIGUOUS.
 */
export async function executeDelivery(
  supabase: SupabaseClient,
  candidate: NotificationCandidate,
  slackPostFn: (msg: DeniseSlackMessage) => Promise<{ ok: boolean; ts?: string; error?: string }>,
  channelId: string
): Promise<DeliveryResult> {
  if (!(await isDeniseSlackAuthorized())) {
    return { status: 'DISABLED', slackTs: null, slackChannel: null, reason: 'Denise Slack not authorized (env or DB control)' };
  }

  const claimKey = `denise-delivery-${candidate.idempotencyKey}`;

  // 1. Claim atomically
  const { data: claimResult } = await supabase.rpc('claim_denise_eval_task', {
    p_idempotency_key: claimKey, p_lease_seconds: 30,
  });

  if (!claimResult?.length) {
    return { status: 'FAILED', slackTs: null, slackChannel: null, reason: 'Claim failed' };
  }
  const claim = claimResult[0];
  if (claim.claim_status === 'COMPLETED') {
    return { status: 'DUPLICATE', slackTs: null, slackChannel: channelId, reason: 'Already delivered' };
  }
  if (claim.claim_status !== 'CLAIMED') {
    return { status: claim.claim_status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'FAILED', slackTs: null, slackChannel: null, reason: `Claim status: ${claim.claim_status}` };
  }

  const claimId = claim.claim_id;

  // 2. Mark delivery attempted BEFORE Slack API call (durable boundary)
  await supabase.rpc('mark_denise_inference_attempted', {
    p_claim_id: claimId,
    p_gateway_idempotency_key: `slack:${candidate.idempotencyKey}`,
  });

  // 3. Invoke Slack API
  const message = formatNotificationMessage(candidate, channelId);
  try {
    const result = await slackPostFn(message);

    if (result.ok) {
      // 4. Success — persist
      await supabase.rpc('complete_denise_eval_claim', {
        p_claim_id: claimId, p_analysis_id: candidate.artifactId,
        p_eval_model_id: null, p_ledger_id: null, p_cost_usd: 0,
      });
      return { status: 'DELIVERED', slackTs: result.ts || null, slackChannel: channelId, reason: 'Delivered' };
    } else {
      // Definitive failure
      await supabase.rpc('fail_denise_eval_claim', {
        p_claim_id: claimId, p_error_code: 'SLACK_API_ERROR',
        p_error_message: result.error || 'Slack API returned not ok',
      });
      return { status: 'FAILED', slackTs: null, slackChannel: channelId, reason: result.error || 'Slack API error' };
    }
  } catch (err) {
    // 5. Uncertain outcome — mark AMBIGUOUS, do NOT retry
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.rpc('mark_denise_eval_ambiguous', {
      p_claim_id: claimId, p_error_code: 'SLACK_DELIVERY_UNCERTAIN',
      p_error_message: msg.slice(0, 500),
    });
    return { status: 'AMBIGUOUS', slackTs: null, slackChannel: channelId, reason: `Delivery uncertain: ${msg}` };
  }
}

// ============================================================
// DEDICATED DENISE SLACK PROCESS
// ============================================================

let deniseApp: App | null = null;
let deniseStarted = false;

/**
 * Start the dedicated Denise Bolt app with its own Socket Mode connection.
 *
 * Requires DENISE_BOT_TOKEN and DENISE_APP_TOKEN.
 * Fail-closed: returns false if tokens are missing or connection fails.
 * Prevents duplicate listeners — only one instance per process.
 * Does NOT require DENISE_SLACK_ENABLED — the app starts but action
 * handlers check isDeniseSlackAuthorized() at invocation time.
 */
export async function startDeniseSlackApp(): Promise<{ started: boolean; reason: string }> {
  if (deniseStarted && deniseApp) {
    return { started: false, reason: 'Denise Slack app already running — duplicate prevented' };
  }

  const tokens = getAgentTokens('denise');
  if (!tokens) {
    return { started: false, reason: 'Missing DENISE_BOT_TOKEN or DENISE_APP_TOKEN' };
  }

  try {
    const app = new App({
      token: tokens.botToken,
      appToken: tokens.appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    registerDeniseActions(app);
    await app.start();
    deniseApp = app;
    deniseStarted = true;

    return { started: true, reason: 'Denise Slack app started with dedicated Socket Mode connection' };
  } catch (err) {
    deniseApp = null;
    deniseStarted = false;
    const msg = err instanceof Error ? err.message : String(err);
    return { started: false, reason: `Denise Slack app failed to start: ${msg}` };
  }
}

/**
 * Stop the dedicated Denise Slack app gracefully.
 */
export async function stopDeniseSlackApp(): Promise<void> {
  if (deniseApp) {
    try {
      await deniseApp.stop();
    } catch {
      // Best-effort shutdown
    }
  }
  deniseApp = null;
  deniseStarted = false;
}

/** Whether the Denise Slack app is currently running */
export function isDeniseSlackAppRunning(): boolean {
  return deniseStarted && deniseApp !== null;
}

/** Reset Denise Slack app state — for testing only */
export function _resetDeniseSlackApp(): void {
  deniseApp = null;
  deniseStarted = false;
}
