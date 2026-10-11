/**
 * Audit Retention Cleanup Tests
 *
 * Deterministic code tests + commissioning DB integration tests.
 * Verifies project identity, scheduled cleanup, financial invariants.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getEnvironmentRole } from '../../../config/environment.js';
import {
  verifyProjectIdentity,
  cleanupExpiredAuditResponses,
  runScheduledCleanup,
  _resetMaintenanceLock,
} from '../audit-retention.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN_DB_TESTS = HAS_DB && !IS_PRODUCTION;

const COMMISSIONING_PROJECT = 'nnwddilewgbsmyouatzu';
const PRODUCTION_PROJECT = 'bvgtfadggtgnakrxvuim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;

// ============================================================
// Project identity verification
// ============================================================
describe('Project identity verification', () => {
  it('accepts correct commissioning project', () => {
    const result = verifyProjectIdentity(
      `https://${COMMISSIONING_PROJECT}.supabase.co`,
      COMMISSIONING_PROJECT
    );
    expect(result.verified).toBe(true);
    expect(result.project).toBe(COMMISSIONING_PROJECT);
    expect(result.error).toBeUndefined();
  });

  it('rejects production project explicitly', () => {
    const result = verifyProjectIdentity(
      `https://${PRODUCTION_PROJECT}.supabase.co`,
      PRODUCTION_PROJECT
    );
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Production project');
    expect(result.error).toContain(PRODUCTION_PROJECT);
  });

  it('rejects production even when expected is production', () => {
    const result = verifyProjectIdentity(
      `https://${PRODUCTION_PROJECT}.supabase.co`,
      PRODUCTION_PROJECT
    );
    expect(result.verified).toBe(false);
  });

  it('rejects credential/project mismatch', () => {
    const result = verifyProjectIdentity(
      `https://otherproject123456.supabase.co`,
      COMMISSIONING_PROJECT
    );
    expect(result.verified).toBe(false);
    expect(result.error).toContain('mismatch');
  });

  it('rejects empty URL', () => {
    const result = verifyProjectIdentity('', COMMISSIONING_PROJECT);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects empty expected project', () => {
    const result = verifyProjectIdentity(`https://${COMMISSIONING_PROJECT}.supabase.co`, '');
    expect(result.verified).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects malformed URL', () => {
    const result = verifyProjectIdentity('not-a-url', COMMISSIONING_PROJECT);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Cannot extract');
  });
});

// ============================================================
// Cleanup with project verification
// ============================================================
describe('Cleanup with project verification', () => {
  it('rejects when project verification fails', async () => {
    const mockClient = { rpc: async () => ({ data: 0, error: null }) };
    const result = await cleanupExpiredAuditResponses(mockClient, {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${PRODUCTION_PROJECT}.supabase.co`,
    });
    expect(result.expired).toBe(0);
    expect(result.error).toContain('Project verification failed');
  });

  it('succeeds when project matches', async () => {
    const mockClient = { rpc: async () => ({ data: 5, error: null }) };
    const result = await cleanupExpiredAuditResponses(mockClient, {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
    });
    expect(result.expired).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it('handles RPC errors', async () => {
    const mockClient = { rpc: async () => ({ data: null, error: { message: 'connection lost' } }) };
    const result = await cleanupExpiredAuditResponses(mockClient);
    expect(result.expired).toBe(0);
    expect(result.error).toContain('connection lost');
  });

  it('handles exceptions', async () => {
    const mockClient = { rpc: async () => { throw new Error('timeout'); } };
    const result = await cleanupExpiredAuditResponses(mockClient);
    expect(result.expired).toBe(0);
    expect(result.error).toContain('timeout');
  });
});

// ============================================================
// Scheduled maintenance
// ============================================================
describe('Scheduled maintenance', () => {
  beforeEach(() => {
    _resetMaintenanceLock();
  });

  it('rejects production project', async () => {
    const mockClient = { rpc: async () => ({ data: 0, error: null }) };
    const result = await runScheduledCleanup(mockClient, {
      expectedProject: PRODUCTION_PROJECT,
      supabaseUrl: `https://${PRODUCTION_PROJECT}.supabase.co`,
    });
    expect(result.skipped).toBe(true);
    expect(result.errors[0]).toContain('Production project');
  });

  it('prevents overlapping runs', async () => {
    let resolveFirst: () => void;
    const firstPromise = new Promise<void>(r => { resolveFirst = r; });
    const slowClient = {
      rpc: async () => {
        await firstPromise;
        return { data: 1, error: null };
      },
    };

    const config = {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
      maxBatches: 1,
    };

    const first = runScheduledCleanup(slowClient, config);
    // Start second while first is running
    const second = await runScheduledCleanup(slowClient, config);
    expect(second.skipped).toBe(true);
    expect(second.errors[0]).toContain('already running');

    resolveFirst!();
    await first;
  });

  it('enforces batch limits', async () => {
    let callCount = 0;
    const mockClient = {
      rpc: async () => {
        callCount++;
        return { data: 100, error: null }; // Always returns full batch
      },
    };

    const result = await runScheduledCleanup(mockClient, {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
      maxBatches: 3,
      batchSize: 100,
    });

    expect(result.totalBatches).toBe(3);
    expect(callCount).toBe(3);
  });

  it('stops early when batch returns fewer than batchSize', async () => {
    let callCount = 0;
    const mockClient = {
      rpc: async () => {
        callCount++;
        return { data: callCount === 1 ? 50 : 100, error: null };
      },
    };

    const result = await runScheduledCleanup(mockClient, {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
      maxBatches: 10,
      batchSize: 100,
    });

    expect(callCount).toBe(1); // Stopped after first batch (50 < 100)
    expect(result.totalExpired).toBe(50);
  });

  it('stops on error and reports it', async () => {
    let callCount = 0;
    const mockClient = {
      rpc: async () => {
        callCount++;
        if (callCount === 2) return { data: null, error: { message: 'DB down' } };
        return { data: 100, error: null };
      },
    };

    const result = await runScheduledCleanup(mockClient, {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
      maxBatches: 5,
    });

    expect(result.totalBatches).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('DB down');
  });

  it('records timestamps', async () => {
    const mockClient = { rpc: async () => ({ data: 0, error: null }) };
    const result = await runScheduledCleanup(mockClient, {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
    });

    expect(result.startedAt).toBeDefined();
    expect(result.completedAt).toBeDefined();
    expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(new Date(result.completedAt).getTime());
  });

  it('releases lock after completion', async () => {
    const mockClient = { rpc: async () => ({ data: 0, error: null }) };
    const config = {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
    };

    await runScheduledCleanup(mockClient, config);
    // Second run should succeed (not skipped)
    const second = await runScheduledCleanup(mockClient, config);
    expect(second.skipped).toBe(false);
  });

  it('releases lock after error', async () => {
    const mockClient = { rpc: async () => { throw new Error('crash'); } };
    const config = {
      expectedProject: COMMISSIONING_PROJECT,
      supabaseUrl: `https://${COMMISSIONING_PROJECT}.supabase.co`,
      maxBatches: 1,
    };

    await runScheduledCleanup(mockClient, config);
    // Should release lock despite error
    const mockOk = { rpc: async () => ({ data: 0, error: null }) };
    const second = await runScheduledCleanup(mockOk, config);
    expect(second.skipped).toBe(false);
  });
});

// ============================================================
// Migration and financial integrity
// ============================================================
describe('Migration and financial integrity', () => {
  const migrationPath = path.join(
    import.meta.dirname, '..', '..', '..', '..', 'supabase', 'migrations',
    '20261011_audit_retention_cleanup.sql'
  );

  it('RPC does not modify ledger status or cost columns', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    const updateSection = sql.slice(sql.indexOf('UPDATE ai_inference_ledger'));
    expect(updateSection).toContain('SET metadata =');
    expect(updateSection).not.toContain('status =');
    expect(updateSection).not.toContain('actual_cost_usd');
    expect(updateSection).not.toContain('reserved_cost_usd');
  });

  it('no inference or Slack in retention module', () => {
    const tsContent = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'audit-retention.ts'), 'utf-8'
    );
    expect(tsContent).not.toContain('complete(');
    expect(tsContent).not.toContain('slack');
    expect(tsContent).not.toContain('postMessage');
    expect(tsContent).not.toContain('Anthropic');
  });
});

// ============================================================
// DB integration tests (commissioning only)
// ============================================================
describe.skipIf(!CAN_RUN_DB_TESTS)('Audit retention — DB integration', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = `ret-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterAll(async () => {
    if (!supabase) return;
    const { data: entries } = await supabase
      .from('ai_inference_ledger').select('id')
      .like('idempotency_key', `retention-test:${testRunId}:%`);
    if (entries?.length) {
      const ids = entries.map((e: { id: string }) => e.id);
      await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
      await supabase.from('ai_inference_ledger').delete().in('id', ids);
    }
  });

  async function insertTestEntry(suffix: string, expiresAt: string, rawResponse: string): Promise<string> {
    const id = randomUUID();
    await supabase.from('ai_inference_ledger').insert({
      id,
      idempotency_key: `retention-test:${testRunId}:${suffix}`,
      agent_id: 'test', purpose: 'retention-test', task_type: 'test',
      provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      status: 'settled', estimated_input_tokens: 100,
      max_output_tokens: 100, max_input_tokens: 1000,
      reserved_cost_usd: 0.01, actual_cost_usd: 0.005,
      actual_input_tokens: 80, actual_output_tokens: 50,
      metadata: {
        validation_failure: {
          error_type: 'SCHEMA', errors: ['test error'],
          response_hash: createHash('sha256').update(rawResponse).digest('hex'),
          response_chars: rawResponse.length,
          raw_response: rawResponse,
          expires_at: expiresAt,
          recorded_at: new Date().toISOString(),
        },
      },
    });
    return id;
  }

  it('removes expired raw_response and preserves permanent fields', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('expired-v2', past, 'Expired content');

    await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });

    const { data: entry } = await supabase.from('ai_inference_ledger')
      .select('metadata, status, actual_cost_usd').eq('id', id).single();
    const vf = entry.metadata.validation_failure;
    expect(vf.raw_response).toBeUndefined();
    expect(vf.raw_response_expired).toBe(true);
    expect(vf.response_hash).toBeDefined();
    expect(vf.error_type).toBe('SCHEMA');
    // Financial columns unchanged
    expect(entry.status).toBe('settled');
    expect(Number(entry.actual_cost_usd)).toBeCloseTo(0.005, 4);
  });

  it('retains unexpired raw_response', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('unexpired-v2', future, 'Still valid');

    await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });

    const { data: entry } = await supabase.from('ai_inference_ledger')
      .select('metadata').eq('id', id).single();
    expect(entry.metadata.validation_failure.raw_response).toBe('Still valid');
  });

  it('repeated cleanup is idempotent', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('idempotent-v2', past, 'Idem test');

    await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });
    const { data: c2 } = await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });

    const { data: entry } = await supabase.from('ai_inference_ledger')
      .select('metadata').eq('id', id).single();
    expect(entry.metadata.validation_failure.raw_response_expired).toBe(true);
  });
});
