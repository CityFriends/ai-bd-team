/**
 * Specialist Executor — Test Fixtures for Milestone 3B
 *
 * Executes specialist tasks using deterministic fixtures.
 * Production specialist agents (David, Marcus, Rosa) are NOT enabled in 3B.
 *
 * All artifacts created here are marked artifact_source: 'TEST_FIXTURE'.
 * Production James must NOT consume TEST_FIXTURE artifacts.
 */

import { emitEvent, CAPTURE_EVENT_TYPES } from './events.js';
import type { SpecialistTaskType } from './types.js';

/**
 * Execute a specialist task using deterministic test fixtures.
 * Claims the task atomically, creates artifact, emits completion event.
 */
export async function executeSpecialistTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
): Promise<boolean> {
  // Claim task atomically
  const { data: task, error: claimErr } = await supabase
    .from('specialist_tasks')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
      execution_mode: 'TEST_FIXTURE',
    })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select('*')
    .single();

  if (claimErr || !task) return false;

  try {
    // Generate fixture artifact based on task type
    const fixture = getFixtureArtifact(task.task_type as SpecialistTaskType, task.question);

    // Create artifact
    await supabase.from('specialist_artifacts').insert({
      specialist_task_id: taskId,
      capture_id: task.capture_id,
      finding: fixture.finding,
      assessment: fixture.assessment,
      confidence: fixture.confidence,
      evidence: fixture.evidence,
      material_unsolicited_findings: fixture.materialUnsolicitedFindings,
      unknowns: fixture.unknowns,
      capture_implications: fixture.captureImplications,
      recommended_followup: fixture.recommendedFollowup,
      artifact_source: 'TEST_FIXTURE',
      schema_version: 1,
    });

    // Mark complete
    await supabase
      .from('specialist_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    // Emit completion event
    await emitEvent(supabase, {
      eventType: CAPTURE_EVENT_TYPES.SPECIALIST_TASK_COMPLETED,
      aggregateType: 'capture',
      aggregateId: task.capture_id,
      opportunityId: task.opportunity_id,
      actorType: 'SYSTEM',
      source: 'specialist-executor',
      correlationId: `capture:${task.capture_id}`,
      idempotencyKey: `specialist-complete:${task.idempotency_key}`,
      schemaVersion: 1,
      payload: { taskType: task.task_type, artifactSource: 'TEST_FIXTURE' },
    });

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('specialist_tasks')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', taskId);

    await emitEvent(supabase, {
      eventType: CAPTURE_EVENT_TYPES.SPECIALIST_TASK_FAILED,
      aggregateType: 'capture',
      aggregateId: task.capture_id,
      opportunityId: task.opportunity_id,
      actorType: 'SYSTEM',
      source: 'specialist-executor',
      correlationId: `capture:${task.capture_id}`,
      idempotencyKey: `specialist-failed:${task.idempotency_key}`,
      schemaVersion: 1,
      payload: { taskType: task.task_type, error: msg },
    });

    return false;
  }
}

/**
 * Process all pending specialist tasks for a capture.
 */
export async function processPendingSpecialistTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ processed: number; completed: number; failed: number }> {
  const result = { processed: 0, completed: 0, failed: 0 };

  const { data: tasks } = await supabase
    .from('specialist_tasks')
    .select('id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (!tasks?.length) return result;

  for (const task of tasks) {
    result.processed++;
    const success = await executeSpecialistTask(supabase, task.id);
    if (success) result.completed++;
    else result.failed++;
  }

  return result;
}

// ============================================================
// Deterministic Fixture Data
// ============================================================

interface FixtureArtifact {
  finding: string;
  assessment: 'FAVORABLE' | 'MIXED' | 'UNFAVORABLE' | 'INSUFFICIENT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: Array<{ claim: string; evidenceRef: string }>;
  materialUnsolicitedFindings: string[];
  unknowns: string[];
  captureImplications: string[];
  recommendedFollowup: string[];
}

function getFixtureArtifact(type: SpecialistTaskType, question: string): FixtureArtifact {
  switch (type) {
    case 'COMPETITIVE_INTELLIGENCE':
      return {
        finding: `[TEST FIXTURE] Competitive landscape analysis for: ${question.slice(0, 100)}. Multiple incumbent contractors identified. Market appears moderately competitive with 3-5 known competitors in this space.`,
        assessment: 'MIXED',
        confidence: 'MEDIUM',
        evidence: [
          { claim: 'Multiple incumbents in similar work', evidenceRef: 'SAM.gov award history' },
          { claim: 'FFTC has relevant past performance', evidenceRef: 'Company profile' },
        ],
        materialUnsolicitedFindings: [],
        unknowns: ['Incumbent contract performance rating', 'Recompete timeline'],
        captureImplications: [
          'Competitive pricing strategy needed',
          'Differentiators should be highlighted',
        ],
        recommendedFollowup: ['Review incumbent contract details if available'],
      };

    case 'TECHNICAL_ASSESSMENT':
      return {
        finding: `[TEST FIXTURE] Technical assessment for: ${question.slice(0, 100)}. Requirements appear to align with FFTC technical capabilities. Standard technology stack identified.`,
        assessment: 'FAVORABLE',
        confidence: 'MEDIUM',
        evidence: [
          {
            claim: 'Technology requirements within FFTC capability set',
            evidenceRef: 'PWS/SOW analysis',
          },
        ],
        materialUnsolicitedFindings: [],
        unknowns: ['Specific platform/tool requirements', 'Integration complexity'],
        captureImplications: ['Standard delivery approach applicable'],
        recommendedFollowup: [],
      };

    case 'PARTNER_SEARCH':
      return {
        finding: `[TEST FIXTURE] Partner search for: ${question.slice(0, 100)}. Teaming opportunities exist but require further relationship development.`,
        assessment: 'MIXED',
        confidence: 'LOW',
        evidence: [
          {
            claim: 'Potential teaming partners identified in adjacent contracts',
            evidenceRef: 'SAM.gov subcontracting data',
          },
        ],
        materialUnsolicitedFindings: [],
        unknowns: ['Partner willingness and availability', 'Exclusivity arrangements'],
        captureImplications: ['Teaming strategy should be explored before proposal'],
        recommendedFollowup: ['Identify specific teaming candidates'],
      };

    case 'ACQUISITION_INTERPRETATION':
      return {
        finding: `[TEST FIXTURE] Acquisition interpretation for: ${question.slice(0, 100)}. Contract structure appears standard for this procurement type.`,
        assessment: 'FAVORABLE',
        confidence: 'MEDIUM',
        evidence: [
          {
            claim: 'Standard federal acquisition approach',
            evidenceRef: 'Solicitation structure analysis',
          },
        ],
        materialUnsolicitedFindings: [],
        unknowns: ['Evaluation criteria weighting', 'Oral presentation requirements'],
        captureImplications: ['Standard proposal format expected'],
        recommendedFollowup: [],
      };
  }
}
