/**
 * Audit Retention Cleanup Tests
 *
 * Deterministic code tests + commissioning DB integration tests.
 * Verifies expired raw_response removal while preserving financial records.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN_DB_TESTS = HAS_DB && !IS_PRODUCTION;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;

// ============================================================
// Code-level tests (no DB required)
// ============================================================
describe('Audit retention — code verification', () => {
  const migrationPath = path.join(
    import.meta.dirname, '..', '..', '..', '..', 'supabase', 'migrations',
    '20261011_audit_retention_cleanup.sql'
  );

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('RPC removes raw_response but preserves response_hash', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain("- 'raw_response'");
    expect(sql).toContain('raw_response_expired');
    expect(sql).not.toContain("- 'response_hash'");
    expect(sql).not.toContain("- 'errors'");
    expect(sql).not.toContain("- 'error_type'");
  });

  it('RPC uses batch limit and SKIP LOCKED', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('LIMIT p_batch_size');
    expect(sql).toContain('SKIP LOCKED');
  });

  it('RPC only targets records with expired raw_response', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain("'expires_at'");
    expect(sql).toContain('< NOW()');
    expect(sql).toContain("'raw_response' IS NOT NULL");
  });

  it('RPC does not modify ledger status or cost columns', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    // The UPDATE only touches metadata
    const updateSection = sql.slice(sql.indexOf('UPDATE ai_inference_ledger'));
    expect(updateSection).toContain('SET metadata =');
    expect(updateSection).not.toContain('status =');
    expect(updateSection).not.toContain('actual_cost_usd');
    expect(updateSection).not.toContain('reserved_cost_usd');
  });

  it('TypeScript worker handles RPC errors', async () => {
    const { cleanupExpiredAuditResponses } = await import('../audit-retention.js');
    // Mock a failing client
    const mockClient = {
      rpc: async () => ({ data: null, error: { message: 'test error' } }),
    };
    const result = await cleanupExpiredAuditResponses(mockClient);
    expect(result.expired).toBe(0);
    expect(result.error).toContain('test error');
  });

  it('TypeScript worker handles exceptions', async () => {
    const { cleanupExpiredAuditResponses } = await import('../audit-retention.js');
    const mockClient = {
      rpc: async () => { throw new Error('connection failed'); },
    };
    const result = await cleanupExpiredAuditResponses(mockClient);
    expect(result.expired).toBe(0);
    expect(result.error).toContain('connection failed');
  });

  it('TypeScript worker returns count on success', async () => {
    const { cleanupExpiredAuditResponses } = await import('../audit-retention.js');
    const mockClient = {
      rpc: async () => ({ data: 3, error: null }),
    };
    const result = await cleanupExpiredAuditResponses(mockClient);
    expect(result.expired).toBe(3);
    expect(result.error).toBeUndefined();
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
    // Clean up test entries
    const { data: entries } = await supabase
      .from('ai_inference_ledger')
      .select('id')
      .like('idempotency_key', `retention-test:${testRunId}:%`);
    if (entries?.length) {
      const ids = entries.map((e: { id: string }) => e.id);
      await supabase.from('ai_ledger_scopes').delete().in('ledger_id', ids);
      await supabase.from('ai_inference_ledger').delete().in('id', ids);
    }
  });

  async function insertTestEntry(suffix: string, expiresAt: string, rawResponse: string): Promise<string> {
    const id = randomUUID();
    const hash = createHash('sha256').update(rawResponse).digest('hex');
    await supabase.from('ai_inference_ledger').insert({
      id,
      idempotency_key: `retention-test:${testRunId}:${suffix}`,
      agent_id: 'test',
      purpose: 'retention-test',
      task_type: 'test',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      status: 'settled',
      estimated_input_tokens: 100,
      max_output_tokens: 100,
      max_input_tokens: 1000,
      reserved_cost_usd: 0.01,
      actual_cost_usd: 0.005,
      actual_input_tokens: 80,
      actual_output_tokens: 50,
      metadata: {
        validation_failure: {
          error_type: 'SCHEMA',
          errors: ['test error'],
          response_hash: hash,
          response_chars: rawResponse.length,
          raw_response: rawResponse,
          expires_at: expiresAt,
          recorded_at: new Date().toISOString(),
        },
      },
    });
    return id;
  }

  it('removes expired raw_response', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('expired', past, 'This response has expired');

    const { data: count } = await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });
    expect(count).toBeGreaterThanOrEqual(1);

    const { data: entry } = await supabase.from('ai_inference_ledger').select('metadata').eq('id', id).single();
    const vf = entry.metadata.validation_failure;
    expect(vf.raw_response).toBeUndefined();
    expect(vf.raw_response_expired).toBe(true);
    expect(vf.expired_at).toBeDefined();
    // Permanent fields preserved
    expect(vf.response_hash).toBeDefined();
    expect(vf.error_type).toBe('SCHEMA');
    expect(vf.errors).toEqual(['test error']);
  });

  it('retains unexpired raw_response', async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('unexpired', future, 'This response is still valid');

    await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });

    const { data: entry } = await supabase.from('ai_inference_ledger').select('metadata').eq('id', id).single();
    expect(entry.metadata.validation_failure.raw_response).toBe('This response is still valid');
  });

  it('preserves financial columns after cleanup', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('financial', past, 'Expired financial test');

    await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });

    const { data: entry } = await supabase
      .from('ai_inference_ledger')
      .select('status, actual_cost_usd, reserved_cost_usd, actual_input_tokens, actual_output_tokens')
      .eq('id', id).single();
    expect(entry.status).toBe('settled');
    expect(Number(entry.actual_cost_usd)).toBeCloseTo(0.005, 4);
    expect(Number(entry.reserved_cost_usd)).toBeCloseTo(0.01, 4);
    expect(entry.actual_input_tokens).toBe(80);
    expect(entry.actual_output_tokens).toBe(50);
  });

  it('repeated cleanup is idempotent', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const id = await insertTestEntry('idempotent', past, 'Idempotent test');

    await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });
    // Second run should find nothing (raw_response already removed)
    const { data: count2 } = await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 10 });

    const { data: entry } = await supabase.from('ai_inference_ledger').select('metadata').eq('id', id).single();
    expect(entry.metadata.validation_failure.raw_response_expired).toBe(true);
    // Should not have doubled the expired_at field
    expect(typeof entry.metadata.validation_failure.expired_at).toBe('string');
  });

  it('respects batch limit', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await insertTestEntry('batch1', past, 'Batch one');
    await insertTestEntry('batch2', past, 'Batch two');
    await insertTestEntry('batch3', past, 'Batch three');

    const { data: count } = await supabase.rpc('cleanup_expired_audit_responses', { p_batch_size: 2 });
    expect(count).toBeLessThanOrEqual(2);
  });
});
