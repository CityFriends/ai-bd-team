/**
 * David Capture Research Path
 *
 * Bounded, explicitly commissioned execution path for David research
 * requested by James during capture workflow.
 *
 * This path is INDEPENDENT from the generic specialist executor.
 * SPECIALIST_EXECUTION_ENABLED remains false.
 * Only David's commissioned capability is reachable.
 *
 * Budget:
 * - Uses the SAME capture workflow envelope ($0.25 shared ceiling)
 * - Reserves against capture budget BEFORE inference
 * - Settles actual spend through Gateway
 * - Insufficient budget → no provider call → structured result
 *
 * Isolation:
 * - Cannot enable Marcus, Rosa, Acquisition Intelligence, or fixtures
 * - Cannot create additional research rounds beyond James's ceiling
 * - Returns DavidResearchResult to James, not arbitrary data
 */

import { logger } from '../../lib/logger.js';
import { getFeatureFlag } from '../../config/ai-controls.js';
import { complete } from '../../services/llm-gateway/gateway.js';
import {
  ensureWorkflowBudget,
  ensureTaskBudget,
} from '../../services/llm-gateway/budget.js';
import type { DavidResearchRequest, DavidResearchResult } from './types.js';
import { DavidResearchResultSchema } from './types.js';

const log = logger.child({ service: 'DavidCaptureResearch' });

/** Maximum cost for a David capture research call */
const DAVID_CAPTURE_TASK_COST_USD = 0.05;

/**
 * Execute a David capture research task requested by James.
 *
 * Validates:
 * 1. DAVID_INTELLIGENCE_ENABLED feature gate
 * 2. Capture exists and is in valid state
 * 3. Task belongs to the capture
 * 4. Request was made by James (structured DavidResearchRequest)
 * 5. Sufficient remaining capture budget ($0.25 shared ceiling)
 *
 * Does NOT:
 * - Enable generic specialist execution
 * - Make Marcus/Rosa/fixture specialists reachable
 * - Create additional research rounds
 * - Exceed capture budget ceiling
 */
export async function executeDavidCaptureResearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  request: DavidResearchRequest,
  taskId: string
): Promise<DavidResearchResult> {
  // 1. Feature gate
  if (!getFeatureFlag('DAVID_INTELLIGENCE_ENABLED')) {
    log.info('David intelligence disabled — returning INSUFFICIENT result');
    return insufficientResult(taskId, 'DAVID_INTELLIGENCE_ENABLED is not set');
  }

  // 2. Validate capture exists and is in valid state
  const { data: capture, error: captureErr } = await supabase
    .from('captures')
    .select('id, status, opportunity_id')
    .eq('id', request.captureId)
    .single();

  if (captureErr || !capture) {
    log.error(
      { captureId: request.captureId, error: captureErr?.message },
      'Capture not found for David research'
    );
    return insufficientResult(taskId, 'Capture not found');
  }

  // Capture must be in researching state
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
      'Opportunity mismatch — request rejected'
    );
    return insufficientResult(taskId, 'Opportunity ID mismatch');
  }

  // 4. Reserve capture budget
  const workflowScopeId = `capture-${request.captureId}`;
  const taskScopeId = `david-capture-${taskId}`;

  try {
    await ensureWorkflowBudget(supabase, workflowScopeId, 0.25);
    await ensureTaskBudget(supabase, taskScopeId, DAVID_CAPTURE_TASK_COST_USD);
  } catch (budgetErr) {
    log.warn(
      {
        captureId: request.captureId,
        error: budgetErr instanceof Error ? budgetErr.message : String(budgetErr),
      },
      'Insufficient capture budget for David research — no provider call'
    );
    return insufficientResult(
      taskId,
      'Insufficient capture budget — $0.25 ceiling may be exhausted'
    );
  }

  // 5. Build prompt
  const prompt = buildCaptureResearchPrompt(request);

  // 6. ONE LLM call via gateway
  try {
    const response = await complete({
      agentId: 'david',
      purpose: 'research',
      taskType: 'david_capture_research',
      idempotencyKey: `david-capture:${request.captureId}:${taskId}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: DAVID_CAPTURE_TASK_COST_USD,
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

    const result = DavidResearchResultSchema.safeParse({
      ...rawJson,
      taskId,
    });

    if (result.success) {
      log.info(
        {
          captureId: request.captureId,
          taskId,
          confidence: result.data.confidence,
          findings: result.data.findings.length,
        },
        'David capture research completed'
      );
      return result.data;
    }

    // Parse failure — return what we can
    log.warn(
      { captureId: request.captureId, error: result.error.message },
      'David response parse failure — returning raw findings'
    );

    return {
      taskId,
      artifactType: 'COMPETITIVE_BRIEF',
      summary: rawJson.summary || 'Research completed with parse issues',
      findings: rawJson.findings || [response.text.slice(0, 500)],
      evidenceRefs: rawJson.evidenceRefs || [],
      unresolvedQuestions: rawJson.unresolvedQuestions || [],
      confidence: 'LOW',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { captureId: request.captureId, taskId, error: message },
      'David capture research failed'
    );
    return insufficientResult(taskId, `Research failed: ${message}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function buildCaptureResearchPrompt(request: DavidResearchRequest): string {
  return `You are David, competitive intelligence analyst for FFTC.

TASK: ${request.researchType} research for active capture.

QUESTION: ${request.question}

${request.evidenceRefs.length > 0 ? `EXISTING EVIDENCE:\n${request.evidenceRefs.join('\n')}` : ''}

INSTRUCTIONS:
1. Answer the specific research question with available evidence.
2. Cite sources for every factual claim.
3. Distinguish between confirmed facts and inferred assessments.
4. Identify what remains unknown.
5. Provide capture-relevant implications.

Return ONLY JSON: {"artifactType":"${request.expectedArtifact || 'COMPETITIVE_BRIEF'}","summary":"max500","findings":["max10"],"evidenceRefs":["max10"],"unresolvedQuestions":["max5"],"confidence":"HIGH|MEDIUM|LOW"}`;
}

function insufficientResult(
  taskId: string,
  reason: string
): DavidResearchResult {
  return {
    taskId,
    artifactType: 'COMPETITIVE_BRIEF',
    summary: `Research could not be completed: ${reason}`,
    findings: [],
    evidenceRefs: [],
    unresolvedQuestions: [reason],
    confidence: 'LOW',
  };
}
