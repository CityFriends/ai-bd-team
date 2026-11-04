/**
 * HR Message Handler
 *
 * Handles DMs to the HR bot and pilot private-channel messages.
 *
 * DMs: Verifies Slack identity against employee directory. Unknown
 *      users fail closed — no HR data is exposed.
 *
 * Pilot channel: Requires explicit pilot-mode configuration, an
 *      approved user ID, and an approved private channel ID.
 *      All access denied by default.
 *
 * AI pipeline: When pilot access is granted and the pipeline is
 *      configured, questions go through the validated answer pipeline
 *      (retrieval → LLM → citation validation → safe formatting).
 *      Raw retrieval chunks and raw model text are never sent to Slack.
 */

import type { App } from '@slack/bolt';
import type { HRAuthProvider } from '../auth/hr-auth.js';
import type { HRReaderPool } from '../database/hr-client.js';
import { checkPilotAccess, type HRPilotConfig } from './hr-pilot-access.js';
import { executeHRPipeline, type HRPipelineConfig } from '../llm/hr-answer-pipeline.js';
import { formatPipelineResultForSlack } from './hr-slack-formatter.js';

const processedEvents = new Set<string>();

/** Reply function type — injected for testability. */
export type SlackReplyFn = (channel: string, text: string) => Promise<void>;

export interface DMHandlerConfig {
  app: App;
  auth: HRAuthProvider;
  expectedTeamId?: string;
  readerPool?: HRReaderPool;
  signingSecret?: string;
  pilotConfig?: HRPilotConfig;
  pipelineConfig?: HRPipelineConfig;
}

export function registerDMHandler(
  app: App,
  auth: HRAuthProvider,
  expectedTeamId?: string,
  readerPool?: HRReaderPool,
  signingSecret?: string
): void {
  registerMessageHandler({
    app,
    auth,
    expectedTeamId,
    readerPool,
    signingSecret,
  });
}

export function registerMessageHandler(config: DMHandlerConfig): void {
  config.app.event('message', async ({ event, client, context }) => {
    if (!('user' in event) || !event.user) return;
    if ('subtype' in event && event.subtype) return;
    if ('bot_id' in event) return;

    // Workspace validation
    if (config.expectedTeamId && context.teamId !== config.expectedTeamId) return;

    const channelType = (event as { channel_type?: string }).channel_type || '';
    const userId = event.user;
    const channelId = event.channel;

    // Build reply function from the live client
    const reply: SlackReplyFn = async (ch, text) => {
      await client.chat.postMessage({ channel: ch, text });
    };

    await handleMessage({
      userId,
      channelId,
      channelType,
      text: 'text' in event ? event.text || '' : '',
      eventTs: event.ts,
      auth: config.auth,
      readerPool: config.readerPool,
      signingSecret: config.signingSecret,
      pilotConfig: config.pilotConfig,
      pipelineConfig: config.pipelineConfig,
      reply,
    });
  });
}

// ── Testable Core Logic ─────────────────────────────────────

export interface HandleMessageInput {
  userId: string;
  channelId: string;
  channelType: string;
  text: string;
  eventTs: string;
  auth: HRAuthProvider;
  readerPool?: HRReaderPool;
  signingSecret?: string;
  pilotConfig?: HRPilotConfig;
  pipelineConfig?: HRPipelineConfig;
  reply: SlackReplyFn;
}

/**
 * Core message-handling logic, extracted for testability.
 * All Slack I/O goes through the injected reply function.
 */
export async function handleMessage(input: HandleMessageInput): Promise<void> {
  const {
    userId,
    channelId,
    channelType,
    text,
    eventTs,
    auth,
    pilotConfig,
    pipelineConfig,
    reply,
  } = input;

  // ── Deduplication ───────────────────────────────────────
  const eventId = `${channelType}:${eventTs}`;
  if (processedEvents.has(eventId)) return;
  processedEvents.add(eventId);
  if (processedEvents.size > 1000) {
    const entries = Array.from(processedEvents);
    for (let i = 0; i < 500; i++) processedEvents.delete(entries[i]);
  }

  // ── Pilot Private-Channel Path ──────────────────────────
  if (channelType === 'group') {
    // Feature gates: HR AI and HR LLM must both be enabled before any
    // retrieval or LLM call. Checked before pilot access to ensure no
    // pipeline processing occurs when AI is globally disabled.
    if (
      process.env.HR_AI_ENABLED?.toLowerCase() !== 'true' ||
      process.env.HR_LLM_ENABLED?.toLowerCase() !== 'true'
    ) {
      return;
    }

    if (!pilotConfig || !pipelineConfig) return;

    const pilotCheck = checkPilotAccess(pilotConfig, userId, channelId, channelType);
    if (!pilotCheck.allowed) return; // silently ignore non-pilot messages

    // Pilot access granted — require employee identity
    const isKnown = await auth.isKnownEmployee(userId);
    if (!isKnown) {
      await reply(
        channelId,
        "I don't have your information on file. Please contact your HR administrator."
      );
      return;
    }

    if (!text.trim()) return;

    try {
      const result = await executeHRPipeline(pipelineConfig, text, userId);
      await reply(channelId, formatPipelineResultForSlack(result));
    } catch {
      // Pipeline or reply failure — do not expose internal details to Slack
      try {
        await reply(
          channelId,
          'I encountered an issue processing your question. Please try again later or contact your HR team.'
        );
      } catch {
        // Reply itself failed — cannot safely send anything
      }
    }
    return;
  }

  // ── DM Path (existing behavior) ─────────────────────────
  if (channelType !== 'im') return;

  const isKnown = await auth.isKnownEmployee(userId);
  if (!isKnown) {
    await reply(
      channelId,
      "I'm the FFTC HR assistant. I don't have your information on file yet. Please contact your HR administrator for assistance."
    );
    return;
  }

  // Placeholder — AI pipeline is only available through the approved pilot channel.
  // Raw retrieval chunks are never sent to employee DMs.
  const isAdmin = auth.isAdmin(userId);
  if (isAdmin) {
    await reply(
      channelId,
      "Hi! I'm the FFTC HR assistant. HR administration features are being set up and will be available soon. You'll be able to manage employee records, review policies, and handle onboarding tasks here."
    );
  } else {
    await reply(
      channelId,
      "Hi! I'm the FFTC HR assistant. I'm currently being set up and will be able to help with policy questions, benefits information, and other HR topics soon. For immediate assistance, please reach out to your HR administrator."
    );
  }
}
