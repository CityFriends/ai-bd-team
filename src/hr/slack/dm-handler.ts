/**
 * HR Direct Message Handler
 *
 * Accepts DMs to the HR bot. Verifies the Slack identity against
 * the employee directory or admin allowlist.
 *
 * Unknown users fail closed — no HR data is exposed.
 * M1: Placeholder responses only (no LLM, no handbook).
 */

import type { App } from '@slack/bolt';
import type { HRAuthProvider } from '../auth/hr-auth.js';
import type { HRReaderPool } from '../database/hr-client.js';
import { retrieveForUser } from '../notion/retrieval.js';

const processedEvents = new Set<string>();

export function registerDMHandler(
  app: App,
  auth: HRAuthProvider,
  expectedTeamId?: string,
  readerPool?: HRReaderPool,
  signingSecret?: string
): void {
  app.event('message', async ({ event, client, context }) => {
    // Only handle direct messages (IM channel type)
    if (event.channel_type !== 'im') return;
    if (!('user' in event) || !event.user) return;
    if ('subtype' in event && event.subtype) return;
    // Ignore bot's own messages
    if ('bot_id' in event) return;

    // Workspace validation
    if (expectedTeamId && context.teamId !== expectedTeamId) return;

    // Deduplicate retries
    const eventId = `dm:${event.ts}`;
    if (processedEvents.has(eventId)) return;
    processedEvents.add(eventId);
    if (processedEvents.size > 1000) {
      const entries = Array.from(processedEvents);
      for (let i = 0; i < 500; i++) processedEvents.delete(entries[i]);
    }

    const userId = event.user;

    // Verify identity — fail closed for unknown users
    const isKnown = await auth.isKnownEmployee(userId);
    if (!isKnown) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "I'm the FFTC HR assistant. I don't have your information on file yet. Please contact your HR administrator for assistance.",
      });
      return;
    }

    // Knowledge retrieval via signed identity tokens (when reader pool is available)
    if (readerPool && signingSecret && 'text' in event && event.text) {
      const result = await retrieveForUser(readerPool, signingSecret, event.text, userId);
      if (result.chunks.length > 0) {
        const formatted = result.chunks.map((c) => {
          const heading = c.citation.heading ? `*${c.citation.heading}*\n` : '';
          return `${heading}${c.contentText}\n_Source: <${c.citation.url}|${c.citation.title}>_`;
        }).join('\n\n---\n\n');

        await client.chat.postMessage({
          channel: event.channel,
          text: `Here's what I found:\n\n${formatted}`,
        });
        return;
      }
      // Fall through to placeholder if no results found
    }

    // Placeholder — no matching knowledge or retrieval not configured
    const isAdmin = auth.isAdmin(userId);
    if (isAdmin) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "Hi! I'm the FFTC HR assistant. HR administration features are being set up and will be available soon. You'll be able to manage employee records, review policies, and handle onboarding tasks here.",
      });
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        text: "Hi! I'm the FFTC HR assistant. I'm currently being set up and will be able to help with policy questions, benefits information, and other HR topics soon. For immediate assistance, please reach out to your HR administrator.",
      });
    }
  });
}
