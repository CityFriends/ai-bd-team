/**
 * Validation-Failure Audit and Reconciliation Tests
 *
 * Verifies durable audit storage, retention policy, task-cost reconciliation,
 * conflict detection, and financial integrity preservation.
 *
 * All tests use code inspection and synthetic fixtures — zero live inference.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const regInterpPath = path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts');
const content = fs.readFileSync(regInterpPath, 'utf-8');

// Helper to extract the audit function body
function getAuditFn(): string {
  const start = content.indexOf('async function recordValidationFailureAudit');
  const end = content.indexOf('\n// ====', start + 1);
  return content.slice(start, end > start ? end : start + 4000);
}

// ============================================================
// Audit storage
// ============================================================
describe('Audit storage', () => {
  it('stores validation errors in ledger metadata', () => {
    const fn = getAuditFn();
    expect(fn).toContain("'ai_inference_ledger'");
    expect(fn).toContain('validation_failure');
    expect(fn).toContain('error_type');
    expect(fn).toContain('response_hash');
  });

  it('computes SHA-256 content hash', () => {
    const fn = getAuditFn();
    expect(fn).toContain("createHash('sha256')");
  });

  it('truncates raw response to bounded size', () => {
    expect(content).toContain('MAX_AUDIT_RAW_CHARS');
    const fn = getAuditFn();
    expect(fn).toContain('rawText.slice(0, MAX_AUDIT_RAW_CHARS)');
  });

  it('does not expose raw output in Slack or logs', () => {
    const fn = getAuditFn();
    expect(fn).not.toContain('console.log');
    expect(fn).not.toContain('slack');
    expect(fn).not.toContain('postMessage');
  });

  it('JSON and schema failure paths call recordValidationFailureAudit', () => {
    expect(content).toMatch(/JSON_PARSE.*recordValidationFailureAudit/s);
    expect(content).toMatch(/SCHEMA.*recordValidationFailureAudit/s);
  });
});

// ============================================================
// Retention policy
// ============================================================
describe('Raw-response retention policy', () => {
  it('defines AUDIT_RETENTION_DAYS constant', () => {
    expect(content).toContain('AUDIT_RETENTION_DAYS');
  });

  it('retention is 30 days', async () => {
    const { AUDIT_RETENTION_DAYS } = await import('../regulatory-interpretation.js');
    expect(AUDIT_RETENTION_DAYS).toBe(30);
  });

  it('stores expires_at in audit metadata', () => {
    const fn = getAuditFn();
    expect(fn).toContain('expires_at');
    expect(fn).toContain('expiresAt');
  });

  it('separates temporary (raw_response) from permanent (hash, errors) fields', () => {
    const fn = getAuditFn();
    // Both raw_response and response_hash are stored
    expect(fn).toContain('raw_response');
    expect(fn).toContain('response_hash');
    // expires_at signals which content is temporary
    expect(fn).toContain('expires_at: expiresAt');
  });

  it('documents expiration removes raw content but preserves financial records', () => {
    // The doc comment or constant explains retention
    const retentionSection = content.slice(
      content.indexOf('Raw-response retention policy'),
      content.indexOf('async function recordValidationFailureAudit')
    );
    expect(retentionSection).toContain('raw_response is cleared');
    expect(retentionSection).toContain('preserved permanently');
  });
});

// ============================================================
// Task-cost reconciliation
// ============================================================
describe('Task-cost reconciliation', () => {
  it('updates claim with ledger_id and cost_usd', () => {
    const fn = getAuditFn();
    expect(fn).toContain('ledger_id: ledgerId');
    expect(fn).toContain('cost_usd: costUsd');
  });

  it('idempotent guard: only updates if ledger_id IS NULL', () => {
    const fn = getAuditFn();
    expect(fn).toContain(".is('ledger_id', null)");
  });

  it('performs verified read-back after update', () => {
    const fn = getAuditFn();
    // Read-back query
    expect(fn).toContain("select('id, ledger_id, cost_usd')");
    expect(fn).toContain('.single()');
  });

  it('verifies claim exists on read-back', () => {
    const fn = getAuditFn();
    expect(fn).toContain('Task claim not found on read-back');
  });

  it('verifies ledger_id matches intended Gateway ledger', () => {
    const fn = getAuditFn();
    expect(fn).toContain('claim.ledger_id === ledgerId');
  });

  it('detects conflicting ledger association (fail closed)', () => {
    const fn = getAuditFn();
    expect(fn).toContain('conflictDetected');
    expect(fn).toContain('Conflicting ledger association');
    // Must NOT overwrite on conflict
    expect(fn).toContain('claim.ledger_id !== null && claim.ledger_id !== ledgerId');
  });

  it('distinguishes already-correct from conflicting', () => {
    const fn = getAuditFn();
    // Already correct: claim.ledger_id === ledgerId → costAssociated = true
    expect(fn).toContain('costAssociated = true');
    // Conflicting: different ledger_id → conflictDetected = true
    expect(fn).toContain('conflictDetected = true');
  });

  it('reports database errors explicitly', () => {
    const fn = getAuditFn();
    expect(fn).toContain('readErr');
    expect(fn).toContain('did not persist');
  });
});

// ============================================================
// Financial integrity on audit failure
// ============================================================
describe('Financial integrity on audit failure', () => {
  it('audit failure records AUDIT_STORAGE_FAILED without modifying settled status', () => {
    const fn = getAuditFn();
    expect(fn).toContain('AUDIT_STORAGE_FAILED');
    // The update targets error_code/error_message, NOT status or actual_cost_usd
    const failSection = fn.slice(fn.indexOf('AUDIT_STORAGE_FAILED'));
    expect(failSection).toContain('error_code');
    expect(failSection).not.toContain("status:");
    expect(failSection).not.toContain('actual_cost_usd');
  });

  it('returns structured AuditResult', async () => {
    const mod = await import('../regulatory-interpretation.js');
    // AuditResult interface should be exported
    expect(content).toContain('export interface AuditResult');
    expect(content).toContain('auditStored: boolean');
    expect(content).toContain('costAssociated: boolean');
    expect(content).toContain('conflictDetected: boolean');
  });

  it('never calls complete() or retries inference', () => {
    const fn = getAuditFn();
    expect(fn).not.toContain('await complete(');
    expect(fn).not.toContain('analyzeRegulatoryProvision');
  });

  it('no Slack or autonomous routing in audit function', () => {
    const fn = getAuditFn();
    expect(fn).not.toContain('postMessage');
    expect(fn).not.toMatch(/emit\(/);
    expect(fn).not.toContain('publishEvent');
  });
});

// ============================================================
// Legal-safety gate (preserved from prior tests)
// ============================================================
describe('Legal-safety gate with 3 uncertainties', () => {
  it('processes 3 uncertainties without downgrade', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');
    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'Test' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'Test' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Test' }],
      uncertainties: [
        { category: 'UNCERTAINTY' as const, statement: 'U1' },
        { category: 'UNCERTAINTY' as const, statement: 'U2' },
        { category: 'UNCERTAINTY' as const, statement: 'U3' },
      ],
      legalReviewRequired: false,
      confidence: 'HIGH' as const,
    };
    const result = enforceNoUnsupportedLegalConclusions(output);
    expect(output.uncertainties).toHaveLength(3);
    expect(result.downgrades).toHaveLength(0);
  });
});

// ============================================================
// Historical preservation
// ============================================================
describe('Historical commissioning record preservation', () => {
  it('audit function does not delete records', () => {
    const fn = getAuditFn();
    expect(fn).not.toContain('.delete(');
  });

  it('no modification of Gateway ledger settled status or cost', () => {
    const fn = getAuditFn();
    // Must not update status to anything other than error metadata
    expect(fn).not.toContain("status: 'settled'");
    expect(fn).not.toContain("status: 'failed'");
    expect(fn).not.toContain('actual_cost_usd');
    expect(fn).not.toContain('reserved_cost_usd');
  });
});
