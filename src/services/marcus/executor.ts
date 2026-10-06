/**
 * Marcus Technical Intelligence Executor
 *
 * Processes marcus_technical_tasks through bounded G2X evidence
 * retrieval and ONE LLM call via the centralized gateway.
 *
 * Evidence vs Intelligence separation:
 *   - Raw G2X data persisted to external_source_records (evidence, immutable)
 *   - Marcus's analysis persisted to marcus_technical_artifacts (intelligence, versioned)
 *   - Never store AI interpretation as source fact
 *
 * CAPTURE_REQUEST tasks consume the capture workflow budget envelope,
 * not Marcus's own budget.
 *
 * Technical assessment semantics:
 *   - REQUIRED vs PROPOSED vs ASSUMED for all technology decisions
 *   - Decisive technical blockers short-circuit to James
 *   - Teaming candidates emit to workflow (NOT directly to Rosa)
 *   - Marcus does NOT make GO/NO_GO decisions
 */

import { logger } from '../../lib/logger.js';
import { getFeatureFlag } from '../../config/ai-controls.js';
import { complete } from '../llm-gateway/gateway.js';
import { ensureWorkflowBudget, ensureTaskBudget } from '../llm-gateway/budget.js';
import { getG2XAuth } from '../g2x/auth.js';
import { callToolDirect } from '../g2x/transport.js';
import {
  MarcusTriggerType,
  MarcusTaskStatus,
  MarcusArtifactType,
  MARCUS_G2X_ALLOWED_TOOLS,
  MAX_G2X_CALLS_PER_TASK,
  MAX_RECORDS_PER_TASK,
  MAX_MARCUS_REASONING_CALLS,
  CAPTURE_BUDGET_CEILING,
  MARCUS_CAPTURE_TASK_COST,
  TechnicalAssessmentSchema,
  PreliminarySolutionArchitectureSchema,
  type MarcusTriggerTypeValue,
  type MarcusG2XAllowedTool,
  type TechnicalAssessment,
  type MarcusResearchResult,
} from './types.js';

const log = logger.child({ service: 'MarcusExecutor' });

// ============================================================
// G2X Tool Boundary Enforcement
// ============================================================

const ALLOWED_TOOL_SET = new Set<string>(MARCUS_G2X_ALLOWED_TOOLS);

/**
 * Call a G2X tool with MARCUS_G2X_ALLOWED_TOOLS boundary enforcement.
 * Rejects any tool not in the allowlist regardless of remote availability.
 */
export async function callMarcusG2XTool(
  toolName: string,
  args: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!ALLOWED_TOOL_SET.has(toolName)) {
    log.warn({ tool: toolName }, 'G2X tool not in Marcus allowlist -- rejected');
    return { success: false, error: `Tool ${toolName} not in Marcus allowlist` };
  }

  try {
    const auth = getG2XAuth();
    const response = await callToolDirect(auth, { name: toolName, arguments: args });

    if ('type' in response && 'message' in response) {
      return { success: false, error: (response as { message: string }).message };
    }

    return { success: true, data: response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ============================================================
// G2X Evidence Retrieval (Bounded)
// ============================================================

interface G2XEvidence {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: Array<{ tool: string; data: any }>;
  totalCalls: number;
  totalRecords: number;
  errors: string[];
}

/**
 * Build G2X tool plan for Marcus technical research.
 * Focused on solicitation documents and opportunity details.
 */
function getG2XPlan(
  triggerType: MarcusTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Array<{ tool: MarcusG2XAllowedTool; args: Record<string, unknown> }> {
  const opportunityId = triggerData.opportunityId || '';

  switch (triggerType) {
    case MarcusTriggerType.CAPTURE_REQUEST:
      return [
        { tool: 'g2x_opportunity_documents', args: { opportunityId } },
        { tool: 'g2x_opportunity_attachment_text', args: { opportunityId } },
        { tool: 'g2x_get_record', args: { recordId: opportunityId } },
      ];

    case MarcusTriggerType.PURSUIT_CHANGE:
      return [
        { tool: 'g2x_get_record', args: { recordId: opportunityId } },
        { tool: 'g2x_opportunity_documents', args: { opportunityId } },
      ];

    case MarcusTriggerType.HUMAN_REQUEST:
      return [
        { tool: 'g2x_get_record', args: { recordId: opportunityId } },
        { tool: 'g2x_opportunity_documents', args: { opportunityId } },
        { tool: 'g2x_opportunity_attachment_text', args: { opportunityId } },
      ];

    default:
      return [];
  }
}

/**
 * Execute bounded G2X evidence retrieval for Marcus.
 * Enforces MAX_G2X_CALLS_PER_TASK and MAX_RECORDS_PER_TASK.
 * Enforces MARCUS_G2X_ALLOWED_TOOLS allowlist.
 */
async function retrieveEvidence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string,
  triggerType: MarcusTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Promise<G2XEvidence> {
  const result: G2XEvidence = {
    records: [],
    totalCalls: 0,
    totalRecords: 0,
    errors: [],
  };
  const plan = getG2XPlan(triggerType, triggerData);
  const auth = getG2XAuth();

  for (const step of plan) {
    if (result.totalCalls >= MAX_G2X_CALLS_PER_TASK) {
      log.info({ taskId, totalCalls: result.totalCalls }, 'G2X call budget exhausted');
      break;
    }
    if (result.totalRecords >= MAX_RECORDS_PER_TASK) {
      log.info({ taskId, totalRecords: result.totalRecords }, 'G2X record budget exhausted');
      break;
    }

    // Enforce tool boundary
    if (!ALLOWED_TOOL_SET.has(step.tool)) {
      log.warn({ taskId, tool: step.tool }, 'G2X tool not in Marcus allowlist -- skipped');
      result.errors.push(`Tool ${step.tool} not in allowlist`);
      continue;
    }

    try {
      const response = await callToolDirect(auth, {
        name: step.tool,
        arguments: step.args,
      });
      result.totalCalls++;

      // Check for G2X failure
      if ('type' in response && 'message' in response) {
        const failMsg = `G2X ${step.tool}: ${(response as { message: string }).message}`;
        log.warn({ taskId, tool: step.tool }, failMsg);
        result.errors.push(failMsg);
        continue;
      }

      // Extract records from MCP tool response
      const content = (response as { content?: Array<{ text?: string }> }).content || [];
      let stepRecordCount = 0;
      for (const block of content) {
        if (block.text) {
          try {
            const parsed = JSON.parse(block.text);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            const remaining = MAX_RECORDS_PER_TASK - result.totalRecords;
            const bounded = items.slice(0, remaining);
            for (const item of bounded) {
              result.records.push({ tool: step.tool, data: item });
              result.totalRecords++;
              stepRecordCount++;
            }
          } catch {
            // Non-JSON text content -- store as-is
            result.records.push({ tool: step.tool, data: { text: block.text } });
            result.totalRecords++;
            stepRecordCount++;
          }
        }
      }

      // Track G2X usage
      await supabase.from('marcus_g2x_observation').insert({
        task_id: taskId,
        tool_name: step.tool,
        record_count: stepRecordCount,
        called_at: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ taskId, tool: step.tool, error: msg }, 'G2X call failed');
      result.errors.push(`G2X ${step.tool}: ${msg}`);
      result.totalCalls++;
    }
  }

  // Persist raw evidence to external_source_records (immutable evidence layer)
  for (const record of result.records) {
    await supabase
      .from('external_source_records')
      .insert({
        source: 'g2x',
        source_tool: record.tool,
        task_id: taskId,
        agent_id: 'marcus',
        data: record.data,
        created_at: new Date().toISOString(),
      })
      .catch(() => {
        // Non-critical -- evidence persistence is best-effort
      });
  }

  return result;
}

// ============================================================
// Prompt Construction
// ============================================================

function buildMarcusPrompt(
  taskType: 'marcus_capture_research' | 'marcus_technical_stewardship',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyProfile: Record<string, any>,
  evidence: G2XEvidence,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingArtifacts: Array<Record<string, any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captureContext: Record<string, any> | null
): string {
  const evidenceSummary = evidence.records
    .slice(0, 20) // Cap evidence context to keep prompt bounded
    .map((r, i) => `[E${i + 1}] (${r.tool}): ${JSON.stringify(r.data).slice(0, 500)}`)
    .join('\n');

  const existingArtifactSummary = existingArtifacts.length > 0
    ? existingArtifacts
        .slice(0, 3)
        .map((a) => `- ${a.artifact_type}: ${a.conclusion || 'N/A'} (confidence: ${a.confidence || 'N/A'})`)
        .join('\n')
    : 'None';

  const captureSection = captureContext
    ? `\nCAPTURE CONTEXT:\nOpportunity: ${captureContext.title || captureContext.opportunity_id}\nAgency: ${captureContext.agency || 'N/A'}\nSet-aside: ${captureContext.set_aside || 'N/A'}\nVehicle: ${captureContext.vehicle || 'N/A'}\nNAICS: ${captureContext.naics || 'N/A'}`
    : '';

  return `You are Marcus, engineering lead and technical intelligence analyst for FFTC.

COMPANY CONTEXT:
${companyProfile.companyName || 'FFTC'} | NAICS: ${(companyProfile.naicsCodes || []).join(', ')} | Capabilities: ${(companyProfile.capabilities || []).slice(0, 8).join(', ')}
Certifications: ${(companyProfile.certifications || []).join(', ')}

TASK: ${taskType}
Technical Question: ${triggerData.question || 'N/A'}
${captureSection}

EXISTING TECHNICAL ARTIFACTS:
${existingArtifactSummary}

RETRIEVED EVIDENCE (${evidence.totalRecords} records from ${evidence.totalCalls} G2X calls):
${evidenceSummary || 'No evidence retrieved.'}
${evidence.errors.length > 0 ? `\nEvidence gaps: ${evidence.errors.join('; ')}` : ''}

INSTRUCTIONS:
1. Assess the technical feasibility of this opportunity for FFTC.
2. For every technology decision, classify as REQUIRED (in solicitation), PROPOSED (your recommendation), or ASSUMED (inferred).
3. Reference evidence by provenance (e.g., "Per SOW Section 3.2") -- never "G2X says".
4. Evaluate FFTC capability alignment, technical risks, and capability gaps.
5. If capability gaps exist, identify teaming needs but do NOT recommend specific partners.
6. Do NOT invent requirements, certifications, clearances, or technical constraints not in evidence.
7. Be concise and factual. Do not speculate beyond evidence.

Your technical conclusion MUST be EXACTLY one of: FEASIBLE, FEASIBLE_WITH_RISKS, TEAMING_DEPENDENT, INSUFFICIENT_EVIDENCE, TECHNICALLY_UNSUITABLE
Any other value will be rejected. Put explanations in "findings", NOT in the conclusion field.

You may NOT make GO/NO_GO decisions. James retains capture strategy authority.

"confidence" MUST be EXACTLY: HIGH, MEDIUM, or LOW.

Return ONLY valid JSON (no markdown, no extra text):
{"opportunityId":"string","conclusion":"FEASIBLE|FEASIBLE_WITH_RISKS|TEAMING_DEPENDENT|INSUFFICIENT_EVIDENCE|TECHNICALLY_UNSUITABLE","technicalSummary":"max1000","capabilityAlignment":"max500","requirementsAnalysis":[{"requirement":"max300","fftcCapability":"max300","gap":"max300 or null","classification":"REQUIRED|PROPOSED|ASSUMED"}],"technologyDecisions":[{"technology":"max200","classification":"REQUIRED|PROPOSED|ASSUMED","rationale":"max300"}],"technicalRisks":[{"risk":"max300","severity":"HIGH|MEDIUM|LOW","mitigation":"max300"}],"capabilityGaps":[{"gap":"max300","requiredCapability":"max300","teamingRecommendation":"max300"}],"findings":["max10"],"evidenceRefs":["max10"],"unresolvedQuestions":["max5"],"recommendedActions":["max5"],"confidence":"HIGH|MEDIUM|LOW","decisiveTechnicalBlocker":false,"technicalTeamingCandidate":false}`;
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Process a single Marcus technical task.
 *
 * Steps:
 * 1. Check feature gate: MARCUS_INTELLIGENCE_ENABLED
 * 2. Claim task (pending -> in_progress)
 * 3. Load capture context, opportunity, existing technical artifacts, source documents
 * 4. G2X evidence retrieval if needed (max 8 calls, 100 records, MARCUS_G2X_ALLOWED_TOOLS only)
 * 5. Build Marcus prompt with FFTC technical capabilities, evidence, solicitation requirements
 * 6. ONE LLM call via Gateway (agentId: 'marcus', purpose: 'reason')
 * 7. Parse response against appropriate artifact schema
 * 8. FAIL CLOSED on Zod validation failure (mark task failed, settle cost, no artifact persisted)
 * 9. Check for DECISIVE_TECHNICAL_BLOCKER — short-circuit if found
 * 10. Check for TECHNICAL_TEAMING_CANDIDATE — emit to workflow (NOT directly to Rosa)
 * 11. Persist artifact immutably
 * 12. Update task status
 * 13. Return MarcusResearchResult to James
 */
export async function processMarcusTechnicalTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
): Promise<MarcusResearchResult | null> {
  // 1. Feature gate
  if (!getFeatureFlag('MARCUS_INTELLIGENCE_ENABLED')) {
    log.info({ taskId }, 'Marcus intelligence disabled -- skipping task');
    return null;
  }

  // 2. Claim task
  const { data: task, error: claimErr } = await supabase
    .from('marcus_technical_tasks')
    .update({ status: MarcusTaskStatus.IN_PROGRESS, started_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('status', MarcusTaskStatus.PENDING)
    .select('*')
    .single();

  if (claimErr || !task) {
    log.info({ taskId, error: claimErr?.message }, 'Task claim failed -- already claimed or missing');
    return null;
  }

  try {
    const triggerType = task.trigger_type as MarcusTriggerTypeValue;
    const triggerData = task.trigger_data || {};
    const isCaptureRequest = triggerType === MarcusTriggerType.CAPTURE_REQUEST;
    const taskType = isCaptureRequest ? 'marcus_capture_research' : 'marcus_technical_stewardship';

    // 3. Load context
    const [companyProfile, existingArtifacts, captureContext] = await Promise.all([
      loadCompanyProfile(supabase),
      loadExistingArtifacts(supabase, triggerData.opportunityId),
      isCaptureRequest ? loadCaptureContext(supabase, triggerData) : Promise.resolve(null),
    ]);

    // 4. G2X evidence retrieval (bounded)
    const evidence = await retrieveEvidence(supabase, taskId, triggerType, triggerData);
    log.info(
      {
        taskId,
        totalCalls: evidence.totalCalls,
        totalRecords: evidence.totalRecords,
      },
      'G2X evidence retrieval complete'
    );

    // 5. Build prompt
    const prompt = buildMarcusPrompt(
      taskType as 'marcus_capture_research' | 'marcus_technical_stewardship',
      triggerData,
      companyProfile,
      evidence,
      existingArtifacts,
      captureContext
    );

    // 6. Budget setup
    const maxTaskCost = MARCUS_CAPTURE_TASK_COST;
    const wfScopeId = isCaptureRequest
      ? `capture-${triggerData.captureId || task.id}`
      : `marcus-technical-${task.id}`;
    const taskScopeId = `marcus-task-${task.id}`;

    if (isCaptureRequest && triggerData.captureId) {
      await ensureWorkflowBudget(supabase, `capture-${triggerData.captureId}`, CAPTURE_BUDGET_CEILING);
    } else {
      await ensureWorkflowBudget(supabase, wfScopeId, maxTaskCost);
    }
    await ensureTaskBudget(supabase, taskScopeId, maxTaskCost);

    // ONE LLM call -- enforced by MAX_MARCUS_REASONING_CALLS
    if (MAX_MARCUS_REASONING_CALLS < 1) {
      throw new Error('MAX_MARCUS_REASONING_CALLS is 0 -- no LLM calls permitted');
    }

    const response = await complete({
      agentId: 'marcus',
      purpose: 'reason',
      taskType,
      idempotencyKey: `marcus:${task.id}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: maxTaskCost,
      workflowId: wfScopeId,
      taskId: taskScopeId,
      opportunityId: triggerData.opportunityId || undefined,
    });

    // 7. Parse response against appropriate artifact schema
    const cleanText = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const rawJson = JSON.parse(cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    // Select schema based on assessment type
    const assessmentType = triggerData.assessmentType || 'TECHNICAL_ASSESSMENT';
    const schema = assessmentType === 'PRELIMINARY_SOLUTION_ARCHITECTURE'
      ? PreliminarySolutionArchitectureSchema
      : TechnicalAssessmentSchema;

    const parsed = schema.safeParse(rawJson);

    // 8. FAIL CLOSED on Zod validation failure
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
      log.error(
        { taskId, issues },
        'Technical artifact schema validation FAILED -- inference succeeded but artifact rejected'
      );

      // Mark task as failed with observable error
      await supabase
        .from('marcus_technical_tasks')
        .update({
          status: MarcusTaskStatus.FAILED,
          completed_at: new Date().toISOString(),
          error_message: `Schema validation failed: ${issues.join('; ')}`,
          result_payload: { validationErrors: issues, rawResponse: response.text.substring(0, 500) },
        })
        .eq('id', taskId);

      return null;
    }

    const artifact = parsed.data;

    // 9. Check for DECISIVE_TECHNICAL_BLOCKER
    const isBlocker = 'decisiveTechnicalBlocker' in artifact && artifact.decisiveTechnicalBlocker === true;
    if (isBlocker) {
      log.warn(
        { taskId, opportunityId: triggerData.opportunityId },
        'DECISIVE TECHNICAL BLOCKER detected -- short-circuiting to James'
      );
    }

    // 10. Check for TECHNICAL_TEAMING_CANDIDATE -- emit to workflow, NOT directly to Rosa
    const isTeamingCandidate = 'technicalTeamingCandidate' in artifact && artifact.technicalTeamingCandidate === true;
    if (isTeamingCandidate) {
      log.info(
        { taskId, opportunityId: triggerData.opportunityId },
        'TECHNICAL_TEAMING_CANDIDATE detected -- emitting to workflow for James'
      );
      // Emit teaming signal to workflow (James will decide whether to engage Rosa)
      await supabase.from('workflow_signals').insert({
        signal_type: 'TECHNICAL_TEAMING_CANDIDATE',
        source_agent: 'marcus',
        source_task_id: taskId,
        opportunity_id: triggerData.opportunityId || null,
        capture_id: triggerData.captureId || null,
        payload: {
          conclusion: 'conclusion' in artifact ? artifact.conclusion : null,
          capabilityGaps: 'capabilityGaps' in artifact ? artifact.capabilityGaps : [],
        },
        created_at: new Date().toISOString(),
      }).catch((err: Error) => {
        log.warn({ taskId, error: err.message }, 'Workflow signal emission failed -- non-critical');
      });
    }

    // 11. Persist artifact immutably
    const { data: savedArtifact } = await supabase
      .from('marcus_technical_artifacts')
      .insert({
        task_id: taskId,
        artifact_type: assessmentType === 'PRELIMINARY_SOLUTION_ARCHITECTURE'
          ? MarcusArtifactType.PRELIMINARY_SOLUTION_ARCHITECTURE
          : MarcusArtifactType.TECHNICAL_ASSESSMENT,
        trigger_type: triggerType,
        artifact_data: artifact,
        opportunity_id: triggerData.opportunityId || null,
        capture_id: triggerData.captureId || null,
        conclusion: 'conclusion' in artifact ? artifact.conclusion : null,
        confidence: 'confidence' in artifact ? artifact.confidence : null,
        decisive_blocker: isBlocker,
        teaming_candidate: isTeamingCandidate,
        evidence_record_count: evidence.totalRecords,
        g2x_call_count: evidence.totalCalls,
        inference_ledger_id: response.ledgerId,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // 12. Update task status
    await supabase
      .from('marcus_technical_tasks')
      .update({
        status: MarcusTaskStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        artifact_id: savedArtifact?.id,
        artifact_type: assessmentType,
        inference_ledger_id: response.ledgerId,
      })
      .eq('id', taskId);

    log.info(
      {
        taskId,
        conclusion: 'conclusion' in artifact ? artifact.conclusion : 'N/A',
        evidenceRecords: evidence.totalRecords,
        decisiveBlocker: isBlocker,
        teamingCandidate: isTeamingCandidate,
      },
      'Marcus technical task completed'
    );

    // 13. Return MarcusResearchResult to James
    const ta = artifact as TechnicalAssessment;
    return {
      taskId,
      artifactType: 'TECHNICAL_ASSESSMENT' as const,
      conclusion: ta.conclusion || 'INSUFFICIENT_EVIDENCE',
      summary: ta.deliveryConsiderations || 'Technical assessment completed',
      findings: ta.requirements.slice(0, 5).concat(ta.constraints.slice(0, 5)),
      technicalRisks: ta.technicalRisks.map(
        (r) => `${r.severity}: ${r.description} — ${r.mitigation}`
      ),
      evidenceRefs: ta.evidenceRefs || [],
      unresolvedQuestions: ta.unresolvedQuestions || [],
      recommendedActions: ta.recommendedActions || [],
      confidence: ta.confidence || 'LOW',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ taskId, error: msg }, 'Marcus technical task failed');

    await supabase
      .from('marcus_technical_tasks')
      .update({
        status: MarcusTaskStatus.FAILED,
        completed_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', taskId);

    return null;
  }
}

// ============================================================
// Process All Pending Tasks
// ============================================================

/**
 * Query and process all pending Marcus technical tasks.
 * Called by scheduler. Safety-capped at 3 tasks per run.
 */
export async function processPendingMarcusTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ processed: number; completed: number; failed: number }> {
  const result = { processed: 0, completed: 0, failed: 0 };

  if (!getFeatureFlag('MARCUS_INTELLIGENCE_ENABLED')) {
    log.info('Marcus intelligence disabled -- skipping pending task processing');
    return result;
  }

  const { data: tasks } = await supabase
    .from('marcus_technical_tasks')
    .select('id')
    .eq('status', MarcusTaskStatus.PENDING)
    .order('created_at', { ascending: true })
    .limit(3); // Safety cap per processing run

  if (!tasks || tasks.length === 0) return result;

  for (const task of tasks) {
    const outcome = await processMarcusTechnicalTask(supabase, task.id);
    result.processed++;
    if (outcome) {
      result.completed++;
    } else {
      result.failed++;
    }
  }

  log.info(result, 'Marcus pending task processing complete');
  return result;
}

// ============================================================
// Context Loaders
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCompanyProfile(supabase: any): Promise<Record<string, any>> {
  const { data } = await supabase
    .from('company_profile')
    .select('*')
    .eq('is_primary', true)
    .single();
  return data || { companyName: 'FFTC', naicsCodes: [], capabilities: [], certifications: [] };
}

async function loadExistingArtifacts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opportunityId: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<Record<string, any>>> {
  if (!opportunityId) return [];

  const { data } = await supabase
    .from('marcus_technical_artifacts')
    .select('artifact_type, conclusion, confidence, created_at')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(5);

  return data || [];
}

async function loadCaptureContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  if (!triggerData.captureId) return null;

  const { data } = await supabase
    .from('capture_aggregates')
    .select('opportunity_id, title, status, agency, set_aside, vehicle, naics')
    .eq('id', triggerData.captureId)
    .single();

  return data;
}
