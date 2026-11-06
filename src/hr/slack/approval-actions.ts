/**
 * HR Slack Approval Action Handlers
 *
 * Processes owner-only approve/reject actions for sensitive policies
 * and compensation batch manifests. All actions are verified against
 * the configured owner Slack ID and workspace.
 *
 * Trust model:
 *   - Bolt authenticates the Slack request (signature verification).
 *   - This module verifies workspace + owner identity from body.user.id.
 *   - Database functions enforce authorization independently.
 *   - Action payloads contain only opaque IDs, not authorization facts.
 *
 * Does not activate unless HR_APPROVAL_ACTIONS_ENABLED=true.
 */

import type { App } from '@slack/bolt';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Action IDs ─────────────────────────────────────────────

export const ACTION_APPROVE_POLICY = 'hr_approve_policy';
export const ACTION_REJECT_POLICY = 'hr_reject_policy';
export const ACTION_APPROVE_BATCH = 'hr_approve_batch';
export const ACTION_REJECT_BATCH = 'hr_reject_batch';
export const ACTION_REVIEW_BATCH_PAGES = 'hr_review_batch_pages';
export const ACTION_BATCH_PAGE_PREV = 'hr_batch_page_prev';
export const ACTION_BATCH_PAGE_NEXT = 'hr_batch_page_next';

// ── Configuration ──────────────────────────────────────────

export interface ApprovalConfig {
  /** Authorized owner Slack user ID. */
  ownerSlackId: string;
  /** Expected Slack workspace/team ID. */
  expectedTeamId?: string;
  /** Supabase admin client for DB operations. */
  db: SupabaseClient;
}

export function isApprovalActionsEnabled(): boolean {
  return process.env.HR_APPROVAL_ACTIONS_ENABLED?.toLowerCase() === 'true';
}

// ── Owner Verification ─────────────────────────────────────

export interface ActionContext {
  userId: string;
  teamId?: string;
  actionValue: string;
}

/**
 * Verify the action originated from the authorized owner.
 * Returns null if authorized, or an error string if not.
 */
export function verifyOwner(
  ctx: ActionContext,
  config: ApprovalConfig
): string | null {
  if (config.expectedTeamId && ctx.teamId !== config.expectedTeamId) {
    return 'wrong_workspace';
  }
  if (ctx.userId !== config.ownerSlackId) {
    return 'not_authorized_owner';
  }
  return null;
}

// ── Sensitive Policy Approval ──────────────────────────────

export interface PolicyApprovalResult {
  ok: boolean;
  action: 'approved' | 'rejected' | 'error';
  message: string;
  reviewId?: string;
}

/**
 * Process a sensitive policy approval action.
 * Delegates to the atomic hr_approve_sensitive_policy RPC which
 * locks the review and page, verifies hash, writes approval, and
 * resolves the review in one transaction.
 */
export async function handlePolicyApproval(
  ctx: ActionContext,
  config: ApprovalConfig
): Promise<PolicyApprovalResult> {
  const authError = verifyOwner(ctx, config);
  if (authError) {
    return { ok: false, action: 'error', message: authError };
  }

  const reviewId = ctx.actionValue;
  if (!reviewId) {
    return { ok: false, action: 'error', message: 'missing_review_id' };
  }

  // Single atomic RPC — no multi-step application-level writes
  const { data, error } = await config.db.rpc('hr_approve_sensitive_policy', {
    p_review_id: reviewId,
    p_approved_by: ctx.userId,
  });

  if (error) {
    return { ok: false, action: 'error', message: 'approval_rpc_failed' };
  }

  const result = data as string;
  if (result === 'approved') {
    return { ok: true, action: 'approved', message: 'Policy approved', reviewId };
  }

  return { ok: false, action: 'error', message: result, reviewId };
}

/**
 * Process a sensitive policy rejection action.
 * Delegates to the atomic hr_reject_sensitive_policy RPC.
 * Suspended pages stay suspended; new pages are quarantined.
 */
export async function handlePolicyRejection(
  ctx: ActionContext,
  config: ApprovalConfig
): Promise<PolicyApprovalResult> {
  const authError = verifyOwner(ctx, config);
  if (authError) {
    return { ok: false, action: 'error', message: authError };
  }

  const reviewId = ctx.actionValue;
  if (!reviewId) {
    return { ok: false, action: 'error', message: 'missing_review_id' };
  }

  const { data, error } = await config.db.rpc('hr_reject_sensitive_policy', {
    p_review_id: reviewId,
    p_rejected_by: ctx.userId,
  });

  if (error) {
    return { ok: false, action: 'error', message: 'rejection_rpc_failed' };
  }

  const result = data as string;
  if (result === 'rejected') {
    return { ok: true, action: 'rejected', message: 'Policy rejected', reviewId };
  }

  return { ok: false, action: 'error', message: result, reviewId };
}

// ── Compensation Batch Approval ────────────────────────────

export interface BatchApprovalResult {
  ok: boolean;
  action: 'approved' | 'rejected' | 'error';
  message: string;
  batchId?: string;
}

/**
 * Process a compensation batch approval action.
 * Delegates to the atomic database function.
 */
export async function handleBatchApproval(
  ctx: ActionContext,
  config: ApprovalConfig
): Promise<BatchApprovalResult> {
  const authError = verifyOwner(ctx, config);
  if (authError) {
    return { ok: false, action: 'error', message: authError };
  }

  // Value format: "batchId:manifestDigest"
  const [batchId, manifestDigest] = ctx.actionValue.split(':');
  if (!batchId || !manifestDigest) {
    return { ok: false, action: 'error', message: 'invalid_action_value' };
  }

  // Delegate to atomic database function (verifies admin, digest, all entries)
  const { data: result, error } = await config.db.rpc('hr_approve_compensation_batch', {
    p_batch_id: batchId,
    p_manifest_digest: manifestDigest,
    p_approved_by: ctx.userId,
  });

  if (error) {
    return { ok: false, action: 'error', message: 'batch_rpc_failed' };
  }

  const rpcResult = result as string;
  if (rpcResult === 'approved') {
    return { ok: true, action: 'approved', message: 'Batch approved', batchId };
  }

  return { ok: false, action: 'error', message: rpcResult, batchId };
}

/**
 * Process a compensation batch rejection.
 */
export async function handleBatchRejection(
  ctx: ActionContext,
  config: ApprovalConfig
): Promise<BatchApprovalResult> {
  const authError = verifyOwner(ctx, config);
  if (authError) {
    return { ok: false, action: 'error', message: authError };
  }

  const batchId = ctx.actionValue;
  if (!batchId) {
    return { ok: false, action: 'error', message: 'missing_batch_id' };
  }

  await config.db
    .from('hr_compensation_batches')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
    .eq('id', batchId)
    .in('status', ['pending', 'sent']);

  await config.db.from('hr_audit_events').insert({
    event_type: 'BATCH_REJECTED', actor_type: 'human', actor_id: ctx.userId,
    target_type: 'compensation_batch', target_id: batchId,
    action: 'reject_batch', outcome: 'success',
  });

  return { ok: true, action: 'rejected', message: 'Batch rejected', batchId };
}

// ── Batch Manifest Pagination ───────────────────────────────

const ENTRIES_PER_PAGE = 10;

export interface BatchPageResult {
  entries: Array<{ title: string; notionPageId: string; contentHash: string; pageId: string }>;
  page: number;
  totalPages: number;
  batchId: string;
  digestShort: string;
  pageCount: number;
  batchStatus: string;
}

/**
 * Load a page of batch entries for owner review.
 * Verifies batch status and owner authorization.
 */
export async function loadBatchPage(
  ctx: ActionContext,
  config: ApprovalConfig,
  batchId: string,
  pageNum: number
): Promise<{ ok: boolean; data?: BatchPageResult; message?: string }> {
  const authError = verifyOwner(ctx, config);
  if (authError) return { ok: false, message: authError };

  // Load batch
  const { data: batch } = await config.db
    .from('hr_compensation_batches')
    .select('id, manifest_digest, page_count, status')
    .eq('id', batchId)
    .single();

  if (!batch) return { ok: false, message: 'batch_not_found' };
  if (batch.status === 'invalidated' || batch.status === 'expired') {
    return { ok: false, message: 'batch_superseded' };
  }

  const totalPages = Math.ceil(batch.page_count / ENTRIES_PER_PAGE);
  const safePage = Math.max(1, Math.min(pageNum, totalPages));
  const offset = (safePage - 1) * ENTRIES_PER_PAGE;

  // Load entries sorted by page ID for stable ordering
  const { data: entries } = await config.db
    .from('hr_compensation_batch_entries')
    .select('knowledge_page_id, notion_page_id, title, content_hash')
    .eq('batch_id', batchId)
    .order('knowledge_page_id', { ascending: true })
    .range(offset, offset + ENTRIES_PER_PAGE - 1);

  return {
    ok: true,
    data: {
      entries: (entries || []).map((e: any) => ({
        title: e.title,
        notionPageId: e.notion_page_id,
        contentHash: e.content_hash,
        pageId: e.knowledge_page_id,
      })),
      page: safePage,
      totalPages,
      batchId: batch.id,
      digestShort: batch.manifest_digest.slice(0, 12),
      pageCount: batch.page_count,
      batchStatus: batch.status,
    },
  };
}

/**
 * Build Block Kit for a batch review page.
 */
export function buildBatchReviewPage(data: BatchPageResult): {
  text: string;
  blocks: import('@slack/types').KnownBlock[];
} {
  const lines = data.entries.map((e, i) => {
    const num = (data.page - 1) * ENTRIES_PER_PAGE + i + 1;
    return `${num}. *${e.title}*\n   Hash: \`${e.contentHash.slice(0, 12)}…\` · <https://notion.so/${e.notionPageId.replace(/-/g, '')}|View>`;
  }).join('\n\n');

  const blocks: import('@slack/types').KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📋 Batch Review — Page ${data.page} of ${data.totalPages}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Batch:* \`${data.batchId.slice(0, 8)}…\` · *Digest:* \`${data.digestShort}…\` · *${data.pageCount} pages total*\n*Status:* ${data.batchStatus}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines || '_No entries on this page._' },
    },
  ];

  // Pagination controls
  const navElements: any[] = [];
  if (data.page > 1) {
    navElements.push({
      type: 'button',
      text: { type: 'plain_text', text: '◀ Previous', emoji: true },
      action_id: ACTION_BATCH_PAGE_PREV,
      value: `${data.batchId}:${data.page - 1}`,
    });
  }
  if (data.page < data.totalPages) {
    navElements.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Next ▶', emoji: true },
      action_id: ACTION_BATCH_PAGE_NEXT,
      value: `${data.batchId}:${data.page + 1}`,
    });
  }
  if (navElements.length > 0) {
    blocks.push({ type: 'actions', elements: navElements });
  }

  return {
    text: `Batch Review Page ${data.page}/${data.totalPages}`,
    blocks,
  };
}

// ── Slack Action Registration ──────────────────────────────

/**
 * Register approval action handlers on the Bolt app.
 * Only active when HR_APPROVAL_ACTIONS_ENABLED=true.
 */
export function registerApprovalActions(
  app: App,
  config: ApprovalConfig
): void {
  if (!isApprovalActionsEnabled()) return;

  app.action(ACTION_APPROVE_POLICY, async ({ body, ack, client }) => {
    await ack();
    const ctx: ActionContext = {
      userId: body.user.id,
      teamId: body.team?.id,
      actionValue: (body as any).actions?.[0]?.value || '',
    };
    const result = await handlePolicyApproval(ctx, config);
    await updateApprovalMessage(client, body, result.ok
      ? '✅ Policy approved'
      : `❌ ${result.message}`
    );
  });

  app.action(ACTION_REJECT_POLICY, async ({ body, ack, client }) => {
    await ack();
    const ctx: ActionContext = {
      userId: body.user.id,
      teamId: body.team?.id,
      actionValue: (body as any).actions?.[0]?.value || '',
    };
    const result = await handlePolicyRejection(ctx, config);
    await updateApprovalMessage(client, body, result.ok
      ? '🚫 Policy rejected'
      : `❌ ${result.message}`
    );
  });

  app.action(ACTION_APPROVE_BATCH, async ({ body, ack, client }) => {
    await ack();
    const ctx: ActionContext = {
      userId: body.user.id,
      teamId: body.team?.id,
      actionValue: (body as any).actions?.[0]?.value || '',
    };
    const result = await handleBatchApproval(ctx, config);
    await updateApprovalMessage(client, body, result.ok
      ? '✅ Salary-band batch approved'
      : `❌ ${result.message}`
    );
  });

  app.action(ACTION_REJECT_BATCH, async ({ body, ack, client }) => {
    await ack();
    const ctx: ActionContext = {
      userId: body.user.id,
      teamId: body.team?.id,
      actionValue: (body as any).actions?.[0]?.value || '',
    };
    const result = await handleBatchRejection(ctx, config);
    await updateApprovalMessage(client, body, result.ok
      ? '🚫 Salary-band batch rejected'
      : `❌ ${result.message}`
    );
  });

  // Batch pagination: Review All Pages / Previous / Next
  const handlePagination = async ({ body, ack, client }: any) => {
    await ack();
    const value = body.actions?.[0]?.value || '';
    const [batchId, pageStr] = value.split(':');
    const pageNum = parseInt(pageStr || '1', 10);
    const ctx: ActionContext = {
      userId: body.user.id,
      teamId: body.team?.id,
      actionValue: value,
    };
    const result = await loadBatchPage(ctx, config, batchId, pageNum);
    if (result.ok && result.data) {
      const msg = buildBatchReviewPage(result.data);
      await updateApprovalMessage(client, body, msg.text, msg.blocks);
    } else {
      await updateApprovalMessage(client, body, `❌ ${result.message}`);
    }
  };

  app.action(ACTION_REVIEW_BATCH_PAGES, handlePagination);
  app.action(ACTION_BATCH_PAGE_PREV, handlePagination);
  app.action(ACTION_BATCH_PAGE_NEXT, handlePagination);
}

async function updateApprovalMessage(
  client: any,
  body: any,
  statusText: string,
  blocks?: import('@slack/types').KnownBlock[]
): Promise<void> {
  try {
    const channel = body.channel?.id || body.container?.channel_id;
    const ts = body.message?.ts || body.container?.message_ts;
    if (channel && ts) {
      await client.chat.update({
        channel,
        ts,
        text: statusText,
        blocks: blocks || [],
      });
    }
  } catch {
    // Message update failure is non-critical — DB decision already recorded
  }
}
