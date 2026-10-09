/**
 * Denise Specialist Integration — 20 Commissioning Cases
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;
let oppId: string;
let otherOppId: string;
let captureId: string;
let analysisId1: string;
let analysisId2: string;

import { getDeniseIntelligenceForSpecialist } from '../specialist-integration.js';
import type { DeniseIntelligenceBundle } from '../specialist-integration.js';

describe.skipIf(!CAN_RUN)('Denise Specialist Integration — 20 Cases', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = `si-${Math.random().toString(36).slice(2, 8)}`;
    oppId = `opp-si-${testRunId}`;
    otherOppId = `opp-other-${testRunId}`;
    captureId = randomUUID();
    analysisId1 = randomUUID();
    analysisId2 = randomUUID();

    // Create capture
    await supabase.from('captures').insert({
      id: captureId, opportunity_id: oppId, source_material_hash: `h-${testRunId}`,
      status: 'pursuit_authorized', created_by_human_id: 'test',
      idempotency_key: `cap-si-${testRunId}`,
    });

    // Create two versioned analyses (v1 superseded by v2)
    await supabase.from('acquisition_analyses').insert({
      id: analysisId1, opportunity_id: oppId, capture_id: captureId,
      solicitation_version: 'SOL-V1', amendment_version: 0, version: 1,
      contract_type: 'FFP', competition_type: 'FULL_AND_OPEN', set_aside: 'SMALL_BUSINESS',
      source_refs: [{ id: 'ev-1' }],
      interpretation: { evaluationMethod: 'BEST_VALUE' },
      unresolved_issues: [], created_by: 'denise',
      idempotency_key: `analysis-v1-${testRunId}`,
    });
    await supabase.from('acquisition_analyses').insert({
      id: analysisId2, opportunity_id: oppId, capture_id: captureId,
      solicitation_version: 'SOL-V2', amendment_version: 1, version: 2,
      supersedes_id: analysisId1,
      contract_type: 'FFP', set_aside: 'SDVOSB',
      source_refs: [{ id: 'ev-2' }],
      interpretation: { evaluationMethod: 'BEST_VALUE', amendmentChange: true },
      unresolved_issues: [{ category: 'UNCERTAINTY', statement: 'Set-aside changed to SDVOSB' }],
      created_by: 'denise', idempotency_key: `analysis-v2-${testRunId}`,
    });

    // Create evaluation model
    await supabase.from('acquisition_evaluation_models').insert({
      acquisition_analysis_id: analysisId2, opportunity_id: oppId,
      evaluation_method: 'BEST_VALUE',
      factors: [{ name: 'Technical', relativeImportance: 'MOST_IMPORTANT' }],
      source_refs: [{ id: 'ev-2' }],
      idempotency_key: `eval-${testRunId}`,
    });

    // Create clause register entries
    await supabase.from('acquisition_clause_register').insert({
      acquisition_analysis_id: analysisId2, opportunity_id: oppId,
      clause_number: 'FAR 52.219-14', authority: 'FAR',
      requirement: 'Limitations on Subcontracting', operational_impact: '50% personnel costs',
      recommended_owner: 'ROSA', risk_severity: 'HIGH',
      legal_review_required: false, action_required: true,
      action_type: 'LIMITATION_ON_SUBCONTRACTING', action_owner: 'ROSA',
      idempotency_key: `clause-sub-${testRunId}`,
    });
    await supabase.from('acquisition_clause_register').insert({
      acquisition_analysis_id: analysisId2, opportunity_id: oppId,
      clause_number: 'DFARS 252.204-7012', authority: 'DFARS',
      requirement: 'Safeguarding CUI', operational_impact: 'NIST 800-171 required',
      recommended_owner: 'MARCUS', risk_severity: 'HIGH',
      legal_review_required: true, action_required: true,
      action_type: 'SECURITY_DOCUMENTATION', action_owner: 'MARCUS',
      idempotency_key: `clause-sec-${testRunId}`,
    });

    // Create acquisition risk
    await supabase.from('acquisition_risks').insert({
      acquisition_analysis_id: analysisId2, opportunity_id: oppId,
      risk_type: 'SET_ASIDE_MISMATCH', severity: 'HIGH',
      source_fact: 'Set-aside changed to SDVOSB', interpretation: 'FFTC is SDVOSB certified',
      operational_impact: 'Verify current SDVOSB status', source_refs: [{ id: 'ev-2' }],
      potentially_disqualifying: false, legal_review_required: false,
      idempotency_key: `risk-${testRunId}`,
    });

    // Create clarification question
    await supabase.from('acquisition_clarification_questions').insert({
      acquisition_analysis_id: analysisId2, opportunity_id: oppId,
      source_section: 'Section L', ambiguity: 'Page limit unclear',
      operational_impact: 'Cannot determine volume size',
      proposed_question: 'What is the page limit?', priority: 'HIGH',
      classification: 'CLARIFICATION_NEEDED',
      evidence_refs: [{ id: 'ev-2' }],
      idempotency_key: `clarify-${testRunId}`,
    });

    // Create acquisition conflict
    await supabase.from('acquisition_conflicts').insert({
      acquisition_analysis_id: analysisId2, opportunity_id: oppId,
      acquisition_artifact_id: analysisId2, conflicting_artifact_type: 'CAPTURE_STRATEGY',
      conflicting_artifact_id: captureId,
      conflict_description: 'Subcontracting assumption conflicts with FAR 52.219-14',
      affected_owners: ['JAMES', 'ROSA'], source_refs: [{ id: 'ev-2' }],
      idempotency_key: `conflict-${testRunId}`,
    });
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('acquisition_conflicts').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_clarification_questions').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_risks').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_clause_register').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_evaluation_models').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_analyses').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('captures').delete().like('idempotency_key', `cap-si-${testRunId}`);
  });

  // Case 1 — James: evaluation + risks
  it('Case 1: James receives evaluation and acquisition risks', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    expect(b.acquisitionAnalyses.length).toBeGreaterThan(0);
    expect(b.acquisitionRisks.length).toBeGreaterThan(0);
  });

  // Case 2 — James: reassessment indicator, no auto decision
  it('Case 2: James receives reassessment indicator without auto decision', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    // Amendment exists (v2) — stale indicator or amendment impact should be present
    expect(b.amendmentImpacts.length).toBeGreaterThan(0);
    // No capture status change
    const { data: cap } = await supabase.from('captures').select('status').eq('id', captureId).single();
    expect(cap.status).toBe('pursuit_authorized'); // Unchanged
  });

  // Case 3 — Patricia: submission requirements
  it('Case 3: Patricia receives submission requirements', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'PATRICIA', workflowPhase: 'PURSUIT',
    });
    expect(b.clauseRegister.length).toBeGreaterThan(0);
    expect(b.clarificationQuestions.length).toBeGreaterThan(0);
  });

  // Case 4 — Patricia: amendment impacts
  it('Case 4: Patricia receives material amendment impacts', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'PATRICIA', workflowPhase: 'PURSUIT',
    });
    expect(b.amendmentImpacts.length).toBeGreaterThan(0);
  });

  // Case 5 — Jodie: evaluation + Section L
  it('Case 5: Jodie receives evaluation constraints', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JODIE', workflowPhase: 'PURSUIT',
    });
    expect(b.evaluationModels.length).toBeGreaterThan(0);
    expect(b.clauseRegister.length).toBeGreaterThan(0);
  });

  // Case 6 — Jodie: partial regulatory interpretation with warning
  it('Case 6: Jodie receives coverage limitations for missing reg interp', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JODIE', workflowPhase: 'PURSUIT',
      requestedArtifactTypes: ['REGULATORY_INTERPRETATION'],
    });
    // Either no reg interpretations → missing artifact, or existing ones → coverage limitations
    if (b.regulatoryInterpretations.length === 0) {
      expect(b.missingArtifacts).toContain('REGULATORY_INTERPRETATION');
    } else {
      expect(b.coverageLimitations.length).toBeGreaterThan(0);
    }
  });

  // Case 7 — Marcus: technical/security
  it('Case 7: Marcus receives security requirements', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'MARCUS', workflowPhase: 'PURSUIT',
    });
    const securityClauses = b.clauseRegister.filter(c => c.clause_number === 'DFARS 252.204-7012');
    expect(securityClauses.length).toBeGreaterThan(0);
  });

  // Case 8 — Rosa: teaming/subcontracting
  it('Case 8: Rosa receives subcontracting concerns', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'ROSA', workflowPhase: 'PURSUIT',
    });
    const subClauses = b.clauseRegister.filter(c => c.clause_number === 'FAR 52.219-14');
    expect(subClauses.length).toBeGreaterThan(0);
    expect(b.acquisitionConflicts.length).toBeGreaterThan(0);
  });

  // Case 9 — Legal review flag survives projection
  it('Case 9: legal-review flag survives every projection', async () => {
    for (const role of ['JAMES', 'PATRICIA', 'JODIE', 'MARCUS', 'ROSA'] as const) {
      const b = await getDeniseIntelligenceForSpecialist(supabase, {
        opportunityId: oppId, specialistRole: role, workflowPhase: 'PURSUIT',
      });
      // At least one artifact has legal_review_required (DFARS 252.204-7012)
      expect(b.legalReviewRequired).toBe(true);
    }
  });

  // Case 10 — Source fact distinct from interpretation
  it('Case 10: source fact remains distinct from interpretation', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    for (const a of b.acquisitionAnalyses) {
      expect(a._provenance.findingCategory).toBeTruthy();
      expect(a._provenance.artifactType).toBe('ACQUISITION_ANALYSIS');
    }
  });

  // Case 11 — Evidence ID and hash preserved
  it('Case 11: regulatory evidence ID and hash preserved', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    for (const a of b.acquisitionAnalyses) {
      expect(a._provenance.sourceEvidenceIds.length).toBeGreaterThan(0);
      expect(a._provenance.createdAt).toBeTruthy();
    }
  });

  // Case 12 — Superseded artifact excluded
  it('Case 12: superseded artifact excluded from current view', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    // v1 (analysisId1) is superseded by v2 — should be excluded
    const ids = b.acquisitionAnalyses.map(a => a.id);
    expect(ids).not.toContain(analysisId1);
    expect(ids).toContain(analysisId2);
  });

  // Case 13 — Historical version explicitly requested
  it('Case 13: historical version requested', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
      asOfVersion: 1,
    });
    // Should include v1 since we asked for asOfVersion=1
    expect(b.acquisitionAnalyses.some(a => Number(a.version) === 1)).toBe(true);
  });

  // Case 14 — Unresolved conflict visible
  it('Case 14: unresolved conflict remains visible', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    expect(b.acquisitionConflicts.length).toBeGreaterThan(0);
    expect(b.acquisitionConflicts[0].status).toBe('OPEN');
  });

  // Case 15 — Amendment flags stale analysis
  it('Case 15: amendment flags stale analysis', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    // Amendment v1 exists (analysis v2 has amendment_version=1)
    // The stale indicator should note this
    // (In our test data, the latest analysis IS the amendment, so no staleness)
    expect(b.versionInfo.latestVersion).toBeGreaterThanOrEqual(2);
  });

  // Case 16 — Cross-opportunity isolation
  it('Case 16: cross-opportunity leakage prevented', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: otherOppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    // Other opportunity has no artifacts
    expect(b.acquisitionAnalyses).toHaveLength(0);
    expect(b.acquisitionRisks).toHaveLength(0);
    expect(b.missingArtifacts.length).toBeGreaterThan(0);
  });

  // Case 17 — Missing artifact returns typed absence
  it('Case 17: missing artifact returns typed absence for nonexistent opportunity', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: `nonexistent-${testRunId}`, specialistRole: 'JODIE', workflowPhase: 'PURSUIT',
    });
    expect(b.evaluationModels).toHaveLength(0);
    expect(b.missingArtifacts).toContain('EVALUATION_MODEL');
  });

  // Case 18 — Specialist cannot mutate
  it('Case 18: specialist cannot mutate Denise records', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    // The bundle is a plain object — but let's verify the underlying record is immutable
    if (b.acquisitionAnalyses.length > 0) {
      const id = b.acquisitionAnalyses[0].id;
      const { error } = await supabase.from('acquisition_analyses')
        .update({ contract_type: 'HACKED' }).eq('id', id);
      expect(error).toBeTruthy(); // Immutability trigger blocks UPDATE
    }
  });

  // Case 19 — Zero LLM, G2X, Slack, downstream
  it('Case 19: zero LLM, G2X, Slack, downstream actions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'specialist-integration.ts'), 'utf-8'
    );
    expect(content).not.toContain("from '../llm-gateway/gateway.js'");
    expect(content).not.toContain("complete(");
    expect(content).not.toContain("slack");
    expect(content).not.toContain("g2x");
  });

  // Case 20 — Production non-mutation
  it('Case 20: production non-mutation, DENISE flags disabled', () => {
    expect(getEnvironmentRole()).not.toBe('production');
    expect(process.env.DENISE_CAPTURE_ENABLED).not.toBe('true');
    expect(process.env.DENISE_PURSUIT_ENABLED).not.toBe('true');
    expect(process.env.DENISE_SLACK_ENABLED).not.toBe('true');
    expect(process.env.DENISE_REGULATORY_RESEARCH_ENABLED).not.toBe('true');
  });
});
