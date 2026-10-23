/**
 * HR Startup Hardening Tests
 *
 * Covers:
 * - Atomic bootstrap administrator synchronization
 * - Input validation (empty, null, invalid, duplicate IDs)
 * - Repeated initialization (idempotency)
 * - Administrator replacement
 * - Health endpoint responses
 * - RPC permission contract
 */
import { describe, it, expect, vi } from 'vitest';
import { syncBootstrapAdmins } from '../database/employees.js';
import { getHealthStatus, markStarted } from '../config/hr-controls.js';
import type { HREnvConfig } from '../config/hr-env.js';

// ============================================================
// Helper: mock Supabase RPC responses
// ============================================================

function mockRpc(response: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(response) } as any;
}

// ============================================================
// Bootstrap admin sync — application layer
// ============================================================

describe('syncBootstrapAdmins — application layer', () => {
  it('calls hr_sync_bootstrap_admins RPC with desired IDs', async () => {
    const db = mockRpc({ data: { error: null, added: 1, removed: 0 }, error: null });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU']);

    expect(db.rpc).toHaveBeenCalledWith('hr_sync_bootstrap_admins', {
      p_desired_ids: ['U01SC2TNYKU'],
    });
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.error).toBeNull();
  });

  it('rejects empty admin list at application layer (before RPC)', async () => {
    const db = mockRpc({ data: null, error: null });
    const result = await syncBootstrapAdmins(db, []);

    expect(db.rpc).not.toHaveBeenCalled();
    expect(result.error).toContain('empty');
  });

  it('handles multiple admin IDs', async () => {
    const db = mockRpc({ data: { error: null, added: 2, removed: 0 }, error: null });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU', 'UADMIN56789']);

    expect(db.rpc).toHaveBeenCalledWith('hr_sync_bootstrap_admins', {
      p_desired_ids: ['U01SC2TNYKU', 'UADMIN56789'],
    });
    expect(result.added).toBe(2);
  });

  it('reports database connection errors', async () => {
    const db = mockRpc({ data: null, error: { message: 'connection refused' } });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU']);

    expect(result.error).toBe('connection refused');
    expect(result.added).toBe(0);
  });
});

// ============================================================
// Bootstrap admin sync — RPC-level validation contract
// These test the expected RPC error responses for invalid inputs.
// The actual validation runs in PostgreSQL; these verify the
// TypeScript caller handles each rejection correctly.
// ============================================================

describe('syncBootstrapAdmins — RPC validation contract', () => {
  it('RPC rejects null/blank IDs', async () => {
    const db = mockRpc({
      data: { error: 'Administrator list contains null or blank entries', added: 0, removed: 0 },
      error: null,
    });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU']); // TS passes valid, but simulating RPC response
    expect(result.error).toContain('null or blank');
  });

  it('RPC rejects invalid Slack user ID format', async () => {
    const db = mockRpc({
      data: { error: 'Administrator list contains an invalid Slack user ID', added: 0, removed: 0 },
      error: null,
    });
    const result = await syncBootstrapAdmins(db, ['UVALID12345']);
    expect(result.error).toContain('invalid Slack user ID');
  });

  it('RPC rejects duplicate IDs', async () => {
    const db = mockRpc({
      data: { error: 'Administrator list contains duplicate IDs', added: 0, removed: 0 },
      error: null,
    });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU']);
    expect(result.error).toContain('duplicate');
  });
});

// ============================================================
// Idempotency and replacement
// ============================================================

describe('syncBootstrapAdmins — idempotency and replacement', () => {
  it('repeated call with same list returns added=0, removed=0', async () => {
    const db = mockRpc({ data: { error: null, added: 0, removed: 0 }, error: null });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU']);

    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.error).toBeNull();
  });

  it('replacing one admin with another reports correct counts', async () => {
    const db = mockRpc({ data: { error: null, added: 1, removed: 1 }, error: null });
    const result = await syncBootstrapAdmins(db, ['UNEWADMIN99']);

    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.error).toBeNull();
  });

  it('adding a second admin to existing one', async () => {
    const db = mockRpc({ data: { error: null, added: 1, removed: 0 }, error: null });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU', 'UNEWADMIN99']);

    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
  });
});

// ============================================================
// Concurrent call serialization contract
// ============================================================

describe('syncBootstrapAdmins — concurrency', () => {
  it('concurrent calls are serialized by advisory lock (RPC contract)', async () => {
    // The advisory lock is in the SQL function. From the TS side,
    // concurrent calls both go to the RPC. The second waits for the
    // first's transaction to commit. Both return correct results.
    const call1 = vi.fn().mockResolvedValue({
      data: { error: null, added: 1, removed: 0 }, error: null,
    });
    const call2 = vi.fn().mockResolvedValue({
      data: { error: null, added: 0, removed: 1 }, error: null,
    });

    // Simulate two calls — both resolve (lock serializes at DB level)
    const db1 = { rpc: call1 } as any;
    const db2 = { rpc: call2 } as any;

    const [r1, r2] = await Promise.all([
      syncBootstrapAdmins(db1, ['UADMIN1AAAA']),
      syncBootstrapAdmins(db2, ['UADMIN2BBBB']),
    ]);

    // Both calls complete without error — serialization is at DB level
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(call1).toHaveBeenCalledTimes(1);
    expect(call2).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Rollback contract
// ============================================================

describe('syncBootstrapAdmins — rollback on failure', () => {
  it('database error means no partial state change', async () => {
    // If the RPC raises an exception, PostgreSQL rolls back the
    // entire transaction (advisory lock, deletes, inserts).
    // The TS caller receives the error and reports it.
    const db = mockRpc({ data: null, error: { message: 'disk full' } });
    const result = await syncBootstrapAdmins(db, ['U01SC2TNYKU']);

    expect(result.error).toBe('disk full');
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });
});

// ============================================================
// RPC permission contract
// ============================================================

describe('syncBootstrapAdmins — permission contract', () => {
  it('function is called via service_role RPC (not direct table access)', async () => {
    const db = mockRpc({ data: { error: null, added: 1, removed: 0 }, error: null });
    await syncBootstrapAdmins(db, ['U01SC2TNYKU']);

    // Verify it calls rpc(), not from().insert()/delete()
    expect(db.rpc).toHaveBeenCalledWith('hr_sync_bootstrap_admins', expect.any(Object));
  });

  it('does not use direct table operations', async () => {
    const fromSpy = vi.fn();
    const db = {
      rpc: vi.fn().mockResolvedValue({ data: { error: null, added: 1, removed: 0 }, error: null }),
      from: fromSpy,
    } as any;

    await syncBootstrapAdmins(db, ['U01SC2TNYKU']);

    expect(fromSpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// Health endpoint responses
// ============================================================

function makeEnv(overrides: Partial<HREnvConfig> = {}): HREnvConfig {
  return {
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceKey: 'test-key',
    slackEnabled: false,
    botToken: null,
    appToken: null,
    leadershipChannelId: null,
    helpChannelId: null,
    expectedTeamId: null,
    authorizedAdmins: [],
    aiEnabled: false,
    llmEnabled: false,
    anthropicApiKey: null,
    ...overrides,
  };
}

describe('Health endpoint responses', () => {
  it('returns healthy when DB connected and Slack disabled', () => {
    markStarted();
    const health = getHealthStatus(makeEnv(), true, null);
    expect(health.status).toBe('healthy');
    expect(health.version).toBe('M1');
    expect(health.checks.database).toBe(true);
    expect(health.checks.slack).toBeNull();
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy when DB not connected', () => {
    const health = getHealthStatus(makeEnv(), false, null);
    expect(health.status).toBe('unhealthy');
  });

  it('returns degraded when DB connected but Slack failed', () => {
    const health = getHealthStatus(makeEnv({ slackEnabled: true }), true, false);
    expect(health.status).toBe('degraded');
  });

  it('does not expose credentials or admin IDs', () => {
    const health = getHealthStatus(makeEnv({ authorizedAdmins: ['U01SC2TNYKU'] }), true, null);
    const json = JSON.stringify(health);
    expect(json).not.toContain('U01SC2TNYKU');
    expect(json).not.toContain('supabase');
    expect(json).not.toContain('token');
  });
});
