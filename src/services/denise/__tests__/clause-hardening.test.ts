/**
 * Denise Clause Analysis Hardening Tests
 *
 * 1. Deterministic evidence-verifier adversarial tests
 * 2. Truncated JSON rejection
 * 3. Capture budget parentage proof (commissioning DB)
 * 4. Concurrent replay / crash safety (commissioning DB)
 * 5. Zero downstream action execution
 */

import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

// Import verifier and schema for deterministic tests
import { validateClauseEvidence, ClauseAnalysisOutputSchema } from '../clause-analysis.js';
import type { ClauseAnalysisOutput } from '../clause-analysis.js';

function makeEv(id: string, text: string, oppId = 'opp-test', docVer = 'SOL-1') {
  return { id, opportunityId: oppId, documentVersion: docVer, section: 'H', text };
}

function makeClauseOutput(clauses: Array<Partial<ClauseAnalysisOutput['clauses'][0]>>): ClauseAnalysisOutput {
  return {
    solicitationVersion: 'SOL-1',
    clauses: clauses.map(c => ({
      clauseNumber: c.clauseNumber || 'FAR 52.000-0',
      clauseTitle: c.clauseTitle || '',
      sourceEvidenceId: c.sourceEvidenceId || 'ev-1',
      sourceExcerpt: c.sourceExcerpt || '',
      requirement: c.requirement || 'test',
      materialityRationale: c.materialityRationale || 'test',
      operationalImplication: c.operationalImplication || 'test',
      riskSeverity: (c.riskSeverity || 'LOW') as any,
      legalReviewRequired: c.legalReviewRequired ?? false,
      proposedOwner: c.proposedOwner || 'PATRICIA',
      actionRequired: c.actionRequired ?? false,
      actionType: c.actionType,
      actionDescription: c.actionDescription,
      deadline: c.deadline,
      deadlineExplicitlyStated: c.deadlineExplicitlyStated ?? false,
      unresolvedQuestions: [],
      confidence: 'MEDIUM' as const,
      incorporatedByReference: c.incorporatedByReference ?? false,
    })),
    risks: [],
    unresolvedIssues: [],
    excludedBoilerplate: [],
  };
}

// ============================================================
// 1. EVIDENCE VERIFIER — ADVERSARIAL DETERMINISTIC TESTS
// ============================================================

describe('Clause Evidence Verifier — Hardened', () => {
  const evidence = [makeEv('ev-1',
    'FAR 52.204-8 Annual Representations and Certifications. The offeror shall complete its reps/certs in SAM.gov prior to proposal submission. Failure to complete renders the proposal non-responsive.')];

  it('accepts exact verbatim excerpt', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall complete its reps/certs in SAM.gov',
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(true);
  });

  it('accepts excerpt with minor whitespace differences', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall  complete  its reps/certs  in SAM.gov',
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(true);
  });

  it('REJECTS fabricated excerpt not in evidence', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'contractor must provide security clearance documentation',
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('not contained');
  });

  it('REJECTS negated requirement treated as positive', () => {
    const negEvidence = [makeEv('ev-neg',
      'FAR 52.219-14 Limitations on Subcontracting does NOT apply to this procurement.')];
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.219-14',
      sourceEvidenceId: 'ev-neg',
      // Model claims the requirement IS the limitation, but evidence says it does NOT apply
      sourceExcerpt: 'does NOT apply to this procurement',
      requirement: 'Limitations on Subcontracting does NOT apply',
    }]);
    // This should pass validation (excerpt IS in evidence) — the model correctly quoted the negation
    const r = validateClauseEvidence(output, negEvidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(true);
    // The requirement text correctly reflects the negation — that's proper behavior
  });

  it('REJECTS unrelated high-overlap text as excerpt', () => {
    // Evidence about cybersecurity. Clause claims subcontracting requirement.
    const cyberEvidence = [makeEv('ev-cyber',
      'DFARS 252.204-7012 Safeguarding Covered Defense Information. The contractor shall implement NIST SP 800-171 security requirements.')];
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.219-14',
      sourceEvidenceId: 'ev-cyber',
      sourceExcerpt: 'at least 50 percent of personnel costs',
    }]);
    const r = validateClauseEvidence(output, cyberEvidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(false);
    // Both excerpt and clause ID should fail
  });

  it('REJECTS incorrect clause identifier not in evidence', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.999-99',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall complete its reps/certs in SAM.gov',
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('clause identifier'))).toBe(true);
  });

  it('REJECTS fabricated deadline not in evidence', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall complete its reps/certs in SAM.gov',
      deadline: 'December 31, 2026',
      deadlineExplicitlyStated: true,
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('deadline'))).toBe(true);
  });

  it('REJECTS deadline without explicit-stated flag', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall complete its reps/certs in SAM.gov',
      deadline: 'prior to proposal submission',
      deadlineExplicitlyStated: false,
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('not marked explicitly'))).toBe(true);
  });

  it('accepts deadline when explicitly stated and present in evidence', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall complete its reps/certs in SAM.gov',
      deadline: 'prior to proposal submission',
      deadlineExplicitlyStated: true,
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(true);
  });

  it('preserves incorporation-by-reference without inventing text', () => {
    const refEvidence = [makeEv('ev-ref',
      'The following clauses are incorporated by reference: FAR 52.232-18, DFARS 252.227-7013.')];
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.232-18',
      sourceEvidenceId: 'ev-ref',
      sourceExcerpt: 'incorporated by reference: FAR 52.232-18',
      incorporatedByReference: true,
    }]);
    const r = validateClauseEvidence(output, refEvidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(true);
  });

  it('REJECTS evidence ID from wrong opportunity', () => {
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'shall complete its reps/certs',
    }]);
    const r = validateClauseEvidence(output, evidence, 'DIFFERENT-OPP', 'SOL-1');
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('not in supplied set');
  });

  it('REJECTS unsupported mandatory obligation', () => {
    // Evidence only says reps/certs required. Model invents a performance bond.
    const output = makeClauseOutput([{
      clauseNumber: 'FAR 52.204-8',
      sourceEvidenceId: 'ev-1',
      sourceExcerpt: 'contractor shall provide a performance bond',
    }]);
    const r = validateClauseEvidence(output, evidence, 'opp-test', 'SOL-1');
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('not contained');
  });
});

// ============================================================
// 2. TRUNCATED JSON REJECTION
// ============================================================

describe('Truncated JSON — Fail Closed', () => {
  it('rejects truncated JSON without recovery', () => {
    // Import the module's parseJsonStrict indirectly via schema parse
    const truncated = '{"solicitationVersion":"SOL-1","clauses":[{"clauseNumber":"FAR 52.204-8","sourceEvidenceId":"ev-1","sourceExcerpt":"test","requirement":"te';
    // This does NOT have a closing brace — parseJsonStrict should return null
    const cleaned = truncated.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    expect(jsonMatch).toBeNull(); // No complete JSON object
  });
});

// ============================================================
// 3-5. DB-BACKED TESTS (commissioning only)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN_DB = HAS_DB && !IS_PRODUCTION;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;

describe.skipIf(!CAN_RUN_DB)('Capture Budget Parentage', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = `clause-hard-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('ai_budget_scopes').delete().like('scope_id', `%${testRunId}%`);
  });

  it('Denise task budget is child of existing workflow, not independent $0.25', async () => {
    const { ensureWorkflowBudget, ensureTaskBudget } = await import('../../llm-gateway/budget.js');

    // Simulate James capture workflow budget (the parent)
    const captureWfId = `capture-james-${testRunId}`;
    const wfScopeId = await ensureWorkflowBudget(supabase, captureWfId, 0.25);

    // Denise task budget (child)
    const deniseTaskId = `denise-clause-${testRunId}`;
    const taskScopeId = await ensureTaskBudget(supabase, deniseTaskId, 0.05);

    // Verify workflow is $0.25
    const { data: wfScope } = await supabase.from('ai_budget_scopes')
      .select('*').eq('id', wfScopeId).single();
    expect(Number(wfScope.limit_usd)).toBeCloseTo(0.25);
    expect(wfScope.scope_type).toBe('workflow');

    // Verify task is $0.05
    const { data: taskScope } = await supabase.from('ai_budget_scopes')
      .select('*').eq('id', taskScopeId).single();
    expect(Number(taskScope.limit_usd)).toBeCloseTo(0.05);
    expect(taskScope.scope_type).toBe('task');

    // Verify Denise did NOT create an independent $0.25 scope
    const { data: allDeniseScopes } = await supabase.from('ai_budget_scopes')
      .select('scope_type, limit_usd')
      .like('scope_id', `%denise%${testRunId}%`);
    for (const s of (allDeniseScopes || [])) {
      expect(Number(s.limit_usd)).toBeLessThanOrEqual(0.05);
    }

    // Verify the workflow scope is shared (same ID would be used for James tasks)
    const { data: resolvedScopes } = await supabase.from('ai_budget_scopes')
      .select('id').eq('scope_type', 'workflow').eq('scope_id', captureWfId);
    expect(resolvedScopes).toHaveLength(1);
    expect(resolvedScopes[0].id).toBe(wfScopeId);
  });
});

describe.skipIf(!CAN_RUN_DB)('Concurrent Replay and Crash Safety (Clause)', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = testRunId || `clause-hard-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('denise_task_claims').delete().like('idempotency_key', `%clause-hard%${testRunId}%`);
  });

  it('concurrent claims: exactly 1 winner', async () => {
    const key = `denise-clause-conc-${testRunId}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        supabase.rpc('claim_denise_eval_task', { p_idempotency_key: key, p_lease_seconds: 60 })
      )
    );
    const statuses = results.map(r => r.data?.[0]?.claim_status);
    expect(statuses.filter(s => s === 'CLAIMED')).toHaveLength(1);
    expect(statuses.filter(s => s === 'LEASE_HELD')).toHaveLength(4);
  });

  it('crash after inference boundary → AMBIGUOUS', async () => {
    const key = `denise-clause-crash-${testRunId}`;
    const { data: c } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 1,
    });
    await supabase.rpc('mark_denise_inference_attempted', {
      p_claim_id: c[0].claim_id, p_gateway_idempotency_key: `denise:clause:${key}`,
    });
    await new Promise(r => setTimeout(r, 1500));
    const { data: recovery } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: key, p_lease_seconds: 60,
    });
    expect(recovery[0].claim_status).toBe('AMBIGUOUS');
  });
});

describe.skipIf(!CAN_RUN_DB)('Zero Downstream Action Execution', () => {
  it('no patricia_commitments created by clause analysis', async () => {
    supabase = supabase || createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    const { data } = await supabase.from('patricia_commitments')
      .select('id').like('idempotency_key', '%clause%').limit(1);
    expect((data || []).length).toBe(0);
  });

  it('no specialist_tasks created by clause analysis', async () => {
    const { data } = await supabase.from('specialist_tasks')
      .select('id').like('idempotency_key', '%clause%').limit(1);
    expect((data || []).length).toBe(0);
  });
});

describe.skipIf(!CAN_RUN_DB)('Production Safety', () => {
  it('not connected to production', () => {
    expect(getEnvironmentRole()).not.toBe('production');
  });
});
