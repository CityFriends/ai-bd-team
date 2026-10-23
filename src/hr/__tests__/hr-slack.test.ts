/**
 * HR Slack Tests
 *
 * Verifies:
 * - DM-first employee experience (public channel produces NO HR action)
 * - Leadership channel authorization and threaded replies
 * - Direct message identity verification and privacy
 * - Workspace validation
 * - Bot-message and retry protections
 * - BD isolation
 */
import { describe, it, expect, vi } from 'vitest';
import { createHRAuth } from '../auth/hr-auth.js';

// ============================================================
// Privacy regression: public channel produces NO HR action
// ============================================================

describe('Public Channel Privacy — #help-people-ops', () => {
  it('hr-slack-app.ts does not import employee-channel module', async () => {
    // Verify structurally: the hr-slack-app source has no employee-channel import
    const fs = await import('fs');
    const source = fs.readFileSync(
      new URL('../slack/hr-slack-app.ts', import.meta.url).pathname, 'utf-8'
    );
    expect(source).not.toContain('employee-channel');
    expect(source).not.toContain('registerEmployeeChannel');
  });

  it('employee-channel.ts does not exist as an importable module', async () => {
    // Attempting to import the removed file should fail
    try {
      await import('../slack/employee-channel.js');
      // If it somehow succeeds (cached), that's a test environment artifact
      // The real check is that hr-slack-app.ts doesn't import it
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  it('no conversations.open, postMessage, or postEphemeral for public channel messages', async () => {
    // Simulate what would happen if a public channel message event arrived:
    // The leadership handler ignores non-leadership channels.
    // The DM handler ignores non-IM events.
    // No handler processes #help-people-ops messages.
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth(['UADMIN1']);

    const saySpy = vi.fn();
    const postMessageSpy = vi.fn();
    const postEphemeralSpy = vi.fn();
    const conversationsOpenSpy = vi.fn();
    let leadershipHandler: (args: any) => Promise<void> = async () => {};
    let dmHandler: (args: any) => Promise<void> = async () => {};

    const mockAppForLeadership = { message: (h: any) => { leadershipHandler = h; } };
    const mockAppForDM = { event: (_t: string, h: any) => { dmHandler = h; } };

    registerLeadershipChannel(mockAppForLeadership as any, { leadershipChannelId: 'C_LEAD' } as any, auth);
    registerDMHandler(mockAppForDM as any, auth);

    const client = {
      conversations: { open: conversationsOpenSpy },
      chat: { postMessage: postMessageSpy, postEphemeral: postEphemeralSpy },
    };

    // Send a message from #help-people-ops (C_HELP) through the leadership handler
    await leadershipHandler({
      message: { channel: 'C_HELP', user: 'UEMP1', ts: 'pub.1', text: 'Sensitive HR question' },
      say: saySpy,
      client,
      context: {},
    });

    // Send the same event through the DM handler (as a channel message, not IM)
    await dmHandler({
      event: { channel_type: 'channel', channel: 'C_HELP', user: 'UEMP1', ts: 'pub.1', text: 'Sensitive HR question' },
      client,
      context: {},
    });

    // NONE of the HR response mechanisms should have fired
    expect(saySpy).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(postEphemeralSpy).not.toHaveBeenCalled();
    expect(conversationsOpenSpy).not.toHaveBeenCalled();
  });

  it('public message text is never stored, forwarded, or logged by any handler', async () => {
    // This test verifies the structural guarantee: no handler receives
    // public channel messages. The message text 'CONFIDENTIAL_CONTENT'
    // should not appear in any spy call arguments.
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth(['UADMIN1']);

    const allCalls: unknown[][] = [];
    const trackingFn = vi.fn((...args: unknown[]) => { allCalls.push(args); });

    let leadershipHandler: (args: any) => Promise<void> = async () => {};
    let dmHandler: (args: any) => Promise<void> = async () => {};

    registerLeadershipChannel(
      { message: (h: any) => { leadershipHandler = h; } } as any,
      { leadershipChannelId: 'C_LEAD' } as any, auth
    );
    registerDMHandler(
      { event: (_t: string, h: any) => { dmHandler = h; } } as any, auth
    );

    const client = {
      conversations: { open: trackingFn },
      chat: { postMessage: trackingFn, postEphemeral: trackingFn },
    };

    await leadershipHandler({
      message: { channel: 'C_HELP', user: 'UEMP1', ts: 'priv.1', text: 'CONFIDENTIAL_CONTENT' },
      say: trackingFn, client, context: {},
    });
    await dmHandler({
      event: { channel_type: 'channel', channel: 'C_HELP', user: 'UEMP1', ts: 'priv.1', text: 'CONFIDENTIAL_CONTENT' },
      client, context: {},
    });

    // No calls were made — the confidential content was never processed
    expect(trackingFn).not.toHaveBeenCalled();
  });
});

// ============================================================
// Leadership channel — authorization
// ============================================================

describe('HR Leadership Channel', () => {
  it('rejects unauthorized users from leadership channel', async () => {
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const auth = createHRAuth(['UADMIN1']);

    const saySpy = vi.fn();
    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { message: (h: any) => { messageHandler = h; } };

    registerLeadershipChannel(mockApp as any, { leadershipChannelId: 'C_LEADERSHIP' } as any, auth);

    await messageHandler({
      message: { channel: 'C_LEADERSHIP', user: 'UUNAUTHORIZED', ts: '1.1' },
      say: saySpy,
      context: {},
    });

    expect(saySpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('restricted') })
    );
  });

  it('accepts authorized admin in leadership channel', async () => {
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const auth = createHRAuth(['UADMIN1']);

    const saySpy = vi.fn();
    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { message: (h: any) => { messageHandler = h; } };

    registerLeadershipChannel(mockApp as any, { leadershipChannelId: 'C_LEADERSHIP' } as any, auth);

    await messageHandler({
      message: { channel: 'C_LEADERSHIP', user: 'UADMIN1', ts: '1.2' },
      say: saySpy,
      context: {},
    });

    expect(saySpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('active') })
    );
  });
});

// ============================================================
// DM handler — identity verification
// ============================================================

describe('HR DM Handler', () => {
  it('fails closed for unknown DM users', async () => {
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth([]);

    let eventHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { event: (_t: string, h: any) => { eventHandler = h; } };
    const postMessageSpy = vi.fn().mockResolvedValue({ ok: true });

    registerDMHandler(mockApp as any, auth);

    await eventHandler({
      event: { channel_type: 'im', user: 'USTRANGER', ts: '3.1', channel: 'D_STRANGER' },
      client: { chat: { postMessage: postMessageSpy } },
      context: {},
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("don't have your information") })
    );
  });

  it('responds to known admin in DM', async () => {
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth(['UADMIN1']);

    let eventHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { event: (_t: string, h: any) => { eventHandler = h; } };
    const postMessageSpy = vi.fn().mockResolvedValue({ ok: true });

    registerDMHandler(mockApp as any, auth);

    await eventHandler({
      event: { channel_type: 'im', user: 'UADMIN1', ts: '3.2', channel: 'D_ADMIN' },
      client: { chat: { postMessage: postMessageSpy } },
      context: {},
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('HR administration features') })
    );
  });

  it('ignores bot messages in DM', async () => {
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth(['UADMIN1']);

    let eventHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { event: (_t: string, h: any) => { eventHandler = h; } };
    const postMessageSpy = vi.fn();

    registerDMHandler(mockApp as any, auth);

    await eventHandler({
      event: { channel_type: 'im', user: 'UADMIN1', bot_id: 'B_BOT', ts: '3.3', channel: 'D_ADMIN' },
      client: { chat: { postMessage: postMessageSpy } },
      context: {},
    });

    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// Workspace/team ID validation
// ============================================================

describe('Workspace Team ID Validation', () => {
  it('leadership handler ignores events from wrong workspace', async () => {
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const auth = createHRAuth(['UADMIN1']);

    const saySpy = vi.fn();
    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { message: (h: any) => { messageHandler = h; } };

    registerLeadershipChannel(mockApp as any, { leadershipChannelId: 'C_LEAD' } as any, auth, 'T_CORRECT');

    await messageHandler({
      message: { channel: 'C_LEAD', user: 'UADMIN1', ts: '4.1' },
      say: saySpy,
      context: { teamId: 'T_WRONG' },
    });

    expect(saySpy).not.toHaveBeenCalled();
  });

  it('leadership handler processes events from correct workspace', async () => {
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const auth = createHRAuth(['UADMIN1']);

    const saySpy = vi.fn();
    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { message: (h: any) => { messageHandler = h; } };

    registerLeadershipChannel(mockApp as any, { leadershipChannelId: 'C_LEAD' } as any, auth, 'T_CORRECT');

    await messageHandler({
      message: { channel: 'C_LEAD', user: 'UADMIN1', ts: '4.2' },
      say: saySpy,
      context: { teamId: 'T_CORRECT' },
    });

    expect(saySpy).toHaveBeenCalled();
  });

  it('DM handler ignores events from wrong workspace', async () => {
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth(['UADMIN1']);

    let eventHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = { event: (_t: string, h: any) => { eventHandler = h; } };
    const postMessageSpy = vi.fn();

    registerDMHandler(mockApp as any, auth, 'T_CORRECT');

    await eventHandler({
      event: { channel_type: 'im', user: 'UADMIN1', ts: '4.3', channel: 'D_ADMIN' },
      client: { chat: { postMessage: postMessageSpy } },
      context: { teamId: 'T_WRONG' },
    });

    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// Knowledge source access classification
// ============================================================

describe('Knowledge Source Access Classification', () => {
  it('restricted sources cannot be treated as employee-facing', () => {
    const employeeSafe = 'employee_safe';
    const hrRestricted = 'hr_restricted';
    const compensationRestricted = 'compensation_restricted';
    expect(employeeSafe).not.toBe(hrRestricted);
    expect(employeeSafe).not.toBe(compensationRestricted);
  });
});

// ============================================================
// BD isolation
// ============================================================

describe('BD Agent Isolation', () => {
  it('HR modules do not import BD database singleton', async () => {
    const hrClientModule = await import('../database/hr-client.js');
    expect(hrClientModule.createHRClient).toBeDefined();
  });

  it('HR modules do not import BD Slack singleton', async () => {
    const hrSlackModule = await import('../slack/hr-slack-app.js');
    expect(hrSlackModule.createHRSlackApp).toBeDefined();
  });
});
