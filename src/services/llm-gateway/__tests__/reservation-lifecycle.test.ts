/**
 * Reservation Lifecycle Regression Tests
 *
 * Proves the accounting invariant through all lifecycle transitions:
 * reserve → settle, reserve → release, reserve → in_progress → ambiguous,
 * reconcile idempotency, and concurrent safety.
 *
 * Tests the periodic vs non-periodic scope enforcement differences.
 *
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY pointing at commissioning DB.
 * Skip if not configured (CI-safe).
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN_DB_TESTS = HAS_DB && !IS_PRODUCTION;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;
let scopeNonPeriodic: string; // Uses accounting columns for enforcement
let scopePeriodic: string;    // Recalculates from junction entries

async function createScope(type: string, scopeId: string, limit: number, periodHours?: number): Promise<string> {
  const { data, error } = await supabase
    .from('ai_budget_scopes')
    .upsert({ scope_type: type, scope_id: scopeId, limit_usd: limit, period_hours: periodHours || null, spent_usd: 0, reserved_usd: 0, enabled: true }, { onConflict: 'scope_type,scope_id' })
    .select('id').single();
  if (error) throw new Error(`createScope: ${error.message}`);
  return data.id;
}

async function getScope(id: string) {
  const { data } = await supabase.from('ai_budget_scopes').select('*').eq('id', id).single();
  return data;
}

async function reserve(key: string, cost: number, scopeIds: string[]) {
  return supabase.rpc('reserve_inference_hierarchical', {
    p_idempotency_key: key,
    p_agent_id: 'test',
    p_purpose: 'lifecycle-test',
    p_task_type: 'test',
    p_provider: 'anthropic',
    p_model: 'claude-haiku-4-5-20251001',
    p_model_tier: 'haiku',
    p_estimated_input_tokens: 100,
    p_max_input_tokens: 1000,
    p_max_output_tokens: 100,
    p_reserved_cost_usd: cost,
    p_scope_ids: scopeIds,
  });
}

async function cleanup() {
  // Clean test entries by prefix
  const { data: entries } = await supabase
    .from('ai_inference_ledger')
    .select('id')
    .like('idempotency_key', `lc:${testRunId}:%`);
  if (entries?.length) {
    const ids = entries.map((e: { id: string }) => e.id);
    await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
    await supabase.from('ai_inference_ledger').delete().in('id', ids);
  }
  await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-np-${testRunId}`);
  await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-p-${testRunId}`);
}

describe.skipIf(!CAN_RUN_DB_TESTS)('Reservation Lifecycle', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = Math.random().toString(36).slice(2, 10);
  });

  afterAll(async () => {
    if (supabase) await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    // Non-periodic scope: enforcement uses accounting columns
    scopeNonPeriodic = await createScope('workflow', `lc-np-${testRunId}`, 1.0);
    // Periodic scope: enforcement recalculates from junction entries
    scopePeriodic = await createScope('task', `lc-p-${testRunId}`, 1.0, 24);
  });

  // ============================================================
  // Ambiguous entries retain reservation
  // ============================================================
  it('ambiguous entries retain reserved_usd on non-periodic scope', async () => {
    const key = `lc:${testRunId}:amb1`;
    const res = await reserve(key, 0.10, [scopeNonPeriodic]);
    expect(res.data?.is_new).toBe(true);
    const ledgerId = res.data.ledger_id;

    // Mark in progress
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: ledgerId });

    // Mark ambiguous
    await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: ledgerId,
      p_error_code: 'test_ambiguous',
      p_error_message: 'test',
    });

    // Verify scope: reserved_usd should still hold the reservation
    const scope = await getScope(scopeNonPeriodic);
    expect(Number(scope.reserved_usd)).toBeCloseTo(0.10, 4);
    expect(Number(scope.spent_usd)).toBeCloseTo(0, 4);

    // Verify ledger status
    const { data: entry } = await supabase
      .from('ai_inference_ledger').select('status').eq('id', ledgerId).single();
    expect(entry.status).toBe('ambiguous');
  });

  // ============================================================
  // Settled entries move reservation to spending exactly once
  // ============================================================
  it('settle moves reserved to spent exactly once', async () => {
    const key = `lc:${testRunId}:settle1`;
    const res = await reserve(key, 0.10, [scopeNonPeriodic]);
    const ledgerId = res.data.ledger_id;

    // Mark in progress
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: ledgerId });

    // Settle with actual cost $0.04
    await supabase.rpc('settle_inference', {
      p_ledger_id: ledgerId,
      p_actual_input_tokens: 50,
      p_actual_output_tokens: 20,
      p_actual_cost_usd: 0.04,
    });

    const scope = await getScope(scopeNonPeriodic);
    expect(Number(scope.reserved_usd)).toBeCloseTo(0, 4);
    expect(Number(scope.spent_usd)).toBeCloseTo(0.04, 4);

    // Second settle attempt should fail (already settled)
    const { data: secondSettle } = await supabase.rpc('settle_inference', {
      p_ledger_id: ledgerId,
      p_actual_input_tokens: 50,
      p_actual_output_tokens: 20,
      p_actual_cost_usd: 0.04,
    });
    expect(secondSettle).toBe(false);

    // Scope unchanged
    const scopeAfter = await getScope(scopeNonPeriodic);
    expect(Number(scopeAfter.spent_usd)).toBeCloseTo(0.04, 4);
  });

  // ============================================================
  // Released entries release exactly once
  // ============================================================
  it('release frees reserved_usd exactly once', async () => {
    const key = `lc:${testRunId}:release1`;
    const res = await reserve(key, 0.10, [scopeNonPeriodic]);
    const ledgerId = res.data.ledger_id;

    // Release (pre-network)
    await supabase.rpc('release_inference_reservation', {
      p_ledger_id: ledgerId,
      p_reason: 'test_release',
    });

    const scope = await getScope(scopeNonPeriodic);
    expect(Number(scope.reserved_usd)).toBeCloseTo(0, 4);
    expect(Number(scope.spent_usd)).toBeCloseTo(0, 4);

    // Second release should fail (status changed to released)
    const { data: secondRelease } = await supabase.rpc('release_inference_reservation', {
      p_ledger_id: ledgerId,
    });
    expect(secondRelease).toBe(false);
  });

  // ============================================================
  // Reconciliation is idempotent
  // ============================================================
  it('reconcile_stale_reservations is idempotent', async () => {
    const key = `lc:${testRunId}:recon1`;
    const res = await reserve(key, 0.10, [scopeNonPeriodic]);
    const ledgerId = res.data.ledger_id;

    // Mark in progress
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: ledgerId });

    // Backdate the entry to make it stale
    await supabase.from('ai_inference_ledger')
      .update({ created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() })
      .eq('id', ledgerId);

    // First reconciliation
    const { data: count1 } = await supabase.rpc('reconcile_stale_reservations', { p_stale_minutes: 15 });
    expect(count1).toBeGreaterThanOrEqual(1);

    const scope1 = await getScope(scopeNonPeriodic);
    const reserved1 = Number(scope1.reserved_usd);

    // Second reconciliation should find nothing new
    const { data: count2 } = await supabase.rpc('reconcile_stale_reservations', { p_stale_minutes: 15 });
    // The entry is now ambiguous, so it's no longer 'reserved' or 'in_progress'

    const scope2 = await getScope(scopeNonPeriodic);
    expect(Number(scope2.reserved_usd)).toBeCloseTo(reserved1, 4);
  });

  // ============================================================
  // Multi-scope settle accounting
  // ============================================================
  it('multi-scope settle: each scope gets actual_cost independently', async () => {
    const key = `lc:${testRunId}:multi1`;
    const res = await reserve(key, 0.10, [scopeNonPeriodic, scopePeriodic]);
    const ledgerId = res.data.ledger_id;

    // Both scopes should have reserved
    const np1 = await getScope(scopeNonPeriodic);
    const p1 = await getScope(scopePeriodic);
    expect(Number(np1.reserved_usd)).toBeCloseTo(0.10, 4);
    expect(Number(p1.reserved_usd)).toBeCloseTo(0.10, 4);

    // Mark in progress and settle
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: ledgerId });
    await supabase.rpc('settle_inference', {
      p_ledger_id: ledgerId,
      p_actual_input_tokens: 50,
      p_actual_output_tokens: 20,
      p_actual_cost_usd: 0.04,
    });

    // Each scope gets actual cost independently
    const np2 = await getScope(scopeNonPeriodic);
    const p2 = await getScope(scopePeriodic);
    expect(Number(np2.reserved_usd)).toBeCloseTo(0, 4);
    expect(Number(np2.spent_usd)).toBeCloseTo(0.04, 4);
    expect(Number(p2.reserved_usd)).toBeCloseTo(0, 4);
    expect(Number(p2.spent_usd)).toBeCloseTo(0.04, 4);
  });

  // ============================================================
  // Concurrent operations cannot exceed budget
  // ============================================================
  it('concurrent reserves cannot exceed budget', async () => {
    const promises = Array.from({ length: 15 }, (_, i) =>
      reserve(`lc:${testRunId}:race:${i}`, 0.10, [scopeNonPeriodic])
    );

    const results = await Promise.all(promises);
    const succeeded = results.filter(r => r.data?.ledger_id && r.data?.is_new === true);

    // Budget is $1.00, each reservation is $0.10, so at most 10 should succeed
    expect(succeeded.length).toBeLessThanOrEqual(10);
    expect(succeeded.length).toBeGreaterThan(0);

    const scope = await getScope(scopeNonPeriodic);
    expect(Number(scope.spent_usd) + Number(scope.reserved_usd)).toBeLessThanOrEqual(1.0 + 0.001);
  });

  // ============================================================
  // Periodic scope enforcement uses junction, not columns
  // ============================================================
  it('periodic scope enforcement ignores stale accounting columns', async () => {
    // Reserve and settle to build up spent_usd on the periodic scope
    for (let i = 0; i < 5; i++) {
      const key = `lc:${testRunId}:periodic:${i}`;
      const res = await reserve(key, 0.10, [scopePeriodic]);
      if (res.data?.ledger_id && res.data?.is_new) {
        await supabase.rpc('mark_inference_in_progress', { p_ledger_id: res.data.ledger_id });
        await supabase.rpc('settle_inference', {
          p_ledger_id: res.data.ledger_id,
          p_actual_input_tokens: 50,
          p_actual_output_tokens: 20,
          p_actual_cost_usd: 0.05,
        });
      }
    }

    // Scope columns show $0.25 spent + $0 reserved = $0.25 committed
    const scope = await getScope(scopePeriodic);
    expect(Number(scope.spent_usd)).toBeCloseTo(0.25, 2);

    // But since all entries are within the 24h window and enforcement recalculates,
    // the effective spend should include the junction reserved_cost_usd sums.
    // A new $0.10 reservation should still succeed since junction sum for settled
    // entries ($0.50 = 5 * $0.10 reserved) is well under $1.00.
    const key = `lc:${testRunId}:periodic:extra`;
    const res = await reserve(key, 0.10, [scopePeriodic]);
    expect(res.data?.is_new).toBe(true);
  });

  // ============================================================
  // Ambiguous-spend enforcement (periodic scopes)
  // ============================================================
  it('ambiguous reservation reduces available periodic budget', async () => {
    // Create a tight periodic scope: $0.20 limit
    const tightScope = await createScope('task', `lc-tight-${testRunId}`, 0.20, 24);

    // Reserve $0.15, mark in_progress, then ambiguous
    const key1 = `lc:${testRunId}:amb-tight:1`;
    const res1 = await reserve(key1, 0.15, [tightScope]);
    expect(res1.data?.is_new).toBe(true);
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: res1.data.ledger_id });
    await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: res1.data.ledger_id,
      p_error_code: 'test', p_error_message: 'test',
    });

    // Now try to reserve $0.10 — should be denied ($0.15 ambiguous + $0.10 = $0.25 > $0.20)
    const key2 = `lc:${testRunId}:amb-tight:2`;
    const res2 = await reserve(key2, 0.10, [tightScope]);
    expect(res2.data?.ledger_id).toBeNull(); // budget exceeded

    // But $0.05 should fit ($0.15 + $0.05 = $0.20 = limit)
    const key3 = `lc:${testRunId}:amb-tight:3`;
    const res3 = await reserve(key3, 0.05, [tightScope]);
    expect(res3.data?.is_new).toBe(true);

    // Cleanup
    const { data: entries } = await supabase.from('ai_inference_ledger').select('id')
      .like('idempotency_key', `lc:${testRunId}:amb-tight:%`);
    if (entries?.length) {
      const ids = entries.map((e: { id: string }) => e.id);
      await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
      await supabase.from('ai_inference_ledger').delete().in('id', ids);
    }
    await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-tight-${testRunId}`);
  });

  it('request denied when settled + active + ambiguous exceeds limit', async () => {
    // $0.50 periodic scope
    const medScope = await createScope('task', `lc-med-${testRunId}`, 0.50, 24);

    // Settle $0.20 (actual)
    const k1 = `lc:${testRunId}:deny-mix:1`;
    const r1 = await reserve(k1, 0.25, [medScope]);
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: r1.data.ledger_id });
    await supabase.rpc('settle_inference', {
      p_ledger_id: r1.data.ledger_id,
      p_actual_input_tokens: 50, p_actual_output_tokens: 20, p_actual_cost_usd: 0.20,
    });

    // Ambiguous $0.15
    const k2 = `lc:${testRunId}:deny-mix:2`;
    const r2 = await reserve(k2, 0.15, [medScope]);
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: r2.data.ledger_id });
    await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: r2.data.ledger_id,
      p_error_code: 'test', p_error_message: 'test',
    });

    // Active reserved $0.10
    const k3 = `lc:${testRunId}:deny-mix:3`;
    const r3 = await reserve(k3, 0.10, [medScope]);
    expect(r3.data?.is_new).toBe(true);

    // Total committed: $0.20 (settled actual) + $0.15 (ambiguous) + $0.10 (reserved) = $0.45
    // $0.10 more should be denied ($0.45 + $0.10 = $0.55 > $0.50)
    const k4 = `lc:${testRunId}:deny-mix:4`;
    const r4 = await reserve(k4, 0.10, [medScope]);
    expect(r4.data?.ledger_id).toBeNull();

    // But $0.05 should fit ($0.45 + $0.05 = $0.50 = limit)
    const k5 = `lc:${testRunId}:deny-mix:5`;
    const r5 = await reserve(k5, 0.05, [medScope]);
    expect(r5.data?.is_new).toBe(true);

    // Cleanup
    const { data: entries } = await supabase.from('ai_inference_ledger').select('id')
      .like('idempotency_key', `lc:${testRunId}:deny-mix:%`);
    if (entries?.length) {
      const ids = entries.map((e: { id: string }) => e.id);
      await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
      await supabase.from('ai_inference_ledger').delete().in('id', ids);
    }
    await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-med-${testRunId}`);
  });

  it('ambiguous entries outside rolling window do not consume current capacity', async () => {
    // 24h periodic scope, $0.30 limit
    const winScope = await createScope('task', `lc-win-${testRunId}`, 0.30, 24);

    // Create an ambiguous entry and backdate it outside the window
    const k1 = `lc:${testRunId}:win-old:1`;
    const r1 = await reserve(k1, 0.25, [winScope]);
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: r1.data.ledger_id });
    await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: r1.data.ledger_id,
      p_error_code: 'test', p_error_message: 'test',
    });
    // Backdate to 48h ago — outside the 24h window
    await supabase.from('ai_inference_ledger')
      .update({ created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() })
      .eq('id', r1.data.ledger_id);

    // A new $0.25 reservation should succeed — the old ambiguous entry is outside the window
    const k2 = `lc:${testRunId}:win-old:2`;
    const r2 = await reserve(k2, 0.25, [winScope]);
    expect(r2.data?.is_new).toBe(true);

    // Cleanup
    const { data: entries } = await supabase.from('ai_inference_ledger').select('id')
      .like('idempotency_key', `lc:${testRunId}:win-old:%`);
    if (entries?.length) {
      const ids = entries.map((e: { id: string }) => e.id);
      await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
      await supabase.from('ai_inference_ledger').delete().in('id', ids);
    }
    await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-win-${testRunId}`);
  });

  it('non-periodic scope behavior unchanged by ambiguous fix', async () => {
    // Non-periodic scope uses accounting columns, not junction recalculation
    const k1 = `lc:${testRunId}:np-unch:1`;
    const r1 = await reserve(k1, 0.30, [scopeNonPeriodic]);
    expect(r1.data?.is_new).toBe(true);

    // Mark ambiguous
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: r1.data.ledger_id });
    await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: r1.data.ledger_id,
      p_error_code: 'test', p_error_message: 'test',
    });

    // Non-periodic: uses columns. reserved_usd should still hold $0.30
    const scope = await getScope(scopeNonPeriodic);
    expect(Number(scope.reserved_usd)).toBeCloseTo(0.30, 4);

    // $0.80 should be denied ($0.30 reserved + $0.80 = $1.10 > $1.00)
    const k2 = `lc:${testRunId}:np-unch:2`;
    const r2 = await reserve(k2, 0.80, [scopeNonPeriodic]);
    expect(r2.data?.ledger_id).toBeNull();

    // $0.70 should succeed ($0.30 + $0.70 = $1.00)
    const k3 = `lc:${testRunId}:np-unch:3`;
    const r3 = await reserve(k3, 0.70, [scopeNonPeriodic]);
    expect(r3.data?.is_new).toBe(true);
  });

  it('hierarchical scope enforcement with ambiguous entries', async () => {
    // Non-periodic parent ($0.50) + periodic child ($0.30)
    const hierParent = await createScope('workflow', `lc-hier-p-${testRunId}`, 0.50);
    const hierChild = await createScope('task', `lc-hier-c-${testRunId}`, 0.30, 24);

    // Create ambiguous entry against both scopes
    const k1 = `lc:${testRunId}:hier:1`;
    const r1 = await reserve(k1, 0.20, [hierParent, hierChild]);
    await supabase.rpc('mark_inference_in_progress', { p_ledger_id: r1.data.ledger_id });
    await supabase.rpc('mark_inference_ambiguous', {
      p_ledger_id: r1.data.ledger_id,
      p_error_code: 'test', p_error_message: 'test',
    });

    // $0.15 should succeed (parent: $0.20+$0.15=$0.35<$0.50, child: $0.20+$0.15=$0.35>$0.30 — DENIED)
    const k2 = `lc:${testRunId}:hier:2`;
    const r2 = await reserve(k2, 0.15, [hierParent, hierChild]);
    expect(r2.data?.ledger_id).toBeNull(); // Child scope blocks it

    // $0.10 should succeed (parent: $0.30<$0.50, child: $0.30=$0.30)
    const k3 = `lc:${testRunId}:hier:3`;
    const r3 = await reserve(k3, 0.10, [hierParent, hierChild]);
    expect(r3.data?.is_new).toBe(true);

    // Cleanup
    const { data: entries } = await supabase.from('ai_inference_ledger').select('id')
      .like('idempotency_key', `lc:${testRunId}:hier:%`);
    if (entries?.length) {
      const ids = entries.map((e: { id: string }) => e.id);
      await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
      await supabase.from('ai_inference_ledger').delete().in('id', ids);
    }
    await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-hier-p-${testRunId}`);
    await supabase.from('ai_budget_scopes').delete().eq('scope_id', `lc-hier-c-${testRunId}`);
  });
});
