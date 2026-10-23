/**
 * HR Employee Directory Repository
 *
 * All mutations use transactional PostgreSQL RPC functions that atomically:
 *   1. Verify actor authorization (via hr_bootstrap_admins / hr_user_roles)
 *   2. Check idempotency (return prior result if key already completed)
 *   3. Perform the employee mutation
 *   4. Record the audit event
 *
 * If any step fails, the entire transaction rolls back.
 * An arbitrary actorId cannot authorize a mutation — authorization is
 * checked inside the trusted database function, not the application.
 *
 * M1: Only synthetic records are permitted (enforced by DB CHECK constraint).
 * No hard deletion — deactivation only.
 * No compensation fields in the employee directory.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Types
// ============================================================

export interface Employee {
  id: string;
  slackUserId: string | null;
  email: string | null;
  fullName: string;
  preferredName: string | null;
  employmentStatus: 'active' | 'onboarding' | 'offboarding' | 'inactive' | 'terminated';
  employmentClassification: 'full_time' | 'part_time' | 'contractor' | '1099' | null;
  workState: string | null;
  startDate: string | null;
  endDate: string | null;
  contractAssignment: string | null;
  isSynthetic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeInput {
  slackUserId?: string;
  email?: string;
  fullName: string;
  preferredName?: string;
  employmentStatus: Employee['employmentStatus'];
  employmentClassification?: Employee['employmentClassification'];
  workState?: string;
  startDate?: string;
  contractAssignment?: string;
}

export interface UpdateEmployeeInput {
  fullName?: string;
  preferredName?: string;
  employmentStatus?: Employee['employmentStatus'];
  employmentClassification?: Employee['employmentClassification'];
  workState?: string;
  startDate?: string;
  endDate?: string;
  contractAssignment?: string;
  email?: string;
  slackUserId?: string;
}

const VALID_STATUSES = ['active', 'onboarding', 'offboarding', 'inactive', 'terminated'] as const;
const VALID_CLASSIFICATIONS = ['full_time', 'part_time', 'contractor', '1099'] as const;

// ============================================================
// Validation (application-layer, before RPC)
// ============================================================

export function validateCreateInput(input: CreateEmployeeInput): string | null {
  if (!input.fullName?.trim()) return 'fullName is required.';
  if (!VALID_STATUSES.includes(input.employmentStatus)) {
    return `Invalid employmentStatus: ${input.employmentStatus}`;
  }
  if (input.employmentClassification && !VALID_CLASSIFICATIONS.includes(input.employmentClassification)) {
    return `Invalid employmentClassification: ${input.employmentClassification}`;
  }
  if (input.workState && !/^[A-Z]{2}$/.test(input.workState)) {
    return 'workState must be a 2-letter US state code.';
  }
  return null;
}

export function validateUpdateInput(input: UpdateEmployeeInput): string | null {
  if (input.fullName !== undefined && !input.fullName?.trim()) return 'fullName cannot be empty.';
  if (input.employmentStatus && !VALID_STATUSES.includes(input.employmentStatus)) {
    return `Invalid employmentStatus: ${input.employmentStatus}`;
  }
  if (input.employmentClassification && !VALID_CLASSIFICATIONS.includes(input.employmentClassification)) {
    return `Invalid employmentClassification: ${input.employmentClassification}`;
  }
  if (input.workState && !/^[A-Z]{2}$/.test(input.workState)) {
    return 'workState must be a 2-letter US state code.';
  }
  return null;
}

// ============================================================
// Row → Employee mapping
// ============================================================

function toEmployee(row: Record<string, unknown>): Employee {
  return {
    id: row.id as string,
    slackUserId: (row.slack_user_id ?? null) as string | null,
    email: (row.email ?? null) as string | null,
    fullName: row.full_name as string,
    preferredName: (row.preferred_name ?? null) as string | null,
    employmentStatus: row.employment_status as Employee['employmentStatus'],
    employmentClassification: (row.employment_classification ?? null) as Employee['employmentClassification'],
    workState: (row.work_state ?? null) as string | null,
    startDate: (row.start_date ?? null) as string | null,
    endDate: (row.end_date ?? null) as string | null,
    contractAssignment: (row.contract_assignment ?? null) as string | null,
    isSynthetic: row.is_synthetic as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ============================================================
// Deterministic request fingerprint
// ============================================================

/**
 * Compute a deterministic SHA-256 fingerprint for an RPC request.
 *
 * Canonicalization format:
 *   JSON array: [action, target, [[key, typedValue], ...]]
 *
 *   - Keys sorted alphabetically — deterministic regardless of insertion order
 *   - Only keys present in the fields object are included
 *     (absent keys vs explicitly provided keys are distinguishable)
 *   - Typed values distinguish null, empty string, and undefined:
 *       "hello"   → ["s", "hello"]   (string)
 *       ""        → ["s", ""]        (empty string)
 *       null      → ["n"]            (explicit null / clear field)
 *       undefined → ["u"]            (field present with undefined value)
 *   - JSON.stringify provides unambiguous serialization — no delimiter collisions
 *     with &, =, |, or any Unicode character
 *   - UTF-8 encoding for the SHA-256 input preserves all characters
 *
 * The fingerprint is computed from the same normalized values that are
 * sent to the database RPC (after trim, || null, etc.), ensuring the
 * fingerprint represents the effective mutation request.
 */
export function computeRequestFingerprint(
  action: string,
  target: string | null,
  fields: Record<string, string | null | undefined>
): string {
  const { createHash } = require('crypto') as typeof import('crypto');

  const sortedEntries = Object.keys(fields)
    .sort()
    .map((k): [string, [string, string?]] => {
      const v = fields[k];
      if (v === undefined) return [k, ['u']];
      if (v === null) return [k, ['n']];
      return [k, ['s', v]];
    });

  const canonical = JSON.stringify([action, target, sortedEntries]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ============================================================
// Bootstrap admin registration
// ============================================================

/**
 * Atomically sync the configured admin list to hr_bootstrap_admins.
 * Uses a transactional RPC — inserts missing, removes stale, in one commit.
 * Rejects empty lists to prevent accidental wipe.
 * Called once at startup so the RPC functions can verify authorization.
 */
export async function syncBootstrapAdmins(
  db: SupabaseClient,
  adminSlackIds: string[]
): Promise<{ added: number; removed: number; error: string | null }> {
  if (adminSlackIds.length === 0) {
    return { added: 0, removed: 0, error: 'Cannot sync an empty administrator list' };
  }

  const { data, error } = await db.rpc('hr_sync_bootstrap_admins', {
    p_desired_ids: adminSlackIds,
  });

  if (error) {
    return { added: 0, removed: 0, error: error.message };
  }

  const result = data as { error: string | null; added: number; removed: number };
  return { added: result.added, removed: result.removed, error: result.error };
}

// ============================================================
// Mutations via transactional RPC
// ============================================================

export async function createEmployee(
  db: SupabaseClient,
  input: CreateEmployeeInput,
  actorId: string,
  idempotencyKey?: string
): Promise<{ employee: Employee | null; error: string | null }> {
  const validationErr = validateCreateInput(input);
  if (validationErr) return { employee: null, error: validationErr };

  const fingerprint = computeRequestFingerprint('create_employee', null, {
    full_name: input.fullName.trim(),
    employment_status: input.employmentStatus,
    slack_user_id: input.slackUserId || null,
    email: input.email || null,
    preferred_name: input.preferredName?.trim() || null,
    employment_classification: input.employmentClassification || null,
    work_state: input.workState || null,
    start_date: input.startDate || null,
    contract_assignment: input.contractAssignment || null,
  });

  const { data, error } = await db.rpc('hr_create_employee', {
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey || null,
    p_request_fingerprint: fingerprint,
    p_full_name: input.fullName.trim(),
    p_employment_status: input.employmentStatus,
    p_slack_user_id: input.slackUserId || null,
    p_email: input.email || null,
    p_preferred_name: input.preferredName?.trim() || null,
    p_employment_classification: input.employmentClassification || null,
    p_work_state: input.workState || null,
    p_start_date: input.startDate || null,
    p_contract_assignment: input.contractAssignment || null,
  });

  if (error) return { employee: null, error: error.message };

  const result = data as { error: string | null; employee: Record<string, unknown> | null };
  if (result.error) return { employee: null, error: result.error };
  if (!result.employee) return { employee: null, error: 'No employee returned.' };

  return { employee: toEmployee(result.employee), error: null };
}

// ============================================================
// Reads — authorized directory access
// ============================================================

/**
 * Get full employee record. Requires admin authorization.
 * Use isKnownSlackUser() for identity checks that don't need full records.
 */
export async function getEmployee(
  db: SupabaseClient,
  employeeId: string,
  actorId: string,
  auth: { isAdmin(slackUserId: string): boolean }
): Promise<{ employee: Employee | null; error: string | null }> {
  if (!auth.isAdmin(actorId)) {
    return { employee: null, error: 'Not authorized to access employee directory.' };
  }
  const { data } = await db.from('hr_employees').select('*').eq('id', employeeId).single();
  return { employee: data ? toEmployee(data) : null, error: null };
}

/**
 * Find full employee record by Slack ID. Requires admin authorization.
 * Use isKnownSlackUser() for identity checks that don't need full records.
 */
export async function findEmployeeBySlackId(
  db: SupabaseClient,
  slackUserId: string,
  actorId: string,
  auth: { isAdmin(slackUserId: string): boolean }
): Promise<{ employee: Employee | null; error: string | null }> {
  if (!auth.isAdmin(actorId)) {
    return { employee: null, error: 'Not authorized to access employee directory.' };
  }
  const { data } = await db
    .from('hr_employees')
    .select('*')
    .eq('slack_user_id', slackUserId)
    .single();
  return { employee: data ? toEmployee(data) : null, error: null };
}

/**
 * Minimal identity check: does this Slack user exist in the employee directory?
 * Returns only a boolean — does NOT expose employee records.
 * Used by Slack handlers to verify whether a user contacting the bot is known.
 */
export async function isKnownSlackUser(
  db: SupabaseClient,
  slackUserId: string
): Promise<boolean> {
  const { data } = await db
    .from('hr_employees')
    .select('id')
    .eq('slack_user_id', slackUserId)
    .single();
  return data !== null;
}

export async function updateEmployee(
  db: SupabaseClient,
  employeeId: string,
  input: UpdateEmployeeInput,
  actorId: string,
  idempotencyKey?: string
): Promise<{ employee: Employee | null; error: string | null }> {
  const validationErr = validateUpdateInput(input);
  if (validationErr) return { employee: null, error: validationErr };

  // Build updates JSONB — only include provided fields
  const updates: Record<string, string | null> = {};
  if (input.fullName !== undefined) updates.full_name = input.fullName.trim();
  if (input.preferredName !== undefined) updates.preferred_name = input.preferredName?.trim() || null;
  if (input.employmentStatus !== undefined) updates.employment_status = input.employmentStatus;
  if (input.employmentClassification !== undefined) updates.employment_classification = input.employmentClassification || null;
  if (input.workState !== undefined) updates.work_state = input.workState || null;
  if (input.startDate !== undefined) updates.start_date = input.startDate || null;
  if (input.endDate !== undefined) updates.end_date = input.endDate || null;
  if (input.contractAssignment !== undefined) updates.contract_assignment = input.contractAssignment || null;
  if (input.email !== undefined) updates.email = input.email || null;
  if (input.slackUserId !== undefined) updates.slack_user_id = input.slackUserId || null;

  const fingerprint = computeRequestFingerprint('update_employee', employeeId, updates);

  const { data, error } = await db.rpc('hr_update_employee', {
    p_actor_id: actorId,
    p_employee_id: employeeId,
    p_idempotency_key: idempotencyKey || null,
    p_request_fingerprint: fingerprint,
    p_updates: updates,
  });

  if (error) return { employee: null, error: error.message };

  const result = data as { error: string | null; employee: Record<string, unknown> | null };
  if (result.error) return { employee: null, error: result.error };
  if (!result.employee) return { employee: null, error: 'No employee returned.' };

  return { employee: toEmployee(result.employee), error: null };
}

export async function deactivateEmployee(
  db: SupabaseClient,
  employeeId: string,
  actorId: string,
  idempotencyKey?: string
): Promise<{ success: boolean; error: string | null }> {
  const fingerprint = computeRequestFingerprint('deactivate_employee', employeeId, {});

  const { data, error } = await db.rpc('hr_deactivate_employee', {
    p_actor_id: actorId,
    p_employee_id: employeeId,
    p_idempotency_key: idempotencyKey || null,
    p_request_fingerprint: fingerprint,
  });

  if (error) return { success: false, error: error.message };

  const result = data as { error: string | null; success: boolean };
  if (result.error) return { success: false, error: result.error };
  return { success: result.success, error: null };
}
