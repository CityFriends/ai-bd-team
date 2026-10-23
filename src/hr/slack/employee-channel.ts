/**
 * HR Employee Help Channel Handler
 *
 * Employee-facing channel where employees ask HR questions.
 * The HR AI responds privately via DM — never publishes HR answers
 * or repeats the question in the public channel.
 *
 * If a DM cannot be opened, provides only a neutral failure response.
 */

import type { App } from '@slack/bolt';
import type { HREnvConfig } from '../config/hr-env.js';
import type { HRAuthProvider } from '../auth/hr-auth.js';

const processedEvents = new Set<string>();

export function registerEmployeeChannel(
  app: App,
  env: HREnvConfig,
  auth: HRAuthProvider,
  expectedTeamId?: string
): void {
  app.message(async ({ message, client, context }) => {
    // Only handle messages in the help channel
    if (!('channel' in message) || message.channel !== env.helpChannelId) return;
    if (!('user' in message) || !message.user) return;
    if (message.subtype) return;

    // Workspace validation
    if (expectedTeamId && context.teamId !== expectedTeamId) return;

    // Deduplicate retries
    const eventId = `help:${message.ts}`;
    if (processedEvents.has(eventId)) return;
    processedEvents.add(eventId);
    if (processedEvents.size > 1000) {
      const entries = Array.from(processedEvents);
      for (let i = 0; i < 500; i++) processedEvents.delete(entries[i]);
    }

    const userId = message.user;

    // Verify the user is known (admin or employee in directory)
    const isKnown = await auth.isKnownEmployee(userId);
    if (!isKnown) {
      // Neutral response — do not reveal HR data or system details
      await client.chat.postEphemeral({
        channel: message.channel,
        user: userId,
        text: 'Please contact your HR administrator for assistance.',
      });
      return;
    }

    // Route to private DM — never answer in the public channel
    try {
      const dm = await client.conversations.open({ users: userId });
      if (!dm.ok || !dm.channel?.id) throw new Error('Could not open DM');

      await client.chat.postMessage({
        channel: dm.channel.id,
        text: "Thanks for your HR question! I'm currently being set up and will be able to help with policy questions soon. For immediate assistance, please reach out to your HR administrator.",
      });

      // Acknowledge in-channel with a neutral, non-sensitive reply
      await client.chat.postEphemeral({
        channel: message.channel,
        user: userId,
        text: "I've sent you a private message to help with your question.",
      });
    } catch {
      // DM failed — provide neutral failure response only
      await client.chat.postEphemeral({
        channel: message.channel,
        user: userId,
        text: 'I was unable to send you a private message. Please reach out to your HR administrator directly.',
      });
    }
  });
}
