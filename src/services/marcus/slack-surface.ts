/**
 * Marcus Slack Surface
 *
 * Slack is presentation, not authority. DB state comes first.
 *
 * Technical change notifications are projected with:
 *   [Review] [Ask Marcus] [Dismiss]
 *
 * Button handlers perform ZERO additional LLM calls:
 *   Review      = mark change as under human review, no LLM
 *   Ask Marcus  = create ONE bounded marcus_technical_task for deeper analysis
 *   Dismiss     = dismiss change, no re-wake unless new material change
 */

import { logger } from '../../lib/logger.js';
/** Technical change event data for Slack projection */
interface TechnicalChangeEvent {
  captureId?: string;
  opportunityId?: string;
  changeType: string;
  material: boolean;
  changedFields: string[];
  changeReasons: string[];
  opportunityTitle?: string;
}

const log = logger.child({ service: 'MarcusSlackSurface' });

// ============================================================
// Slack Projection Control
// ============================================================

/**
 * Check if Marcus Slack projection is enabled.
 * Fail closed: missing or non-'true' = disabled.
 */
export function isMarcusSlackProjectionEnabled(): boolean {
  const val = process.env.MARCUS_SLACK_PROJECTION_ENABLED;
  return val !== undefined && val.toLowerCase() === 'true';
}

// ============================================================
// Slack Message Formatting
// ============================================================

/**
 * Format a Marcus technical change notification into Slack Block Kit message.
 */
export function formatTechnicalChangeNotice(
  changeEvent: TechnicalChangeEvent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { text: string; blocks: any[] } {
  const opportunity = changeEvent.opportunityTitle || changeEvent.opportunityId;
  const changeType = changeEvent.changeType.replace(/_/g, ' ').toLowerCase();
  const description = changeEvent.changeReasons?.[0] || 'Technical change detected.';
  const impact = changeEvent.changedFields?.join(', ') || 'Fields changed.';

  const text = `MARCUS -- Technical Change Notice\n\nPursuit: ${opportunity}\nChange: ${changeType} - ${description}\nImpact: ${impact}`;

  const changeId = changeEvent.opportunityId || 'unknown';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'MARCUS -- Technical Change Notice' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Pursuit:* ${opportunity}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Change:* ${changeType}\n${description}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Impact:* ${impact}`,
      },
    },
  ];

  if (changeEvent.changedFields && changeEvent.changedFields.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Changed fields:* ${changeEvent.changedFields.join(', ')}`,
      },
    });
  }

  if (changeEvent.changeReasons && changeEvent.changeReasons.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Reasons:*\n' + changeEvent.changeReasons.map((r: string) => `  ${r}`).join('\n'),
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Review' },
          style: 'primary',
          action_id: 'marcus_review',
          value: changeId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Ask Marcus' },
          action_id: 'marcus_ask_question',
          value: changeId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          style: 'danger',
          action_id: 'marcus_dismiss',
          value: changeId,
        },
      ],
    }
  );

  return { text, blocks };
}

// ============================================================
// Post Technical Change Notice to Slack
// ============================================================

/**
 * Project a Marcus technical change notice to Slack.
 * Only called when a material technical change is detected.
 */
export async function projectMarcusTechnicalChange(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  changeEvent: TechnicalChangeEvent
): Promise<{ success: boolean; messageTs?: string }> {
  if (!isMarcusSlackProjectionEnabled()) {
    log.info({ opportunityId: changeEvent.opportunityId }, 'Marcus Slack projection disabled -- skipping');
    return { success: true };
  }

  const channelId = process.env.SLACK_AI_BD_CHANNEL || process.env.SLACK_CHANNEL_ID;
  const slackToken = process.env.MARCUS_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;

  if (!channelId || !slackToken) {
    log.warn('Missing Slack channel or token configuration for Marcus projection');
    return { success: false };
  }

  // Check for existing post (idempotent)
  const idempKey = `marcus-change:${changeEvent.opportunityId}:${changeEvent.changeType}`;
  const { data: existing } = await supabase
    .from('marcus_slack_notices')
    .select('id, message_ts')
    .eq('idempotency_key', idempKey)
    .eq('status', 'posted')
    .single();

  if (existing?.message_ts) {
    return { success: true, messageTs: existing.message_ts };
  }

  // Create pending notice record FIRST (DB before Slack)
  const { data: slackNotice } = await supabase
    .from('marcus_slack_notices')
    .upsert(
      {
        opportunity_id: changeEvent.opportunityId,
        change_type: changeEvent.changeType,
        channel_id: channelId,
        status: 'pending',
        idempotency_key: idempKey,
        change_data: changeEvent,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'idempotency_key' }
    )
    .select('id')
    .single();

  try {
    const { WebClient } = await import('@slack/web-api');
    const slackClient = new WebClient(slackToken);

    const { text, blocks } = formatTechnicalChangeNotice(changeEvent);

    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (result.ok && result.ts) {
      await supabase
        .from('marcus_slack_notices')
        .update({
          message_ts: result.ts,
          thread_ts: result.ts,
          status: 'posted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', slackNotice?.id);

      log.info(
        { opportunityId: changeEvent.opportunityId, messageTs: result.ts },
        'Marcus technical change notice posted to Slack'
      );
      return { success: true, messageTs: result.ts };
    }

    throw new Error(`Slack post failed: ${result.error || 'unknown'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ opportunityId: changeEvent.opportunityId, error: msg }, 'Marcus Slack projection failed');

    await supabase
      .from('marcus_slack_notices')
      .update({
        projection_attempts: (slackNotice?.projection_attempts || 0) + 1,
        last_projection_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', slackNotice?.id);

    return { success: false };
  }
}

// ============================================================
// Button Handlers -- ZERO LLM calls
// ============================================================

/**
 * Review: mark change as under human review.
 * Pure state change -- no LLM call.
 */
export async function handleMarcusReview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    await supabase.from('marcus_technical_change_reviews').upsert(
      {
        opportunity_id: opportunityId,
        status: 'UNDER_REVIEW',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'opportunity_id' }
    );

    // Update slack notice
    await supabase
      .from('marcus_slack_notices')
      .update({
        human_action: 'REVIEW',
        human_action_by: userId,
        human_action_at: new Date().toISOString(),
      })
      .eq('opportunity_id', opportunityId)
      .eq('status', 'posted');

    log.info({ opportunityId, userId }, 'Technical change marked as under review');
    return { success: true, message: 'Technical change is now under human review.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ opportunityId, userId, error: msg }, 'handleMarcusReview failed');
    return { success: false, message: 'Failed to mark change for review.' };
  }
}

/**
 * Ask Marcus: create ONE bounded marcus_technical_task for deeper analysis.
 * No LLM call from this handler -- the task is processed by the scheduler.
 */
export async function handleMarcusAskQuestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Check for existing investigation task (idempotent)
    const idempKey = `marcus-ask:${opportunityId}`;
    const { data: existingTask } = await supabase
      .from('marcus_technical_tasks')
      .select('id')
      .eq('idempotency_key', idempKey)
      .single();

    if (existingTask) {
      return { success: true, message: 'Technical analysis already queued.' };
    }

    // Load change context
    const { data: changeReview } = await supabase
      .from('marcus_technical_change_reviews')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .single();

    const { data: slackNotice } = await supabase
      .from('marcus_slack_notices')
      .select('change_data')
      .eq('opportunity_id', opportunityId)
      .eq('status', 'posted')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Create ONE bounded marcus_technical_task
    await supabase.from('marcus_technical_tasks').insert({
      trigger_type: 'HUMAN_REQUEST',
      trigger_data: {
        opportunityId,
        question: `Deeper technical analysis requested for opportunity ${opportunityId} following technical change detection.`,
        changeContext: slackNotice?.change_data || null,
        requestedBy: userId,
      },
      status: 'pending',
      idempotency_key: idempKey,
      requested_by: userId,
      created_at: new Date().toISOString(),
    });

    // Update review status
    if (changeReview) {
      await supabase
        .from('marcus_technical_change_reviews')
        .update({
          status: 'ANALYSIS_REQUESTED',
          updated_at: new Date().toISOString(),
        })
        .eq('opportunity_id', opportunityId);
    }

    log.info({ opportunityId, userId }, 'Marcus technical analysis task created');
    return {
      success: true,
      message: 'Technical analysis queued. Marcus will perform deeper technical assessment on the next processing cycle.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ opportunityId, userId, error: msg }, 'handleMarcusAskQuestion failed');
    return { success: false, message: 'Failed to queue technical analysis.' };
  }
}

/**
 * Dismiss: dismiss change, no re-wake unless new material change.
 * No LLM call.
 */
export async function handleMarcusDismiss(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string,
  userId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  try {
    await supabase.from('marcus_technical_change_reviews').upsert(
      {
        opportunity_id: opportunityId,
        status: 'DISMISSED',
        dismissed_by: userId,
        dismissed_at: new Date().toISOString(),
        dismissal_reason: reason || 'User dismissed',
      },
      { onConflict: 'opportunity_id' }
    );

    // Update the slack notice status
    await supabase
      .from('marcus_slack_notices')
      .update({
        human_action: 'DISMISSED',
        human_action_by: userId,
        human_action_at: new Date().toISOString(),
        status: 'dismissed',
      })
      .eq('opportunity_id', opportunityId)
      .eq('status', 'posted');

    log.info({ opportunityId, userId, reason }, 'Technical change dismissed');
    return { success: true, message: 'Technical change dismissed. No further monitoring unless new material change.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ opportunityId, userId, error: msg }, 'handleMarcusDismiss failed');
    return { success: false, message: 'Failed to dismiss technical change.' };
  }
}

// ============================================================
// Slack Action Registration
// ============================================================

/**
 * Register Marcus's Slack action handlers with a Bolt app.
 * ACK promptly -> call handler -> reply in thread.
 * ZERO direct LLM calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMarcusActions(app: any): void {
  app.action(
    'marcus_review',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const opportunityId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleMarcusReview(supabase, opportunityId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'marcus_ask_question',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const opportunityId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleMarcusAskQuestion(supabase, opportunityId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'marcus_dismiss',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const opportunityId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleMarcusDismiss(supabase, opportunityId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  log.info('Registered Marcus action handlers: marcus_review, marcus_ask_question, marcus_dismiss');
}
