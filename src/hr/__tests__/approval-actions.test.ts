/**
 * Approval Action Handler Tests
 *
 * Tests owner identity verification, policy approval/rejection,
 * batch approval/rejection, replay protection, and error handling.
 * All Slack and database interactions are mocked.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  verifyOwner,
  handlePolicyApproval,
  handlePolicyRejection,
  handleBatchApproval,
  handleBatchRejection,
  type ActionContext,
  type ApprovalConfig,
} from '../slack/approval-actions.js';
import {
  buildPolicyApprovalMessage,
  buildBatchApprovalMessage,
} from '../slack/approval-notifications.js';

const OWNER_ID = 'U01SC2TNYKU';
const TEAM_ID = 'T_WORKSPACE';

function mockDb(overrides: Record<string, any> = {}) {
  const selectResult = overrides.selectResult ?? null;
  const rpcResult = overrides.rpcResult ?? { approved: 1 };
  const rpcError = overrides.rpcError ?? null;

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: selectResult, error: null }),
          in: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: rpcResult, error: rpcError }),
  } as any;
}

function config(db: any = mockDb()): ApprovalConfig {
  return { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db };
}

// ── Owner Verification ─────────────────────────────────────

describe('verifyOwner', () => {
  it('accepts correct owner and workspace', () => {
    expect(verifyOwner({ userId: OWNER_ID, teamId: TEAM_ID, actionValue: '' }, config())).toBeNull();
  });

  it('rejects non-owner', () => {
    expect(verifyOwner({ userId: 'UIMPOSTOR', teamId: TEAM_ID, actionValue: '' }, config())).toBe('not_authorized_owner');
  });

  it('rejects wrong workspace', () => {
    expect(verifyOwner({ userId: OWNER_ID, teamId: 'T_WRONG', actionValue: '' }, config())).toBe('wrong_workspace');
  });

  it('accepts when no team ID configured', () => {
    const cfg = { ownerSlackId: OWNER_ID, db: mockDb() };
    expect(verifyOwner({ userId: OWNER_ID, teamId: 'T_ANY', actionValue: '' }, cfg)).toBeNull();
  });

  it('ignores forged owner ID in action value', () => {
    // The action value might contain any string — owner is from body.user.id
    expect(verifyOwner({ userId: 'UWRONG', teamId: TEAM_ID, actionValue: OWNER_ID }, config())).toBe('not_authorized_owner');
  });
});

// ── Policy Approval ────────────────────────────────────────

describe('handlePolicyApproval', () => {
  it('approves valid review via atomic RPC', async () => {
    // The handler now delegates to hr_approve_sensitive_policy RPC
    const rpcMock = vi.fn().mockResolvedValue({ data: 'approved', error: null });
    const cfg = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: { rpc: rpcMock, from: mockDb().from } as any };

    const result = await handlePolicyApproval({ userId: OWNER_ID, teamId: TEAM_ID, actionValue: 'rev-1' }, cfg);
    expect(result.ok).toBe(true);
    expect(result.action).toBe('approved');
    expect(rpcMock).toHaveBeenCalledWith('hr_approve_sensitive_policy', {
      p_review_id: 'rev-1',
      p_approved_by: OWNER_ID,
    });
  });

  it('propagates RPC error for stale hash', async () => {
    const cfg = {
      ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID,
      db: { rpc: vi.fn().mockResolvedValue({ data: 'content_changed', error: null }), from: mockDb().from } as any,
    };
    const result = await handlePolicyApproval({ userId: OWNER_ID, teamId: TEAM_ID, actionValue: 'rev-1' }, cfg);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('content_changed');
  });

  it('rejects non-owner', async () => {
    const result = await handlePolicyApproval({ userId: 'UWRONG', teamId: TEAM_ID, actionValue: 'rev-1' }, config());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('not_authorized_owner');
  });

  it('rejects missing review ID', async () => {
    const result = await handlePolicyApproval({ userId: OWNER_ID, teamId: TEAM_ID, actionValue: '' }, config());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('missing_review_id');
  });
});

// ── Policy Rejection ───────────────────────────────────────

describe('handlePolicyRejection', () => {
  it('rejects non-owner', async () => {
    const result = await handlePolicyRejection({ userId: 'UWRONG', teamId: TEAM_ID, actionValue: 'rev-1' }, config());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('not_authorized_owner');
  });
});

// ── Batch Approval ─────────────────────────────────────────

describe('handleBatchApproval', () => {
  it('delegates to atomic RPC for authorized owner', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: 'approved', error: null });
    const cfg = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: { rpc: rpcMock, from: mockDb().from } as any };

    const result = await handleBatchApproval({
      userId: OWNER_ID, teamId: TEAM_ID,
      actionValue: 'batch-id-123:digest-abc',
    }, cfg);

    expect(result.ok).toBe(true);
    expect(result.action).toBe('approved');
    expect(rpcMock).toHaveBeenCalledWith('hr_approve_compensation_batch', {
      p_batch_id: 'batch-id-123',
      p_manifest_digest: 'digest-abc',
      p_approved_by: OWNER_ID,
    });
  });

  it('rejects unauthorized user', async () => {
    const result = await handleBatchApproval({ userId: 'UWRONG', teamId: TEAM_ID, actionValue: 'batch:digest' }, config());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('not_authorized_owner');
  });

  it('rejects invalid action value format', async () => {
    const result = await handleBatchApproval({ userId: OWNER_ID, teamId: TEAM_ID, actionValue: 'no-colon' }, config());
    expect(result.ok).toBe(false);
    expect(result.message).toBe('invalid_action_value');
  });

  it('propagates RPC error result', async () => {
    const cfg = {
      ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID,
      db: { rpc: vi.fn().mockResolvedValue({ data: 'entry_hash_mismatch:page-1', error: null }), from: mockDb().from } as any,
    };
    const result = await handleBatchApproval({ userId: OWNER_ID, teamId: TEAM_ID, actionValue: 'b:d' }, cfg);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('entry_hash_mismatch');
  });
});

// ── Batch Rejection ────────────────────────────────────────

describe('handleBatchRejection', () => {
  it('rejects non-owner', async () => {
    const result = await handleBatchRejection({ userId: 'UWRONG', teamId: TEAM_ID, actionValue: 'b1' }, config());
    expect(result.ok).toBe(false);
  });
});

// ── Message Builders ───────────────────────────────────────

describe('buildPolicyApprovalMessage', () => {
  it('produces valid Block Kit for new policy', () => {
    const msg = buildPolicyApprovalMessage({
      reviewId: 'rev-1', pageTitle: 'Harassment Policy', notionUrl: 'https://notion.so/test',
      category: 'sensitive_policy', reason: 'Matches harassment pattern',
      contentHashShort: 'abc123', isUpdate: false,
    });
    expect(msg.text).toContain('Harassment Policy');
    expect(msg.blocks.length).toBeGreaterThan(0);
    const blockJson = JSON.stringify(msg.blocks);
    expect(blockJson).toContain('hr_approve_policy');
    expect(blockJson).toContain('hr_reject_policy');
    expect(blockJson).toContain('rev-1'); // action value = review ID
    expect(blockJson).toContain('🆕 New');
  });

  it('marks updated policies', () => {
    const msg = buildPolicyApprovalMessage({
      reviewId: 'rev-2', pageTitle: 'Updated Policy', notionUrl: 'https://notion.so/test',
      category: 'sensitive_policy', reason: 'Content changed',
      contentHashShort: 'def456', isUpdate: true,
    });
    const blockJson = JSON.stringify(msg.blocks);
    expect(blockJson).toContain('📝 Updated');
  });
});

describe('buildBatchApprovalMessage', () => {
  it('produces valid Block Kit for batch', () => {
    const msg = buildBatchApprovalMessage({
      batchId: 'batch-123', manifestDigest: 'digest-abc', pageCount: 248,
      digestShort: 'digest-a', sampleTitles: ['Salary Band A', 'Salary Band B'],
    });
    expect(msg.text).toContain('248 pages');
    expect(msg.blocks.length).toBeGreaterThan(0);
    const blockJson = JSON.stringify(msg.blocks);
    expect(blockJson).toContain('hr_approve_batch');
    expect(blockJson).toContain('batch-123:digest-abc'); // action value
    expect(blockJson).toContain('All-or-nothing');
    expect(blockJson).toContain('Salary Band A');
  });

  it('truncates long page lists', () => {
    const titles = Array.from({ length: 20 }, (_, i) => `Page ${i}`);
    const msg = buildBatchApprovalMessage({
      batchId: 'b', manifestDigest: 'd', pageCount: 20,
      digestShort: 'd', sampleTitles: titles,
    });
    const blockJson = JSON.stringify(msg.blocks);
    expect(blockJson).toContain('10 more');
  });
});

// ── Feature Flag ───────────────────────────────────────────

describe('feature flags', () => {
  it('approval actions default to disabled', async () => {
    delete process.env.HR_APPROVAL_ACTIONS_ENABLED;
    const { isApprovalActionsEnabled } = await import('../slack/approval-actions.js');
    expect(isApprovalActionsEnabled()).toBe(false);
  });
});
