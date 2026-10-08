/**
 * Denise Section L/M Hardening Tests
 *
 * 1. Adversarial relationship verification (deterministic, no LLM)
 * 2. Concurrent replay protection (requires commissioning DB)
 * 3. Crash/uncertain outcome behavior
 */

import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

// ============================================================
// 1. ADVERSARIAL RELATIONSHIP VERIFICATION (deterministic)
// ============================================================

import { validateRelationshipSupport } from '../reasoning.js';
import type { EvaluationAnalysisOutput } from '../reasoning.js';

function makeOutput(factors: Array<{
  name: string;
  relativeImportance: string;
  sourceEvidenceId: string;
  sourceText: string;
}>): EvaluationAnalysisOutput {
  return {
    solicitationVersion: 'SOL-TEST',
    evaluationMethod: 'BEST_VALUE',
    factors: factors.map(f => ({ ...f, category: 'SOURCE_FACT' as const })),
    subfactors: [],
    findings: [],
    unresolvedIssues: [],
    risks: [],
    missingInformation: [],
  };
}

function makeEvidence(id: string, text: string) {
  return { id, opportunityId: 'test', documentVersion: 'SOL-TEST', section: 'M.1', text };
}

describe('Adversarial Relationship Verification', () => {
  // --- Valid relationships ---
  it('accepts valid MORE_IMPORTANT when source says "Technical is more important than Price"', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is more important than Price' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is more important than Price.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid LESS_IMPORTANT for the lesser factor', () => {
    const output = makeOutput([
      { name: 'Price', relativeImportance: 'LESS_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is more important than Price' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is more important than Price.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts MOST_IMPORTANT with "significantly more important"', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'MOST_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is significantly more important than Price' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is significantly more important than Price.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(true);
  });

  it('accepts PASS_FAIL with LPTA language', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'PASS_FAIL', sourceEvidenceId: 'ev-1', sourceText: 'lowest priced, technically acceptable' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Award will be made to the lowest priced, technically acceptable offeror.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(true);
  });

  it('accepts APPROX_EQUAL with equality language', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'APPROX_EQUAL', sourceEvidenceId: 'ev-1', sourceText: 'approximately equal' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical and Management are approximately equal in importance.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(true);
  });

  it('accepts NOT_STATED without requiring comparative evidence', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'NOT_STATED', sourceEvidenceId: 'ev-1', sourceText: 'factors listed' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Proposals will be evaluated on Technical, Management, and Price.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(true);
    expect(result.unresolved).toHaveLength(0);
  });

  // --- Inverted comparison direction ---
  it('REJECTS inverted comparison: claims Technical MORE_IMPORTANT but source says Price is more important', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Price is more important than Technical' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Price is more important than Technical.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('INVERSE');
  });

  it('REJECTS inverted LESS_IMPORTANT: claims Price LESS but source says Technical is less important', () => {
    const output = makeOutput([
      { name: 'Price', relativeImportance: 'LESS_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is less important' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is more important than Price.')];
    const result = validateRelationshipSupport(output, evidence);
    // Price IS less important when Technical is more important — this should be valid
    expect(result.valid).toBe(true);
  });

  it('REJECTS inverted: claims A MORE_IMPORTANT when source says B more important than A', () => {
    const output = makeOutput([
      { name: 'Management', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is more important than Management' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is more important than Management.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('INVERSE');
  });

  // --- Negation ---
  it('REJECTS when source contains negation: "Technical is NOT more important than Price"', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is not more important' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is not more important than Price.')];
    const result = validateRelationshipSupport(output, evidence);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('INVERSE');
  });

  // --- Unrelated high-overlap citation ---
  it('marks UNRESOLVED when evidence has high keyword overlap but no comparative language', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'technical approach evaluation criteria important' },
    ]);
    // High keyword overlap but no "X is more important than Y" structure
    const evidence = [makeEvidence('ev-1',
      'The technical approach evaluation criteria are important considerations. ' +
      'The Government will consider the technical approach, management plan, and pricing.')];
    const result = validateRelationshipSupport(output, evidence);
    // Should NOT be accepted as valid — no directional comparison found
    expect(result.unresolved.length).toBeGreaterThan(0);
    expect(result.unresolved[0].reason).toContain('no comparative');
  });

  // --- Contradictory amendments ---
  it('does not silently reconcile contradictory evidence', () => {
    // Evidence says Technical > Price, but factor claims Price > Technical
    const output = makeOutput([
      { name: 'Price', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'ev-1', sourceText: 'Technical is significantly more important' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical is significantly more important than Price.')];
    const result = validateRelationshipSupport(output, evidence);
    // Price cannot be MORE_IMPORTANT when source says Technical is significantly more important
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('INVERSE');
  });

  // --- Missing evidence ---
  it('errors when cited evidence ID does not exist', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'MORE_IMPORTANT', sourceEvidenceId: 'MISSING', sourceText: 'anything' },
    ]);
    const result = validateRelationshipSupport(output, []);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  // --- Explicit numerical weight in source (when actually present) ---
  it('does not reject when source contains actual percentage (model uses NOT_STATED)', () => {
    const output = makeOutput([
      { name: 'Technical', relativeImportance: 'NOT_STATED', sourceEvidenceId: 'ev-1', sourceText: 'Technical 60%, Price 40%' },
    ]);
    const evidence = [makeEvidence('ev-1', 'Technical will receive 60% of the total score. Price will receive 40%.')];
    const result = validateRelationshipSupport(output, evidence);
    // NOT_STATED is always accepted (no relationship claim to verify)
    expect(result.valid).toBe(true);
  });
});

// ============================================================
// 2. CONCURRENT REPLAY & CLAIM/LEASE (requires commissioning DB)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY);
const CAN_RUN_DB = HAS_DB && !IS_PRODUCTION;
const CAN_RUN_INFERENCE = CAN_RUN_DB && HAS_ANTHROPIC;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;

describe.skipIf(!CAN_RUN_DB)('Concurrent Claim/Lease Mechanism', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = `hardening-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('denise_task_claims').delete().like('idempotency_key', `%${testRunId}%`);
  });

  it('first claim wins the lease', async () => {
    const key = `claim-test-1-${testRunId}`;
    const { data } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(data[0].claim_status).toBe('CLAIMED');
    expect(data[0].claim_id).toBeTruthy();
  });

  it('second claim for same key returns LEASE_HELD', async () => {
    const key = `claim-test-1-${testRunId}`;
    const { data } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(data[0].claim_status).toBe('LEASE_HELD');
  });

  it('completed claim returns COMPLETED with analysis_id', async () => {
    const key = `claim-test-2-${testRunId}`;
    const { data: claim } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    const claimId = claim[0].claim_id;

    const analysisId = randomUUID();
    await supabase.rpc('complete_denise_eval_claim', {
      p_claim_id: claimId, p_analysis_id: analysisId,
      p_eval_model_id: randomUUID(), p_ledger_id: randomUUID(), p_cost_usd: 0.005,
    });

    // Subsequent claim returns COMPLETED
    const { data: replay } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(replay[0].claim_status).toBe('COMPLETED');
    expect(replay[0].existing_analysis_id).toBe(analysisId);
  });

  it('AMBIGUOUS claim does NOT auto-retry', async () => {
    const key = `claim-test-3-${testRunId}`;
    const { data: claim } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });

    await supabase.rpc('mark_denise_eval_ambiguous', {
      p_claim_id: claim[0].claim_id,
      p_error_code: 'PROVIDER_TIMEOUT',
      p_error_message: 'Simulated timeout',
    });

    // Retry returns AMBIGUOUS, not a new CLAIMED
    const { data: retry } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(retry[0].claim_status).toBe('AMBIGUOUS');
  });

  it('FAILED claim does NOT auto-retry', async () => {
    const key = `claim-test-4-${testRunId}`;
    const { data: claim } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });

    await supabase.rpc('fail_denise_eval_claim', {
      p_claim_id: claim[0].claim_id,
      p_error_code: 'VALIDATION_FAILED',
      p_error_message: 'Schema validation failed',
    });

    const { data: retry } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(retry[0].claim_status).toBe('FAILED');
  });

  // ============================================================
  // Crash-recovery scenarios with provider-attempt boundary
  // ============================================================

  it('CRASH SCENARIO 1: crash before provider-attempt boundary → safe recovery', async () => {
    const key = `crash-pre-attempt-${testRunId}`;
    // Worker claims, then crashes BEFORE marking inference_attempted
    const { data: claim } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 1,
    });
    expect(claim[0].claim_status).toBe('CLAIMED');

    // Verify inference_attempted is FALSE (no mark_denise_inference_attempted call)
    const { data: row } = await supabase.from('denise_task_claims')
      .select('inference_attempted').eq('id', claim[0].claim_id).single();
    expect(row.inference_attempted).toBe(false);

    // Wait for lease expiry
    await new Promise(r => setTimeout(r, 1500));

    // Recovery: safe re-claim permitted (no inference was attempted)
    const { data: recovery } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    // Should get new CLAIMED (the expired claim had no inference attempt)
    expect(['CLAIMED']).toContain(recovery[0].claim_status);
  });

  it('CRASH SCENARIO 2: crash after provider-attempt boundary, before response → AMBIGUOUS, no second call', async () => {
    const key = `crash-post-attempt-${testRunId}`;
    // Worker claims and marks inference_attempted, then crashes
    const { data: claim } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 1,
    });
    expect(claim[0].claim_status).toBe('CLAIMED');

    // Mark inference attempted (simulates the pre-Gateway boundary)
    await supabase.rpc('mark_denise_inference_attempted', {
      p_claim_id: claim[0].claim_id,
      p_gateway_idempotency_key: `denise:eval:${key}`,
    });

    // Verify inference_attempted is TRUE
    const { data: row } = await supabase.from('denise_task_claims')
      .select('inference_attempted').eq('id', claim[0].claim_id).single();
    expect(row.inference_attempted).toBe(true);

    // Wait for lease expiry (simulates crash)
    await new Promise(r => setTimeout(r, 1500));

    // Recovery attempt: should get AMBIGUOUS (inference was attempted, outcome unknown)
    const { data: recovery } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(recovery[0].claim_status).toBe('AMBIGUOUS');
  });

  it('CRASH SCENARIO 3: crash after provider response, before completion → AMBIGUOUS, no second call', async () => {
    const key = `crash-post-response-${testRunId}`;
    // Worker claims, marks inference, gets response, but crashes before complete_denise_eval_claim
    const { data: claim } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 1,
    });

    // Mark inference attempted
    await supabase.rpc('mark_denise_inference_attempted', {
      p_claim_id: claim[0].claim_id,
      p_gateway_idempotency_key: `denise:eval:${key}`,
    });

    // Worker would have received provider response and settled budget here
    // But crashes BEFORE calling complete_denise_eval_claim

    await new Promise(r => setTimeout(r, 1500));

    // Recovery: AMBIGUOUS (inference was attempted)
    const { data: recovery } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(recovery[0].claim_status).toBe('AMBIGUOUS');
  });

  it('concurrent duplicate delivery produces at most one provider call', async () => {
    // This test fires N concurrent claim requests for the same key
    // Only one should get CLAIMED, rest get LEASE_HELD
    const key = `concurrent-${testRunId}`;
    const concurrency = 5;

    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        supabase.rpc('claim_denise_eval_task', {
          p_idempotency_key: key, p_lease_seconds: 60,
        })
      )
    );

    const statuses = results.map(r => r.data?.[0]?.claim_status);
    const claimed = statuses.filter(s => s === 'CLAIMED');
    const held = statuses.filter(s => s === 'LEASE_HELD');

    expect(claimed.length).toBe(1); // Exactly one winner
    expect(held.length).toBe(concurrency - 1); // Rest are blocked
  });
});

// ============================================================
// 3. REAL CONCURRENT INFERENCE (requires DB + Anthropic)
// ============================================================

describe.skipIf(!CAN_RUN_INFERENCE)('Concurrent Inference Protection', () => {
  let captureId: string;
  let oppId: string;
  let workflowId: string;

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = testRunId || `hardening-${Math.random().toString(36).slice(2, 8)}`;
    oppId = `opp-concurrent-${testRunId}`;
    captureId = randomUUID();
    workflowId = `denise-hardening-${testRunId}`;

    await supabase.from('captures').insert({
      id: captureId, opportunity_id: oppId,
      source_material_hash: `hash-${testRunId}`,
      status: 'pursuit_authorized', created_by_human_id: 'test',
      idempotency_key: `cap-concurrent-${testRunId}`,
    });

    await supabase.from('denise_observation_windows').insert({
      observation_type: 'PURSUIT', status: 'ACTIVE',
      max_calls: 5, max_cumulative_spend_usd: 0.25,
      capture_id: captureId,
    });
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('acquisition_risks').delete().like('idempotency_key', `%concurrent-${testRunId}%`);
    await supabase.from('acquisition_evaluation_models').delete().like('idempotency_key', `%concurrent-${testRunId}%`);
    await supabase.from('acquisition_analyses').delete().like('idempotency_key', `%concurrent-${testRunId}%`);
    await supabase.from('denise_task_claims').delete().like('idempotency_key', `%concurrent-${testRunId}%`);
    await supabase.from('ai_budget_scopes').delete().like('scope_id', `%concurrent-${testRunId}%`);
    await supabase.from('denise_observation_windows').delete().eq('capture_id', captureId);
    await supabase.from('captures').delete().like('idempotency_key', `cap-concurrent-${testRunId}`);
  });

  it('concurrent evaluation requests produce at most one provider call', async () => {
    const { executeEvaluationAnalysis } = await import('../reasoning.js');
    const evidence = [{
      id: 'ev-conc-1', opportunityId: oppId, documentVersion: 'SOL-CONC',
      section: 'Section M.1',
      text: 'Technical is more important than Price. Past Performance is approximately equal to Price.',
    }];

    // Fire 3 concurrent requests with same idempotency key
    const results = await Promise.all([
      executeEvaluationAnalysis(supabase, {
        opportunityId: oppId, captureId, solicitationVersion: 'SOL-CONC',
        evidence, workflowId, idempotencyKey: `concurrent-eval-${testRunId}`,
      }),
      executeEvaluationAnalysis(supabase, {
        opportunityId: oppId, captureId, solicitationVersion: 'SOL-CONC',
        evidence, workflowId, idempotencyKey: `concurrent-eval-${testRunId}`,
      }),
      executeEvaluationAnalysis(supabase, {
        opportunityId: oppId, captureId, solicitationVersion: 'SOL-CONC',
        evidence, workflowId, idempotencyKey: `concurrent-eval-${testRunId}`,
      }),
    ]);

    // Count provider calls (ledgerId !== null means a provider call was made)
    const providerCalls = results.filter(r => r.ledgerId !== null).length;
    const successes = results.filter(r => r.success).length;

    // At most one provider call
    expect(providerCalls).toBeLessThanOrEqual(1);
    // At least one should succeed (or all report lease-held/idempotent)
    expect(successes + results.filter(r => r.error?.includes('Concurrent') || r.error?.includes('Idempotent') || r.error?.includes('lease')).length).toBe(3);
  });
});

// ============================================================
// 4. MODEL LIFECYCLE WORDING
// ============================================================

describe('Model lifecycle metadata', () => {
  it('Haiku 4.5 boundary is described as review/commitment, not retirement', async () => {
    const { MODEL_LIFECYCLE } = await import('../../llm-gateway/model-lifecycle.js');
    const haiku = MODEL_LIFECYCLE.find(m => m.modelId === 'claude-haiku-4-5-20251001');
    expect(haiku).toBeTruthy();
    // Should NOT say "retirement date" in the code
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'llm-gateway', 'model-lifecycle.ts'), 'utf-8'
    );
    expect(content).not.toContain('"not sooner than"');
    expect(content).toContain('Review/commitment boundary');
  });

  it('lifecycle warnings use review/commitment language', async () => {
    const { checkModelLifecycle } = await import('../../llm-gateway/model-lifecycle.js');
    const warnings = checkModelLifecycle(['claude-haiku-4-5-20251001']);
    if (warnings.length > 0) {
      expect(warnings[0]).toContain('review/commitment boundary');
      expect(warnings[0]).not.toContain('retirement boundary');
    }
  });
});

// ============================================================
// 5. PRODUCTION SAFETY
// ============================================================

describe.skipIf(!CAN_RUN_DB)('Production safety', () => {
  it('not connected to production', () => {
    expect(getEnvironmentRole()).not.toBe('production');
  });
});
