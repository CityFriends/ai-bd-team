/**
 * David Slack Surface
 *
 * Slack is presentation, not authority. DB state comes first.
 *
 * POST → Slack intelligence brief with [Watch] [Investigate] [Dismiss]
 * STORE_ONLY → no Slack post
 * WATCH → no Slack post (signal tracked internally)
 *
 * Button handlers perform ZERO additional LLM calls:
 *   Watch      = state change only
 *   Investigate = create ONE bounded david_intelligence_task
 *   Dismiss     = state change + record reason
 *   Silence     = 0 additional AI work
 */

import { logger } from '../../lib/logger.js';
import {
  DavidArtifactType,
  DavidTriggerType,
  type DavidArtifactTypeValue,
} from './types.js';

const log = logger.child({ service: 'DavidSlackSurface' });

// ============================================================
// Slack Projection Control
// ============================================================

/**
 * Check if David Slack projection is enabled.
 * Fail closed: missing or non-'true' = disabled.
 */
export function isDavidSlackProjectionEnabled(): boolean {
  const val = process.env.DAVID_SLACK_PROJECTION_ENABLED;
  return val !== undefined && val.toLowerCase() === 'true';
}

// ============================================================
// Slack Message Formatting
// ============================================================

/**
 * Format a David intelligence artifact into Slack Block Kit message.
 */
export function formatIntelligenceBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  artifact: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { text: string; blocks: any[] } {
  const artifactType = artifact.artifact_type as DavidArtifactTypeValue;
  const data = artifact.artifact_data || {};

  const signalSummary = buildSignalSummary(artifactType, data, task);
  const whyCareSummary = buildWhyCare(artifactType, data);
  const recommendedAction = extractRecommendedAction(artifactType, data);
  const evidencePoints = buildEvidencePoints(data);

  const text = `DAVID -- Market Intelligence\n\nSignal: ${signalSummary}\n\nWhy FFTC should care:\n${whyCareSummary}\n\nRecommended action: ${recommendedAction}`;

  const signalId = task.id || artifact.id || 'unknown';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'DAVID -- Market Intelligence' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Signal:* ${signalSummary}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Why FFTC should care:*\n${whyCareSummary}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommended action:* ${recommendedAction}`,
      },
    },
  ];

  if (evidencePoints.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Evidence:*\n' + evidencePoints.map((e) => `• ${e}`).join('\n'),
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
          text: { type: 'plain_text', text: 'Watch' },
          action_id: 'david_watch',
          value: signalId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Investigate' },
          style: 'primary',
          action_id: 'david_investigate',
          value: signalId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          style: 'danger',
          action_id: 'david_dismiss',
          value: signalId,
        },
      ],
    }
  );

  return { text, blocks };
}

// ============================================================
// Signal Summary Builders
// ============================================================

function buildSignalSummary(
  artifactType: DavidArtifactTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Record<string, any>
): string {
  switch (artifactType) {
    case DavidArtifactType.COMPETITIVE_BRIEF:
      return `Competitive intelligence: ${data.company || 'Unknown company'} -- ${data.competitivePosition || 'position analysis'}`;
    case DavidArtifactType.CUSTOMER_MARKET_BRIEF:
      return `Market intelligence: ${data.agency || 'Unknown agency'} -- ${data.fftcAlignment || 'alignment analysis'}`;
    case DavidArtifactType.FORECAST_SIGNAL:
      return `Forecast: ${data.customer || 'Unknown'} -- ${data.expectedScope || 'scope TBD'} (${data.maturity || 'UNKNOWN'})`;
    case DavidArtifactType.EVENT_BRIEF:
      return `Event: ${data.eventName || 'Unknown event'} (${data.dateRange || 'TBD'})`;
    default:
      return task.trigger_type || 'Intelligence signal';
  }
}

function buildWhyCare(
  artifactType: DavidArtifactTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
): string {
  switch (artifactType) {
    case DavidArtifactType.COMPETITIVE_BRIEF:
      return data.fftcImplications || 'Competitive landscape change detected.';
    case DavidArtifactType.CUSTOMER_MARKET_BRIEF:
      return data.fftcAlignment || 'Agency buying pattern relevant to FFTC capabilities.';
    case DavidArtifactType.FORECAST_SIGNAL:
      return data.fftcConnection || 'Forecast opportunity aligns with FFTC capabilities.';
    case DavidArtifactType.EVENT_BRIEF:
      return data.whyFftcCares || 'GovCon event relevant to FFTC market position.';
    default:
      return 'Market signal relevant to FFTC.';
  }
}

function extractRecommendedAction(
  _artifactType: DavidArtifactTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
): string {
  return data.recommendedAction || data.recommended_action || 'REVIEW';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEvidencePoints(data: Record<string, any>): string[] {
  const provenance: string[] = data.provenance || [];
  return provenance.slice(0, 5);
}

// ============================================================
// Post Intelligence to Slack
// ============================================================

/**
 * Project David intelligence to the AI-BD-TEAM Slack channel.
 * Only called for POST projection decisions.
 * No Slack post for STORE_ONLY artifacts.
 */
export async function projectDavidIntelligence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  task: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  artifact: Record<string, any>
): Promise<{ success: boolean; messageTs?: string }> {
  if (!isDavidSlackProjectionEnabled()) {
    log.info({ taskId: task.id }, 'David Slack projection disabled -- skipping');
    return { success: true };
  }

  const channelId = process.env.SLACK_AI_BD_CHANNEL || process.env.SLACK_CHANNEL_ID;
  const slackToken = process.env.DAVID_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;

  if (!channelId || !slackToken) {
    log.warn('Missing Slack channel or token configuration for David projection');
    return { success: false };
  }

  // Check for existing post (idempotent)
  const { data: existing } = await supabase
    .from('david_slack_briefs')
    .select('id, message_ts')
    .eq('task_id', task.id)
    .eq('status', 'posted')
    .single();

  if (existing?.message_ts) {
    return { success: true, messageTs: existing.message_ts };
  }

  // Create pending brief record FIRST (DB before Slack)
  const { data: brief } = await supabase
    .from('david_slack_briefs')
    .upsert(
      {
        task_id: task.id,
        artifact_id: artifact.id,
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

    const { text, blocks } = formatIntelligenceBrief(task, artifact);

    const result = await slackClient.chat.postMessage({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (result.ok && result.ts) {
      await supabase
        .from('david_slack_briefs')
        .update({
          message_ts: result.ts,
          thread_ts: result.ts,
          status: 'posted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', brief?.id);

      log.info({ taskId: task.id, messageTs: result.ts }, 'David intelligence posted to Slack');
      return { success: true, messageTs: result.ts };
    }

    throw new Error(`Slack post failed: ${result.error || 'unknown'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ taskId: task.id, error: msg }, 'David Slack projection failed');

    await supabase
      .from('david_slack_briefs')
      .update({
        projection_attempts: (brief?.projection_attempts || 0) + 1,
        last_projection_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', brief?.id);

    return { success: false };
  }
}

// ============================================================
// Button Handlers — ZERO LLM calls
// ============================================================

/**
 * Watch: create/update david_watched_signals with status=WATCHING.
 * Pure state change — no LLM call.
 */
export async function handleDavidWatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  signalId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Load the task to get signal context
    const { data: task } = await supabase
      .from('david_intelligence_tasks')
      .select('id, trigger_type, trigger_data')
      .eq('id', signalId)
      .single();

    if (!task) return { success: false, message: 'Signal not found.' };

    await supabase.from('david_watched_signals').upsert(
      {
        task_id: signalId,
        signal_type: mapTriggerToSignalType(task.trigger_type),
        status: 'WATCHING',
        watched_by: userId,
        watched_at: new Date().toISOString(),
        trigger_data: task.trigger_data,
      },
      { onConflict: 'task_id' }
    );

    log.info({ signalId, userId }, 'Signal set to WATCHING');
    return { success: true, message: 'Signal added to watch list. David will monitor for changes.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ signalId, userId, error: msg }, 'handleDavidWatch failed');
    return { success: false, message: 'Failed to watch signal.' };
  }
}

/**
 * Investigate: create ONE bounded david_intelligence_task for deeper research.
 * No LLM call from this handler — the task is processed by the scheduler.
 */
export async function handleDavidInvestigate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  signalId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Load original task for context
    const { data: originalTask } = await supabase
      .from('david_intelligence_tasks')
      .select('id, trigger_type, trigger_data, artifact_type')
      .eq('id', signalId)
      .single();

    if (!originalTask) return { success: false, message: 'Signal not found.' };

    // Check for existing investigation task (idempotent)
    const idempKey = `investigate:${signalId}`;
    const { data: existingTask } = await supabase
      .from('david_intelligence_tasks')
      .select('id')
      .eq('idempotency_key', idempKey)
      .single();

    if (existingTask) {
      return { success: true, message: 'Investigation already queued.' };
    }

    // Create ONE bounded investigation task
    await supabase.from('david_intelligence_tasks').insert({
      trigger_type: DavidTriggerType.HUMAN_REQUEST,
      trigger_data: {
        ...originalTask.trigger_data,
        question: `Deeper investigation requested for ${originalTask.trigger_type} signal: ${JSON.stringify(originalTask.trigger_data).slice(0, 300)}`,
        parentTaskId: signalId,
        requestedBy: userId,
      },
      status: 'pending',
      idempotency_key: idempKey,
      requested_by: userId,
      created_at: new Date().toISOString(),
    });

    log.info({ signalId, userId }, 'Investigation task created');
    return {
      success: true,
      message: 'Investigation queued. David will perform deeper research on the next processing cycle.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ signalId, userId, error: msg }, 'handleDavidInvestigate failed');
    return { success: false, message: 'Failed to queue investigation.' };
  }
}

/**
 * Dismiss: set status=DISMISSED, record dismissal reason.
 * No re-wake unless material change detected.
 * No LLM call.
 */
export async function handleDavidDismiss(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  signalId: string,
  userId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  try {
    await supabase.from('david_watched_signals').upsert(
      {
        task_id: signalId,
        status: 'DISMISSED',
        dismissed_by: userId,
        dismissed_at: new Date().toISOString(),
        dismissal_reason: reason || 'User dismissed',
      },
      { onConflict: 'task_id' }
    );

    // Update the brief status
    await supabase
      .from('david_slack_briefs')
      .update({
        human_action: 'DISMISSED',
        human_action_by: userId,
        human_action_at: new Date().toISOString(),
        status: 'dismissed',
      })
      .eq('task_id', signalId);

    log.info({ signalId, userId, reason }, 'Signal dismissed');
    return { success: true, message: 'Signal dismissed. No further monitoring unless material change.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ signalId, userId, error: msg }, 'handleDavidDismiss failed');
    return { success: false, message: 'Failed to dismiss signal.' };
  }
}

// ============================================================
// Slack Action Registration
// ============================================================

/**
 * Register David's Slack action handlers with a Bolt app.
 * ACK promptly -> call handler -> reply in thread.
 * ZERO direct LLM calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDavidActions(app: any): void {
  app.action(
    'david_watch',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const signalId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleDavidWatch(supabase, signalId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'david_investigate',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const signalId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleDavidInvestigate(supabase, signalId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  app.action(
    'david_dismiss',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();

      const userId = body.user.id;
      const messageTs = body.message?.ts || '';
      const channelId = body.channel?.id || '';
      const signalId = body.actions?.[0]?.value || '';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      const result = await handleDavidDismiss(supabase, signalId, userId);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  log.info('Registered David action handlers: david_watch, david_investigate, david_dismiss');
}

// ============================================================
// Helpers
// ============================================================

function mapTriggerToSignalType(triggerType: string): string {
  switch (triggerType) {
    case DavidTriggerType.FORECAST_SIGNAL:
      return 'FORECAST';
    case DavidTriggerType.GOVCON_EVENT:
      return 'EVENT';
    case DavidTriggerType.COMPETITIVE_SIGNAL:
      return 'COMPANY';
    default:
      return 'COMPANY';
  }
}
