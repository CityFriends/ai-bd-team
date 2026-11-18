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
 *
 * Processing indicator: Posts a temporary "Looking up FFTC policies..."
 *      message immediately after authorization, then updates it in-place
 *      with the final Block Kit answer via chat.update.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import type { HRAuthProvider } from '../auth/hr-auth.js';
import type { HRReaderPool } from '../database/hr-client.js';
import { checkPilotAccess, type HRPilotConfig } from './hr-pilot-access.js';
import { executeHRPipeline, type HRPipelineConfig } from '../llm/hr-answer-pipeline.js';
import { formatPipelineResultForSlack } from './hr-slack-formatter.js';
import { renderPipelineResultAsBlocks } from './hr-block-kit-renderer.js';
import {
  extractSearchQuery,
  searchHRKnowledge,
  formatSearchResultsForSlack,
  isSearchError,
} from '../search/keyword-search.js';

const processedEvents = new Set<string>();

// ── Correlation ID ─────────────────────────────────────────

/**
 * Generate a short correlation ID for request tracing.
 * Format: 8 hex characters from timestamp + random suffix.
 */
function generateCorrelationId(): string {
  const ts = Date.now().toString(16).slice(-4);
  const rand = Math.random().toString(16).slice(2, 6);
  return `${ts}${rand}`;
}

// ── Processing Indicator ───────────────────────────────────

/** Neutral acknowledgement text. Contains no employee data or policy content. */
export const PROCESSING_INDICATOR_TEXT = '🔍 Looking up FFTC policies…';

// ── Slack Abstractions ─────────────────────────────────────

/** Post a message, returning its timestamp for later updates. */
export type SlackPostFn = (
  channel: string,
  text: string,
  blocks?: KnownBlock[]
) => Promise<{ ts: string | undefined }>;

/** Update an existing bot message by timestamp. */
export type SlackUpdateFn = (
  channel: string,
  ts: string,
  text: string,
  blocks?: KnownBlock[]
) => Promise<void>;

/**
 * Legacy reply function type — kept for backward compatibility with
 * DM path and tests that don't need acknowledgement timestamps.
 */
export type SlackReplyFn = (channel: string, text: string, blocks?: KnownBlock[]) => Promise<void>;

/** Optional function to resolve an employee's preferred first name for greeting. */
export type EmployeeNameFn = (slackUserId: string) => Promise<string | null>;

export interface DMHandlerConfig {
  app: App;
  auth: HRAuthProvider;
  expectedTeamId?: string;
  readerPool?: HRReaderPool;
  signingSecret?: string;
  pilotConfig?: HRPilotConfig;
  pipelineConfig?: HRPipelineConfig;
  getEmployeeName?: EmployeeNameFn;
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

    // Build Slack operation functions from the live client
    const post: SlackPostFn = async (ch, text, blocks?) => {
      const resp = await client.chat.postMessage({
        channel: ch,
        text,
        ...(blocks ? { blocks } : {}),
      });
      return { ts: resp.ts };
    };

    const update: SlackUpdateFn = async (ch, ts, text, blocks?) => {
      await client.chat.update({
        channel: ch,
        ts,
        text,
        ...(blocks ? { blocks } : {}),
      });
    };

    // Legacy reply (for DM path)
    const reply: SlackReplyFn = async (ch, text, blocks?) => {
      await post(ch, text, blocks);
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
      getEmployeeName: config.getEmployeeName,
      post,
      update,
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
  getEmployeeName?: EmployeeNameFn;
  /** Post a message and return its timestamp. Used for ack + update flow. */
  post?: SlackPostFn;
  /** Update an existing message by timestamp. */
  update?: SlackUpdateFn;
  /** Legacy reply (fire-and-forget). Used for DM path and backward compat. */
  reply: SlackReplyFn;
}

/**
 * Core message-handling logic, extracted for testability.
 * All Slack I/O goes through the injected reply/post/update functions.
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
    getEmployeeName,
    post,
    update,
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

    // ── Keyword Search Path ─────────────────────────────────
    // Check for "search: <query>" pattern before AI pipeline.
    // Uses PostgreSQL full-text search, not LLM retrieval.
    const searchQuery = extractSearchQuery(text);
    if (searchQuery && input.readerPool) {
      const searchStart = Date.now();
      try {
        const searchResult = await searchHRKnowledge(input.readerPool.pool, userId, searchQuery);
        const responseText = formatSearchResultsForSlack(searchResult);
        await reply(channelId, responseText);

        if (!isSearchError(searchResult)) {
          // eslint-disable-next-line no-console
          console.log(
            `[HR Search] query="${searchQuery}" results=${searchResult.resultCount} time=${Date.now() - searchStart}ms`
          );
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[HR Search] Unexpected error:', errorMessage);
        await reply(channelId, '❌ Search encountered an unexpected error. Please try again.');
      }
      return;
    }

    const t0 = Date.now();
    const correlationId = generateCorrelationId();

    // ── Post processing indicator ─────────────────────────
    // Only posted after all authorization checks pass.
    // Contains no employee data, question text, or policy content.
    let ackTs: string | undefined;
    if (post) {
      try {
        const ackResult = await post(channelId, PROCESSING_INDICATOR_TEXT);
        ackTs = ackResult.ts;
      } catch {
        // Acknowledgement failed — continue without it.
        // The employee won't see a loading indicator, but the answer
        // will still be delivered as a new message via reply().
      }
    }

    const tAck = Date.now();

    try {
      // Run pipeline and name lookup concurrently
      const [result, employeeName] = await Promise.all([
        executeHRPipeline(pipelineConfig, text, userId, correlationId),
        getEmployeeName
          ? getEmployeeName(userId).catch(() => null as string | null)
          : Promise.resolve(null as string | null),
      ]);

      const tPipeline = Date.now();

      // Render as Block Kit with plain-text fallback
      const payload = renderPipelineResultAsBlocks(result, {
        employeeName,
        messageText: text,
      });

      // ── Deliver final answer ──────────────────────────
      let deliveryOutcome:
        | 'update_blocks'
        | 'update_plain'
        | 'reply_blocks'
        | 'reply_plain'
        | 'update_failed' = 'update_failed';
      if (ackTs && update) {
        // Update the acknowledgement message in-place
        try {
          await update(channelId, ackTs, payload.text, payload.blocks);
          deliveryOutcome = 'update_blocks';
        } catch {
          // Block Kit update rejected — try plain-text update
          try {
            await update(channelId, ackTs, formatPipelineResultForSlack(result));
            deliveryOutcome = 'update_plain';
          } catch {
            // Update failed entirely — do NOT post a duplicate message.
            // The employee still sees the processing indicator.
            // This is a rare edge case (Slack down after initial post).
            deliveryOutcome = 'update_failed';
          }
        }
      } else {
        // No acknowledgement — deliver as new message (legacy path)
        try {
          await reply(channelId, payload.text, payload.blocks);
          deliveryOutcome = 'reply_blocks';
        } catch {
          await reply(channelId, formatPipelineResultForSlack(result));
          deliveryOutcome = 'reply_plain';
        }
      }

      const tDone = Date.now();
      // eslint-disable-next-line no-console
      console.log(
        `[HR Pipeline] cid=${correlationId} ack=${tAck - t0}ms pipeline=${tPipeline - tAck}ms total=${tDone - t0}ms` +
          ` outcome=${result.ok ? 'success' : result.code} delivery=${deliveryOutcome}`
      );
    } catch (err) {
      // Pipeline or delivery failure (unhandled exception)
      const errorMsg =
        'I encountered an issue processing your question. Please try again later or contact your HR team.';
      // eslint-disable-next-line no-console
      console.error(
        `[HR Pipeline] cid=${correlationId} EXCEPTION stage=outer error=${err instanceof Error ? err.message.slice(0, 100) : 'unknown'}`
      );
      try {
        if (ackTs && update) {
          await update(channelId, ackTs, errorMsg);
        } else {
          await reply(channelId, errorMsg);
        }
      } catch {
        // Cannot safely send anything
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
