/**
 * HR Leadership Channel Handler
 *
 * Private channel for HR owners and authorized administrators.
 * Rejects unauthorized requests. Does not publish employee-specific
 * confidential data into the channel.
 */

import type { App } from '@slack/bolt';
import type { HREnvConfig } from '../config/hr-env.js';
import type { HRAuthProvider } from '../auth/hr-auth.js';

const processedEvents = new Set<string>();

export function registerLeadershipChannel(
  app: App,
  env: HREnvConfig,
  auth: HRAuthProvider,
  expectedTeamId?: string
): void {
  app.message(async ({ message, say, context }) => {
    // Only handle messages in the leadership channel
    if (!('channel' in message) || message.channel !== env.leadershipChannelId) return;
    if (!('user' in message) || !message.user) return;
    if (message.subtype) return; // Ignore edits, joins, etc.

    // Workspace validation
    if (expectedTeamId && context.teamId !== expectedTeamId) return;

    // Deduplicate retries
    const eventId = `leadership:${message.ts}`;
    if (processedEvents.has(eventId)) return;
    processedEvents.add(eventId);
    // Prevent unbounded growth
    if (processedEvents.size > 1000) {
      const entries = Array.from(processedEvents);
      for (let i = 0; i < 500; i++) processedEvents.delete(entries[i]);
    }

    const userId = message.user;

    // Authorization: only admins/owners can use the leadership channel
    if (!auth.isAdmin(userId)) {
      await say({
        text: 'This channel is restricted to authorized HR administrators.',
        thread_ts: message.ts,
      });
      return;
    }

    // M1 placeholder — LLM and knowledge retrieval not yet available
    await say({
      text: 'HR leadership channel is active. Policy research and administration tools will be available in a future update.',
      thread_ts: message.ts,
    });
  });
}
