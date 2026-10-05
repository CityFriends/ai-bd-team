/**
 * Rosa Capture Research Path
 *
 * Bounded, explicitly commissioned execution path for Rosa teaming
 * research requested by James during capture workflow.
 *
 * This path is INDEPENDENT from the generic specialist executor.
 * SPECIALIST_EXECUTION_ENABLED remains false.
 * Only Rosa's commissioned capability is reachable.
 *
 * Budget:
 * - Uses the SAME capture workflow envelope ($0.25 shared ceiling)
 * - Reserves against capture budget BEFORE inference
 * - Settles actual spend through Gateway
 * - Insufficient budget -> no provider call -> structured result
 *
 * Isolation:
 * - Cannot enable Marcus, David, Acquisition Intelligence, or fixtures
 * - Cannot create additional research rounds beyond James's ceiling
 * - Returns RosaResearchResult to James, not arbitrary data
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
  ROSA_CAPTURE_TASK_COST,
  RosaResearchResultSchema,
  PartnerBriefSchema,
  type RosaResearchRequest,
  type RosaResearchResult,
  type PartnerBrief,
} from './types.js';

const log = logger.child({ service: 'RosaCaptureResearch' });

/**
 * Execute a Rosa capture research task requested by James.
 *
 * Validates:
 * 1. ROSA_INTELLIGENCE_ENABLED feature gate
 * 2. Capture exists and is in valid state
 * 3. Opportunity matches the capture
 * 4. Sufficient remaining capture budget ($0.25 shared ceiling)
 *
 * Does NOT:
 * - Enable generic specialist execution
 * - Make Marcus/David/fixture specialists reachable
 * - Create additional research rounds
 * - Exceed capture budget ceiling
 */
export async function executeRosaCaptureResearch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  request: RosaResearchRequest,
  taskId: string
): Promise<RosaResearchResult> {
  // 1. Feature gate
  if (!getFeatureFlag('ROSA_INTELLIGENCE_ENABLED')) {
    log.info('Rosa intelligence disabled -- returning INSUFFICIENT result');
    return insufficientResult(taskId, 'ROSA_INTELLIGENCE_ENABLED is not set');
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
      'Capture not found for Rosa research'
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
      'Opportunity mismatch -- request rejected'
    );
    return insufficientResult(taskId, 'Opportunity ID mismatch');
  }

  // 4. Reserve against SHARED capture budget (same $0.25 envelope as James)
  const workflowScopeId = `capture-${capture.id}`;
  const taskScopeId = `rosa-capture-${taskId}`;

  // ensureWorkflowBudget is idempotent -- if James already created it, this is a no-op lookup
  // The critical invariant: James + David + Rosa + any future specialist share this $0.25 ceiling
  try {
    await ensureWorkflowBudget(supabase, workflowScopeId, CAPTURE_BUDGET_CEILING);
    await ensureTaskBudget(supabase, taskScopeId, ROSA_CAPTURE_TASK_COST);
  } catch (budgetErr) {
    log.warn(
      {
        captureId: request.captureId,
        error: budgetErr instanceof Error ? budgetErr.message : String(budgetErr),
      },
      'Insufficient capture budget for Rosa research -- no provider call'
    );
    return insufficientResult(
      taskId,
      'Insufficient capture budget -- $0.25 ceiling may be exhausted'
    );
  }

  // 5. Build prompt for teaming assessment
  const prompt = buildCaptureTeamingPrompt(request);

  // 6. ONE LLM call via gateway
  try {
    const response = await complete({
      agentId: 'rosa',
      purpose: 'research',
      taskType: 'rosa_capture_research',
      idempotencyKey: `rosa-capture:${request.captureId}:${taskId}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: ROSA_CAPTURE_TASK_COST,
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

    // 8. Parse PartnerBrief from response
    const briefParsed = PartnerBriefSchema.safeParse(rawJson);
    let briefData: PartnerBrief | Record<string, unknown>;
    if (briefParsed.success) {
      briefData = briefParsed.data;
    } else {
      log.warn(
        { captureId: request.captureId, error: briefParsed.error.message },
        'PartnerBrief parse failure -- storing raw'
      );
      briefData = rawJson;
    }

    // 9. Persist PartnerBrief
    const { data: savedBrief } = await supabase
      .from('rosa_partner_briefs')
      .insert({
        task_id: taskId,
        artifact_type: 'PARTNER_BRIEF',
        trigger_type: 'CAPTURE_REQUEST',
        brief_data: briefData,
        company_name: (briefData as PartnerBrief).company || 'Unknown',
        capture_id: request.captureId,
        opportunity_id: request.opportunityId || null,
        inference_ledger_id: response.ledgerId,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // 10. Build structured result for James
    const resultData = {
      taskId,
      partnerBriefId: savedBrief?.id || taskId,
      recommendedRelationship: (briefData as PartnerBrief).recommendedRelationship || 'EXPLORE',
      summary: (briefData as PartnerBrief).capabilityComplementarity ||
        rawJson.summary || 'Research completed',
      findings: (briefData as PartnerBrief).findings || [],
      evidenceRefs: (briefData as PartnerBrief).evidenceRefs || [],
      unresolvedQuestions: (briefData as PartnerBrief).unresolvedQuestions || [],
      recommendedActions: (briefData as PartnerBrief).recommendedActions || [],
      confidence: (briefData as PartnerBrief).confidence || 'LOW',
    };

    const result = RosaResearchResultSchema.safeParse(resultData);

    if (result.success) {
      log.info(
        {
          captureId: request.captureId,
          taskId,
          confidence: result.data.confidence,
          recommendedRelationship: result.data.recommendedRelationship,
        },
        'Rosa capture research completed'
      );
      return result.data;
    }

    // Parse failure -- return what we can
    log.warn(
      { captureId: request.captureId, error: result.error.message },
      'Rosa result parse failure -- returning raw findings'
    );

    return {
      taskId,
      partnerBriefId: savedBrief?.id || taskId,
      recommendedRelationship: 'EXPLORE',
      summary: rawJson.summary || 'Research completed with parse issues',
      findings: rawJson.findings || [response.text.slice(0, 500)],
      evidenceRefs: rawJson.evidenceRefs || [],
      unresolvedQuestions: rawJson.unresolvedQuestions || [],
      recommendedActions: rawJson.recommendedActions || [],
      confidence: 'LOW',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      { captureId: request.captureId, taskId, error: message },
      'Rosa capture research failed'
    );
    return insufficientResult(taskId, `Research failed: ${message}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function buildCaptureTeamingPrompt(request: RosaResearchRequest): string {
  return `You are Rosa, teaming and partner intelligence analyst for FFTC.

TASK: Teaming assessment for active capture.

TEAMING NEED: ${request.teamingNeed}
QUESTION: ${request.question}

${request.evidenceRefs.length > 0 ? `EXISTING EVIDENCE:\n${request.evidenceRefs.join('\n')}` : ''}

INSTRUCTIONS:
1. Assess potential teaming partners based on the specific teaming need.
2. Evaluate capability complementarity, customer access, vehicle position, and past performance.
3. Cite sources for every factual claim.
4. Distinguish between confirmed facts and inferred assessments.
5. Identify what remains unknown.
6. Recommend a relationship direction: PRIME_PARTNER, SUB_TO_PARTNER, JV, EXPLORE, or NOT_RECOMMENDED.
7. DO NOT include unnecessary contact data (phone/email) for fit assessment.

Return ONLY JSON matching PartnerBrief schema:
{"company":"string","companyIdentifiers":{"uei":null,"cage":null,"sam":null},"contextType":"CAPTURE","captureId":"${request.captureId}","opportunityId":"${request.opportunityId || ''}","recommendedRelationship":"PRIME_PARTNER|SUB_TO_PARTNER|JV|EXPLORE|NOT_RECOMMENDED","capabilityComplementarity":"max500","customerAccess":"max500","vehiclePosition":"max500","pastPerformanceComplementarity":"max500","socioeconomicStrategy":"max500","relationshipAndCompetitiveRisk":"max500","knownFFTCRelationships":["max5"],"findings":["max10"],"evidenceRefs":["max10"],"unresolvedQuestions":["max5"],"recommendedActions":["max5"],"confidence":"HIGH|MEDIUM|LOW"}`;
}

function insufficientResult(
  taskId: string,
  reason: string
): RosaResearchResult {
  return {
    taskId,
    partnerBriefId: taskId,
    recommendedRelationship: 'NOT_RECOMMENDED',
    summary: `Research could not be completed: ${reason}`,
    findings: [],
    evidenceRefs: [],
    unresolvedQuestions: [reason],
    recommendedActions: [],
    confidence: 'LOW',
  };
}
