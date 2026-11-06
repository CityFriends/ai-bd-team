/**
 * Approval Integration Tests
 *
 * Tests Bolt startup registration, exhaustive pagination,
 * and notification processor behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ACTION_APPROVE_POLICY,
  ACTION_REJECT_POLICY,
  ACTION_APPROVE_BATCH,
  ACTION_REJECT_BATCH,
  ACTION_REVIEW_BATCH_PAGES,
  ACTION_BATCH_PAGE_PREV,
  ACTION_BATCH_PAGE_NEXT,
  loadBatchPage,
  buildBatchReviewPage,
  type ApprovalConfig,
  type ActionContext,
} from '../slack/approval-actions.js';
import { buildBatchApprovalMessage } from '../slack/approval-notifications.js';
import { computeNextDelay, DEFAULT_RETRY_CONFIG } from '../slack/notification-outbox.js';

const OWNER_ID = 'U01SC2TNYKU';
const TEAM_ID = 'T_WORKSPACE';

const savedFlag = process.env.HR_APPROVAL_ACTIONS_ENABLED;
afterEach(() => {
  if (savedFlag !== undefined) process.env.HR_APPROVAL_ACTIONS_ENABLED = savedFlag;
  else delete process.env.HR_APPROVAL_ACTIONS_ENABLED;
});

// ── Gate A: Bolt Startup Registration ──────────────────────

describe('Bolt startup registration', () => {
  // Import the actual function (reads env at call time)
  let registerFn: typeof import('../slack/approval-actions.js').registerApprovalActions;

  beforeEach(async () => {
    const mod = await import('../slack/approval-actions.js');
    registerFn = mod.registerApprovalActions;
  });

  it('registers 7 action handlers when enabled', () => {
    process.env.HR_APPROVAL_ACTIONS_ENABLED = 'true';
    const registered: string[] = [];
    const fakeApp = {
      action: (actionId: string, _handler: any) => { registered.push(actionId); },
    };
    const fakeConfig: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: {} as any };

    registerFn(fakeApp as any, fakeConfig);

    expect(registered).toContain(ACTION_APPROVE_POLICY);
    expect(registered).toContain(ACTION_REJECT_POLICY);
    expect(registered).toContain(ACTION_APPROVE_BATCH);
    expect(registered).toContain(ACTION_REJECT_BATCH);
    expect(registered).toContain(ACTION_REVIEW_BATCH_PAGES);
    expect(registered).toContain(ACTION_BATCH_PAGE_PREV);
    expect(registered).toContain(ACTION_BATCH_PAGE_NEXT);
    expect(registered).toHaveLength(7);
  });

  it('registers zero actions when disabled', () => {
    delete process.env.HR_APPROVAL_ACTIONS_ENABLED;
    const registered: string[] = [];
    const fakeApp = { action: (id: string) => { registered.push(id); } };

    registerFn(fakeApp as any, { ownerSlackId: OWNER_ID, db: {} as any });
    expect(registered).toHaveLength(0);
  });
});

// ── Gate E: Exhaustive 248-Entry Pagination ────────────────

describe('248-entry batch pagination', () => {
  // Generate 248 synthetic entries
  const BATCH_ID = 'batch-248-test';
  const ENTRIES = Array.from({ length: 248 }, (_, i) => ({
    knowledge_page_id: `page-${String(i).padStart(4, '0')}`,
    notion_page_id: `np-${i}`,
    title: `Salary Band ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`,
    content_hash: `hash-${i}`,
  }));

  function mockDbForPagination() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'hr_compensation_batches') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: BATCH_ID, manifest_digest: 'digest-248', page_count: 248, status: 'sent' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'hr_compensation_batch_entries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockImplementation((from: number, to: number) => ({
                    then: undefined,
                    data: ENTRIES.slice(from, to + 1),
                    error: null,
                    // Supabase returns a promise-like
                  })),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as any;
  }

  // For proper async mock, wrap the range in a resolved promise
  function mockDbAsync() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'hr_compensation_batches') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: BATCH_ID, manifest_digest: 'digest-248', page_count: 248, status: 'sent' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'hr_compensation_batch_entries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  range: vi.fn().mockImplementation((from: number, to: number) =>
                    Promise.resolve({ data: ENTRIES.slice(from, to + 1), error: null })
                  ),
                }),
              }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as any;
  }

  it('248 entries require exactly 25 pages', () => {
    expect(Math.ceil(248 / 10)).toBe(25);
  });

  it('page 1 contains entries 1-10', async () => {
    const cfg: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: mockDbAsync() };
    const ctx: ActionContext = { userId: OWNER_ID, teamId: TEAM_ID, actionValue: '' };
    const result = await loadBatchPage(ctx, cfg, BATCH_ID, 1);
    expect(result.ok).toBe(true);
    expect(result.data?.entries).toHaveLength(10);
    expect(result.data?.page).toBe(1);
    expect(result.data?.totalPages).toBe(25);
    expect(result.data?.entries[0].title).toContain('Salary Band');
  });

  it('page 25 (last) contains entries 241-248', async () => {
    const cfg: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: mockDbAsync() };
    const ctx: ActionContext = { userId: OWNER_ID, teamId: TEAM_ID, actionValue: '' };
    const result = await loadBatchPage(ctx, cfg, BATCH_ID, 25);
    expect(result.ok).toBe(true);
    expect(result.data?.entries).toHaveLength(8); // 248 - 240 = 8
    expect(result.data?.page).toBe(25);
    expect(result.data?.totalPages).toBe(25);
  });

  it('all entries appear exactly once across all pages', async () => {
    const cfg: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: mockDbAsync() };
    const ctx: ActionContext = { userId: OWNER_ID, teamId: TEAM_ID, actionValue: '' };
    const allPageIds = new Set<string>();

    for (let p = 1; p <= 25; p++) {
      const result = await loadBatchPage(ctx, cfg, BATCH_ID, p);
      expect(result.ok).toBe(true);
      for (const entry of result.data!.entries) {
        expect(allPageIds.has(entry.pageId)).toBe(false); // no duplicates
        allPageIds.add(entry.pageId);
      }
    }

    expect(allPageIds.size).toBe(248); // no omissions
  });

  it('batch ID and digest consistent across all pages', async () => {
    const cfg: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: mockDbAsync() };
    const ctx: ActionContext = { userId: OWNER_ID, teamId: TEAM_ID, actionValue: '' };

    for (let p = 1; p <= 25; p++) {
      const result = await loadBatchPage(ctx, cfg, BATCH_ID, p);
      expect(result.data?.batchId).toBe(BATCH_ID);
      expect(result.data?.digestShort).toBe('digest-248'.slice(0, 12));
    }
  });

  it('non-owner pagination rejected', async () => {
    const cfg: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: mockDbAsync() };
    const ctx: ActionContext = { userId: 'UWRONG', teamId: TEAM_ID, actionValue: '' };
    const result = await loadBatchPage(ctx, cfg, BATCH_ID, 1);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('not_authorized_owner');
  });

  it('wrong workspace rejected', async () => {
    const cfg: ApprovalConfig = { ownerSlackId: OWNER_ID, expectedTeamId: TEAM_ID, db: mockDbAsync() };
    const ctx: ActionContext = { userId: OWNER_ID, teamId: 'T_WRONG', actionValue: '' };
    const result = await loadBatchPage(ctx, cfg, BATCH_ID, 1);
    expect(result.ok).toBe(false);
  });

  it('page 1 has no Previous button, page 25 has no Next', () => {
    const page1 = buildBatchReviewPage({
      entries: [{ title: 'A', notionPageId: 'np', contentHash: 'h', pageId: 'p' }],
      page: 1, totalPages: 25, batchId: 'b', digestShort: 'd', pageCount: 248, batchStatus: 'sent',
    });
    const blockJson1 = JSON.stringify(page1.blocks);
    expect(blockJson1).not.toContain(ACTION_BATCH_PAGE_PREV);
    expect(blockJson1).toContain(ACTION_BATCH_PAGE_NEXT);

    const page25 = buildBatchReviewPage({
      entries: [{ title: 'Z', notionPageId: 'np', contentHash: 'h', pageId: 'p' }],
      page: 25, totalPages: 25, batchId: 'b', digestShort: 'd', pageCount: 248, batchStatus: 'sent',
    });
    const blockJson25 = JSON.stringify(page25.blocks);
    expect(blockJson25).toContain(ACTION_BATCH_PAGE_PREV);
    expect(blockJson25).not.toContain(ACTION_BATCH_PAGE_NEXT);
  });

  it('batch approval message includes Review All Pages button', () => {
    const msg = buildBatchApprovalMessage({
      batchId: 'b', manifestDigest: 'd', pageCount: 248,
      digestShort: 'd', sampleTitles: ['A', 'B'],
    });
    const blockJson = JSON.stringify(msg.blocks);
    expect(blockJson).toContain(ACTION_REVIEW_BATCH_PAGES);
  });
});

// ── Notification Retry ─────────────────────────────────────

describe('notification retry scheduling', () => {
  it('exponential backoff increases with attempt number', () => {
    const d1 = computeNextDelay(1, { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 });
    const d2 = computeNextDelay(2, { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 });
    const d3 = computeNextDelay(3, { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 });
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  it('delay is capped at maxDelayMs', () => {
    const d = computeNextDelay(20, { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 });
    expect(d).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs);
  });

  it('jitter adds randomness', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(computeNextDelay(3));
    }
    // With jitter, delays should vary (at least 2 different values in 10 tries)
    expect(delays.size).toBeGreaterThan(1);
  });
});
