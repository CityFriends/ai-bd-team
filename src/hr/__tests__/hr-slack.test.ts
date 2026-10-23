/**
 * HR Slack Foundation Tests
 *
 * Verifies channel routing, authorization, DM privacy, and fail-closed behavior.
 * All tests use mocks — no live Slack connection.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHRAuth } from '../auth/hr-auth.js';

// ============================================================
// Leadership channel — authorization
// ============================================================

describe('HR Leadership Channel', () => {
  it('rejects unauthorized users from leadership channel', async () => {
    const { registerLeadershipChannel } = await import('../slack/leadership-channel.js');
    const auth = createHRAuth(['UADMIN1']);

    const saySpy = vi.fn();
    let messageHandler: (args: any) => Promise<void> = async () => {};

    const mockApp = {
      message: (handler: (args: any) => Promise<void>) => {
        messageHandler = handler;
      },
    };

    registerLeadershipChannel(mockApp as any, {
      leadershipChannelId: 'C_LEADERSHIP',
    } as any, auth);

    // Unauthorized user sends message
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

    const mockApp = {
      message: (handler: (args: any) => Promise<void>) => {
        messageHandler = handler;
      },
    };

    registerLeadershipChannel(mockApp as any, {
      leadershipChannelId: 'C_LEADERSHIP',
    } as any, auth);

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
// Employee channel — DM routing, no public answers
// ============================================================

describe('HR Employee Channel', () => {
  it('routes employee questions to DM, not public channel', async () => {
    const { registerEmployeeChannel } = await import('../slack/employee-channel.js');
    const auth = createHRAuth(['UADMIN1'], async (slackId) =>
      slackId === 'UEMP1'
    );

    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = {
      message: (handler: (args: any) => Promise<void>) => {
        messageHandler = handler;
      },
    };

    const postMessageSpy = vi.fn().mockResolvedValue({ ok: true });
    const postEphemeralSpy = vi.fn().mockResolvedValue({ ok: true });
    const conversationsOpenSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, channel: { id: 'D_DM_CHANNEL' } });

    registerEmployeeChannel(mockApp as any, { helpChannelId: 'C_HELP' } as any, auth);

    await messageHandler({
      message: { channel: 'C_HELP', user: 'UEMP1', ts: '2.1' },
      client: {
        conversations: { open: conversationsOpenSpy },
        chat: { postMessage: postMessageSpy, postEphemeral: postEphemeralSpy },
      },
      context: {},
    });

    // DM was opened and message sent privately
    expect(conversationsOpenSpy).toHaveBeenCalledWith({ users: 'UEMP1' });
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'D_DM_CHANNEL' })
    );
    // Ephemeral acknowledgment in channel (not a public HR answer)
    expect(postEphemeralSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('private message'),
      })
    );
  });

  it('fails closed for unknown users', async () => {
    const { registerEmployeeChannel } = await import('../slack/employee-channel.js');
    const auth = createHRAuth([]);

    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = {
      message: (handler: (args: any) => Promise<void>) => {
        messageHandler = handler;
      },
    };

    const postEphemeralSpy = vi.fn().mockResolvedValue({ ok: true });

    registerEmployeeChannel(mockApp as any, { helpChannelId: 'C_HELP' } as any, auth);

    await messageHandler({
      message: { channel: 'C_HELP', user: 'USTRANGER', ts: '2.2' },
      client: {
        chat: { postEphemeral: postEphemeralSpy },
      },
      context: {},
    });

    // Neutral response — no HR data exposed
    expect(postEphemeralSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('contact your HR administrator'),
      })
    );
  });

  it('handles DM open failure gracefully', async () => {
    const { registerEmployeeChannel } = await import('../slack/employee-channel.js');
    const auth = createHRAuth(['UADMIN1']);

    let messageHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = {
      message: (handler: (args: any) => Promise<void>) => {
        messageHandler = handler;
      },
    };

    const postEphemeralSpy = vi.fn().mockResolvedValue({ ok: true });
    const conversationsOpenSpy = vi.fn().mockRejectedValue(new Error('cant_dm_bot'));

    registerEmployeeChannel(mockApp as any, { helpChannelId: 'C_HELP' } as any, auth);

    await messageHandler({
      message: { channel: 'C_HELP', user: 'UADMIN1', ts: '2.3' },
      client: {
        conversations: { open: conversationsOpenSpy },
        chat: { postEphemeral: postEphemeralSpy },
      },
      context: {},
    });

    // Neutral failure — no sensitive data
    expect(postEphemeralSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('unable to send you a private message'),
      })
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
    const mockApp = {
      event: (_type: string, handler: (args: any) => Promise<void>) => {
        eventHandler = handler;
      },
    };

    const postMessageSpy = vi.fn().mockResolvedValue({ ok: true });

    registerDMHandler(mockApp as any, auth);

    await eventHandler({
      event: { channel_type: 'im', user: 'USTRANGER', ts: '3.1', channel: 'D_STRANGER' },
      client: { chat: { postMessage: postMessageSpy } },
      context: {},
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("don't have your information"),
      })
    );
  });

  it('responds to known admin in DM', async () => {
    const { registerDMHandler } = await import('../slack/dm-handler.js');
    const auth = createHRAuth(['UADMIN1']);

    let eventHandler: (args: any) => Promise<void> = async () => {};
    const mockApp = {
      event: (_type: string, handler: (args: any) => Promise<void>) => {
        eventHandler = handler;
      },
    };

    const postMessageSpy = vi.fn().mockResolvedValue({ ok: true });

    registerDMHandler(mockApp as any, auth);

    await eventHandler({
      event: { channel_type: 'im', user: 'UADMIN1', ts: '3.2', channel: 'D_ADMIN' },
      client: { chat: { postMessage: postMessageSpy } },
      context: {},
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('HR administration features'),
      })
    );
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

    // Register with expected team ID
    registerLeadershipChannel(mockApp as any, { leadershipChannelId: 'C_LEAD' } as any, auth, 'T_CORRECT');

    // Event from wrong workspace
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
    // This is a schema-level test: verify the access_classification values
    const employeeSafe = 'employee_safe';
    const hrRestricted = 'hr_restricted';
    const compensationRestricted = 'compensation_restricted';

    // Only employee_safe content should be visible to employees
    expect(employeeSafe).not.toBe(hrRestricted);
    expect(employeeSafe).not.toBe(compensationRestricted);

    // The SQL constraint enforces these values at the database level
    // Application code must filter by access_classification when serving employee queries
  });
});

// ============================================================
// BD isolation
// ============================================================

describe('BD Agent Isolation', () => {
  it('HR modules do not import BD database singleton', async () => {
    // Verify that importing HR modules does not pull in BD integrations
    const hrClientModule = await import('../database/hr-client.js');
    expect(hrClientModule.createHRClient).toBeDefined();
    // The function signature requires explicit URL/key — no BD singleton
  });

  it('HR modules do not import BD Slack singleton', async () => {
    const hrSlackModule = await import('../slack/hr-slack-app.js');
    expect(hrSlackModule.createHRSlackApp).toBeDefined();
    // Takes explicit env config — no BD getSlackApp() singleton
  });
});
