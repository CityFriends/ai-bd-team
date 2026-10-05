/**
 * Rosa Slack Surface
 *
 * Slack is presentation, not authority. DB state comes first.
 *
 * POST -> Slack partner brief with [Watch] [Investigate] [Draft Outreach] [Dismiss]
 * STORE_ONLY -> no Slack post
 * WATCH -> no Slack post (partner tracked internally)
 *
 * Button handlers perform ZERO additional LLM calls:
 *   Watch         = state change only (upsert rosa_watched_partners status=WATCHING)
 *   Investigate   = create ONE bounded rosa_intelligence_task
 *   Draft Outreach = create ONE outreach drafting task (DRAFT status, no send)
 *   Dismiss       = status=DISMISSED, no re-wake unless material change
 *   Silence       = 0 work
 */

import { logger } from '../../lib/logger.js';
import {
  RosaTriggerType,
  RosaOutreachStatus,
  type PartnerBrief,
} from './types.js';

const log = logger.child({ service: 'RosaSlackSurface' });

// ============================================================
// Slack Projection Control
// ============================================================

/**
 * Check if Rosa Slack projection is enabled.
 * Fail closed: missing or non-'true' = disabled.
 */
export function isRosaSlackProjectionEnabled(): boolean {
  const val = process.env.ROSA_SLACK_PROJECTION_ENABLED;
  return val !== undefined && val.toLowerCase() === 'true';
}

// ============================================================
// Slack Message Formatting
// ============================================================

/**
 * Format a Rosa partner brief into Slack Block Kit message.
 */
export function formatPartnerBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Record<string, any>,
  brief: PartnerBrief
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { text: string; blocks: any[] } {
  const companyName = brief.company || 'Unknown Company';
  const whyMatters = brief.capabilityComplementarity || 'Partner intelligence available.';
  const relationship = brief.recommendedRelationship || 'EXPLORE';
  const evidencePoints = (brief.evidenceRefs || []).slice(0, 5);
  const nextStep = (brief.recommendedActions || [])[0] || 'Review partner brief for details.';

  const text = `ROSA -- Partner Intelligence\n\nCompany: ${companyName}\n\nWhy this matters:\n${whyMatters}\n\nRecommended relationship: ${relationship}\n\nRecommended next step: ${nextStep}`;

  const briefId = task.id || 'unknown';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'ROSA -- Partner Intelligence' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Company:* ${companyName}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Why this matters:*\n${whyMatters}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommended relationship:* ${relationship}`,
      },
    },
  ];

  if (evidencePoints.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Key evidence:*\n' + evidencePoints.map((e) => `  ${e}`).join('\n'),
      },
    });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Recommended next step:* ${nextStep}`,
    },
  });

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Watch' },
          action_id: 'rosa_watch',
          value: briefId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Investigate' },
          style: 'primary',
          action_id: 'rosa_investigate',
          value: briefId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Draft Outreach' },
          action_id: 'rosa_draft_outreach',
          value: briefId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          style: 'danger',
          action_id: 'rosa_dismiss',
          value: briefId,
        },
      ],
    }
  );

  return { text, blocks };
}

// ============================================================
// Post Intelligence to Slack
// ============================================================

/**
 * Project Rosa intelligence to the AI-BD-TEAM Slack channel.
 * Only called for POST projection decisions.
 * No Slack post for STORE_ONLY or WATCH.
 */
export async function projectRosaIntelligence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Record<string, any>,
  brief: PartnerBrief
): Promise<{ success: boolean; messageTs?: string }> {
  if (!isRosaSlackProjectionEnabled()) {
    log.info({ taskId: task.id }, 'Rosa Slack projection disabled -- skipping');
    return { success: true };
  }

  const channelId = process.env.SLACK_AI_BD_CHANNEL || process.env.SLACK_CHANNEL_ID;
  const slackToken = process.env.ROSA_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;

  if (!channelId || !slackToken) {
    log.warn('Missing Slack channel or token configuration for Rosa projection');
    return { success: false };
  }

  // Check for existing post (idempotent)
  const { data: existing } = await supabase
    .from('rosa_slack_briefs')
    .select('id, message_ts')
    .eq('task_id', task.id)
    .eq('status', 'posted')
    .single();

  if (existing?.message_ts) {
    return { success: true, messageTs: existing.message_ts };
  }

  // Create pending brief record FIRST (DB before Slack)
  const { data: slackBrief } = await supabase
    .from('rosa_slack_briefs')
    .upsert(
      {
        task_id: task.id,
        brief_id: task.brief_id,
        channel_id: channelId,
        status: 'pending',
      },
      { onConflict: 'task_id' }
    )
    .select('id')
    .single();

  try {
    const { WebClient } = await import('@slack/web-api');
    const slackClient = new WebClient(slackToken);

    const { text, blocks } = formatPartnerBrief(task, brief);

    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (result.ok && result.ts) {
      await supabase
        .from('rosa_slack_briefs')
        .update({
          message_ts: result.ts,
          thread_ts: result.ts,
          status: 'posted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', slackBrief?.id);

      log.info({ taskId: task.id, messageTs: result.ts }, 'Rosa intelligence posted to Slack');
      return { success: true, messageTs: result.ts };
    }

    throw new Error(`Slack post failed: ${result.error || 'unknown'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ taskId: task.id, error: msg }, 'Rosa Slack projection failed');

    await supabase
      .from('rosa_slack_briefs')
      .update({
        projection_attempts: (slackBrief?.projection_attempts || 0) + 1,
        last_projection_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', slackBrief?.id);

    return { success: false };
  }
}

// ============================================================
// Button Handlers -- ZERO LLM calls
// ============================================================

/**
 * Watch: upsert rosa_watched_partners with status=WATCHING.
 * Pure state change -- no LLM call.
 */
export async function handleRosaWatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  briefId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Load the task to get partner context
    const { data: task } = await supabase
      .from('rosa_intelligence_tasks')
      .select('id, trigger_type, trigger_data, brief_id')
      .eq('id', briefId)
      .single();

    if (!task) return { success: false, message: 'Partner brief not found.' };

    await supabase.from('rosa_watched_partners').upsert(
      {
        task_id: briefId,
        company_name: task.trigger_data?.companyName || 'Unknown',
        status: 'WATCHING',
        watched_by: userId,
        watched_at: new Date().toISOString(),
        trigger_data: task.trigger_data,
      },
      { onConflict: 'task_id' }
    );

    log.info({ briefId, userId }, 'Partner set to WATCHING');
    return { success: true, message: 'Partner added to watch list. Rosa will monitor for changes.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ briefId, userId, error: msg }, 'handleRosaWatch failed');
    return { success: false, message: 'Failed to watch partner.' };
  }
}

/**
 * Investigate: create ONE bounded rosa_intelligence_task for deeper research.
 * No LLM call from this handler -- the task is processed by the scheduler.
 */
export async function handleRosaInvestigate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  briefId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Load original task for context
    const { data: originalTask } = await supabase
      .from('rosa_intelligence_tasks')
      .select('id, trigger_type, trigger_data')
      .eq('id', briefId)
      .single();

    if (!originalTask) return { success: false, message: 'Partner brief not found.' };

    // Check for existing investigation task (idempotent)
    const idempKey = `rosa-investigate:${briefId}`;
    const { data: existingTask } = await supabase
      .from('rosa_intelligence_tasks')
      .select('id')
      .eq('idempotency_key', idempKey)
      .single();

    if (existingTask) {
      return { success: true, message: 'Investigation already queued.' };
    }

    // Create ONE bounded investigation task
    await supabase.from('rosa_intelligence_tasks').insert({
      trigger_type: RosaTriggerType.HUMAN_REQUEST,
      trigger_data: {
        ...originalTask.trigger_data,
        question: `Deeper teaming investigation requested for ${originalTask.trigger_data?.companyName || 'partner'}: ${JSON.stringify(originalTask.trigger_data).slice(0, 300)}`,
        parentTaskId: briefId,
        requestedBy: userId,
      },
      status: 'pending',
      idempotency_key: idempKey,
      requested_by: userId,
      created_at: new Date().toISOString(),
    });

    log.info({ briefId, userId }, 'Investigation task created');
    return {
      success: true,
      message: 'Investigation queued. Rosa will perform deeper partner research on the next processing cycle.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ briefId, userId, error: msg }, 'handleRosaInvestigate failed');
    return { success: false, message: 'Failed to queue investigation.' };
  }
}

/**
 * Draft Outreach: create ONE outreach drafting task (DRAFT status, no send).
 * No LLM call from this handler -- the task is processed by the scheduler.
 * Outreach drafts require human approval before any sending occurs.
 */
export async function handleRosaDraftOutreach(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  briefId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Load original task for partner context
    const { data: originalTask } = await supabase
      .from('rosa_intelligence_tasks')
      .select('id, trigger_data, brief_id')
      .eq('id', briefId)
      .single();

    if (!originalTask) return { success: false, message: 'Partner brief not found.' };

    // Check for existing outreach draft (idempotent)
    const idempKey = `rosa-outreach:${briefId}`;
    const { data: existingDraft } = await supabase
      .from('rosa_outreach_drafts')
      .select('id')
      .eq('idempotency_key', idempKey)
      .single();

    if (existingDraft) {
      return { success: true, message: 'Outreach draft already queued.' };
    }

    // Create ONE outreach drafting task with DRAFT status (no send)
    await supabase.from('rosa_outreach_drafts').insert({
      task_id: briefId,
      brief_id: originalTask.brief_id,
      company_name: originalTask.trigger_data?.companyName || 'Unknown',
      status: RosaOutreachStatus.DRAFT,
      requested_by: userId,
      idempotency_key: idempKey,
      created_at: new Date().toISOString(),
    });

    log.info({ briefId, userId }, 'Outreach draft task created');
    return {
      success: true,
      message: 'Outreach draft queued. Rosa will prepare a draft for your review -- no message will be sent without approval.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ briefId, userId, error: msg }, 'handleRosaDraftOutreach failed');
    return { success: false, message: 'Failed to queue outreach draft.' };
  }
}

/**
 * Dismiss: set status=DISMISSED, no re-wake unless material change.
 * No LLM call.
 */
export async function handleRosaDismiss(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  briefId: string,
  userId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  try {
    await supabase.from('rosa_watched_partners').upsert(
      {
        task_id: briefId,
        status: 'DISMISSED',
        dismissed_by: userId,
        dismissed_at: new Date().toISOString(),
        dismissal_reason: reason || 'User dismissed',
      },
      { onConflict: 'task_id' }
    );

    // Update the brief status
    await supabase
      .from('rosa_slack_briefs')
      .update({
        human_action: 'DISMISSED',
        human_action_by: userId,
        human_action_at: new Date().toISOString(),
        status: 'dismissed',
      })
      .eq('task_id', briefId);

    log.info({ briefId, userId, reason }, 'Partner dismissed');
    return { success: true, message: 'Partner dismissed. No further monitoring unless material change.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ briefId, userId, error: msg }, 'handleRosaDismiss failed');
    return { success: false, message: 'Failed to dismiss partner.' };
  }
}

// ============================================================
// Slack Action Registration
// ============================================================

/**
 * Register Rosa's Slack action handlers with a Bolt app.
 * ACK promptly -> call handler -> reply in thread.
 * ZERO direct LLM calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerRosaActions(app: any): void {
  app.action(
    'rosa_watch',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const briefId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleRosaWatch(supabase, briefId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'rosa_investigate',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const briefId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleRosaInvestigate(supabase, briefId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'rosa_draft_outreach',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const briefId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleRosaDraftOutreach(supabase, briefId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'rosa_dismiss',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const briefId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleRosaDismiss(supabase, briefId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  log.info('Registered Rosa action handlers: rosa_watch, rosa_investigate, rosa_draft_outreach, rosa_dismiss');
}
