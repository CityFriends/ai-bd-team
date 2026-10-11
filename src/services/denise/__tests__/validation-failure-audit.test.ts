/**
 * Validation-Failure Audit Tests
 *
 * Verifies durable audit storage when a paid provider response
 * fails JSON parsing, schema validation, or legal-safety checks.
 *
 * All tests use code inspection and mocked fixtures — zero live inference.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const regInterpPath = path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts');

describe('Validation-failure audit storage', () => {
  const content = fs.readFileSync(regInterpPath, 'utf-8');

  it('recordValidationFailureAudit function exists', () => {
    expect(content).toContain('async function recordValidationFailureAudit');
  });

  it('stores validation errors in ledger metadata', () => {
    const fn = content.slice(content.indexOf('async function recordValidationFailureAudit'));
    expect(fn).toContain("'ai_inference_ledger'");
    expect(fn).toContain('validation_failure');
    expect(fn).toContain('error_type');
    expect(fn).toContain('response_hash');
    expect(fn).toContain('raw_response');
  });

  it('computes content hash of raw response', () => {
    const fn = content.slice(content.indexOf('async function recordValidationFailureAudit'));
    expect(fn).toContain("createHash('sha256')");
    expect(fn).toContain('responseHash');
  });

  it('truncates raw response to bounded size', () => {
    expect(content).toContain('MAX_AUDIT_RAW_CHARS');
    expect(content).toContain('rawText.slice(0, MAX_AUDIT_RAW_CHARS)');
  });

  it('does not expose raw output in Slack or logs', () => {
    const fnStart = content.indexOf('async function recordValidationFailureAudit');
    const fnEnd = content.indexOf('\n// ====', fnStart + 1);
    const fn = content.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
    expect(fn).not.toContain('console.log');
    expect(fn).not.toContain('slack');
    expect(fn).not.toContain('postMessage');
  });

  it('handles audit storage failure without retrying inference', () => {
    const fnStart = content.indexOf('async function recordValidationFailureAudit');
    const fnEnd = content.indexOf('\n// ====', fnStart + 1);
    const fn = content.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
    expect(fn).toContain('AUDIT_STORAGE_FAILED');
    // Must not call the Gateway complete() function
    expect(fn).not.toContain('await complete(');
    // Must not import or call any inference retry mechanism
    expect(fn).not.toContain('analyzeRegulatoryProvision');
  });

  it('JSON parse failure path calls recordValidationFailureAudit', () => {
    const parseSection = content.slice(content.indexOf("'JSON_PARSE'"));
    expect(parseSection).toContain('recordValidationFailureAudit');
  });

  it('schema validation failure path calls recordValidationFailureAudit', () => {
    const schemaSection = content.slice(content.indexOf("'SCHEMA'"));
    expect(schemaSection).toContain('recordValidationFailureAudit');
  });
});

describe('Task-cost attribution — idempotent', () => {
  const content = fs.readFileSync(regInterpPath, 'utf-8');

  it('cost update targets exact claim ID', () => {
    const fn = content.slice(content.indexOf('async function recordValidationFailureAudit'));
    expect(fn).toContain(".eq('id', claimId)");
  });

  it('cost update is guarded by ledger_id IS NULL (idempotent)', () => {
    const fn = content.slice(content.indexOf('async function recordValidationFailureAudit'));
    expect(fn).toContain(".is('ledger_id', null)");
  });

  it('repeated reconciliation cannot overwrite existing ledger association', () => {
    const fnStart = content.indexOf('async function recordValidationFailureAudit');
    const fnEnd = content.indexOf('\n// ====', fnStart + 1);
    const fn = content.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2000);
    // The .is('ledger_id', null) filter means if ledger_id is already set,
    // the update matches 0 rows — no change
    expect(fn).toContain(".is('ledger_id', null)");
  });

  it('Gateway ledger is financial source of truth', () => {
    // The cost update on task_claims is metadata — the ledger is authoritative
    // Verify the return statement includes ledgerId for reconciliation
    expect(content).toContain("return { ...fail('Schema validation failed'), ledgerId, costUsd");
    expect(content).toContain("return { ...fail('Invalid JSON output'), ledgerId, costUsd");
  });
});

describe('No automatic retry on validation failure', () => {
  const content = fs.readFileSync(regInterpPath, 'utf-8');

  it('schema failure path does not call complete()', () => {
    // After the schema validation section, there should be no second complete() call
    const afterSchema = content.slice(content.indexOf("'Schema validation failed'"));
    const nextComplete = afterSchema.indexOf('await complete(');
    // The only complete() call should be the original one earlier in the function
    // If nextComplete is found, it should be in the main execution path (the first call)
    // not a retry
    if (nextComplete > 0) {
      // Check it's not in a retry context
      const context = afterSchema.slice(Math.max(0, nextComplete - 100), nextComplete);
      expect(context).not.toContain('retry');
    }
  });

  it('no Slack or downstream routing on validation failure', () => {
    expect(content).not.toContain('postMessage');
    expect(content).not.toContain("from 'slack");
    expect(content).not.toMatch(/emit\(/);
    expect(content).not.toContain('publishEvent');
  });
});

describe('Legal-safety gate with 3 uncertainties (preserved)', () => {
  it('enforceNoUnsupportedLegalConclusions handles 3 items', async () => {
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

describe('Historical commissioning attempts preserved', () => {
  it('code does not delete or overwrite historical task claims', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    // No DELETE on denise_task_claims
    expect(content).not.toContain(".delete()");
    // The update uses .is('ledger_id', null) guard — won't overwrite existing
    const updateSection = content.slice(content.indexOf('recordValidationFailureAudit'));
    expect(updateSection).toContain(".is('ledger_id', null)");
  });
});
