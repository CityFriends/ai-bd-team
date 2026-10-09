/**
 * Denise Specialist Integration — Architecture Verification
 *
 * Task 1: Authorization boundary enforcement
 * Task 2: Historical version and supersession integrity
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

import { getDeniseIntelligenceForSpecialist, SPECIALIST_ARTIFACT_MAP } from '../specialist-integration.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;
let oppId: string;
let captureId: string;
let analysisV1: string;
let analysisV2: string;
let analysisV3: string;

// Shared setup for both task describes
beforeAll(async () => {
  if (!CAN_RUN) return;
  supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  testRunId = `sv-${Math.random().toString(36).slice(2, 8)}`;
  oppId = `opp-sv-${testRunId}`;
  captureId = randomUUID();
  analysisV1 = randomUUID();
  analysisV2 = randomUUID();
  analysisV3 = randomUUID();

  await supabase.from('captures').insert({
    id: captureId, opportunity_id: oppId, source_material_hash: `h-${testRunId}`,
    status: 'pursuit_authorized', created_by_human_id: 'test',
    idempotency_key: `cap-sv-${testRunId}`,
  });

  await supabase.from('acquisition_analyses').insert({
    id: analysisV1, opportunity_id: oppId, capture_id: captureId,
    solicitation_version: 'SOL-V1', amendment_version: 0, version: 1,
    source_refs: [{ id: 'ev-1' }], interpretation: {}, unresolved_issues: [],
    created_by: 'denise', idempotency_key: `sv-a1-${testRunId}`,
  });
  await supabase.from('acquisition_analyses').insert({
    id: analysisV2, opportunity_id: oppId, capture_id: captureId,
    solicitation_version: 'SOL-V2', amendment_version: 0, version: 2,
    supersedes_id: analysisV1,
    source_refs: [{ id: 'ev-2' }], interpretation: {}, unresolved_issues: [],
    created_by: 'denise', idempotency_key: `sv-a2-${testRunId}`,
  });
  await supabase.from('acquisition_analyses').insert({
    id: analysisV3, opportunity_id: oppId, capture_id: captureId,
    solicitation_version: 'SOL-V3', amendment_version: 0, version: 3,
    supersedes_id: analysisV2,
    source_refs: [{ id: 'ev-3' }], interpretation: {}, unresolved_issues: [],
    created_by: 'denise', idempotency_key: `sv-a3-${testRunId}`,
  });

  await supabase.from('acquisition_clarification_questions').insert({
    acquisition_analysis_id: analysisV3, opportunity_id: oppId,
    source_section: 'L', ambiguity: 'test', operational_impact: 'test',
    proposed_question: 'test?', priority: 'NORMAL', classification: 'CLARIFICATION_NEEDED',
    idempotency_key: `sv-cq-${testRunId}`,
  });

  await supabase.from('acquisition_analyses').insert({
    id: randomUUID(), opportunity_id: `opp-other-${testRunId}`, capture_id: captureId,
    solicitation_version: 'SOL-X', amendment_version: 0, version: 1,
    source_refs: [], interpretation: {}, unresolved_issues: [],
    created_by: 'denise', idempotency_key: `sv-other-${testRunId}`,
  });
});

afterAll(async () => {
  if (!supabase) return;
  await supabase.from('acquisition_clarification_questions').delete().like('idempotency_key', `sv-%${testRunId}%`);
  await supabase.from('acquisition_analyses').delete().like('idempotency_key', `sv-%${testRunId}%`);
  await supabase.from('captures').delete().like('idempotency_key', `cap-sv-${testRunId}`);
});

describe.skipIf(!CAN_RUN)('Task 1 — Specialist Authorization Boundaries', () => {

  it('1a: each specialist receives only authorized artifact types', async () => {
    // James should NOT receive CLARIFICATION_QUESTION
    const james = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    expect(james.clarificationQuestions).toHaveLength(0);

    // Patricia SHOULD receive CLARIFICATION_QUESTION
    const patricia = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'PATRICIA', workflowPhase: 'PURSUIT',
    });
    expect(patricia.clarificationQuestions.length).toBeGreaterThan(0);
  });

  it('1b: requestedArtifactTypes cannot expand beyond role authorization', async () => {
    // James tries to request CLARIFICATION_QUESTION via override
    const james = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
      requestedArtifactTypes: ['CLARIFICATION_QUESTION', 'ACQUISITION_ANALYSIS'],
    });
    // CLARIFICATION_QUESTION should be filtered out — not in James's allowed set
    expect(james.clarificationQuestions).toHaveLength(0);
    // ACQUISITION_ANALYSIS should still work (it IS in James's allowed set)
    expect(james.acquisitionAnalyses.length).toBeGreaterThan(0);
  });

  it('1c: requestedArtifactTypes can narrow within role authorization', async () => {
    // Patricia requests ONLY clause register (subset of her allowed types)
    const patricia = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'PATRICIA', workflowPhase: 'PURSUIT',
      requestedArtifactTypes: ['CLAUSE_REGISTER'],
    });
    // Should not fetch clarification questions even though Patricia is authorized
    expect(patricia.clarificationQuestions).toHaveLength(0);
  });

  it('1d: invalid role throws error', async () => {
    await expect(getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'HACKER' as any, workflowPhase: 'CAPTURE',
    })).rejects.toThrow('Invalid specialist role');
  });

  it('1e: cross-opportunity access prevented', async () => {
    const james = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: `opp-other-${testRunId}`, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    // Should only see the other opportunity's data, not oppId's
    for (const a of james.acquisitionAnalyses) {
      expect(a.opportunity_id).toBe(`opp-other-${testRunId}`);
    }
  });
});

describe.skipIf(!CAN_RUN)('Task 2 — Historical Version and Supersession Integrity', () => {
  it('2a: querying version 1 returns A (v1)', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
      asOfVersion: 1,
    });
    const ids = b.acquisitionAnalyses.map(a => a.id);
    expect(ids).toContain(analysisV1);
    expect(ids).not.toContain(analysisV2);
    expect(ids).not.toContain(analysisV3);
  });

  it('2b: querying version 2 returns B (v2), not A', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
      asOfVersion: 2,
    });
    const ids = b.acquisitionAnalyses.map(a => a.id);
    // v2 supersedes v1, so only v2 should appear
    expect(ids).toContain(analysisV2);
    expect(ids).not.toContain(analysisV1);
    expect(ids).not.toContain(analysisV3);
  });

  it('2c: querying current (no asOfVersion) returns v3 only', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
    });
    const ids = b.acquisitionAnalyses.map(a => a.id);
    expect(ids).toContain(analysisV3);
    expect(ids).not.toContain(analysisV1);
    expect(ids).not.toContain(analysisV2);
  });

  it('2d: later supersession does not retroactively remove from earlier query', async () => {
    // v3 supersedes v2, but querying asOfVersion=1 should still return v1
    // (v3's supersession of v2 is irrelevant when we only see v1)
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
      asOfVersion: 1,
    });
    expect(b.acquisitionAnalyses.map(a => a.id)).toContain(analysisV1);
  });

  it('2e: three-level supersession chain works correctly', async () => {
    // v1 → v2 → v3: at each level, only the terminal version appears
    for (const [ver, expected, excluded] of [
      [1, analysisV1, [analysisV2, analysisV3]],
      [2, analysisV2, [analysisV1, analysisV3]],
      [3, analysisV3, [analysisV1, analysisV2]],
    ] as [number, string, string[]][]) {
      const b = await getDeniseIntelligenceForSpecialist(supabase, {
        opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
        asOfVersion: ver,
      });
      const ids = b.acquisitionAnalyses.map(a => a.id);
      expect(ids).toContain(expected);
      for (const ex of excluded) expect(ids).not.toContain(ex);
    }
  });

  it('2f: unrelated artifacts not affected by version filter', async () => {
    // Clause register entries don't have version — they should appear regardless
    // (only acquisition_analyses support version filtering)
    const b1 = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'PATRICIA', workflowPhase: 'PURSUIT',
      asOfVersion: 1,
    });
    const b3 = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'PATRICIA', workflowPhase: 'PURSUIT',
    });
    // Both should see the same clarification questions
    expect(b1.clarificationQuestions.length).toBe(b3.clarificationQuestions.length);
  });

  it('2g: version scope is PER_ARTIFACT_STREAM, not global', async () => {
    const b = await getDeniseIntelligenceForSpecialist(supabase, {
      opportunityId: oppId, specialistRole: 'JAMES', workflowPhase: 'CAPTURE',
      asOfVersion: 2,
    });
    expect(b.versionInfo.versionScope).toBe('PER_ARTIFACT_STREAM');
  });
});
