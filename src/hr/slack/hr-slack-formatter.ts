/**
 * HR Slack Message Formatter — Employee-Safe Output
 *
 * Formats validated HR answers for Slack delivery.
 * Only accepts pre-validated answer results from the pipeline.
 * Never formats raw model text, internal errors, or unvalidated citations.
 *
 * Security:
 *   - Strips active Slack mentions (@channel, @here, @user) from answer text.
 *   - Escapes Slack control characters in citation titles.
 *   - Enforces message-length limits.
 *   - Uses only validated citation metadata (URL + title from retrieval).
 *   - No credentials, prompts, or internal identifiers are included.
 */

import type { HRAnswerResult } from '../llm/hr-answer-foundation.js';
import type { HRPipelineResult } from '../llm/hr-answer-pipeline.js';

/** Maximum Slack message length (Slack's limit is ~40k; we use a safe subset). */
const MAX_SLACK_MESSAGE_LENGTH = 3000;

/**
 * Neutralize Slack special mentions in model-generated text.
 * Prevents the model from triggering @channel, @here, or @user pings.
 */
function neutralizeMentions(text: string): string {
  return text
    .replace(/<!channel>/g, '@\u200Bchannel')
    .replace(/<!here>/g, '@\u200Bhere')
    .replace(/<!everyone>/g, '@\u200Beveryone')
    // Neutralize user mention format <@U...>
    .replace(/<@(U[A-Z0-9]+)>/g, '@\u200Buser');
}

/**
 * Escape Slack mrkdwn control characters in untrusted text.
 * Used for citation titles that come from retrieval metadata.
 */
function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format a successful validated answer for Slack delivery.
 */
export function formatAnswerForSlack(result: HRAnswerResult & { ok: true }): string {
  let text = neutralizeMentions(result.answer.text);

  // Append citations if present
  if (result.answer.citations.length > 0) {
    const sources = result.answer.citations
      .map((c) => {
        const title = escapeSlackText(c.title || 'Source');
        return `• <${c.sourceUrl}|${title}>`;
      })
      .join('\n');
    text += `\n\n*Sources:*\n${sources}`;
  }

  // Enforce length limit
  if (text.length > MAX_SLACK_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_SLACK_MESSAGE_LENGTH - 3) + '...';
  }

  return text;
}

/**
 * Format a pipeline result (success or failure) for Slack delivery.
 */
export function formatPipelineResultForSlack(result: HRPipelineResult): string {
  if (result.ok) {
    return formatAnswerForSlack(result);
  }
  return result.fallbackMessage;
}
