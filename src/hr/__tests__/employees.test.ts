/**
 * HR Employee Directory Tests — Hardened
 *
 * Tests RPC-based mutations with atomic authorization, audit, and idempotency.
 * All mutations flow through PostgreSQL transactional functions.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  getEmployee,
  findEmployeeBySlackId,
  isKnownSlackUser,
  validateCreateInput,
  validateUpdateInput,
  computeRequestFingerprint,
} from '../database/employees.js';

// ============================================================
// Mock Supabase client with RPC support
// ============================================================

function mockDb(rpcResult?: { error: string | null; employee?: Record<string, unknown> | null; success?: boolean }, rpcError?: { message: string }) {
  const rpcSpy = vi.fn().mockResolvedValue({
    data: rpcResult ?? { error: null, employee: {
      id: 'emp-1', full_name: 'Test', employment_status: 'active',
      is_synthetic: true, created_at: '2026-01-01', updated_at: '2026-01-01',
    }},
    error: rpcError || null,
  });

  return {
    db: {
      rpc: rpcSpy,
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({
              data: table === 'hr_employees' ? {
                id: 'emp-1', full_name: 'Found', employment_status: 'active',
                is_synthetic: true, created_at: '2026-01-01', updated_at: '2026-01-01',
              } : null,
              error: null,
            }),
          }),
        }),
      }),
    } as any,
    rpcSpy,
  };
}

// ============================================================
// Validation
// ============================================================

describe('Employee Input Validation', () => {
  it('rejects empty fullName', () => {
    expect(validateCreateInput({ fullName: '', employmentStatus: 'active' })).toContain('fullName');
  });

  it('rejects invalid status', () => {
    expect(validateCreateInput({ fullName: 'Test', employmentStatus: 'fired' as any })).toContain('employmentStatus');
  });

  it('rejects invalid classification', () => {
    expect(validateCreateInput({
      fullName: 'Test', employmentStatus: 'active', employmentClassification: 'intern' as any,
    })).toContain('employmentClassification');
  });

  it('rejects invalid state code', () => {
    expect(validateCreateInput({
      fullName: 'Test', employmentStatus: 'active', workState: 'Washington',
    })).toContain('workState');
  });

  it('accepts valid input', () => {
    expect(validateCreateInput({
      fullName: 'Test Employee', employmentStatus: 'active',
      employmentClassification: 'full_time', workState: 'WA',
    })).toBeNull();
  });

  it('update rejects empty fullName', () => {
    expect(validateUpdateInput({ fullName: '' })).toContain('fullName');
  });
});

// ============================================================
// Create — via transactional RPC
// ============================================================

describe('createEmployee (RPC-based)', () => {
  it('calls hr_create_employee RPC with correct parameters', async () => {
    const { db, rpcSpy } = mockDb();
    await createEmployee(db, { fullName: 'Jane Doe', employmentStatus: 'active', workState: 'WA' }, 'UADMIN1', 'key-1');

    expect(rpcSpy).toHaveBeenCalledWith('hr_create_employee', expect.objectContaining({
      p_actor_id: 'UADMIN1',
      p_idempotency_key: 'key-1',
      p_request_fingerprint: expect.any(String),
      p_full_name: 'Jane Doe',
      p_employment_status: 'active',
      p_work_state: 'WA',
    }));
  });

  it('returns employee on success', async () => {
    const { db } = mockDb();
    const result = await createEmployee(db, { fullName: 'Jane', employmentStatus: 'active' }, 'UADMIN1');
    expect(result.error).toBeNull();
    expect(result.employee?.isSynthetic).toBe(true);
  });

  it('returns validation error without calling RPC', async () => {
    const { db, rpcSpy } = mockDb();
    const result = await createEmployee(db, { fullName: '', employmentStatus: 'active' }, 'UADMIN1');
    expect(result.error).toContain('fullName');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns authorization error from RPC', async () => {
    const { db } = mockDb({ error: 'Not authorized', employee: null });
    const result = await createEmployee(db, { fullName: 'Test', employmentStatus: 'active' }, 'UUNAUTHORIZED');
    expect(result.error).toBe('Not authorized');
    expect(result.employee).toBeNull();
  });

  it('returns database error', async () => {
    const { db } = mockDb(undefined, { message: 'connection refused' });
    const result = await createEmployee(db, { fullName: 'Test', employmentStatus: 'active' }, 'UADMIN1');
    expect(result.error).toBe('connection refused');
  });

  it('idempotent: RPC returns prior result for duplicate key', async () => {
    const { db } = mockDb({
      error: null,
      employee: { id: 'emp-prior', full_name: 'Prior', employment_status: 'active', is_synthetic: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    });
    const result = await createEmployee(db, { fullName: 'Prior', employmentStatus: 'active' }, 'UADMIN1', 'idemp-1');
    expect(result.employee?.id).toBe('emp-prior');
  });
});

// ============================================================
// Read
// ============================================================

describe('getEmployee / findEmployeeBySlackId — authorized reads', () => {
  const adminAuth = { isAdmin: (id: string) => id === 'UADMIN1' };

  it('returns employee by ID for authorized admin', async () => {
    const { db } = mockDb();
    const result = await getEmployee(db, 'emp-1', 'UADMIN1', adminAuth);
    expect(result.employee?.fullName).toBe('Found');
    expect(result.error).toBeNull();
  });

  it('rejects unauthorized directory read by ID', async () => {
    const { db } = mockDb();
    const result = await getEmployee(db, 'emp-1', 'UUNAUTHORIZED', adminAuth);
    expect(result.employee).toBeNull();
    expect(result.error).toContain('Not authorized');
  });

  it('rejects unauthorized directory read by Slack ID', async () => {
    const { db } = mockDb();
    const result = await findEmployeeBySlackId(db, 'USLACK1', 'UUNAUTHORIZED', adminAuth);
    expect(result.employee).toBeNull();
    expect(result.error).toContain('Not authorized');
  });
});

describe('isKnownSlackUser — minimal identity check', () => {
  it('returns true for existing user', async () => {
    const { db } = mockDb();
    const known = await isKnownSlackUser(db, 'USLACK1');
    expect(known).toBe(true);
  });

  it('returns false for non-existent user', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    } as any;
    const known = await isKnownSlackUser(db, 'USTRANGER');
    expect(known).toBe(false);
  });

  it('does not expose employee records', async () => {
    const { db } = mockDb();
    // isKnownSlackUser returns boolean, not Employee
    const result = await isKnownSlackUser(db, 'USLACK1');
    expect(typeof result).toBe('boolean');
  });
});

describe('Idempotency — fingerprint binding', () => {
  it('rejects key reused with different request fingerprint (via RPC error)', async () => {
    const { db } = mockDb({ error: 'Idempotency key already used for a different request', employee: null });
    const result = await createEmployee(db, { fullName: 'Different', employmentStatus: 'active' }, 'UADMIN1', 'key-used-before');
    expect(result.error).toContain('different request');
  });

  it('rejects key reused for update with different fields (via RPC error)', async () => {
    const { db } = mockDb({ error: 'Idempotency key already used for a different request', employee: null });
    const result = await updateEmployee(db, 'emp-1', { fullName: 'Changed Name' }, 'UADMIN1', 'key-used-for-different-update');
    expect(result.error).toContain('different request');
  });

  it('rejects key reused for deactivation of different employee (via RPC error)', async () => {
    const { db } = mockDb({ error: 'Idempotency key already used for a different request', success: false });
    const result = await deactivateEmployee(db, 'emp-other', 'UADMIN1', 'key-used-for-emp-1');
    expect(result.error).toContain('different request');
  });
});

describe('computeRequestFingerprint', () => {
  // --- Determinism ---
  it('identical inputs produce identical fingerprint', () => {
    const a = computeRequestFingerprint('create', null, { name: 'Alice', state: 'WA' });
    const b = computeRequestFingerprint('create', null, { name: 'Alice', state: 'WA' });
    expect(a).toBe(b);
  });

  it('same output regardless of property insertion order', () => {
    const a = computeRequestFingerprint('create', null, { z_field: 'last', a_field: 'first' });
    const b = computeRequestFingerprint('create', null, { a_field: 'first', z_field: 'last' });
    expect(a).toBe(b);
  });

  // --- Different requests → different fingerprints ---
  it('different field values → different fingerprint', () => {
    const a = computeRequestFingerprint('create', null, { name: 'Alice' });
    const b = computeRequestFingerprint('create', null, { name: 'Bob' });
    expect(a).not.toBe(b);
  });

  it('different actions → different fingerprint', () => {
    const a = computeRequestFingerprint('create', null, { name: 'Alice' });
    const b = computeRequestFingerprint('update', null, { name: 'Alice' });
    expect(a).not.toBe(b);
  });

  it('different targets → different fingerprint', () => {
    const a = computeRequestFingerprint('update', 'emp-1', { name: 'Alice' });
    const b = computeRequestFingerprint('update', 'emp-2', { name: 'Alice' });
    expect(a).not.toBe(b);
  });

  it('same key, changed field value → different fingerprint', () => {
    const before = computeRequestFingerprint('update', 'emp-1', { full_name: 'Jane Doe' });
    const after = computeRequestFingerprint('update', 'emp-1', { full_name: 'Jane Smith' });
    expect(before).not.toBe(after);
  });

  // --- Null vs empty string vs undefined ---
  it('null vs empty string → different fingerprint', () => {
    const withNull = computeRequestFingerprint('create', null, { name: null });
    const withEmpty = computeRequestFingerprint('create', null, { name: '' });
    expect(withNull).not.toBe(withEmpty);
  });

  it('null vs undefined → different fingerprint', () => {
    const withNull = computeRequestFingerprint('create', null, { name: null });
    const withUndef = computeRequestFingerprint('create', null, { name: undefined });
    expect(withNull).not.toBe(withUndef);
  });

  it('undefined vs absent key → different fingerprint', () => {
    const withUndef = computeRequestFingerprint('create', null, { name: undefined });
    const withAbsent = computeRequestFingerprint('create', null, {});
    expect(withUndef).not.toBe(withAbsent);
  });

  it('null and undefined are each self-consistent', () => {
    const a = computeRequestFingerprint('create', null, { x: null, y: undefined });
    const b = computeRequestFingerprint('create', null, { x: null, y: undefined });
    expect(a).toBe(b);
  });

  // --- Delimiter collision resistance ---
  it('values containing & = | do not cause collisions', () => {
    const a = computeRequestFingerprint('create', null, { name: 'a&b=c|d' });
    const b = computeRequestFingerprint('create', null, { name: 'a&b', extra: 'c|d' });
    expect(a).not.toBe(b);
  });

  it('key/value boundary is unambiguous', () => {
    // These could collide with naive key=value&key=value serialization
    const a = computeRequestFingerprint('create', null, { 'a=b': 'c' });
    const b = computeRequestFingerprint('create', null, { a: 'b=c' });
    expect(a).not.toBe(b);
  });

  // --- Unicode ---
  it('preserves Unicode characters', () => {
    const a = computeRequestFingerprint('create', null, { name: 'Ren\u00e9' });
    const b = computeRequestFingerprint('create', null, { name: 'Ren\u00e9' });
    expect(a).toBe(b);
    // Different Unicode → different fingerprint
    const c = computeRequestFingerprint('create', null, { name: 'Ren\u00e8' });
    expect(a).not.toBe(c);
  });

  // --- Format ---
  it('returns a 64-character hex string (SHA-256)', () => {
    const fp = computeRequestFingerprint('test', null, {});
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================
// Update — via transactional RPC
// ============================================================

describe('updateEmployee (RPC-based)', () => {
  it('calls hr_update_employee RPC', async () => {
    const { db, rpcSpy } = mockDb({
      error: null,
      employee: { id: 'emp-1', full_name: 'Updated', employment_status: 'active', is_synthetic: true, created_at: '2026-01-01', updated_at: '2026-01-02' },
    });
    const result = await updateEmployee(db, 'emp-1', { fullName: 'Updated' }, 'UADMIN1', 'upd-1');
    expect(result.employee?.fullName).toBe('Updated');
    expect(rpcSpy).toHaveBeenCalledWith('hr_update_employee', expect.objectContaining({
      p_actor_id: 'UADMIN1',
      p_employee_id: 'emp-1',
    }));
  });

  it('returns authorization error for unauthorized actor', async () => {
    const { db } = mockDb({ error: 'Not authorized', employee: null });
    const result = await updateEmployee(db, 'emp-1', { fullName: 'Hacked' }, 'UUNAUTHORIZED');
    expect(result.error).toBe('Not authorized');
  });

  it('returns error for non-synthetic employee', async () => {
    const { db } = mockDb({ error: 'Employee not found or not synthetic', employee: null });
    const result = await updateEmployee(db, 'emp-prod', { fullName: 'Change' }, 'UADMIN1');
    expect(result.error).toContain('not synthetic');
  });
});

// ============================================================
// Deactivate — via transactional RPC
// ============================================================

describe('deactivateEmployee (RPC-based)', () => {
  it('calls hr_deactivate_employee RPC', async () => {
    const { db, rpcSpy } = mockDb({ error: null, success: true });
    const result = await deactivateEmployee(db, 'emp-1', 'UADMIN1', 'deact-1');
    expect(result.success).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('hr_deactivate_employee', expect.objectContaining({
      p_actor_id: 'UADMIN1',
      p_employee_id: 'emp-1',
    }));
  });

  it('returns authorization error for unauthorized actor', async () => {
    const { db } = mockDb({ error: 'Not authorized', success: false });
    const result = await deactivateEmployee(db, 'emp-1', 'UUNAUTHORIZED');
    expect(result.error).toBe('Not authorized');
    expect(result.success).toBe(false);
  });

  it('idempotent: RPC returns success for duplicate key', async () => {
    const { db } = mockDb({ error: null, success: true });
    const result = await deactivateEmployee(db, 'emp-1', 'UADMIN1', 'idemp-deact');
    expect(result.success).toBe(true);
  });
});

// ============================================================
// Direct repository call authorization
// ============================================================

describe('Direct repository call authorization', () => {
  it('unauthorized actor cannot create via RPC', async () => {
    const { db } = mockDb({ error: 'Not authorized', employee: null });
    const result = await createEmployee(db, { fullName: 'Exploit', employmentStatus: 'active' }, 'UATTACKER');
    expect(result.error).toBe('Not authorized');
  });

  it('unauthorized actor cannot update via RPC', async () => {
    const { db } = mockDb({ error: 'Not authorized', employee: null });
    const result = await updateEmployee(db, 'emp-1', { fullName: 'Exploit' }, 'UATTACKER');
    expect(result.error).toBe('Not authorized');
  });

  it('unauthorized actor cannot deactivate via RPC', async () => {
    const { db } = mockDb({ error: 'Not authorized', success: false });
    const result = await deactivateEmployee(db, 'emp-1', 'UATTACKER');
    expect(result.error).toBe('Not authorized');
  });
});
