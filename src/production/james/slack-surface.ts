/**
 * James Slack Surface — Capture Brief + Button Handlers
 *
 * James posts to Maya's EXISTING opportunity thread.
 * Pursue/No-Go/More Research buttons for human decisions.
 */

import { emitEvent, CAPTURE_EVENT_TYPES } from './events.js';
import { ensureWorkflowBudget } from '../../services/llm-gateway/budget.js';
import { CAPTURE_BUDGET } from './types.js';
import type { JamesCaptureDecision } from './types.js';

// Re-use Maya's authorization
import { isAuthorizedUser } from '../maya/slack-surface.js';

// ============================================================
// Format James Capture Brief
// ============================================================

export function formatJamesBrief(
  opp: { title: string; agency: string | null; solicitationNumber: string | null },
  decision: JamesCaptureDecision,
  captureId: string,
  decisionVersion: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { text: string; blocks: any[] } {
  const dimLabel = (d: { assessment: string; confidence: string }) =>
    `${d.assessment} (${d.confidence})`;

  const text = `JAMES — Capture Recommendation\n\n*${opp.title}*\nRecommendation: ${decision.recommendation} (${decision.confidence}%)`;

  const buttonValue = `${captureId}:${decisionVersion}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: 'JAMES — Capture Recommendation' } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${opp.title}*\n` +
          `Agency: ${opp.agency || 'Unknown'} | Sol: ${opp.solicitationNumber || 'N/A'}\n` +
          `*Recommendation:* ${decision.recommendation} | *Confidence:* ${decision.confidence}%`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Customer Fit:* ${dimLabel(decision.customerFit)}\n` +
          `*Capability Fit:* ${dimLabel(decision.capabilityFit)}\n` +
          `*Acquisition Fit:* ${dimLabel(decision.acquisitionFit)}\n` +
          `*Competitive Position:* ${dimLabel(decision.competitivePosition)}\n` +
          `*Delivery Feasibility:* ${dimLabel(decision.deliveryFeasibility)}\n` +
          `*Business Case:* ${dimLabel(decision.businessCase)}`,
      },
    },
  ];

  if (decision.strongestReasonsToPursue.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Why pursue:*\n' + decision.strongestReasonsToPursue.map((r) => `• ${r}`).join('\n'),
      },
    });
  }

  if (decision.criticalRisks.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Key risks:*\n' + decision.criticalRisks.map((r) => `• ${r}`).join('\n'),
      },
    });
  }

  if (decision.unresolvedQuestions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Unresolved:*\n' + decision.unresolvedQuestions.map((q) => `• ${q}`).join('\n'),
      },
    });
  }

  blocks.push(
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Recommended posture:* ${decision.primeSubPosture}` },
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Pursue' },
          style: 'primary',
          action_id: 'james_pursue',
          value: buttonValue,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'No-Go' },
          style: 'danger',
          action_id: 'james_no_go',
          value: buttonValue,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'More Research' },
          action_id: 'james_more_research',
          value: buttonValue,
        },
      ],
    }
  );

  return { text, blocks };
}

// ============================================================
// Post James Brief to Existing Thread
// ============================================================

export async function postJamesBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slackClient: any,
  captureId: string
): Promise<{ success: boolean; messageTs?: string }> {
  const { data: capture } = await supabase
    .from('captures')
    .select('*, opportunity_id')
    .eq('id', captureId)
    .single();

  if (!capture?.james_decision_payload) return { success: false };

  const { data: opp } = await supabase
    .from('pipeline_opportunities')
    .select('title, agency, solicitation_number')
    .eq('source_id', capture.opportunity_id)
    .single();

  if (!opp) return { success: false };

  const decision = capture.james_decision_payload as JamesCaptureDecision;
  const { text, blocks } = formatJamesBrief(opp, decision, captureId, capture.decision_version);

  try {
    const result = await slackClient.chat.postMessage({
      channel: capture.slack_channel_id,
      thread_ts: capture.slack_thread_ts,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (result.ok && result.ts) {
      await supabase
        .from('captures')
        .update({
          slack_brief_message_ts: result.ts,
          updated_at: new Date().toISOString(),
        })
        .eq('id', captureId);
      return { success: true, messageTs: result.ts };
    }

    return { success: false };
  } catch (err) {
    console.error('[JamesSlack] Failed to post brief:', err instanceof Error ? err.message : err);
    return { success: false };
  }
}

// ============================================================
// Button Handlers
// ============================================================

function parseButtonValue(value: string): { captureId: string; decisionVersion: number } | null {
  const parts = value?.split(':');
  if (!parts || parts.length < 2) return null;
  return { captureId: parts[0], decisionVersion: parseInt(parts[1], 10) };
}

async function validateCaptureAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  expectedStatuses: string[],
  expectedVersion: number
): Promise<{ error: string | null }> {
  const { data: capture } = await supabase
    .from('captures')
    .select('status, decision_version')
    .eq('id', captureId)
    .single();

  if (!capture) return { error: 'Capture not found.' };
  if (!expectedStatuses.includes(capture.status)) {
    return { error: `This capture is ${capture.status}. No further action available.` };
  }
  if (capture.decision_version !== expectedVersion) {
    return { error: 'A newer recommendation exists. Please use the latest brief.' };
  }
  return { error: null };
}

export async function handlePursue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  userId: string,
  decisionVersion: number
): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedUser(userId)) return { success: false, message: 'Not authorized.' };

  const { error: staleErr } = await validateCaptureAction(
    supabase,
    captureId,
    ['recommendation_ready'],
    decisionVersion
  );
  if (staleErr) return { success: false, message: staleErr };

  const { error } = await supabase.rpc('authorize_pursuit', {
    p_capture_id: captureId,
    p_human_id: userId,
    p_decision_version: decisionVersion,
  });

  if (error) {
    console.error('[JamesSlack] Pursue RPC failed:', error.message);
    return { success: false, message: error.message };
  }

  // Emit future-consumer events (no live integration in 3B)
  await emitEvent(supabase, {
    eventType: CAPTURE_EVENT_TYPES.NOTION_SYNC_REQUESTED,
    aggregateType: 'capture',
    aggregateId: captureId,
    actorType: 'SYSTEM',
    source: 'james-slack',
    correlationId: `capture:${captureId}`,
    idempotencyKey: `notion-sync:${captureId}`,
    schemaVersion: 1,
    payload: { status: 'pending_consumer' },
  });

  await emitEvent(supabase, {
    eventType: CAPTURE_EVENT_TYPES.PORTFOLIO_TRACKING_REQUIRED,
    aggregateType: 'capture',
    aggregateId: captureId,
    actorType: 'SYSTEM',
    source: 'james-slack',
    correlationId: `capture:${captureId}`,
    idempotencyKey: `portfolio:${captureId}`,
    schemaVersion: 1,
    payload: { status: 'pending_consumer' },
  });

  return { success: true, message: 'Pursuit authorized. Proposal workspace created.' };
}

export async function handleNoGo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  userId: string,
  decisionVersion: number
): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedUser(userId)) return { success: false, message: 'Not authorized.' };

  const { error: staleErr } = await validateCaptureAction(
    supabase,
    captureId,
    ['recommendation_ready'],
    decisionVersion
  );
  if (staleErr) return { success: false, message: staleErr };

  const { error } = await supabase.rpc('authorize_no_go', {
    p_capture_id: captureId,
    p_human_id: userId,
    p_decision_version: decisionVersion,
  });

  if (error) {
    console.error('[JamesSlack] No-Go RPC failed:', error.message);
    return { success: false, message: error.message };
  }

  return { success: true, message: 'No-Go recorded. Capture closed.' };
}

export async function handleJamesMoreResearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  userId: string,
  decisionVersion: number,
  researchQuestion: string
): Promise<{ success: boolean; message: string }> {
  if (!isAuthorizedUser(userId)) return { success: false, message: 'Not authorized.' };
  if (!researchQuestion || researchQuestion.trim().length < 10) {
    return { success: false, message: 'Please provide a specific research question.' };
  }

  const { error: staleErr } = await validateCaptureAction(
    supabase,
    captureId,
    ['recommendation_ready'],
    decisionVersion
  );
  if (staleErr) return { success: false, message: staleErr };

  // Create new bounded research authorization with separate budget
  const researchBudgetId = `exec-research-${captureId}-${Date.now()}`;
  await ensureWorkflowBudget(supabase, researchBudgetId, CAPTURE_BUDGET.EXECUTIVE_RESEARCH_USD);

  const questionHash = Math.abs(
    researchQuestion.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
  ).toString(36);

  await emitEvent(supabase, {
    eventType: CAPTURE_EVENT_TYPES.EXECUTIVE_MORE_RESEARCH_REQUESTED,
    aggregateType: 'capture',
    aggregateId: captureId,
    actorType: 'HUMAN',
    actorId: userId,
    source: 'slack',
    correlationId: `capture:${captureId}`,
    idempotencyKey: `exec-research:${captureId}:${questionHash}:v${decisionVersion}`,
    schemaVersion: 1,
    payload: {
      question: researchQuestion,
      decisionVersion,
      researchBudgetId,
      researchAuthority: 'EXECUTIVE_REQUESTED',
    },
  });

  // Transition back to researching (does NOT increment autonomous round counter)
  await supabase
    .from('captures')
    .update({
      status: 'researching',
      updated_at: new Date().toISOString(),
    })
    .eq('id', captureId)
    .eq('status', 'recommendation_ready');

  return { success: true, message: 'Research request recorded. James will investigate.' };
}

// ============================================================
// Register James Slack Actions
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerJamesActions(app: any): void {
   
  app.action(
    'james_pursue',
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();
      const userId = body.user.id;
      const channelId = body.channel?.id || '';
      const messageTs = body.message?.ts || '';
      const action = body.actions?.[0];
      const parsed = parseButtonValue(action?.value);
      if (!parsed) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: 'Invalid action.',
        });
        return;
      }
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const result = await handlePursue(supabase, parsed.captureId, userId, parsed.decisionVersion);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

   
  app.action(
    'james_no_go',
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();
      const userId = body.user.id;
      const channelId = body.channel?.id || '';
      const messageTs = body.message?.ts || '';
      const action = body.actions?.[0];
      const parsed = parseButtonValue(action?.value);
      if (!parsed) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: 'Invalid action.',
        });
        return;
      }
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const result = await handleNoGo(supabase, parsed.captureId, userId, parsed.decisionVersion);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

   
  app.action(
    'james_more_research',
    async ({ ack, body, client }: { ack: () => Promise<void>; body: any; client: any }) => {
      await ack();
      const userId = body.user.id;
      const channelId = body.channel?.id || '';
      const messageTs = body.message?.ts || '';
      const action = body.actions?.[0];
      const parsed = parseButtonValue(action?.value);
      if (!parsed) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: 'Invalid action.',
        });
        return;
      }

      // For 3B: direct handler invocation with explicit question from action value
      // Production UI would use a modal to collect the research question
      const question = 'Executive-requested research on this opportunity';

      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );

      // Load unresolved questions from current decision to provide context
      const { data: capture } = await supabase
        .from('captures')
        .select('james_decision_payload')
        .eq('id', parsed.captureId)
        .single();

      const unresolvedQuestions =
        (capture?.james_decision_payload as JamesCaptureDecision)?.unresolvedQuestions || [];
      const selectedQuestion = unresolvedQuestions[0] || question;

      const result = await handleJamesMoreResearch(
        supabase,
        parsed.captureId,
        userId,
        parsed.decisionVersion,
        selectedQuestion
      );
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: result.message,
      });
    }
  );

  console.log('[JamesSlackSurface] Registered: james_pursue, james_no_go, james_more_research');
}
