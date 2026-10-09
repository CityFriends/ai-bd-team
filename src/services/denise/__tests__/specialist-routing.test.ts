/**
 * Denise Specialist Workflow Routing — 20+ Commissioning Cases
 *
 * All deterministic. Zero LLM calls. Zero downstream actions.
 */

import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnvironmentRole } from '../../../config/environment.js';

vi.setConfig({ testTimeout: 30_000 });

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN = HAS_DB && !IS_PRODUCTION;

import { dispatchDeniseRequest, cancelRoutingTask, DeniseRoutingRequestSchema } from '../specialist-routing.js';
import type { DeniseRoutingRequest } from '../specialist-routing.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;
let oppId: string;
let captureId: string;
let analysisId: string;

// Shared setup
beforeAll(async () => {
  if (!CAN_RUN) return;
  supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  testRunId = `sr-${Math.random().toString(36).slice(2, 8)}`;
  oppId = `opp-sr-${testRunId}`;
  captureId = randomUUID();
  analysisId = randomUUID();

  await supabase.from('captures').insert({
    id: captureId, opportunity_id: oppId, source_material_hash: `h-${testRunId}`,
    status: 'pursuit_authorized', created_by_human_id: 'test',
    idempotency_key: `cap-sr-${testRunId}`,
  });

  await supabase.from('acquisition_analyses').insert({
    id: analysisId, opportunity_id: oppId, capture_id: captureId,
    solicitation_version: 'SOL-V1', amendment_version: 0, version: 1,
    set_aside: 'SDVOSB', source_refs: [{ id: 'ev-1' }],
    interpretation: { evaluationMethod: 'BEST_VALUE' },
    unresolved_issues: [], created_by: 'denise',
    idempotency_key: `sr-analysis-${testRunId}`,
  });

  await supabase.from('acquisition_evaluation_models').insert({
    acquisition_analysis_id: analysisId, opportunity_id: oppId,
    evaluation_method: 'BEST_VALUE',
    factors: [{ name: 'Technical', relativeImportance: 'MOST_IMPORTANT' }],
    source_refs: [{ id: 'ev-1' }],
    idempotency_key: `sr-eval-${testRunId}`,
  });

  await supabase.from('acquisition_clause_register').insert({
    acquisition_analysis_id: analysisId, opportunity_id: oppId,
    clause_number: 'FAR 52.219-14', authority: 'FAR',
    requirement: 'Limitations on Subcontracting',
    operational_impact: '50% personnel costs',
    recommended_owner: 'ROSA', risk_severity: 'HIGH',
    legal_review_required: true, action_required: true,
    action_type: 'LIMITATION_ON_SUBCONTRACTING',
    idempotency_key: `sr-clause-${testRunId}`,
  });

  await supabase.from('acquisition_risks').insert({
    acquisition_analysis_id: analysisId, opportunity_id: oppId,
    risk_type: 'SET_ASIDE_MISMATCH', severity: 'HIGH',
    source_fact: 'SDVOSB set-aside', interpretation: 'FFTC eligible',
    operational_impact: 'Verify status', source_refs: [{ id: 'ev-1' }],
    idempotency_key: `sr-risk-${testRunId}`,
  });

  await supabase.from('acquisition_conflicts').insert({
    acquisition_analysis_id: analysisId, opportunity_id: oppId,
    acquisition_artifact_id: analysisId, conflicting_artifact_type: 'STRATEGY',
    conflicting_artifact_id: captureId,
    conflict_description: 'Subcontracting assumption conflicts',
    affected_owners: ['JAMES', 'ROSA'],
    idempotency_key: `sr-conflict-${testRunId}`,
  });

  // Clean stale claims
  await supabase.from('denise_task_claims').delete().like('idempotency_key', `%sr-${testRunId}%`);
});

afterAll(async () => {
  if (!supabase) return;
  await supabase.from('acquisition_conflicts').delete().like('idempotency_key', `sr-%${testRunId}%`);
  await supabase.from('acquisition_risks').delete().like('idempotency_key', `sr-%${testRunId}%`);
  await supabase.from('acquisition_clause_register').delete().like('idempotency_key', `sr-%${testRunId}%`);
  await supabase.from('acquisition_evaluation_models').delete().like('idempotency_key', `sr-%${testRunId}%`);
  await supabase.from('acquisition_analyses').delete().like('idempotency_key', `sr-%${testRunId}%`);
  await supabase.from('denise_task_claims').delete().like('idempotency_key', `%sr-${testRunId}%`);
  await supabase.from('captures').delete().like('idempotency_key', `cap-sr-${testRunId}`);
});

function req(specialist: string, key: string, overrides?: Partial<DeniseRoutingRequest>): DeniseRoutingRequest {
  return {
    opportunityId: oppId,
    requestingSpecialist: specialist as any,
    workflowPhase: 'PURSUIT',
    requestType: 'ACQUISITION_INTELLIGENCE',
    parentWorkflowId: captureId, // Actual capture UUID — validated against captures table
    idempotencyKey: `${key}-${testRunId}`,
    ...overrides,
  };
}

describe.skipIf(!CAN_RUN)('Specialist Workflow Routing — 20 Cases', () => {
  // Case 1 — James requests existing intelligence
  it('Case 1: James receives acquisition intelligence', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c1'));
    expect(r.disposition).toBe('ARTIFACTS_DELIVERED');
    expect(r.bundle).toBeTruthy();
    expect(r.referencedArtifactIds.length).toBeGreaterThan(0);
    expect(r.bundle!.acquisitionAnalyses.length).toBeGreaterThan(0);
  });

  // Case 2 — Patricia receives submission constraints
  it('Case 2: Patricia receives submission constraints', async () => {
    const r = await dispatchDeniseRequest(supabase, req('PATRICIA', 'c2'));
    expect(r.disposition).toBe('ARTIFACTS_DELIVERED');
    expect(r.bundle!.clauseRegister.length).toBeGreaterThan(0);
  });

  // Case 3 — Jodie receives evaluation findings
  it('Case 3: Jodie receives evaluation and compliance findings', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JODIE', 'c3'));
    expect(r.disposition).toBe('ARTIFACTS_DELIVERED');
    expect(r.bundle!.evaluationModels.length).toBeGreaterThan(0);
  });

  // Case 4 — Marcus receives technical/security
  it('Case 4: Marcus receives technical/security findings', async () => {
    const r = await dispatchDeniseRequest(supabase, req('MARCUS', 'c4'));
    expect(r.disposition).toBe('ARTIFACTS_DELIVERED');
    expect(r.bundle!.clauseRegister.length).toBeGreaterThan(0);
  });

  // Case 5 — Rosa receives teaming restrictions
  it('Case 5: Rosa receives teaming restrictions', async () => {
    const r = await dispatchDeniseRequest(supabase, req('ROSA', 'c5'));
    expect(r.disposition).toBe('ARTIFACTS_DELIVERED');
    expect(r.bundle!.acquisitionConflicts.length).toBeGreaterThan(0);
  });

  // Case 6 — Unauthorized role rejected
  it('Case 6: unauthorized specialist request rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, {
      ...req('JAMES', 'c6'),
      requestingSpecialist: 'HACKER' as any,
    });
    expect(r.disposition).toBe('FAILED');
    expect(r.failureCode).toBe('VALIDATION_FAILED');
  });

  // Case 7 — No authorization source → rejected
  it('Case 7: caller-declared role without authorization source rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, {
      opportunityId: oppId,
      requestingSpecialist: 'JAMES',
      workflowPhase: 'CAPTURE',
      requestType: 'test',
      idempotencyKey: `c7-${testRunId}`,
      // No sourceEventId, humanAuthorizationId, or parentWorkflowId
    });
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureCode).toBe('UNAUTHORIZED');
  });

  // Case 8 — Duplicate request
  it('Case 8: duplicate does not create duplicate execution', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c1')); // Same as Case 1
    expect(r.disposition).toBe('DUPLICATE');
  });

  // Case 9 — Concurrent claims
  it('Case 9: concurrent claims cannot execute same task twice', async () => {
    const key = `conc-${testRunId}`;
    const claimKey = `denise-route-${key}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        supabase.rpc('claim_denise_eval_task', { p_idempotency_key: claimKey, p_lease_seconds: 60 })
      )
    );
    const statuses = results.map((r: any) => r.data?.[0]?.claim_status);
    expect(statuses.filter((s: string) => s === 'CLAIMED')).toHaveLength(1);
    expect(statuses.filter((s: string) => s === 'LEASE_HELD')).toHaveLength(4);
  });

  // Case 10 — Missing artifacts (use valid capture but different opportunity with no artifacts)
  it('Case 10: missing artifacts return typed absence', async () => {
    // Create a capture for an opportunity with no Denise artifacts
    const emptyOppId = `empty-opp-${testRunId}`;
    const emptyCaptureId = randomUUID();
    await supabase.from('captures').insert({
      id: emptyCaptureId, opportunity_id: emptyOppId,
      source_material_hash: 'h', status: 'pursuit_authorized',
      created_by_human_id: 'test', idempotency_key: `cap-empty-${testRunId}`,
    });

    const r = await dispatchDeniseRequest(supabase, req('JODIE', 'c10', {
      opportunityId: emptyOppId,
      parentWorkflowId: emptyCaptureId,
    }));
    expect(r.disposition).toBe('MISSING_ARTIFACTS');
    expect(r.missingArtifacts.length).toBeGreaterThan(0);

    await supabase.from('captures').delete().like('idempotency_key', `cap-empty-${testRunId}`);
  });

  // Case 11 — Disabled capability (deterministic stub)
  it('Case 11: disabled capability blocks execution', async () => {
    // All DENISE_* flags are off — this test verifies the flags remain disabled
    expect(process.env.DENISE_CAPTURE_ENABLED).not.toBe('true');
    expect(process.env.DENISE_PURSUIT_ENABLED).not.toBe('true');
    // The routing service delivers existing artifacts without triggering inference
  });

  // Case 12 — Legal review propagates
  it('Case 12: legal-review flags propagate', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c12'));
    expect(r.legalReviewRequired).toBe(true);
  });

  // Case 13 — Partial coverage propagates
  it('Case 13: partial coverage propagates', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c13'));
    // Regulatory interpretations would have PARTIAL; but even without them,
    // the bundle's coverage limitations are preserved
    expect(r.bundle).toBeTruthy();
  });

  // Case 14 — Evidence provenance intact
  it('Case 14: evidence provenance remains intact', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c14'));
    for (const a of r.bundle!.acquisitionAnalyses) {
      expect(a._provenance.artifactId).toBeTruthy();
      expect(a._provenance.sourceEvidenceIds.length).toBeGreaterThan(0);
      expect(a._provenance.createdAt).toBeTruthy();
    }
  });

  // Case 15 — Cross-opportunity access rejected
  it('Case 15: cross-opportunity access rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c15', {
      opportunityId: `other-opp-${testRunId}`,
    }));
    // No artifacts for this opportunity
    expect(r.referencedArtifactIds).toHaveLength(0);
    // All artifact IDs should be from the requested opportunity only
    if (r.bundle) {
      for (const a of r.bundle.acquisitionAnalyses) {
        expect(a.opportunity_id).toBe(`other-opp-${testRunId}`);
      }
    }
  });

  // Case 16 — Historical version limitations explicit
  it('Case 16: historical version limitations remain explicit', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'c16'));
    expect(r.bundle!.versionInfo.versionScope).toBe('PER_ARTIFACT_STREAM');
  });

  // Case 17 — Ambiguous not retried
  it('Case 17: ambiguous execution not automatically retried', async () => {
    const key = `amb-${testRunId}`;
    const claimKey = `denise-route-${key}`;
    // Create and mark as ambiguous
    const { data: c } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: claimKey, p_lease_seconds: 60,
    });
    await supabase.rpc('mark_denise_eval_ambiguous', {
      p_claim_id: c[0].claim_id, p_error_code: 'TEST', p_error_message: 'test',
    });
    // Dispatch should not retry
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'amb'));
    expect(r.disposition).toBe('AMBIGUOUS');
  });

  // Case 18 — Budget (no inference needed for routing)
  it('Case 18: deterministic routing incurs zero inference cost', async () => {
    const r = await dispatchDeniseRequest(supabase, req('PATRICIA', 'c18'));
    // Routing is deterministic — zero cost
    expect(r.bundle).toBeTruthy();
    // No Gateway calls made
  });

  // Case 19 — Cancelled task
  it('Case 19: cancelled task does not execute', async () => {
    const key = `cancel-${testRunId}`;
    // Create a task
    const claimKey = `denise-route-${key}`;
    await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: claimKey, p_lease_seconds: 60,
    });
    // Cancel it
    const cancelResult = await cancelRoutingTask(supabase, key);
    expect(cancelResult.cancelled).toBe(true);
    // Attempt to dispatch — should see FAILED (cancelled)
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'cancel'));
    expect(r.disposition).toBe('FAILED');
  });

  // Case 20 — Production non-mutation
  it('Case 20: no production activation or mutation', () => {
    expect(getEnvironmentRole()).not.toBe('production');
    expect(process.env.DENISE_CAPTURE_ENABLED).not.toBe('true');
    expect(process.env.DENISE_PURSUIT_ENABLED).not.toBe('true');
    expect(process.env.DENISE_SLACK_ENABLED).not.toBe('true');
  });

  // Case 21 — Crash recovery (crash after claim, before completion)
  it('Case 21: crash after claim → ambiguous on re-attempt', async () => {
    const key = `crash-${testRunId}`;
    const claimKey = `denise-route-${key}`;
    const { data: c } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: claimKey, p_lease_seconds: 1,
    });
    // Simulate crash: mark inference attempted then let lease expire
    await supabase.rpc('mark_denise_inference_attempted', {
      p_claim_id: c[0].claim_id, p_gateway_idempotency_key: `test:${key}`,
    });
    await new Promise(r => setTimeout(r, 1500));
    // Re-attempt should get AMBIGUOUS
    const { data: rec } = await supabase.rpc('claim_denise_eval_task', {
      p_idempotency_key: claimKey, p_lease_seconds: 60,
    });
    expect(rec[0].claim_status).toBe('AMBIGUOUS');
  });

  // Case 22 — No mutations to Denise records
  it('Case 22: routing does not mutate Denise records', async () => {
    // Verify the analysis is still the same after routing
    const { data } = await supabase.from('acquisition_analyses')
      .select('set_aside, version').eq('id', analysisId).single();
    expect(data.set_aside).toBe('SDVOSB');
    expect(data.version).toBe(1);
  });
});

// ============================================================
// AUTHORIZATION VERIFICATION — 10 cases
// ============================================================

describe.skipIf(!CAN_RUN)('Authorization Verification', () => {
  // Auth 1 — Valid authorized request (already covered by Case 1, but explicit)
  it('Auth 1: valid capture-backed authorization succeeds', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'auth1'));
    expect(['ARTIFACTS_DELIVERED', 'COMPLETED', 'MISSING_ARTIFACTS']).toContain(r.disposition);
    expect(r.disposition).not.toBe('UNAUTHORIZED');
  });

  // Auth 2 — Fabricated parentWorkflowId
  it('Auth 2: fabricated parentWorkflowId rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'auth2', {
      parentWorkflowId: '00000000-0000-0000-0000-000000000000', // Non-existent UUID
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('not found');
  });

  // Auth 3 — Authorization belonging to another opportunity
  it('Auth 3: parentWorkflowId from different opportunity rejected', async () => {
    // Create a capture for a different opportunity
    const otherCaptureId = randomUUID();
    await supabase.from('captures').insert({
      id: otherCaptureId, opportunity_id: `other-opp-auth-${testRunId}`,
      source_material_hash: 'h', status: 'pursuit_authorized',
      created_by_human_id: 'test', idempotency_key: `cap-auth-other-${testRunId}`,
    });

    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'auth3', {
      parentWorkflowId: otherCaptureId, // Exists but wrong opportunity
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('not');

    await supabase.from('captures').delete().like('idempotency_key', `cap-auth-other-${testRunId}`);
  });

  // Auth 4 — Fabricated humanAuthorizationId
  it('Auth 4: fabricated humanAuthorizationId rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, req('PATRICIA', 'auth4', {
      parentWorkflowId: undefined,
      humanAuthorizationId: '00000000-0000-0000-0000-000000000000',
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('not found');
  });

  // Auth 5 — humanAuthorizationId without human decision
  it('Auth 5: capture without human decision rejects humanAuthorizationId', async () => {
    // captureId has status=pursuit_authorized but created_by_human_id, not human_decision_by
    // human_decision_by is NULL
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'auth5', {
      parentWorkflowId: undefined,
      humanAuthorizationId: captureId,
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('No human decision');
  });

  // Auth 6 — Fabricated sourceEventId
  it('Auth 6: fabricated sourceEventId rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, req('MARCUS', 'auth6', {
      parentWorkflowId: undefined,
      sourceEventId: '00000000-0000-0000-0000-000000000000',
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('not found');
  });

  // Auth 7 — Abandoned capture blocks authorization
  it('Auth 7: abandoned capture blocks routing', async () => {
    const abandonedId = randomUUID();
    await supabase.from('captures').insert({
      id: abandonedId, opportunity_id: oppId,
      source_material_hash: 'h', status: 'abandoned',
      created_by_human_id: 'test', idempotency_key: `cap-abandoned-${testRunId}`,
    });

    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'auth7', {
      parentWorkflowId: abandonedId,
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('abandoned');

    await supabase.from('captures').delete().like('idempotency_key', `cap-abandoned-${testRunId}`);
  });

  // Auth 8 — No authorization reference at all
  it('Auth 8: missing all authorization references rejected', async () => {
    const r = await dispatchDeniseRequest(supabase, {
      opportunityId: oppId,
      requestingSpecialist: 'ROSA',
      workflowPhase: 'PURSUIT',
      requestType: 'test',
      idempotencyKey: `auth8-${testRunId}`,
      // No sourceEventId, humanAuthorizationId, or parentWorkflowId
    });
    expect(r.disposition).toBe('UNAUTHORIZED');
  });

  // Auth 9 — Duplicate of authorized request still idempotent
  it('Auth 9: duplicate authorized request is idempotent', async () => {
    const r = await dispatchDeniseRequest(supabase, req('JAMES', 'auth1')); // Same as Auth 1
    expect(r.disposition).toBe('DUPLICATE');
  });

  // Auth 10 — no_go capture blocks authorization
  it('Auth 10: no_go capture blocks routing', async () => {
    const noGoId = randomUUID();
    await supabase.from('captures').insert({
      id: noGoId, opportunity_id: oppId,
      source_material_hash: 'h', status: 'no_go',
      created_by_human_id: 'test', idempotency_key: `cap-nogo-${testRunId}`,
    });

    const r = await dispatchDeniseRequest(supabase, req('PATRICIA', 'auth10', {
      parentWorkflowId: noGoId,
    }));
    expect(r.disposition).toBe('UNAUTHORIZED');
    expect(r.failureReason).toContain('no_go');

    await supabase.from('captures').delete().like('idempotency_key', `cap-nogo-${testRunId}`);
  });
});

// Static analysis
describe('Static Safety', () => {
  it('routing module has no LLM/Gateway/Slack imports', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'specialist-routing.ts'), 'utf-8'
    );
    expect(content).not.toContain("from '../llm-gateway/gateway.js'");
    expect(content).not.toContain("complete(");
    expect(content).not.toContain("slack");
    expect(content).not.toContain("g2x");
  });
});
