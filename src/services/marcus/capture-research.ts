/**
 * Marcus Capture Research Path
 *
 * Bounded, explicitly commissioned execution path for Marcus technical
 * research requested by James during capture workflow.
 *
 * This path is INDEPENDENT from the generic specialist executor.
 * SPECIALIST_EXECUTION_ENABLED remains false.
 * Only Marcus's commissioned capability is reachable.
 *
 * Budget:
 * - Uses the SAME capture workflow envelope ($0.25 shared ceiling)
 * - Reserves against capture budget BEFORE inference
 * - Settles actual spend through Gateway
 * - Insufficient budget -> no provider call -> structured result
 *
 * Isolation:
 * - Cannot enable David, Rosa, Acquisition Intelligence, or fixtures
 * - Cannot create additional research rounds beyond James's ceiling
 * - Returns MarcusResearchResult to James, not arbitrary data
 */

import { logger } from '../../lib/logger.js';
import { getFeatureFlag } from '../../config/ai-controls.js';
import { complete } from '../../services/llm-gateway/gateway.js';
import {
  ensureWorkflowBudget,
  ensureTaskBudget,
} from '../../services/llm-gateway/budget.js';
import {
  CAPTURE_BUDGET_CEILING,
  MARCUS_CAPTURE_TASK_COST,
  TechnicalAssessmentSchema, // Used for validation at line 159
  MarcusResearchResultSchema,
  type MarcusResearchRequest,
  type MarcusResearchResult,
  // TechnicalAssessment type inferred from schema
} from './types.js';

const log = logger.child({ service: 'MarcusCaptureResearch' });

/**
 * Execute a Marcus capture research task requested by James.
 *
 * Validates:
 * 1. MARCUS_CAPTURE_RESEARCH_ENABLED feature gate
 * 2. Capture exists and is in valid state (researching/initial_assessment)
 * 3. Opportunity matches the capture
 * 4. Sufficient remaining capture budget ($0.25 shared ceiling)
 *
 * Does NOT:
 * - Enable generic specialist execution
 * - Make David/Rosa/fixture specialists reachable
 * - Create additional research rounds
 * - Exceed capture budget ceiling
 */
export async function executeMarcusCaptureResearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  request: MarcusResearchRequest,
  taskId: string
): Promise<MarcusResearchResult> {
  // 1. Feature gate
  if (!getFeatureFlag('MARCUS_CAPTURE_RESEARCH_ENABLED')) {
    log.info('Marcus intelligence disabled -- returning INSUFFICIENT result');
    return insufficientResult(taskId, 'MARCUS_CAPTURE_RESEARCH_ENABLED is not set');
  }

  // 2. Validate capture exists and is in valid state
  const { data: capture, error: captureErr } = await supabase
    .from('captures')
    .select('id, status, opportunity_id, capture_budget_scope_id')
    .eq('id', request.captureId)
    .single();

  if (captureErr || !capture) {
    log.error(
      { captureId: request.captureId, error: captureErr?.message },
      'Capture not found for Marcus research'
    );
    return insufficientResult(taskId, 'Capture not found');
  }

  // Capture must be in researching or initial_assessment state
  if (capture.status !== 'researching' && capture.status !== 'initial_assessment') {
    log.warn(
      { captureId: request.captureId, status: capture.status },
      'Capture not in valid state for research'
    );
    return insufficientResult(
      taskId,
      `Capture status ${capture.status} does not accept research`
    );
  }

  // 3. Validate opportunity matches
  if (request.opportunityId && capture.opportunity_id !== request.opportunityId) {
    log.error(
      {
        captureId: request.captureId,
        requestOppId: request.opportunityId,
        captureOppId: capture.opportunity_id,
      },
      'Opportunity mismatch -- request rejected'
    );
    return insufficientResult(taskId, 'Opportunity ID mismatch');
  }

  // 4. Reserve against SHARED capture budget (same $0.25 envelope as James)
  const workflowScopeId = `capture-${capture.id}`;
  const taskScopeId = `marcus-capture-${taskId}`;

  // ensureWorkflowBudget is idempotent -- if James already created it, this is a no-op lookup
  // The critical invariant: James + David + Rosa + Marcus share this $0.25 ceiling
  try {
    await ensureWorkflowBudget(supabase, workflowScopeId, CAPTURE_BUDGET_CEILING);
    await ensureTaskBudget(supabase, taskScopeId, MARCUS_CAPTURE_TASK_COST);
  } catch (budgetErr) {
    log.warn(
      {
        captureId: request.captureId,
        error: budgetErr instanceof Error ? budgetErr.message : String(budgetErr),
      },
      'Insufficient capture budget for Marcus research -- no provider call'
    );
    return insufficientResult(
      taskId,
      'Insufficient capture budget -- $0.25 ceiling may be exhausted'
    );
  }

  // 5. Build technical research prompt
  const prompt = buildCaptureTechnicalPrompt(request);

  // 6. ONE LLM call via gateway
  try {
    const response = await complete({
      agentId: 'marcus',
      purpose: 'reason',
      taskType: 'marcus_capture_research',
      idempotencyKey: `marcus-capture:${request.captureId}:${taskId}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: MARCUS_CAPTURE_TASK_COST,
      workflowId: workflowScopeId,
      taskId: taskScopeId,
      opportunityId: request.opportunityId || undefined,
    });

    // 7. Parse response
    const cleanText = response.text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '');
    const rawJson = JSON.parse(
      cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}'
    );

    // 8. Parse + Zod validate (fail closed)
    const assessmentParsed = TechnicalAssessmentSchema.safeParse(rawJson);

    if (!assessmentParsed.success) {
      // Fail closed: schema validation is authoritative
      const issues = assessmentParsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
      log.error(
        { captureId: request.captureId, taskId, issues },
        'Marcus capture research validation FAILED -- inference succeeded but artifact rejected'
      );
      return insufficientResult(taskId, `Schema validation failed: ${issues.join('; ')}`);
    }

    const assessment = assessmentParsed.data;

    // Persist artifact
    await supabase
      .from('technical_assessments')
      .insert({
        task_id: taskId,
        capture_id: request.captureId,
        opportunity_id: request.opportunityId || null,
        conclusion: assessment.conclusion,
        confidence: assessment.confidence,
        assessment_content: assessment,
        evidence_refs: assessment.evidenceRefs,
        idempotency_key: `assessment:${request.captureId}:${taskId}`,
      })
      .select('id')
      .single()
      .catch(() => ({ data: null }));

    // Build structured result for James
    const resultData = {
      taskId,
      artifactType: 'TECHNICAL_ASSESSMENT' as const,
      conclusion: assessment.conclusion,
      summary: assessment.deliveryConsiderations || 'Technical assessment completed',
      findings: assessment.requirements.slice(0, 5).concat(assessment.constraints.slice(0, 5)),
      technicalRisks: assessment.technicalRisks.map(
        (r) => `${r.severity}: ${r.description} — ${r.mitigation}`
      ),
      evidenceRefs: assessment.evidenceRefs,
      unresolvedQuestions: assessment.unresolvedQuestions,
      recommendedActions: assessment.recommendedActions,
      confidence: assessment.confidence,
    };

    const result = MarcusResearchResultSchema.safeParse(resultData);

    if (result.success) {
      log.info(
        {
          captureId: request.captureId,
          taskId,
          conclusion: result.data.conclusion,
          confidence: result.data.confidence,
        },
        'Marcus capture research completed'
      );
      return result.data;
    }

    // Fail closed: result schema validation is authoritative
    const resultIssues = result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
    log.error(
      { captureId: request.captureId, taskId, issues: resultIssues },
      'Marcus capture research result validation FAILED -- artifact persisted but result rejected'
    );
    return insufficientResult(taskId, `Result validation failed: ${resultIssues.join('; ')}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { captureId: request.captureId, taskId, error: message },
      'Marcus capture research failed'
    );
    return insufficientResult(taskId, `Research failed: ${message}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function buildCaptureTechnicalPrompt(request: MarcusResearchRequest): string {
  return `You are Marcus, engineering lead and technical intelligence analyst for FFTC.

TASK: Technical assessment for active capture.

RESEARCH TYPE: ${request.researchType}
QUESTION: ${request.question}

${request.evidenceRefs.length > 0 ? `EXISTING EVIDENCE:\n${request.evidenceRefs.join('\n')}` : ''}

INSTRUCTIONS:
1. Assess the technical feasibility based on the specific question and available evidence.
2. For every technology decision, classify as REQUIRED (in solicitation), PROPOSED (your recommendation), or ASSUMED (inferred).
3. Cite sources for every factual claim.
4. Distinguish between confirmed facts and inferred assessments.
5. Identify what remains unknown.
6. If capability gaps exist, identify teaming needs but do NOT recommend specific partners.
7. Do NOT invent requirements, certifications, clearances, or technical constraints not in evidence.

Your technical conclusion MUST be EXACTLY one of: FEASIBLE, FEASIBLE_WITH_RISKS, TEAMING_DEPENDENT, INSUFFICIENT_EVIDENCE, TECHNICALLY_UNSUITABLE
Any other value will be rejected. Put explanations in "findings", NOT in the conclusion field.

You may NOT make GO/NO_GO decisions. James retains capture strategy authority.

"confidence" MUST be EXACTLY: HIGH, MEDIUM, or LOW.

Return ONLY valid JSON matching this EXACT schema (no markdown):
{"captureId":"${request.captureId}","opportunityId":"${request.opportunityId || ''}","conclusion":"FEASIBLE|FEASIBLE_WITH_RISKS|TEAMING_DEPENDENT|INSUFFICIENT_EVIDENCE|TECHNICALLY_UNSUITABLE","confidence":"HIGH|MEDIUM|LOW","requirements":["max10 strings"],"constraints":["max10 strings"],"assumptions":["max10 strings"],"technicalRisks":[{"description":"max300","severity":"HIGH|MEDIUM|LOW","mitigation":"max200"}],"deliveryConsiderations":"max500","evidenceRefs":["max10 strings"],"unresolvedQuestions":["max5 strings"],"recommendedActions":["max5 strings"]}`;
}

function insufficientResult(
  taskId: string,
  reason: string
): MarcusResearchResult {
  return {
    taskId,
    artifactType: 'TECHNICAL_ASSESSMENT' as const,
    conclusion: 'INSUFFICIENT_EVIDENCE',
    summary: `Technical research could not be completed: ${reason}`,
    findings: [],
    technicalRisks: [],
    evidenceRefs: [],
    unresolvedQuestions: [reason],
    recommendedActions: [],
    confidence: 'LOW',
  };
}
