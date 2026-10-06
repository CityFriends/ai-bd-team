/**
 * Rosa Intelligence Executor
 *
 * Processes rosa_intelligence_tasks through bounded G2X evidence
 * retrieval and ONE LLM call via the centralized gateway.
 *
 * Evidence vs Intelligence separation:
 *   - Raw G2X data persisted to external_source_records (evidence, immutable)
 *   - Rosa's analysis persisted to rosa_partner_briefs (intelligence, versioned)
 *   - Never store AI interpretation as source fact
 *
 * CAPTURE_REQUEST tasks consume the capture workflow budget envelope,
 * not Rosa's own observation window budget.
 *
 * Teaming tool semantics:
 *   g2x_teaming_partners returning 0 results = "NO RESULTS RETURNED"
 *   NOT "NO PARTNERS EXIST". Fall back to company + award evidence.
 */

import { logger } from '../../lib/logger.js';
import { complete } from '../llm-gateway/gateway.js';
import { ensureWorkflowBudget, ensureTaskBudget } from '../llm-gateway/budget.js';
import { getG2XAuth } from '../g2x/auth.js';
import { callToolDirect } from '../g2x/transport.js';
import {
  RosaTriggerType,
  RosaTaskStatus,
  RosaArtifactType,
  ROSA_G2X_ALLOWED_TOOLS,
  MAX_G2X_CALLS_PER_TASK,
  MAX_RECORDS_PER_TASK,
  MAX_ROSA_REASONING_CALLS,
  CAPTURE_BUDGET_CEILING,
  ROSA_CAPTURE_TASK_COST,
  PartnerBriefSchema,
  type RosaTriggerTypeValue,
  type RosaG2XAllowedTool,
  type PartnerBrief,
} from './types.js';
import { projectRosaIntelligence } from './slack-surface.js';

const log = logger.child({ service: 'RosaExecutor' });

// ============================================================
// G2X Tool Plans per Trigger Type
// ============================================================

/**
 * Maps trigger types to ordered G2X tool sequences.
 * Each plan is bounded by MAX_G2X_CALLS_PER_TASK.
 */
function getG2XPlan(
  triggerType: RosaTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Array<{ tool: RosaG2XAllowedTool; args: Record<string, unknown> }> {
  switch (triggerType) {
    case RosaTriggerType.CAPTURE_REQUEST:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.question || triggerData.companyName || '' } },
        {
          tool: 'g2x_company_contract_history',
          args: { companyName: triggerData.companyName || triggerData.question || '' },
        },
        { tool: 'g2x_search_records', args: { query: triggerData.question || '' } },
        { tool: 'g2x_teaming_partners', args: { companyName: triggerData.companyName || '' } },
      ];

    case RosaTriggerType.DAVID_PARTNER_CANDIDATE:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.companyName || '' } },
        {
          tool: 'g2x_company_contract_history',
          args: { companyName: triggerData.companyName || '' },
        },
        { tool: 'g2x_teaming_partners', args: { companyName: triggerData.companyName || '' } },
        ...(triggerData.recordId
          ? [{ tool: 'g2x_get_record' as RosaG2XAllowedTool, args: { recordId: triggerData.recordId } }]
          : []),
      ];

    case RosaTriggerType.COMPANY_SIGNAL:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.companyName || '' } },
        {
          tool: 'g2x_company_contract_history',
          args: { companyName: triggerData.companyName || '' },
        },
        { tool: 'g2x_teaming_partners', args: { companyName: triggerData.companyName || '' } },
      ];

    case RosaTriggerType.RELATIONSHIP_SIGNAL:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.companyName || '' } },
        {
          tool: 'g2x_company_contract_history',
          args: { companyName: triggerData.companyName || '' },
        },
      ];

    case RosaTriggerType.HUMAN_REQUEST:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.question || '' } },
        { tool: 'g2x_search_records', args: { query: triggerData.question || '' } },
        { tool: 'g2x_teaming_partners', args: { companyName: triggerData.question || '' } },
      ];

    default:
      return [];
  }
}

// ============================================================
// G2X Tool Boundary Enforcement
// ============================================================

const ALLOWED_TOOL_SET = new Set<string>(ROSA_G2X_ALLOWED_TOOLS);

/**
 * Call a G2X tool with ROSA_G2X_ALLOWED_TOOLS boundary enforcement.
 * Rejects any tool not in the allowlist regardless of remote availability.
 */
export async function callRosaG2XTool(
  toolName: string,
  args: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!ALLOWED_TOOL_SET.has(toolName)) {
    log.warn({ tool: toolName }, 'G2X tool not in Rosa allowlist -- rejected');
    return { success: false, error: `Tool ${toolName} not in Rosa allowlist` };
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
// Evidence Retrieval (Bounded)
// ============================================================

interface G2XEvidence {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: Array<{ tool: string; data: any }>;
  totalCalls: number;
  totalRecords: number;
  errors: string[];
  teamingPartnersQueried: boolean;
  teamingPartnersReturned: number;
}

/**
 * Execute bounded G2X evidence retrieval.
 * Enforces MAX_G2X_CALLS_PER_TASK and MAX_RECORDS_PER_TASK.
 * Enforces ROSA_G2X_ALLOWED_TOOLS allowlist.
 */
async function retrieveEvidence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string,
  triggerType: RosaTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Promise<G2XEvidence> {
  const result: G2XEvidence = {
    records: [],
    totalCalls: 0,
    totalRecords: 0,
    errors: [],
    teamingPartnersQueried: false,
    teamingPartnersReturned: 0,
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
      log.warn({ taskId, tool: step.tool }, 'G2X tool not in Rosa allowlist -- skipped');
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

      // Track teaming partners tool semantics
      if (step.tool === 'g2x_teaming_partners') {
        result.teamingPartnersQueried = true;
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

      // Track teaming partners result count
      if (step.tool === 'g2x_teaming_partners') {
        result.teamingPartnersReturned = stepRecordCount;
      }

      // Track G2X usage
      await supabase.from('rosa_g2x_observation').insert({
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
        agent_id: 'rosa',
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

function buildRosaPrompt(
  triggerType: RosaTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyProfile: Record<string, any>,
  evidence: G2XEvidence,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingRelationships: Array<Record<string, any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captureContext: Record<string, any> | null
): string {
  const evidenceSummary = evidence.records
    .slice(0, 20) // Cap evidence context to keep prompt bounded
    .map((r, i) => `[E${i + 1}] (${r.tool}): ${JSON.stringify(r.data).slice(0, 500)}`)
    .join('\n');

  const teamingNote = evidence.teamingPartnersQueried && evidence.teamingPartnersReturned === 0
    ? '\nIMPORTANT: g2x_teaming_partners returned 0 results. This means NO RESULTS RETURNED, not NO PARTNERS EXIST. Rely on company profile and award evidence instead.'
    : '';

  const relationshipContext = existingRelationships.length > 0
    ? existingRelationships
        .slice(0, 5)
        .map((r) => `- ${r.company_name}: ${r.relationship_type} (${r.status || 'unknown'})`)
        .join('\n')
    : 'None known';

  const captureSection = captureContext
    ? `\nCAPTURE CONTEXT:\nOpportunity: ${captureContext.title || captureContext.opportunity_id}\nAgency: ${captureContext.agency || 'N/A'}\nSet-aside: ${captureContext.set_aside || 'N/A'}\nVehicle: ${captureContext.vehicle || 'N/A'}\nNAICS: ${captureContext.naics || 'N/A'}`
    : '';

  return `You are Rosa, teaming and partner intelligence analyst for ${companyProfile.companyName || 'FFTC'}.

COMPANY CONTEXT:
${companyProfile.companyName || 'FFTC'} | NAICS: ${(companyProfile.naicsCodes || []).join(', ')} | Capabilities: ${(companyProfile.capabilities || []).slice(0, 8).join(', ')}
Certifications: ${(companyProfile.certifications || []).join(', ')}

TASK: ${triggerType} -- produce a partner brief
Question/Signal: ${triggerData.question || triggerData.signalSummary || triggerData.companyName || 'N/A'}
${captureSection}

EXISTING FFTC RELATIONSHIPS:
${relationshipContext}

RETRIEVED EVIDENCE (${evidence.totalRecords} records from ${evidence.totalCalls} G2X calls):
${evidenceSummary || 'No evidence retrieved.'}
${evidence.errors.length > 0 ? `\nEvidence gaps: ${evidence.errors.join('; ')}` : ''}${teamingNote}

INSTRUCTIONS:
1. Assess whether this company is a viable teaming partner for FFTC.
2. Reference evidence by provenance (e.g., "Per FPDS award W911QX-23-C-0042") -- never "G2X says".
3. Evaluate capability complementarity, customer access, vehicle position, and past performance.
4. Recommend a relationship direction: PRIME_PARTNER, SUB_TO_PARTNER, JV, EXPLORE, or NOT_RECOMMENDED.
5. DO NOT include unnecessary contact data (phone/email) for fit assessment.
6. Be concise and factual. Do not speculate beyond evidence.

CRITICAL: "recommendedRelationship" MUST be EXACTLY one of these 5 values (no other text):
  PRIME_PARTNER
  SUB_TO_PARTNER
  JV
  EXPLORE
  NOT_RECOMMENDED
Any other value will be rejected. Put explanations in "findings", NOT in this field.

"confidence" MUST be EXACTLY: HIGH, MEDIUM, or LOW.

Return ONLY valid JSON (no markdown, no extra text):
{"company":"string","companyIdentifiers":{"uei":null,"cage":null,"sam":null},"contextType":"CAPTURE|PROACTIVE|HUMAN_REQUEST","recommendedRelationship":"PRIME_PARTNER|SUB_TO_PARTNER|JV|EXPLORE|NOT_RECOMMENDED","capabilityComplementarity":"max500","customerAccess":"max500","vehiclePosition":"max500","pastPerformanceComplementarity":"max500","socioeconomicStrategy":"max500","relationshipAndCompetitiveRisk":"max500","knownFFTCRelationships":["max5"],"findings":["max10"],"evidenceRefs":["max10"],"unresolvedQuestions":["max5"],"recommendedActions":["max5"],"confidence":"HIGH|MEDIUM|LOW"}`;
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Process a single Rosa intelligence task.
 *
 * Steps:
 * 1. Check Rosa observation window (claim_rosa_observation_slot)
 * 2. Claim task (pending -> in_progress)
 * 3. Load context: FFTC profile, existing org/relationship data, active captures
 * 4. Bounded G2X research (max 8 calls, 100 records, ROSA_G2X_ALLOWED_TOOLS only)
 * 5. Build Rosa prompt
 * 6. ONE LLM call via Gateway
 * 7. Parse response into PartnerBrief
 * 8. Persist to rosa_partner_briefs
 * 9. Update organization profile
 * 10. Settle observation window
 * 11. Determine: POST / STORE_ONLY / WATCH
 * 12. Update task status
 */
export async function processRosaTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  // 1. Check Rosa observation window
  const isCaptureRequest = await checkIfCaptureRequest(supabase, taskId);

  if (!isCaptureRequest) {
    const { data: obsSlot } = await supabase
      .rpc('claim_rosa_observation_slot', {
        p_task_id: taskId,
        p_reserved_cost_usd: 0.03,
      })
      .catch(() => ({ data: true })); // RPC not found = no window = no limit

    if (obsSlot === false) {
      log.info({ taskId }, 'Rosa observation window exhausted -- skipping task');
      await supabase
        .from('rosa_intelligence_tasks')
        .update({ status: RosaTaskStatus.SKIPPED, completed_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('status', RosaTaskStatus.PENDING);
      return null;
    }
  }

  // 2. Claim task
  const { data: task, error: claimErr } = await supabase
    .from('rosa_intelligence_tasks')
    .update({ status: RosaTaskStatus.IN_PROGRESS, started_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('status', RosaTaskStatus.PENDING)
    .select('*')
    .single();

  if (claimErr || !task) {
    log.info({ taskId, error: claimErr?.message }, 'Task claim failed -- already claimed or missing');
    return null;
  }

  try {
    const triggerType = task.trigger_type as RosaTriggerTypeValue;
    const triggerData = task.trigger_data || {};

    // 3. Load context
    const [companyProfile, existingRelationships, captureContext] = await Promise.all([
      loadCompanyProfile(supabase),
      loadExistingRelationships(supabase, triggerData),
      isCaptureRequest ? loadCaptureContext(supabase, triggerData) : Promise.resolve(null),
    ]);

    // 4. G2X evidence retrieval (bounded)
    const evidence = await retrieveEvidence(supabase, taskId, triggerType, triggerData);
    log.info(
      {
        taskId,
        totalCalls: evidence.totalCalls,
        totalRecords: evidence.totalRecords,
        teamingPartnersQueried: evidence.teamingPartnersQueried,
        teamingPartnersReturned: evidence.teamingPartnersReturned,
      },
      'G2X evidence retrieval complete'
    );

    // 5. Build prompt
    const prompt = buildRosaPrompt(
      triggerType,
      triggerData,
      companyProfile,
      evidence,
      existingRelationships,
      captureContext
    );

    // 6. Budget setup
    const maxTaskCost = isCaptureRequest ? ROSA_CAPTURE_TASK_COST : 0.03;
    const wfScopeId = isCaptureRequest
      ? `capture-${triggerData.captureId || task.id}`
      : `rosa-intelligence-${task.id}`;
    const taskScopeId = `rosa-task-${task.id}`;

    if (isCaptureRequest && triggerData.captureId) {
      await ensureWorkflowBudget(supabase, `capture-${triggerData.captureId}`, CAPTURE_BUDGET_CEILING);
    } else {
      await ensureWorkflowBudget(supabase, wfScopeId, maxTaskCost);
    }
    await ensureTaskBudget(supabase, taskScopeId, maxTaskCost);

    // ONE LLM call -- enforced by MAX_ROSA_REASONING_CALLS
    if (MAX_ROSA_REASONING_CALLS < 1) {
      throw new Error('MAX_ROSA_REASONING_CALLS is 0 -- no LLM calls permitted');
    }

    const response = await complete({
      agentId: 'rosa',
      purpose: 'research',
      taskType: 'rosa_intelligence',
      idempotencyKey: `rosa:${task.id}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: maxTaskCost,
      workflowId: wfScopeId,
      taskId: taskScopeId,
      opportunityId: triggerData.opportunityId || undefined,
    });

    // 7. Parse response into PartnerBrief
    const cleanText = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const rawJson = JSON.parse(cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    const parsed = PartnerBriefSchema.safeParse(rawJson);
    if (!parsed.success) {
      // Fail closed: do NOT persist a malformed PartnerBrief
      const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`);
      log.error(
        { taskId, issues },
        'PartnerBrief schema validation FAILED — inference succeeded but artifact rejected'
      );

      // Still settle actual provider cost (inference occurred)
      // Settle observation (same RPC pattern as success path)
      await supabase
        .rpc('settle_rosa_observation_slot', {
          p_task_id: task.id,
          p_reserved_cost_usd: 0.03,
          p_actual_cost_usd: 0, // No artifact produced but provider was called
          p_ledger_id: response.ledgerId,
        })
        .catch(() => {}); // Non-critical

      // Mark task as failed with observable error
      await supabase
        .from('rosa_intelligence_tasks')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `PartnerBrief validation failed: ${issues.join('; ')}`,
          result_payload: { validationErrors: issues, rawResponse: response.text.substring(0, 500) },
        })
        .eq('id', taskId);

      return null;
    }

    const brief = parsed.data;

    // 8. Persist to rosa_partner_briefs
    const { data: savedBrief } = await supabase
      .from('rosa_partner_briefs')
      .insert({
        task_id: taskId,
        artifact_type: RosaArtifactType.PARTNER_BRIEF,
        trigger_type: triggerType,
        brief_data: brief,
        company_name: (brief as PartnerBrief).company || triggerData.companyName || 'Unknown',
        evidence_record_count: evidence.totalRecords,
        g2x_call_count: evidence.totalCalls,
        inference_ledger_id: response.ledgerId,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // 9. Update organization profile if applicable
    await updatePartnerProfile(supabase, brief as PartnerBrief, triggerData);

    // 10. Settle observation window (non-capture tasks only)
    if (!isCaptureRequest) {
      await supabase
        .rpc('settle_rosa_observation_slot', {
          p_task_id: taskId,
          p_reserved_cost_usd: 0.03,
          p_actual_cost_usd: response.costUsd || 0,
          p_ledger_id: response.ledgerId,
        })
        .catch(() => {}); // Non-critical if observation window doesn't exist
    }

    // 11. Determine projection
    const projection = determineProjection(triggerType, brief as PartnerBrief);

    if (projection === 'POST') {
      try {
        await projectRosaIntelligence(supabase, task, brief as PartnerBrief);
      } catch (slackErr) {
        log.error(
          { taskId, error: slackErr instanceof Error ? slackErr.message : String(slackErr) },
          'Slack projection failed -- DB state is authoritative'
        );
      }
    }

    // 12. Update task status
    await supabase
      .from('rosa_intelligence_tasks')
      .update({
        status: RosaTaskStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        brief_id: savedBrief?.id,
        artifact_type: RosaArtifactType.PARTNER_BRIEF,
        projection,
        inference_ledger_id: response.ledgerId,
      })
      .eq('id', taskId);

    log.info(
      { taskId, projection, evidenceRecords: evidence.totalRecords },
      'Rosa task completed'
    );

    return brief as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ taskId, error: msg }, 'Rosa task failed');

    await supabase
      .from('rosa_intelligence_tasks')
      .update({
        status: RosaTaskStatus.FAILED,
        completed_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', taskId);

    // Settle observation window on failure (non-capture only)
    if (!isCaptureRequest) {
      await supabase
        .rpc('settle_rosa_observation_slot', {
          p_task_id: taskId,
          p_reserved_cost_usd: 0.03,
          p_actual_cost_usd: 0,
          p_ledger_id: null,
        })
        .catch(() => {});
    }

    return null;
  }
}

// ============================================================
// Process All Pending Tasks
// ============================================================

/**
 * Query and process all pending Rosa intelligence tasks.
 * Called by scheduler. Safety-capped at 5 tasks per run.
 */
export async function processPendingRosaTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ processed: number; completed: number; failed: number; skipped: number }> {
  const result = { processed: 0, completed: 0, failed: 0, skipped: 0 };

  const { data: tasks } = await supabase
    .from('rosa_intelligence_tasks')
    .select('id')
    .eq('status', RosaTaskStatus.PENDING)
    .order('created_at', { ascending: true })
    .limit(5); // Safety cap per processing run

  if (!tasks || tasks.length === 0) return result;

  for (const task of tasks) {
    const outcome = await processRosaTask(supabase, task.id);
    result.processed++;
    if (outcome) {
      result.completed++;
    } else {
      // Distinguish skipped (observation exhausted) from failed
      const { data: check } = await supabase
        .from('rosa_intelligence_tasks')
        .select('status')
        .eq('id', task.id)
        .single();
      if (check?.status === RosaTaskStatus.SKIPPED) {
        result.skipped++;
      } else {
        result.failed++;
      }
    }
  }

  log.info(result, 'Rosa pending task processing complete');
  return result;
}

// ============================================================
// Context Loaders
// ============================================================

async function checkIfCaptureRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('rosa_intelligence_tasks')
    .select('trigger_type')
    .eq('id', taskId)
    .single();
  return data?.trigger_type === RosaTriggerType.CAPTURE_REQUEST;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCompanyProfile(supabase: any): Promise<Record<string, any>> {
  const { data } = await supabase
    .from('company_profile')
    .select('*')
    .eq('is_primary', true)
    .single();
  return data || { companyName: 'FFTC', naicsCodes: [], capabilities: [], certifications: [] };
}

async function loadExistingRelationships(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<Record<string, any>>> {
  // Load known FFTC relationships for context
  const companyName = triggerData.companyName;
  if (!companyName) return [];

  const { data } = await supabase
    .from('partner_relationships')
    .select('company_name, relationship_type, status, last_interaction')
    .ilike('company_name', `%${companyName}%`)
    .limit(10);

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

// ============================================================
// Profile Updates
// ============================================================

async function updatePartnerProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brief: PartnerBrief,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Promise<void> {
  try {
    const uei = brief.companyIdentifiers?.uei || triggerData.uei || null;
    if (!uei) return;

    await supabase.from('partner_intelligence_profiles').upsert(
      {
        uei,
        company_name: brief.company,
        capability_complementarity: brief.capabilityComplementarity || '',
        customer_access: brief.customerAccess || '',
        vehicle_position: brief.vehiclePosition || '',
        recommended_relationship: brief.recommendedRelationship,
        confidence: brief.confidence,
        last_refreshed: new Date().toISOString(),
      },
      { onConflict: 'uei' }
    );
  } catch (err) {
    log.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Partner profile update failed -- non-critical'
    );
  }
}

// ============================================================
// Projection Determination
// ============================================================

/**
 * Determine whether to POST to Slack, STORE_ONLY, or WATCH.
 * CAPTURE_REQUEST results are always STORE_ONLY (returned to James).
 */
function determineProjection(
  triggerType: RosaTriggerTypeValue,
  brief: PartnerBrief
): 'POST' | 'STORE_ONLY' | 'WATCH' {
  // Capture requests go back to James, not to Slack
  if (triggerType === RosaTriggerType.CAPTURE_REQUEST) return 'STORE_ONLY';

  // Human requests always project
  if (triggerType === RosaTriggerType.HUMAN_REQUEST) return 'POST';

  // Not recommended = store only
  if (brief.recommendedRelationship === 'NOT_RECOMMENDED') return 'STORE_ONLY';

  // EXPLORE with low confidence = watch
  if (brief.recommendedRelationship === 'EXPLORE' && brief.confidence === 'LOW') {
    return 'WATCH';
  }

  // Default: POST for actionable partner intelligence
  return 'POST';
}
