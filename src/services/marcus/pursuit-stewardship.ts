/**
 * Marcus Pursuit Technical Stewardship
 *
 * Deterministic wiring from PURSUIT_AUTHORIZED → TechnicalSolutionArtifact
 * → source document change → material technical change → Marcus task.
 *
 * No periodic LLM wake. Schedule may check/process deterministic document
 * work, but schedule execution itself never invokes Marcus merely because
 * time passed.
 */

import { logger } from '../../lib/logger.js';
// Feature gate controls execution in the executor, not task creation here
import { getSupabase } from '../../integrations/database/client.js';
import { classifyTechnicalChange, normalizeTechnicalFields } from './technical-change.js';
// MaterialTechnicalChangeType values used via classification result
import { randomUUID } from 'crypto';

const log = logger.child({ service: 'MarcusPursuitStewardship' });

// ============================================================
// PURSUIT_AUTHORIZED → Initialize Stewardship
// ============================================================

/**
 * Called when PURSUIT_AUTHORIZED occurs.
 *
 * Does NOT automatically spend Marcus inference.
 * Establishes the pursuit TechnicalSolutionArtifact from existing
 * capture evidence where possible, or creates a pending task.
 */
export async function initializePursuitStewardship(
  captureId: string,
  opportunityId: string
): Promise<{ artifactId: string; fromExisting: boolean; pendingTaskId: string | null }> {
  const supabase = getSupabase();

  // Check if a TechnicalSolutionArtifact already exists for this pursuit
  const { data: existing } = await supabase
    .from('technical_solution_artifacts')
    .select('id')
    .eq('capture_id', captureId)
    .eq('opportunity_id', opportunityId)
    .maybeSingle();

  if (existing) {
    log.info({ captureId, artifactId: existing.id }, 'Pursuit stewardship already initialized');
    return { artifactId: existing.id, fromExisting: true, pendingTaskId: null };
  }

  // Check for existing capture TechnicalAssessment / PreliminarySolutionArchitecture
  const { data: captureAssessment } = await supabase
    .from('technical_assessments')
    .select('id, assessment_content, evidence_refs')
    .eq('capture_id', captureId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const artifactId = randomUUID();

  // Create the durable TechnicalSolutionArtifact
  await supabase.from('technical_solution_artifacts').insert({
    id: artifactId,
    capture_id: captureId,
    opportunity_id: opportunityId,
  });

  if (captureAssessment) {
    // Establish v1 from existing capture evidence (deterministic — no LLM)
    const versionId = randomUUID();
    await supabase.from('technical_solution_artifact_versions').insert({
      id: versionId,
      artifact_id: artifactId,
      version_number: 1,
      version_content: captureAssessment.assessment_content,
      source_document_version_refs: [],
      evidence_refs: captureAssessment.evidence_refs || [],
    });

    await supabase.from('technical_solution_artifacts')
      .update({ current_version_id: versionId })
      .eq('id', artifactId);

    log.info(
      { captureId, artifactId, versionId, fromAssessment: captureAssessment.id },
      'Pursuit stewardship initialized from existing capture assessment'
    );

    return { artifactId, fromExisting: true, pendingTaskId: null };
  }

  // No existing evidence — create a pending stewardship task
  // (will execute only when MARCUS_PURSUIT_STEWARDSHIP_ENABLED=true)
  const taskId = randomUUID();
  await supabase.from('marcus_technical_tasks').insert({
    id: taskId,
    capture_id: captureId,
    opportunity_id: opportunityId,
    trigger_type: 'PURSUIT_CHANGE',
    question: 'Establish initial technical solution artifact for authorized pursuit',
    status: 'pending',
    idempotency_key: `marcus:pursuit:init:${captureId}`,
  });

  log.info(
    { captureId, artifactId, taskId },
    'Pursuit stewardship initialized with pending Marcus task (no existing capture assessment)'
  );

  return { artifactId, fromExisting: false, pendingTaskId: taskId };
}

// ============================================================
// Source Document Change → Material Classification → Marcus Task
// ============================================================

/**
 * Process a source document version change for a pursuit.
 *
 * Deterministic pipeline:
 * 1. Load previous and current source document fields
 * 2. Classify technical change (NO LLM)
 * 3. Persist technical_change_event (always)
 * 4. If material → create marcus_technical_stewardship task
 * 5. If nonmaterial → no task
 * 6. If ambiguous → TECHNICAL_CHANGE_REVIEW_REQUIRED, no task
 */
export async function processSourceDocumentChange(
  captureId: string,
  opportunityId: string,
  sourceDocumentVersionId: string,
  previousPayload: Record<string, unknown> | null,
  currentPayload: Record<string, unknown>
): Promise<{
  changeEventId: string;
  material: boolean;
  ambiguous: boolean;
  taskCreated: boolean;
  taskId: string | null;
}> {
  const supabase = getSupabase();

  // 1. Normalize fields
  const oldFields = normalizeTechnicalFields(previousPayload || {});
  const newFields = normalizeTechnicalFields(currentPayload);

  // 2. Classify (deterministic, NO LLM)
  const classification = classifyTechnicalChange(oldFields, newFields);

  // 3. Persist change event (always, even for nonmaterial)
  const changeEventId = randomUUID();
  const contentHash = JSON.stringify(newFields).length.toString(); // Simple hash for dedup

  // Check for duplicate
  const { data: existingEvent } = await supabase
    .from('technical_change_events')
    .select('id')
    .eq('capture_id', captureId)
    .eq('source_document_version_id', sourceDocumentVersionId)
    .eq('new_hash', contentHash)
    .maybeSingle();

  if (existingEvent) {
    log.debug({ captureId, sourceDocumentVersionId }, 'Duplicate change event — skipping');
    return { changeEventId: existingEvent.id, material: false, ambiguous: false, taskCreated: false, taskId: null };
  }

  await supabase.from('technical_change_events').insert({
    id: changeEventId,
    capture_id: captureId,
    opportunity_id: opportunityId,
    change_type: classification.classification || 'UNKNOWN',
    material: classification.material,
    changed_fields: classification.changedFields,
    change_reasons: classification.reasons.map((r) => r.description),
    source_document_version_id: sourceDocumentVersionId,
    previous_hash: previousPayload ? JSON.stringify(previousPayload).length.toString() : null,
    new_hash: contentHash,
  });

  // 4. Handle based on classification
  if (classification.ambiguous) {
    log.info(
      { captureId, changeType: 'TECHNICAL_CHANGE_REVIEW_REQUIRED', changedFields: classification.changedFields },
      'Ambiguous technical change — REVIEW_REQUIRED, no Marcus task'
    );
    return { changeEventId, material: false, ambiguous: true, taskCreated: false, taskId: null };
  }

  if (!classification.material) {
    log.info(
      { captureId, changedFields: classification.changedFields },
      'Nonmaterial technical change — event persisted, no Marcus task'
    );
    return { changeEventId, material: false, ambiguous: false, taskCreated: false, taskId: null };
  }

  // 5. Material change → ALWAYS create a pending stewardship task
  // The capability gate controls EXECUTION, not durable recognition of work.
  // A temporary feature disablement must not lose technical amendment work.

  // Get current TechnicalSolutionArtifact version
  const { data: artifact } = await supabase
    .from('technical_solution_artifacts')
    .select('id, current_version_id')
    .eq('capture_id', captureId)
    .eq('opportunity_id', opportunityId)
    .maybeSingle();

  const taskId = randomUUID();
  const idempotencyKey = `marcus:stewardship:${captureId}:${sourceDocumentVersionId}:${contentHash}`;

  // Check idempotency
  const { data: existingTask } = await supabase
    .from('marcus_technical_tasks')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingTask) {
    log.debug({ idempotencyKey }, 'Stewardship task already exists — skipping');
    return { changeEventId, material: true, ambiguous: false, taskCreated: false, taskId: existingTask.id };
  }

  await supabase.from('marcus_technical_tasks').insert({
    id: taskId,
    capture_id: captureId,
    opportunity_id: opportunityId,
    trigger_type: 'PURSUIT_CHANGE',
    question: `Material technical change detected: ${classification.reasons.map((r) => r.description).join('; ')}`,
    status: 'pending',
    idempotency_key: idempotencyKey,
  });

  log.info(
    {
      captureId, taskId, changeEventId,
      changeType: classification.classification,
      reasons: classification.reasons.map((r) => r.description),
      previousVersionId: artifact?.current_version_id,
    },
    'Material technical change → Marcus stewardship task created'
  );

  return { changeEventId, material: true, ambiguous: false, taskCreated: true, taskId };
}
