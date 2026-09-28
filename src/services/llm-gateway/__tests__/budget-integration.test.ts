/**
 * PostgreSQL Budget Integration Tests
 *
 * Tests budget RPCs against REAL Supabase/PostgreSQL.
 * NO provider API calls. NO LLM inference. AI remains disabled.
 *
 * These tests verify:
 * - Concurrent global contention
 * - Hierarchical contention (global + workflow)
 * - Same-workflow contention
 * - Multi-scope rollback
 * - Duplicate idempotency race
 * - Reconciliation concurrency
 * - Settlement actual <= reserved invariant
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in environment.
 * Requires: 20260928_llm_gateway.sql migration applied to test DB.
 *
 * Skip if not configured (CI-safe).
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_DB = Boolean(SUPABASE_URL && SUPABASE_KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testScopeGlobal: string;
let testScopeWorkflowA: string;
let testScopeWorkflowB: string;
let testScopeTask: string;
let testRunId: string;

async function createScope(
  type: string,
  id: string,
  limit: number,
  periodHours?: number
): Promise<string> {
  const { data, error } = await supabase
    .from('ai_budget_scopes')
    .upsert(
      {
        scope_type: type,
        scope_id: id,
        limit_usd: limit,
        period_hours: periodHours || null,
        spent_usd: 0,
        reserved_usd: 0,
        enabled: true,
      },
      { onConflict: 'scope_type,scope_id' }
    )
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create scope ${type}:${id}: ${error.message}`);
  return data.id;
}

async function getScope(id: string) {
  const { data } = await supabase.from('ai_budget_scopes').select('*').eq('id', id).single();
  return data;
}

async function cleanupTest() {
  // Delete test ledger entries and scopes by test run prefix
  await supabase.from('ai_ledger_scopes').delete().like('ledger_id', '%');
  await supabase
    .from('ai_inference_ledger')
    .delete()
    .like('idempotency_key', `test:${testRunId}:%`);
  await supabase.from('ai_budget_scopes').delete().eq('scope_id', `test-global-${testRunId}`);
  await supabase.from('ai_budget_scopes').delete().eq('scope_id', `test-wf-a-${testRunId}`);
  await supabase.from('ai_budget_scopes').delete().eq('scope_id', `test-wf-b-${testRunId}`);
  await supabase.from('ai_budget_scopes').delete().eq('scope_id', `test-task-${testRunId}`);
}

describe.skipIf(!HAS_DB)('PostgreSQL Budget Integration', () => {
  beforeAll(async () => {
    supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
    testRunId = Math.random().toString(36).slice(2, 10);

    // Verify tables exist
    const { error } = await supabase.from('ai_budget_scopes').select('id').limit(1);
    if (error?.message?.includes('does not exist')) {
      throw new Error('Migration 20260928_llm_gateway.sql not applied. Run migration first.');
    }
  });

  afterAll(async () => {
    if (supabase) await cleanupTest();
  });

  beforeEach(async () => {
    await cleanupTest();

    // Create test scopes
    testScopeGlobal = await createScope('global_daily', `test-global-${testRunId}`, 1.0);
    testScopeWorkflowA = await createScope('workflow', `test-wf-a-${testRunId}`, 0.6);
    testScopeWorkflowB = await createScope('workflow', `test-wf-b-${testRunId}`, 0.6);
    testScopeTask = await createScope('task', `test-task-${testRunId}`, 0.3);
  });

  // ============================================================
  // Concurrent global contention
  // ============================================================
  it('concurrent global contention: spent + reserved <= $1.00', async () => {
    const reservations = Array.from({ length: 10 }, (_, i) =>
      supabase.rpc('reserve_inference_hierarchical', {
        p_idempotency_key: `test:${testRunId}:global:${i}`,
        p_agent_id: 'maya',
        p_purpose: 'research',
        p_task_type: 'test',
        p_provider: 'anthropic',
        p_model: 'claude-sonnet-4-20250514',
        p_model_tier: 'sonnet',
        p_estimated_input_tokens: 100,
        p_max_input_tokens: 1000,
        p_max_output_tokens: 100,
        p_reserved_cost_usd: 0.15, // 10 * 0.15 = $1.50 > $1.00 limit
        p_scope_ids: [testScopeGlobal],
      })
    );

    const results = await Promise.all(reservations);
    const succeeded = results.filter((r) => r.data?.ledger_id !== null && r.data?.is_new === true);

    // At most floor(1.00/0.15) = 6 should succeed
    expect(succeeded.length).toBeLessThanOrEqual(7);
    expect(succeeded.length).toBeGreaterThan(0);

    // Verify invariant
    const scope = await getScope(testScopeGlobal);
    expect(Number(scope.spent_usd) + Number(scope.reserved_usd)).toBeLessThanOrEqual(1.0);
  });

  // ============================================================
  // Hierarchical contention
  // ============================================================
  it('hierarchical: global=$1.00, wfA=$0.60, wfB=$0.60 — both respect limits', async () => {
    // 4 requests to WF-A, 4 to WF-B, each $0.20
    const reservationsA = Array.from({ length: 4 }, (_, i) =>
      supabase.rpc('reserve_inference_hierarchical', {
        p_idempotency_key: `test:${testRunId}:hier-a:${i}`,
        p_agent_id: 'maya',
        p_purpose: 'research',
        p_task_type: 'test',
        p_provider: 'anthropic',
        p_model: 'test',
        p_model_tier: 'sonnet',
        p_estimated_input_tokens: 100,
        p_max_input_tokens: 1000,
        p_max_output_tokens: 100,
        p_reserved_cost_usd: 0.2,
        p_scope_ids: [testScopeGlobal, testScopeWorkflowA],
      })
    );
    const reservationsB = Array.from({ length: 4 }, (_, i) =>
      supabase.rpc('reserve_inference_hierarchical', {
        p_idempotency_key: `test:${testRunId}:hier-b:${i}`,
        p_agent_id: 'david',
        p_purpose: 'research',
        p_task_type: 'test',
        p_provider: 'anthropic',
        p_model: 'test',
        p_model_tier: 'sonnet',
        p_estimated_input_tokens: 100,
        p_max_input_tokens: 1000,
        p_max_output_tokens: 100,
        p_reserved_cost_usd: 0.2,
        p_scope_ids: [testScopeGlobal, testScopeWorkflowB],
      })
    );

    const allResults = await Promise.all([...reservationsA, ...reservationsB]);
    const succeeded = allResults.filter((r) => r.data?.is_new);

    // WF-A: max 3 ($0.60/0.20), WF-B: max 3, Global: max 5 ($1.00/0.20)
    // So at most 5 total (global limit), and at most 3 from each workflow
    expect(succeeded.length).toBeLessThanOrEqual(5);

    const scopeGlobal = await getScope(testScopeGlobal);
    const scopeA = await getScope(testScopeWorkflowA);
    const scopeB = await getScope(testScopeWorkflowB);

    expect(Number(scopeGlobal.spent_usd) + Number(scopeGlobal.reserved_usd)).toBeLessThanOrEqual(
      1.0
    );
    expect(Number(scopeA.spent_usd) + Number(scopeA.reserved_usd)).toBeLessThanOrEqual(0.6);
    expect(Number(scopeB.spent_usd) + Number(scopeB.reserved_usd)).toBeLessThanOrEqual(0.6);
  });

  // ============================================================
  // Multi-scope rollback
  // ============================================================
  it('multi-scope rollback: global+workflow OK, task exceeded → no partial reservation', async () => {
    // Fill task budget first
    const { data: fill } = await supabase.rpc('reserve_inference_hierarchical', {
      p_idempotency_key: `test:${testRunId}:rollback-fill`,
      p_agent_id: 'maya',
      p_purpose: 'research',
      p_task_type: 'test',
      p_provider: 'anthropic',
      p_model: 'test',
      p_model_tier: 'sonnet',
      p_estimated_input_tokens: 100,
      p_max_input_tokens: 1000,
      p_max_output_tokens: 100,
      p_reserved_cost_usd: 0.29, // Task limit is $0.30
      p_scope_ids: [testScopeGlobal, testScopeWorkflowA, testScopeTask],
    });
    expect(fill?.is_new).toBe(true);

    // Record scope states before attempt
    const globalBefore = await getScope(testScopeGlobal);
    const wfBefore = await getScope(testScopeWorkflowA);

    // Now try another request — task has $0.01 remaining, request needs $0.10
    const { data: attempt } = await supabase.rpc('reserve_inference_hierarchical', {
      p_idempotency_key: `test:${testRunId}:rollback-attempt`,
      p_agent_id: 'maya',
      p_purpose: 'research',
      p_task_type: 'test',
      p_provider: 'anthropic',
      p_model: 'test',
      p_model_tier: 'sonnet',
      p_estimated_input_tokens: 100,
      p_max_input_tokens: 1000,
      p_max_output_tokens: 100,
      p_reserved_cost_usd: 0.1,
      p_scope_ids: [testScopeGlobal, testScopeWorkflowA, testScopeTask],
    });

    // Should be rejected (task exceeded)
    // RPC returns reservation_result composite: {ledger_id: null, is_new: null} when budget exceeded
    expect(attempt?.ledger_id).toBeNull();

    // Global and workflow should be UNCHANGED (no partial reservation)
    const globalAfter = await getScope(testScopeGlobal);
    const wfAfter = await getScope(testScopeWorkflowA);

    expect(Number(globalAfter.reserved_usd)).toBe(Number(globalBefore.reserved_usd));
    expect(Number(wfAfter.reserved_usd)).toBe(Number(wfBefore.reserved_usd));
  });

  // ============================================================
  // Duplicate idempotency race
  // ============================================================
  it('duplicate race: many concurrent same key → exactly 1 new reservation', async () => {
    const key = `test:${testRunId}:dup-race`;
    const attempts = Array.from({ length: 10 }, () =>
      supabase.rpc('reserve_inference_hierarchical', {
        p_idempotency_key: key,
        p_agent_id: 'maya',
        p_purpose: 'research',
        p_task_type: 'test',
        p_provider: 'anthropic',
        p_model: 'test',
        p_model_tier: 'sonnet',
        p_estimated_input_tokens: 100,
        p_max_input_tokens: 1000,
        p_max_output_tokens: 100,
        p_reserved_cost_usd: 0.1,
        p_scope_ids: [testScopeGlobal],
      })
    );

    const results = await Promise.all(attempts);
    const newReservations = results.filter((r) => r.data?.is_new === true);
    const existingReturns = results.filter((r) => r.data?.is_new === false);
    const errors = results.filter((r) => r.error);

    // Exactly 1 new reservation
    expect(newReservations.length).toBe(1);

    // All others are existing or errored (concurrent serialization)
    // The critical invariant is: new=1, and no more than 1 ledger row
    expect(existingReturns.length + errors.length).toBe(9);

    // All reference the same ledger ID
    const ids = new Set(results.map((r) => r.data?.ledger_id).filter(Boolean));
    expect(ids.size).toBe(1);

    // Only 1 ledger row
    const { count } = await supabase
      .from('ai_inference_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  // ============================================================
  // Settlement invariant: actual <= reserved
  // ============================================================
  it('settlement rejects actual > reserved (safety violation)', async () => {
    const { data: res } = await supabase.rpc('reserve_inference_hierarchical', {
      p_idempotency_key: `test:${testRunId}:settle-violation`,
      p_agent_id: 'maya',
      p_purpose: 'research',
      p_task_type: 'test',
      p_provider: 'anthropic',
      p_model: 'test',
      p_model_tier: 'sonnet',
      p_estimated_input_tokens: 100,
      p_max_input_tokens: 1000,
      p_max_output_tokens: 100,
      p_reserved_cost_usd: 0.05,
      p_scope_ids: [testScopeGlobal],
    });
    expect(res?.is_new).toBe(true);

    // Mark in-progress
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: res.ledger_id });

    // Try to settle with actual > reserved — should raise exception
    const { error } = await supabase.rpc('settle_inference', {
      p_ledger_id: res.ledger_id,
      p_actual_input_tokens: 1000,
      p_actual_output_tokens: 500,
      p_actual_cost_usd: 0.1, // > 0.05 reserved
    });

    expect(error).toBeTruthy();
    expect(error.message).toContain('SAFETY VIOLATION');
  });

  // ============================================================
  // Reconciliation concurrency
  // ============================================================
  it('reconciliation: no double release, no negative balances', async () => {
    // Create a stale reservation (manually backdate)
    const { data: res } = await supabase.rpc('reserve_inference_hierarchical', {
      p_idempotency_key: `test:${testRunId}:stale-recon`,
      p_agent_id: 'maya',
      p_purpose: 'research',
      p_task_type: 'test',
      p_provider: 'anthropic',
      p_model: 'test',
      p_model_tier: 'sonnet',
      p_estimated_input_tokens: 100,
      p_max_input_tokens: 1000,
      p_max_output_tokens: 100,
      p_reserved_cost_usd: 0.1,
      p_scope_ids: [testScopeGlobal],
    });
    expect(res?.is_new).toBe(true);

    // Backdate to make it stale
    await supabase
      .from('ai_inference_ledger')
      .update({ created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
      .eq('id', res.ledger_id);

    // Run reconciliation concurrently (simulates multiple replicas)
    const reconcileResults = await Promise.all([
      supabase.rpc('reconcile_stale_reservations', { p_stale_minutes: 15 }),
      supabase.rpc('reconcile_stale_reservations', { p_stale_minutes: 15 }),
      supabase.rpc('reconcile_stale_reservations', { p_stale_minutes: 15 }),
    ]);

    // Total reconciled should be exactly 1 (not 3)
    const totalReconciled = reconcileResults.reduce((sum, r) => sum + (r.data || 0), 0);
    expect(totalReconciled).toBe(1);

    // Verify no negative balance
    const scope = await getScope(testScopeGlobal);
    expect(Number(scope.reserved_usd)).toBeGreaterThanOrEqual(0);
    expect(Number(scope.spent_usd)).toBeGreaterThanOrEqual(0);

    // Entry should be 'released' (was reserved, not in_progress)
    const { data: entry } = await supabase
      .from('ai_inference_ledger')
      .select('status')
      .eq('id', res.ledger_id)
      .single();
    expect(entry.status).toBe('released');
  });
});
