/**
 * Maya Slack Surface
 *
 * Slack is presentation, not authority. DB state comes first.
 *
 * EVALUATE → Slack opportunity brief with buttons
 * WATCH/PASS → no Slack post
 */

import type { MayaDecision } from './task-processor.js';
import { emitEvent, MAYA_EVENT_TYPES } from './events.js';

// ============================================================
// Slack Projection Control
// ============================================================

/**
 * Check if Slack projection is enabled.
 * Stage B: AI review enabled, Slack projection disabled.
 * Stage C: Slack projection explicitly enabled.
 * Fail closed if not explicitly set to 'true'.
 */
export function isSlackProjectionEnabled(): boolean {
  const val = process.env.MAYA_SLACK_PROJECTION_ENABLED;
  return val !== undefined && val.toLowerCase() === 'true';
}

// ============================================================
// Slack Message Formatting
// ============================================================

export function formatOpportunityBrief(
  opp: {
    title: string;
    agency: string | null;
    setAside: string | null;
    naics: string | null;
    responseDeadline: string | null;
    sourceUrl: string | null;
  },
  decision: MayaDecision,
  materialHash?: string,
  opportunityId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { text: string; blocks: any[] } {
  const text = `MAYA — Opportunity Intelligence\n\n*${opp.title}*\nAgency: ${opp.agency || 'Unknown'}\nRecommendation: ${decision.recommendation} (${decision.confidence}%)`;

  // Encode material version and opportunity ID in button values for stable command identity.
  // Format: {materialHash}:{opportunityId}:{action} or {opportunityId}:{action} or {action}
  const hashPrefix = materialHash ? `${materialHash}:` : '';
  const oppPrefix = opportunityId ? `${opportunityId}:` : '';
  const buttonValuePrefix = `${hashPrefix}${oppPrefix}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: 'MAYA — Opportunity Intelligence' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${opp.title}*\n` +
          `Agency: ${opp.agency || 'Unknown'}\n` +
          `Set-aside: ${opp.setAside || 'None'}\n` +
          `NAICS: ${opp.naics || 'N/A'}` +
          (opp.responseDeadline ? `\nDeadline: ${opp.responseDeadline.slice(0, 10)}` : ''),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*Why this deserves attention:*\n' + decision.fitReasons.map((r) => `• ${r}`).join('\n'),
      },
    },
  ];

  if (decision.concerns.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Concerns:*\n' + decision.concerns.map((c) => `• ${c}`).join('\n'),
      },
    });
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommendation:* ${decision.recommendation} | *Confidence:* ${decision.confidence}%`,
      },
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Send to Capture' },
          style: 'primary',
          action_id: 'maya_send_to_capture',
          value: `${buttonValuePrefix}capture`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'More Research' },
          action_id: 'maya_more_research',
          value: `${buttonValuePrefix}research`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          style: 'danger',
          action_id: 'maya_dismiss',
          value: `${buttonValuePrefix}dismiss`,
        },
      ],
    }
  );

  if (opp.sourceUrl) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${opp.sourceUrl}|View on SAM.gov>` }],
    });
  }

  return { text, blocks };
}

// ============================================================
// Post Brief to Slack
// ============================================================

export async function postOpportunityBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient: any,
  channelId: string,
  opportunityId: string,
  taskId: string,
  opp: {
    title: string;
    agency: string | null;
    setAside: string | null;
    naics: string | null;
    responseDeadline: string | null;
    sourceUrl: string | null;
  },
  decision: MayaDecision,
  materialHash?: string
): Promise<{ success: boolean; messageTs?: string }> {
  // Only post EVALUATE
  if (decision.recommendation !== 'EVALUATE') return { success: true };

  // Stage B control: Slack projection must be explicitly enabled
  if (!isSlackProjectionEnabled()) {
    console.log(`[SlackSurface] Slack projection disabled — skipping post for ${opportunityId}`);
    return { success: true };
  }

  // Respect human dismissals — authoritative pipeline state overrides AI recommendations.
  // Check both this source_id AND by solicitation_number, because SAM.gov can republish
  // the same solicitation under a different UUID.
  const { data: oppState } = await supabase
    .from('pipeline_opportunities')
    .select('human_action, solicitation_number')
    .eq('source_id', opportunityId)
    .single();
  if (oppState?.human_action === 'DISMISSED') {
    console.log(`[SlackSurface] Opportunity ${opportunityId} dismissed by owner — skipping Slack post`);
    return { success: true };
  }
  if (oppState?.solicitation_number) {
    const { data: solDismissed } = await supabase
      .from('pipeline_opportunities')
      .select('source_id')
      .eq('solicitation_number', oppState.solicitation_number)
      .eq('human_action', 'DISMISSED')
      .limit(1);
    if (solDismissed && solDismissed.length > 0) {
      console.log(
        `[SlackSurface] Solicitation ${oppState.solicitation_number} dismissed on ${solDismissed[0].source_id} — skipping Slack post for ${opportunityId}`
      );
      return { success: true };
    }
  }

  // Check for existing brief in any terminal or active state (idempotent).
  // Previous check only looked for status='posted', missing dismissed/capture_sent briefs.
  const { data: existing } = await supabase
    .from('slack_opportunity_briefs')
    .select('id, message_ts, status, maya_task_id')
    .eq('opportunity_id', opportunityId)
    .single();

  if (existing) {
    // Terminal states: do not re-post
    if (existing.status === 'dismissed' || existing.status === 'capture_sent') {
      return { success: true, messageTs: existing.message_ts || undefined };
    }
    // Already posted with a valid Slack message
    if (existing.status === 'posted' && existing.message_ts) {
      return { success: true, messageTs: existing.message_ts };
    }
  }

  // Atomically claim a brief record BEFORE posting to Slack.
  //
  // Insert path: unique constraint on opportunity_id rejects concurrent inserts.
  // Update path: CAS on maya_task_id — only the first writer succeeds because
  //   PostgreSQL row-level locking ensures the second UPDATE evaluates WHERE
  //   against the committed value (which the first writer already changed).
  let briefId: string;
  if (existing) {
    // CAS: claim only if maya_task_id still matches what we read.
    // Worker A: UPDATE SET maya_task_id='task-A' WHERE maya_task_id='old' → succeeds
    // Worker B: UPDATE SET maya_task_id='task-B' WHERE maya_task_id='old' → blocked, then fails
    //   (maya_task_id is now 'task-A', not 'old')
    const casFilter = existing.maya_task_id
      ? supabase
          .from('slack_opportunity_briefs')
          .update({
            maya_task_id: taskId,
            channel_id: channelId,
            thread_owner: 'MAYA',
            status: 'pending',
            decision_version: 'v1',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .neq('status', 'posted')
          .eq('maya_task_id', existing.maya_task_id)
      : supabase
          .from('slack_opportunity_briefs')
          .update({
            maya_task_id: taskId,
            channel_id: channelId,
            thread_owner: 'MAYA',
            status: 'pending',
            decision_version: 'v1',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .neq('status', 'posted')
          .is('maya_task_id', null);

    const { data: claimed, error: updateErr } = await casFilter.select('id').single();
    if (updateErr || !claimed) {
      console.log(`[SlackSurface] Brief ${existing.id} already claimed or posted — skipping`);
      return { success: true };
    }
    briefId = claimed.id;
  } else {
    // No existing row — insert. With unique constraint, concurrent inserts are rejected.
    const { data: inserted, error: insertErr } = await supabase
      .from('slack_opportunity_briefs')
      .insert({
        opportunity_id: opportunityId,
        maya_task_id: taskId,
        channel_id: channelId,
        thread_owner: 'MAYA',
        status: 'pending',
        decision_version: 'v1',
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      // Unique violation on concurrent insert, or other DB error
      console.error(
        `[SlackSurface] Brief insert failed for ${opportunityId}:`,
        insertErr?.message || 'no data returned'
      );
      return { success: false };
    }
    briefId = inserted.id;
  }

  try {
    const { text, blocks } = formatOpportunityBrief(opp, decision, materialHash, opportunityId);

    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (result.ok && result.ts) {
      // Update brief with Slack data — briefId is guaranteed valid
      const { error: tsUpdateErr } = await supabase
        .from('slack_opportunity_briefs')
        .update({
          message_ts: result.ts,
          thread_ts: result.ts,
          status: 'posted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', briefId);

      if (tsUpdateErr) {
        // Critical: Slack message posted but DB not updated — log for reconciliation
        console.error(
          `[SlackSurface] CRITICAL: Slack posted but message_ts update failed for brief ${briefId}:`,
          tsUpdateErr.message
        );
      }

      // Update opportunity with Slack ref
      await supabase
        .from('pipeline_opportunities')
        .update({
          slack_brief_id: briefId,
        })
        .eq('source_id', opportunityId);

      // Emit event
      await emitEvent(supabase, {
        eventType: MAYA_EVENT_TYPES.SLACK_OPPORTUNITY_BRIEF_POSTED,
        aggregateType: 'opportunity',
        aggregateId: opportunityId,
        opportunityId,
        actorType: 'AGENT',
        actorId: 'maya',
        source: 'slack-surface',
        correlationId: `opp:${opportunityId}`,
        idempotencyKey: `slack:brief:${opportunityId}:${decision.recommendation}`,
        schemaVersion: 1,
        payload: { messageTs: result.ts, recommendation: decision.recommendation, materialHash },
      });

      return { success: true, messageTs: result.ts };
    }

    throw new Error(`Slack post failed: ${result.error || 'unknown'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('slack_opportunity_briefs')
      .update({
        projection_attempts: 1,
        last_projection_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', briefId);

    await emitEvent(supabase, {
      eventType: MAYA_EVENT_TYPES.SLACK_PROJECTION_FAILED,
      aggregateType: 'opportunity',
      aggregateId: opportunityId,
      opportunityId,
      actorType: 'SYSTEM',
      source: 'slack-surface',
      correlationId: `opp:${opportunityId}`,
      idempotencyKey: `slack:fail:${opportunityId}:${Date.now()}`,
      schemaVersion: 1,
      payload: { error: msg },
    });

    return { success: false };
  }
}

/**
 * Retry Slack projection for an opportunity that already has a Maya decision.
 * Does NOT repeat inference. Only retries the Slack post.
 */
export async function retrySlackProjection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient: any,
  channelId: string,
  opportunityId: string
): Promise<{ success: boolean; messageTs?: string }> {
  if (!isSlackProjectionEnabled()) return { success: false };

  // Respect human dismissals (same check as postOpportunityBrief)
  const { data: oppState } = await supabase
    .from('pipeline_opportunities')
    .select('human_action, solicitation_number')
    .eq('source_id', opportunityId)
    .single();
  if (oppState?.human_action === 'DISMISSED') return { success: false };
  if (oppState?.solicitation_number) {
    const { data: solDismissed } = await supabase
      .from('pipeline_opportunities')
      .select('source_id')
      .eq('solicitation_number', oppState.solicitation_number)
      .eq('human_action', 'DISMISSED')
      .limit(1);
    if (solDismissed && solDismissed.length > 0) return { success: false };
  }

  // Load existing brief
  const { data: brief } = await supabase
    .from('slack_opportunity_briefs')
    .select('id, status, message_ts, projection_attempts')
    .eq('opportunity_id', opportunityId)
    .single();

  if (!brief) return { success: false };

  // Already posted or terminal — no retry needed
  if (brief.status === 'posted' && brief.message_ts) {
    return { success: true, messageTs: brief.message_ts };
  }
  if (brief.status === 'dismissed' || brief.status === 'capture_sent') {
    return { success: false };
  }

  // Load opportunity and decision
  const { data: opp } = await supabase
    .from('pipeline_opportunities')
    .select(
      'title, agency, set_aside, naics, response_deadline, source_url, maya_quick_review, material_hash'
    )
    .eq('source_id', opportunityId)
    .single();

  if (!opp?.maya_quick_review) return { success: false };

  const decision = opp.maya_quick_review as MayaDecision;
  if (decision.recommendation !== 'EVALUATE') return { success: true };

  try {
    const { text, blocks } = formatOpportunityBrief(
      {
        title: opp.title,
        agency: opp.agency,
        setAside: opp.set_aside,
        naics: opp.naics,
        responseDeadline: opp.response_deadline,
        sourceUrl: opp.source_url,
      },
      decision,
      opp.material_hash,
      opportunityId
    );

    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (result.ok && result.ts) {
      const { error: updateErr } = await supabase
        .from('slack_opportunity_briefs')
        .update({
          message_ts: result.ts,
          thread_ts: result.ts,
          status: 'posted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', brief.id);

      if (updateErr) {
        console.error(
          `[SlackSurface] CRITICAL: Slack retry posted but message_ts update failed for brief ${brief.id}:`,
          updateErr.message
        );
      }

      return { success: true, messageTs: result.ts };
    }

    throw new Error(`Slack retry failed: ${result.error || 'unknown'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('slack_opportunity_briefs')
      .update({
        projection_attempts: (brief.projection_attempts || 0) + 1,
        last_projection_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', brief.id);
    return { success: false };
  }
}

// ============================================================
// Authorized Users — Fail Closed in Production
// ============================================================

const AUTHORIZED_USERS_RAW =
  process.env.SLACK_AUTHORIZED_USERS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) || [];
const AUTHORIZED_USERS = new Set(AUTHORIZED_USERS_RAW);

/**
 * Explicit development mode override.
 * Must be set to 'true' explicitly — missing = production behavior (fail closed).
 */
function isDevelopmentMode(): boolean {
  const val = process.env.MAYA_DEV_MODE;
  return val !== undefined && val.toLowerCase() === 'true';
}

export function isAuthorizedUser(userId: string): boolean {
  // Production: missing/empty allowlist → deny all consequential actions
  if (AUTHORIZED_USERS.size === 0) {
    if (isDevelopmentMode()) {
      console.warn('[SlackSurface] DEV MODE — allowing all users (MAYA_DEV_MODE=true)');
      return true;
    }
    console.warn('[SlackSurface] No authorized users configured — denying action (fail closed)');
    return false;
  }
  return AUTHORIZED_USERS.has(userId);
}

// ============================================================
// Button Handlers
// ============================================================

/** Structured dismissal reasons */
export const DISMISSAL_REASONS = {
  NOT_FIT: 'NOT_FIT',
  TOO_LATE: 'TOO_LATE',
  VEHICLE_ACCESS: 'VEHICLE_ACCESS',
  CAPABILITY_GAP: 'CAPABILITY_GAP',
  ALREADY_KNEW: 'ALREADY_KNEW',
  OTHER: 'OTHER',
} as const;

export type DismissalReason = (typeof DISMISSAL_REASONS)[keyof typeof DISMISSAL_REASONS];

/**
 * Validate current opportunity state before executing action.
 * Returns null if valid, error message if stale.
 *
 * Version-aware: if buttonMaterialHash is provided, checks that it matches
 * the current material_hash on the brief. Stale buttons from superseded
 * evidence versions are rejected.
 */
async function validateActionState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  expectedStatuses: string[],
  buttonMaterialHash?: string
): Promise<{ error: string | null; materialHash?: string }> {
  const { data: brief } = await supabase
    .from('slack_opportunity_briefs')
    .select('status')
    .eq('opportunity_id', opportunityId)
    .single();

  if (!brief) return { error: 'Opportunity brief not found.' };
  if (!expectedStatuses.includes(brief.status)) {
    return {
      error: `This opportunity has already been ${brief.status}. No further action needed.`,
    };
  }

  // Version-aware: check current material hash from pipeline_opportunities
  // (slack_opportunity_briefs.material_hash may not exist pre-migration)
  if (buttonMaterialHash) {
    const { data: opp } = await supabase
      .from('pipeline_opportunities')
      .select('material_hash')
      .eq('source_id', opportunityId)
      .single();
    const currentMaterialHash = opp?.material_hash;
    if (currentMaterialHash && buttonMaterialHash !== currentMaterialHash) {
      return {
        error:
          'This opportunity has been updated since this brief was posted. Please use the latest brief.',
      };
    }
  }

  // Get current material hash for version-aware idempotency keys
  const { data: oppForHash } = await supabase
    .from('pipeline_opportunities')
    .select('material_hash')
    .eq('source_id', opportunityId)
    .single();

  return { error: null, materialHash: oppForHash?.material_hash };
}

/**
 * Parse material hash and opportunity ID from button value.
 * Button values are formatted as:
 *   "{materialHash}:{opportunityId}:{action}" (new format with stable ID)
 *   "{materialHash}:{action}" (legacy format)
 *   "{action}" (no version info)
 *
 * Material hashes are hex strings ≥8 chars. Opportunity IDs contain '--' (SAM format).
 */
export function parseButtonValue(value: string | undefined): {
  materialHash?: string;
  opportunityId?: string;
} {
  if (!value) return {};
  const parts = value.split(':');

  // New format: {hash}:{oppId}:{action} — 3+ parts, first is hex hash, second contains '--'
  if (parts.length >= 3 && parts[0].length >= 8) {
    // Rejoin middle parts in case opportunityId itself contains ':'
    const middle = parts.slice(1, -1).join(':');
    if (middle.includes('--')) {
      return { materialHash: parts[0], opportunityId: middle };
    }
    // Legacy 3-part with no '--': treat as {hash}:{action}:{extra}
    return { materialHash: parts[0] };
  }

  // Legacy format: {hash}:{action}
  if (parts.length >= 2 && parts[0].length >= 8) {
    return { materialHash: parts[0] };
  }
  return {};
}

export async function handleSendToCapture(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  userId: string,
  messageTs: string,
  buttonMaterialHash?: string
): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedUser(userId)) return { success: false, message: 'Not authorized.' };

  const { error: staleErr, materialHash } = await validateActionState(
    supabase,
    opportunityId,
    ['posted', 'acknowledged'],
    buttonMaterialHash
  );
  if (staleErr) return { success: false, message: staleErr };

  // Version-aware idempotency key includes material hash
  const versionSuffix = materialHash ? `:${materialHash}` : '';
  const idempKey = `action:capture:${opportunityId}${versionSuffix}`;
  const eventId = await emitEvent(supabase, {
    eventType: MAYA_EVENT_TYPES.SEND_TO_CAPTURE,
    aggregateType: 'opportunity',
    aggregateId: opportunityId,
    opportunityId,
    actorType: 'HUMAN',
    actorId: userId,
    source: 'slack',
    correlationId: `opp:${opportunityId}`,
    idempotencyKey: idempKey,
    schemaVersion: 1,
    payload: { messageTs, materialHash },
  });

  if (eventId) {
    // State mutation paired with event — both write or reconcile
    await supabase
      .from('slack_opportunity_briefs')
      .update({
        human_action: 'SEND_TO_CAPTURE',
        human_action_by: userId,
        human_action_at: new Date().toISOString(),
        status: 'capture_sent',
      })
      .eq('opportunity_id', opportunityId);

    await supabase
      .from('pipeline_opportunities')
      .update({
        human_action: 'SEND_TO_CAPTURE',
        human_action_by: userId,
        human_action_at: new Date().toISOString(),
      })
      .eq('source_id', opportunityId);
  }

  // Create capture aggregate (fast, bounded — no James inference here)
  try {
    const { createCapture } = await import('../james/capture-manager.js');

    // Get material hash and thread info from the opportunity brief
    const { data: oppData } = await supabase
      .from('pipeline_opportunities')
      .select('material_hash')
      .eq('source_id', opportunityId)
      .single();

    const { data: briefData } = await supabase
      .from('slack_opportunity_briefs')
      .select('channel_id, thread_ts, message_ts')
      .eq('opportunity_id', opportunityId)
      .single();

    if (oppData?.material_hash && briefData) {
      await createCapture(
        supabase,
        opportunityId,
        oppData.material_hash,
        userId,
        eventId || 'unknown',
        briefData.channel_id || '',
        briefData.thread_ts || briefData.message_ts || ''
      );
    }
  } catch (captureErr) {
    console.error(
      '[SlackSurface] Capture creation failed (non-blocking):',
      captureErr instanceof Error ? captureErr.message : captureErr
    );
  }

  return {
    success: true,
    message: 'Capture initiated. James is evaluating this opportunity.',
  };
}

export async function handleMoreResearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  userId: string,
  messageTs: string,
  buttonMaterialHash?: string
): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedUser(userId)) return { success: false, message: 'Not authorized.' };
  const { error: staleErr, materialHash } = await validateActionState(
    supabase,
    opportunityId,
    ['posted', 'acknowledged'],
    buttonMaterialHash
  );
  if (staleErr) return { success: false, message: staleErr };

  const versionSuffix = materialHash ? `:${materialHash}` : '';
  await emitEvent(supabase, {
    eventType: MAYA_EVENT_TYPES.MAYA_MORE_RESEARCH_REQUESTED,
    aggregateType: 'opportunity',
    aggregateId: opportunityId,
    opportunityId,
    actorType: 'HUMAN',
    actorId: userId,
    source: 'slack',
    correlationId: `opp:${opportunityId}`,
    idempotencyKey: `action:research:${opportunityId}${versionSuffix}`,
    schemaVersion: 1,
    payload: { messageTs, materialHash },
  });

  // ============================================================
  // Bounded deterministic evidence refresh
  // Fetch fresh evidence from SAM attachments and compare material hash.
  // ZERO LLM if no new evidence. At most ONE new review task if material changed.
  // ============================================================
  try {
    const { data: opp } = await supabase
      .from('pipeline_opportunities')
      .select('source_id, title, description, attachments, material_hash, evidence_hash')
      .eq('source_id', opportunityId)
      .single();

    if (!opp) return { success: true, message: 'Opportunity not found for research.' };

    const attachments = opp.attachments || [];
    if (attachments.length === 0) {
      return {
        success: true,
        message: 'No additional authoritative evidence sources available for this opportunity.',
      };
    }

    // Re-acquire evidence from attachments
    const { acquireOpportunityEvidence, DEFAULT_ACQUISITION_CONFIG } =
      await import('../../services/evidence/document-acquisition.js');
    const enrichmentConfig = {
      ...DEFAULT_ACQUISITION_CONFIG,
      maxDocumentsPerOpportunity: 3,
      requestTimeoutMs: 15_000,
      opportunityTimeoutMs: 45_000,
    };
    const ev = await acquireOpportunityEvidence(opportunityId, attachments, enrichmentConfig);

    if (ev.extractionCharacterCount === 0) {
      return { success: true, message: 'No material new evidence found.' };
    }

    // Compute new evidence hash and compare
    const { createHash } = await import('crypto');
    const enrichedDescription = `${opp.description || ''}\n\n${ev.extractedScopeText}`.trim();
    const newEvidenceHash = createHash('sha256')
      .update(enrichedDescription)
      .digest('hex')
      .slice(0, 16);

    if (newEvidenceHash === opp.evidence_hash) {
      // Same evidence — no new material
      return { success: true, message: 'No material new evidence found.' };
    }

    // New evidence found — compute new material hash
    const { computeMaterialHash } = await import('../../pipeline/maya/change-detect.js');
    const { data: fullOpp } = await supabase
      .from('pipeline_opportunities')
      .select('*')
      .eq('source_id', opportunityId)
      .single();

    // Build normalized opp for hash computation
    const normalizedForHash = {
      sourceId: fullOpp.source_id,
      source: fullOpp.source,
      solicitationNumber: fullOpp.solicitation_number,
      title: fullOpp.title,
      description: enrichedDescription,
      synopsis: null,
      agency: fullOpp.agency,
      subAgency: fullOpp.sub_agency,
      office: fullOpp.office,
      noticeType: fullOpp.notice_type,
      naics: fullOpp.naics,
      psc: fullOpp.psc,
      setAside: fullOpp.set_aside,
      setAsideDescription: fullOpp.set_aside_description,
      postedDate: fullOpp.posted_date,
      responseDeadline: fullOpp.response_deadline,
      estimatedValue: fullOpp.estimated_value ? Number(fullOpp.estimated_value) : null,
      placeOfPerformance: fullOpp.place_of_performance,
      vehicle: null,
      sourceUrl: fullOpp.source_url,
      attachments: fullOpp.attachments || [],
      active: fullOpp.active,
      archived: fullOpp.archived,
      cancelled: fullOpp.cancelled,
      rawHash: fullOpp.raw_hash,
      materialHash: fullOpp.material_hash,
    };
    const newMaterialHash = computeMaterialHash(normalizedForHash);

    if (newMaterialHash === opp.material_hash) {
      return { success: true, message: 'No material new evidence found.' };
    }

    // Update opportunity with enriched description and new hashes
    await supabase
      .from('pipeline_opportunities')
      .update({
        description: enrichedDescription,
        evidence_hash: newEvidenceHash,
        material_hash: newMaterialHash,
        last_scored_at: new Date().toISOString(),
      })
      .eq('source_id', opportunityId);

    // Check if review task already exists for this new material version
    const reviewIdempKey = `review:${opportunityId}:${newMaterialHash}:v1`;
    const { data: existingTask } = await supabase
      .from('maya_review_tasks')
      .select('id')
      .eq('idempotency_key', reviewIdempKey)
      .single();

    if (!existingTask) {
      // Create exactly ONE new versioned review task
      await supabase.from('maya_review_tasks').upsert(
        {
          opportunity_id: opportunityId,
          material_hash: newMaterialHash,
          contract_version: 'v1',
          idempotency_key: reviewIdempKey,
          status: 'pending',
          scorer_version: 'v1',
          evidence_hash: newEvidenceHash,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true }
      );

      // Emit material change event
      await emitEvent(supabase, {
        eventType: MAYA_EVENT_TYPES.OPPORTUNITY_MATERIAL_CHANGE,
        aggregateType: 'opportunity',
        aggregateId: opportunityId,
        opportunityId,
        actorType: 'SYSTEM',
        source: 'more-research',
        correlationId: `opp:${opportunityId}`,
        idempotencyKey: `material:${opportunityId}:${newMaterialHash}`,
        schemaVersion: 1,
        payload: {
          previousHash: opp.material_hash,
          newHash: newMaterialHash,
          trigger: 'more_research',
        },
      });

      return {
        success: true,
        message:
          'New evidence found. Maya will re-evaluate this opportunity with updated information.',
      };
    }

    return {
      success: true,
      message: 'New evidence was already identified. Re-evaluation is pending.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SlackSurface] More Research evidence refresh failed:`, msg);
    return {
      success: true,
      message: 'Evidence refresh encountered an error. The request has been recorded.',
    };
  }
}

export async function handleDismiss(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  userId: string,
  messageTs: string,
  reason?: DismissalReason,
  note?: string,
  buttonMaterialHash?: string
): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedUser(userId)) return { success: false, message: 'Not authorized.' };
  const { error: staleErr, materialHash } = await validateActionState(
    supabase,
    opportunityId,
    ['posted', 'acknowledged'],
    buttonMaterialHash
  );
  if (staleErr) return { success: false, message: staleErr };

  const versionSuffix = materialHash ? `:${materialHash}` : '';
  const idempKey = `action:dismiss:${opportunityId}${versionSuffix}`;

  // Emit event first — if this succeeds but state mutation fails,
  // the event serves as the authoritative record for reconciliation.
  const eventId = await emitEvent(supabase, {
    eventType: MAYA_EVENT_TYPES.CANDIDATE_DISMISSED,
    aggregateType: 'opportunity',
    aggregateId: opportunityId,
    opportunityId,
    actorType: 'HUMAN',
    actorId: userId,
    source: 'slack',
    correlationId: `opp:${opportunityId}`,
    idempotencyKey: idempKey,
    schemaVersion: 1,
    payload: { messageTs, reason: reason || null, note: note || null, materialHash },
  });

  // State mutation — if event was already emitted (eventId null = duplicate),
  // still apply state mutation for idempotent convergence.
  await supabase
    .from('slack_opportunity_briefs')
    .update({
      human_action: 'DISMISSED',
      human_action_by: userId,
      human_action_at: new Date().toISOString(),
      status: 'dismissed',
      dismissal_reason: reason,
    })
    .eq('opportunity_id', opportunityId)
    .eq('status', 'posted');

  await supabase
    .from('pipeline_opportunities')
    .update({
      human_action: 'DISMISSED',
      human_action_by: userId,
      human_action_at: new Date().toISOString(),
    })
    .eq('source_id', opportunityId);

  // If eventId is null, this was a duplicate — still report success
  // because the action was already recorded.
  if (!eventId) {
    return { success: true, message: 'Opportunity was already dismissed.' };
  }

  return { success: true, message: 'Opportunity dismissed.' };
}

// ============================================================
// Slack Action Registration
// ============================================================

/**
 * Register Maya's production Slack action handlers with a Bolt app.
 * Handlers: ACK promptly → authorize → parse state → call command handler → reply.
 * ZERO direct LLM calls.
 */
/**
 * Resolve opportunity_id from a button click.
 * Primary: look up slack_opportunity_briefs by message_ts.
 * Fallback: use opportunity_id encoded in the button value (new format).
 * This protects against the case where message_ts was never persisted to the brief.
 */
async function resolveOpportunityId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  messageTs: string,
  buttonOpportunityId?: string
): Promise<string | null> {
  // Primary: lookup by message_ts
  if (messageTs) {
    const { data: brief } = await supabase
      .from('slack_opportunity_briefs')
      .select('opportunity_id')
      .eq('message_ts', messageTs)
      .single();
    if (brief?.opportunity_id) return brief.opportunity_id;
  }

  // Fallback: use opportunity_id from button value if available
  if (buttonOpportunityId) {
    // Verify the opportunity exists before trusting the button value
    const { data: opp } = await supabase
      .from('pipeline_opportunities')
      .select('source_id')
      .eq('source_id', buttonOpportunityId)
      .single();
    if (opp) {
      console.warn(
        `[SlackSurface] Brief lookup by message_ts failed — resolved via button opportunityId: ${buttonOpportunityId}`
      );
      return opp.source_id;
    }
  }

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMayaActions(app: any): void {
  app.action(
    'maya_send_to_capture',
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const action = body.actions?.[0];
      const { materialHash, opportunityId: buttonOppId } = parseButtonValue(action?.value);

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const opportunityId = await resolveOpportunityId(supabase, messageTs, buttonOppId);
      if (!opportunityId) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: 'Could not find this opportunity brief.',
        });
        return;
      }

      const result = await handleSendToCapture(
        supabase,
        opportunityId,
        userId,
        messageTs,
        materialHash
      );
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'maya_more_research',
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const action = body.actions?.[0];
      const { materialHash, opportunityId: buttonOppId } = parseButtonValue(action?.value);

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const opportunityId = await resolveOpportunityId(supabase, messageTs, buttonOppId);
      if (!opportunityId) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: 'Could not find this opportunity brief.',
        });
        return;
      }

      const result = await handleMoreResearch(
        supabase,
        opportunityId,
        userId,
        messageTs,
        materialHash
      );
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'maya_dismiss',
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const action = body.actions?.[0];
      const { materialHash, opportunityId: buttonOppId } = parseButtonValue(action?.value);

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const opportunityId = await resolveOpportunityId(supabase, messageTs, buttonOppId);
      if (!opportunityId) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: 'Could not find this opportunity brief.',
        });
        return;
      }

      const result = await handleDismiss(
        supabase,
        opportunityId,
        userId,
        messageTs,
        'NOT_FIT',
        undefined,
        materialHash
      );
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  console.log(
    '[MayaSlackSurface] Registered action handlers: maya_send_to_capture, maya_more_research, maya_dismiss'
  );
}
