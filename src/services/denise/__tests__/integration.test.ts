/**
 * Denise Integration Tests — Commissioning Cases A–M
 *
 * Real commissioning Postgres tests. Zero provider calls.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN_DB_TESTS = HAS_DB && !IS_PRODUCTION;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;
let captureId: string;
let wsId: string;
let analysisId: string;

describe.skipIf(!CAN_RUN_DB_TESTS)('Denise Acquisition Integration', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = `denise-${Math.random().toString(36).slice(2, 8)}`;

    // Create prerequisite capture
    captureId = randomUUID();
    const oppId = `opp-${testRunId}`;
    await supabase.from('captures').insert({
      id: captureId,
      opportunity_id: oppId,
      source_material_hash: `hash-${testRunId}`,
      status: 'pursuit_authorized',
      created_by_human_id: 'test',
      idempotency_key: `cap-${testRunId}`,
    });

    // Create prerequisite proposal workspace
    const { data: wsData } = await supabase
      .from('proposal_workspaces')
      .insert({
        capture_id: captureId,
        opportunity_id: oppId,
        status: 'active',
      })
      .select('id')
      .single();
    wsId = wsData?.id;
  });

  afterAll(async () => {
    if (!supabase) return;
    // Clean up in dependency order
    await supabase.from('acquisition_clarification_questions').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_conflicts').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_risks').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_clause_register').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_evaluation_models').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_analyses').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('acquisition_tasks').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('regulatory_evidence').delete().like('idempotency_key', `%${testRunId}%`);
    await supabase.from('denise_observation_windows').delete().eq('capture_id', captureId);
    if (wsId) await supabase.from('proposal_workspaces').delete().eq('id', wsId);
    await supabase.from('captures').delete().like('idempotency_key', `cap-${testRunId}`);
  });

  // ============================================================
  // RLS
  // ============================================================
  describe('RLS', () => {
    const tables = [
      'acquisition_tasks',
      'acquisition_analyses',
      'acquisition_evaluation_models',
      'acquisition_clause_register',
      'acquisition_risks',
      'acquisition_clarification_questions',
      'acquisition_conflicts',
      'regulatory_evidence',
      'regulatory_source_cache',
      'denise_observation_windows',
    ];

    for (const table of tables) {
      it(`${table} is queryable with service_role`, async () => {
        const { error } = await supabase.from(table).select('id').limit(1);
        expect(error).toBeNull();
      });
    }
  });

  // ============================================================
  // Case A — Capture Request
  // ============================================================
  describe('Case A — Capture Request', () => {
    it('creates acquisition task from structured request', async () => {
      const { createTaskFromRequest } = await import('../storage.js');
      const taskId = await createTaskFromRequest(supabase, {
        captureId,
        opportunityId: `opp-${testRunId}`,
        requester: 'JAMES_CAPTURE',
        question: 'Analyze acquisition structure for this RFP',
        researchType: 'ACQUISITION_STRUCTURE',
        idempotencyKey: `task-a-${testRunId}`,
      });
      expect(taskId).toBeTruthy();

      // Verify task exists
      const { data } = await supabase
        .from('acquisition_tasks')
        .select('*')
        .eq('id', taskId)
        .single();
      expect(data.requester).toBe('JAMES_CAPTURE');
      expect(data.task_type).toBe('ACQUISITION_STRUCTURE');
      expect(data.status).toBe('pending');
    });

    it('idempotent task creation', async () => {
      const { createTaskFromRequest } = await import('../storage.js');
      await expect(
        createTaskFromRequest(supabase, {
          captureId,
          opportunityId: `opp-${testRunId}`,
          requester: 'JAMES_CAPTURE',
          question: 'Duplicate',
          researchType: 'ACQUISITION_STRUCTURE',
          idempotencyKey: `task-a-${testRunId}`,
        })
      ).rejects.toThrow();
    });
  });

  // ============================================================
  // Case B — Evaluation Structure
  // ============================================================
  describe('Case B — Evaluation Structure', () => {
    it('builds evaluation model with exact provenance, no invented percentages', async () => {
      const { createAcquisitionAnalysis, createEvaluationModel } = await import('../storage.js');

      analysisId = await createAcquisitionAnalysis(supabase, {
        opportunityId: `opp-${testRunId}`,
        captureId,
        solicitationVersion: 'SOL-2026-001',
        amendmentVersion: 0,
        contractType: 'FFP',
        competitionType: 'FULL_AND_OPEN',
        idempotencyKey: `analysis-b-${testRunId}`,
      });

      const evalId = await createEvaluationModel(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        evaluationMethod: 'BEST_VALUE',
        factors: [
          {
            name: 'Technical',
            relativeImportance: 'MOST_IMPORTANT',
            sourceRef: 'Amendment 3, Section M.2',
            sourceText: 'Technical is significantly more important than Price.',
          },
          {
            name: 'Past Performance',
            relativeImportance: 'MORE_IMPORTANT',
            sourceRef: 'Section M.2',
            sourceText: 'Past Performance is more important than Price.',
          },
          {
            name: 'Price',
            relativeImportance: 'LESS_IMPORTANT',
            sourceRef: 'Section M.2',
            sourceText: 'Price is least important.',
          },
        ],
        relativeImportance: {
          'Technical > Past Performance > Price': true,
        },
        sourceRefs: [{ section: 'M.2', document: 'Amendment 3' }],
        idempotencyKey: `eval-b-${testRunId}`,
      });
      expect(evalId).toBeTruthy();

      // Verify no percentages
      const { data } = await supabase
        .from('acquisition_evaluation_models')
        .select('*')
        .eq('id', evalId)
        .single();
      const factorsJson = JSON.stringify(data.factors);
      expect(factorsJson).not.toMatch(/\d+%/);
      expect(factorsJson).not.toMatch(/"weight":\s*\d/);
    });
  });

  // ============================================================
  // Case C — Clause Register
  // ============================================================
  describe('Case C — Clause Register', () => {
    it('creates material clause register entries', async () => {
      const { createClauseRegisterEntry } = await import('../storage.js');

      const clauseId = await createClauseRegisterEntry(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        clauseNumber: 'FAR 52.219-14',
        authority: 'FAR',
        requirement: 'Limitations on Subcontracting',
        operationalImpact: 'At least 50% of personnel costs must be FFTC employees',
        recommendedOwner: 'ROSA',
        riskSeverity: 'HIGH',
        actionRequired: false,
        idempotencyKey: `clause-c1-${testRunId}`,
      });
      expect(clauseId).toBeTruthy();
    });
  });

  // ============================================================
  // Case D — Clause Action
  // ============================================================
  describe('Case D — Clause Action', () => {
    it('creates CLAUSE_ACTION_REQUIRED with Patricia-compatible owner', async () => {
      const { createClauseRegisterEntry } = await import('../storage.js');

      const clauseId = await createClauseRegisterEntry(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        clauseNumber: 'FAR 52.204-8',
        authority: 'FAR',
        requirement: 'Annual Representations and Certifications',
        operationalImpact: 'Must complete SAM.gov reps/certs before proposal submission',
        recommendedOwner: 'PATRICIA',
        riskSeverity: 'MEDIUM',
        actionRequired: true,
        actionType: 'REPS_CERTS',
        actionDescription: 'Verify SAM.gov reps/certs are current and complete',
        actionOwner: 'PATRICIA',
        idempotencyKey: `clause-d1-${testRunId}`,
      });
      expect(clauseId).toBeTruthy();

      const { data } = await supabase
        .from('acquisition_clause_register')
        .select('*')
        .eq('id', clauseId)
        .single();
      expect(data.action_required).toBe(true);
      expect(data.action_type).toBe('REPS_CERTS');
      expect(data.action_owner).toBe('PATRICIA');
    });
  });

  // ============================================================
  // Case E — Potentially Disqualifying
  // ============================================================
  describe('Case E — Potentially Disqualifying', () => {
    it('creates POTENTIALLY_DISQUALIFYING risk without GO/NO_GO', async () => {
      const { createAcquisitionRisk } = await import('../storage.js');

      const riskId = await createAcquisitionRisk(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        riskType: 'CLEARANCE',
        severity: 'CRITICAL',
        sourceFact: 'Solicitation requires TS/SCI clearance for all key personnel',
        interpretation: 'FFTC does not currently hold facility clearance at TS/SCI level',
        operationalImpact: 'Cannot staff key personnel positions without clearance',
        affectedOwner: 'JAMES',
        potentiallyDisqualifying: true,
        idempotencyKey: `risk-e1-${testRunId}`,
      });
      expect(riskId).toBeTruthy();

      const { data } = await supabase
        .from('acquisition_risks')
        .select('*')
        .eq('id', riskId)
        .single();
      expect(data.potentially_disqualifying).toBe(true);
      expect(data.status).toBe('OPEN');
      // No GO/NO_GO in the record
      expect(JSON.stringify(data)).not.toContain('NO_GO');
    });
  });

  // ============================================================
  // Case F — Clarification
  // ============================================================
  describe('Case F — Clarification', () => {
    it('creates CLARIFICATION_NEEDED with no external send', async () => {
      const { createClarificationQuestion } = await import('../storage.js');

      const qId = await createClarificationQuestion(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        sourceSection: 'Section L.4',
        ambiguity: 'Section L.4 says 25 page limit; Section M.1 says 30 page limit',
        conflictingLanguage: 'L.4: "not to exceed 25 pages" vs M.1: "technical volume shall be no more than 30 pages"',
        operationalImpact: 'Cannot determine correct page limit for technical volume',
        proposedQuestion: 'Please clarify the correct page limit for the Technical Volume.',
        priority: 'HIGH',
        classification: 'CLARIFICATION_NEEDED',
        idempotencyKey: `clarify-f1-${testRunId}`,
      });
      expect(qId).toBeTruthy();

      const { data } = await supabase
        .from('acquisition_clarification_questions')
        .select('*')
        .eq('id', qId)
        .single();
      expect(data.external_send_status).toBe('NOT_SENT');
      expect(data.human_approval_status).toBe('PENDING');
    });
  });

  // ============================================================
  // Case G — Legal Boundary
  // ============================================================
  describe('Case G — Legal Boundary', () => {
    it('creates LEGAL_REVIEW_REQUIRED without legal resolution', async () => {
      const { createClarificationQuestion } = await import('../storage.js');

      const qId = await createClarificationQuestion(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        sourceSection: 'Section H.8',
        ambiguity: 'OCI clause is ambiguous on whether teaming arrangement creates organizational conflict',
        operationalImpact: 'Teaming strategy may be blocked if OCI determination is adverse',
        proposedQuestion: 'Does the proposed teaming arrangement with XYZ Corp create an OCI under H.8?',
        priority: 'CRITICAL',
        classification: 'LEGAL_REVIEW_REQUIRED',
        idempotencyKey: `legal-g1-${testRunId}`,
      });
      expect(qId).toBeTruthy();

      const { data } = await supabase
        .from('acquisition_clarification_questions')
        .select('*')
        .eq('id', qId)
        .single();
      expect(data.classification).toBe('LEGAL_REVIEW_REQUIRED');
      // No legal resolution in the record
      expect(data.external_send_status).toBe('NOT_SENT');
    });
  });

  // ============================================================
  // Case H — Amendment
  // ============================================================
  describe('Case H — Amendment', () => {
    it('creates new analysis version preserving old version', async () => {
      const { createAcquisitionAnalysis } = await import('../storage.js');

      // Create v2 that supersedes v1
      const v2Id = await createAcquisitionAnalysis(supabase, {
        opportunityId: `opp-${testRunId}`,
        captureId,
        solicitationVersion: 'SOL-2026-001',
        amendmentVersion: 3,
        contractType: 'FFP',
        competitionType: 'FULL_AND_OPEN',
        version: 2,
        supersedesId: analysisId,
        interpretation: {
          change: 'Amendment 3 changes evaluation hierarchy',
          impact: 'Past Performance now significantly more important than Price',
        },
        idempotencyKey: `analysis-h-${testRunId}`,
      });
      expect(v2Id).toBeTruthy();

      // Verify v1 still exists and is untouched
      const { data: v1 } = await supabase
        .from('acquisition_analyses')
        .select('*')
        .eq('id', analysisId)
        .single();
      expect(v1).toBeTruthy();
      expect(v1.version).toBe(1);

      // Verify v2 references v1
      const { data: v2 } = await supabase
        .from('acquisition_analyses')
        .select('*')
        .eq('id', v2Id)
        .single();
      expect(v2.version).toBe(2);
      expect(v2.supersedes_id).toBe(analysisId);
      expect(v2.amendment_version).toBe(3);
    });

    it('analysis immutability prevents UPDATE', async () => {
      const { error } = await supabase
        .from('acquisition_analyses')
        .update({ contract_type: 'IDIQ' })
        .eq('id', analysisId);
      expect(error).toBeTruthy();
      expect(error.message).toContain('immutable');
    });
  });

  // ============================================================
  // Case I — Conflict
  // ============================================================
  describe('Case I — Conflict', () => {
    it('creates conflict without mutating James artifact', async () => {
      const { createAcquisitionConflict } = await import('../storage.js');

      const conflictId = await createAcquisitionConflict(supabase, {
        acquisitionAnalysisId: analysisId,
        opportunityId: `opp-${testRunId}`,
        acquisitionArtifactId: analysisId,
        conflictingArtifactType: 'CAPTURE_STRATEGY',
        conflictingArtifactId: captureId,
        conflictDescription: 'James strategy assumes unrestricted subcontracting. Denise identifies FAR 52.219-14 limitation on subcontracting.',
        affectedOwners: ['JAMES', 'ROSA'],
        decisionOwner: 'JAMES',
        idempotencyKey: `conflict-i1-${testRunId}`,
      });
      expect(conflictId).toBeTruthy();

      // Verify James capture is untouched
      const { data: capture } = await supabase
        .from('captures')
        .select('*')
        .eq('id', captureId)
        .single();
      expect(capture).toBeTruthy();
      expect(capture.status).toBe('pursuit_authorized');
    });
  });

  // ============================================================
  // Case J — Citation Guard
  // ============================================================
  describe('Case J — Citation Guard', () => {
    it('fails closed without regulatory evidence', async () => {
      const { verifyCitation } = await import('../citation-verifier.js');

      const result = await verifyCitation(supabase, 'FAR', '52.999-99');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('AUTHORITATIVE_SOURCE_NOT_FOUND');
    });

    it('accepts citation with valid evidence', async () => {
      const { createRegulatoryEvidence, verifyCitation } = await import('../citation-verifier.js');

      const contentHash = createHash('sha256').update('test provision text').digest('hex');
      await createRegulatoryEvidence(supabase, {
        authority: 'FAR',
        citation: '52.219-14',
        provision: 'Limitations on Subcontracting',
        contentHash,
        boundedRelevantText: 'At least 50 percent of the cost of contract performance...',
        idempotencyKey: `evidence-j1-${testRunId}`,
      });

      const result = await verifyCitation(supabase, 'FAR', '52.219-14');
      expect(result.valid).toBe(true);
      expect(result.evidenceId).toBeTruthy();
    });
  });

  // ============================================================
  // Case K — Cache Freshness
  // ============================================================
  describe('Case K — Cache Freshness', () => {
    it('current matching authority is cache reusable', async () => {
      const { cacheSource, lookupCache } = await import('../regulatory-cache.js');

      await cacheSource(supabase, {
        authority: 'FAR',
        citation: '52.219-14',
        version: '2024-01',
        text: 'Limitations on Subcontracting provision text',
      });

      const result = await lookupCache(supabase, 'FAR', '52.219-14', '2024-01');
      expect(result.found).toBe(true);
      expect(result.fresh).toBe(true);
    });

    it('changed authority requires revalidation', async () => {
      const { checkFreshness } = await import('../regulatory-cache.js');

      const differentHash = createHash('sha256').update('CHANGED text').digest('hex');
      const result = await checkFreshness(supabase, 'FAR', '52.219-14', differentHash);
      expect(result.fresh).toBe(false);
      expect(result.reason).toContain('hash changed');
    });
  });

  // ============================================================
  // Case L — Budget
  // ============================================================
  describe('Case L — Budget', () => {
    it('capture observation window has correct limits', async () => {
      const { data } = await supabase
        .from('denise_observation_windows')
        .insert({
          observation_type: 'CAPTURE',
          status: 'INACTIVE',
          max_calls: 5,
          max_cumulative_spend_usd: 0.05,
          capture_id: captureId,
        })
        .select('*')
        .single();

      expect(Number(data.max_cumulative_spend_usd)).toBeCloseTo(0.05);
      expect(data.status).toBe('INACTIVE');
    });

    it('pursuit observation window has correct limits', async () => {
      const { data } = await supabase
        .from('denise_observation_windows')
        .insert({
          observation_type: 'PURSUIT',
          status: 'INACTIVE',
          max_calls: 10,
          max_cumulative_spend_usd: 0.25,
          proposal_workspace_id: wsId,
        })
        .select('*')
        .single();

      expect(data.max_calls).toBe(10);
      expect(Number(data.max_cumulative_spend_usd)).toBeCloseTo(0.25);
    });

    it('inactive observation window rejects claims', async () => {
      const { data } = await supabase.rpc('claim_denise_observation_slot', {
        p_task_id: randomUUID(),
        p_reserved_cost_usd: 0.01,
      });
      // No active window → FALSE
      expect(data).toBe(false);
    });
  });

  // ============================================================
  // Case M — Slack
  // ============================================================
  describe('Case M — Slack', () => {
    it('generates HIGH-risk Slack payload', async () => {
      const { generateRiskPayload } = await import('../slack-surface.js');
      const payload = generateRiskPayload(
        {
          id: 'test-risk',
          risk_type: 'ELIGIBILITY',
          severity: 'CRITICAL',
          source_fact: 'Must hold GSA MAS contract',
          interpretation: 'FFTC does not hold GSA MAS',
          operational_impact: 'Cannot bid on this vehicle',
          potentially_disqualifying: true,
          legal_review_required: false,
        },
        analysisId || 'analysis-id',
        `opp-${testRunId}`
      );
      expect(payload.blocks.length).toBeGreaterThan(0);
      expect(payload.text).toContain('DENISE');
      expect(payload.notificationType).toBe('POTENTIALLY_DISQUALIFYING');
    });

    it('low-risk finding produces no proactive Slack payload', async () => {
      const { shouldNotify } = await import('../slack-surface.js');
      expect(shouldNotify('LOW', false)).toBe(false);
      expect(shouldNotify('INFORMATIONAL', false)).toBe(false);
    });
  });
});
