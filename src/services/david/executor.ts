/**
 * David Intelligence Executor
 *
 * Processes david_intelligence_tasks through bounded G2X evidence
 * retrieval and ONE LLM call via the centralized gateway.
 *
 * Evidence vs Intelligence separation:
 *   - Raw G2X data persisted to external_source_records (evidence, immutable)
 *   - David's analysis persisted to david_artifacts (intelligence, versioned)
 *   - Never store AI interpretation as source fact
 *
 * CAPTURE_REQUEST tasks consume the capture workflow budget envelope,
 * not David's own observation window budget.
 */

import { logger } from '../../lib/logger.js';
import { complete } from '../llm-gateway/gateway.js';
import { ensureWorkflowBudget, ensureTaskBudget } from '../llm-gateway/budget.js';
import { getG2XAuth } from '../g2x/auth.js';
import { callToolDirect } from '../g2x/transport.js';
import {
  DavidTriggerType,
  DavidTaskStatus,
  DavidArtifactType,
  DAVID_G2X_ALLOWED_TOOLS,
  MAX_G2X_CALLS_PER_SIGNAL,
  MAX_RECORDS_PER_SIGNAL,
  MAX_DAVID_REASONING_CALLS,
  CompetitiveBriefSchema,
  CustomerMarketBriefSchema,
  ForecastSignalArtifactSchema,
  EventBriefArtifactSchema,
  DavidResearchResultSchema,
  PartnerIntelligenceCandidateSchema,
  type DavidTriggerTypeValue,
  type DavidArtifactTypeValue,
  type DavidG2XAllowedTool,
} from './types.js';
import { projectDavidIntelligence } from './slack-surface.js';

const log = logger.child({ service: 'DavidExecutor' });

// ============================================================
// G2X Tool Plans per Trigger Type
// ============================================================

/**
 * Maps trigger types to ordered G2X tool sequences.
 * Each plan is bounded by MAX_G2X_CALLS_PER_SIGNAL.
 */
function getG2XPlan(
  triggerType: DavidTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Array<{ tool: DavidG2XAllowedTool; args: Record<string, unknown> }> {
  switch (triggerType) {
    case DavidTriggerType.CAPTURE_REQUEST:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.question || '' } },
        {
          tool: 'g2x_company_contract_history',
          args: { companyName: triggerData.companyName || triggerData.question || '' },
        },
        { tool: 'g2x_search_records', args: { query: triggerData.question || '' } },
      ];

    case DavidTriggerType.FORECAST_SIGNAL:
      return [
        {
          tool: 'g2x_forecast_scan',
          args: {
            query: triggerData.forecastQuery || triggerData.customer || '',
            agency: triggerData.agency || undefined,
          },
        },
        ...(triggerData.recordId
          ? [
              {
                tool: 'g2x_get_record' as DavidG2XAllowedTool,
                args: { recordId: triggerData.recordId },
              },
            ]
          : []),
      ];

    case DavidTriggerType.COMPETITIVE_SIGNAL:
      return [
        { tool: 'g2x_search_companies', args: { query: triggerData.companyName || '' } },
        {
          tool: 'g2x_company_contract_history',
          args: { companyName: triggerData.companyName || '' },
        },
        ...(triggerData.uei
          ? [
              {
                tool: 'g2x_get_graph_neighborhood' as DavidG2XAllowedTool,
                args: { entityId: triggerData.uei },
              },
            ]
          : []),
      ];

    case DavidTriggerType.GOVCON_EVENT:
      return [
        ...(triggerData.eventId
          ? [
              {
                tool: 'g2x_get_event' as DavidG2XAllowedTool,
                args: { eventId: triggerData.eventId },
              },
            ]
          : [
              {
                tool: 'g2x_search_events' as DavidG2XAllowedTool,
                args: { query: triggerData.eventName || '' },
              },
            ]),
      ];

    case DavidTriggerType.HUMAN_REQUEST:
      // Best-effort tool selection from the question
      return [
        { tool: 'g2x_search_records', args: { query: triggerData.question || '' } },
        { tool: 'g2x_search_companies', args: { query: triggerData.question || '' } },
      ];

    default:
      return [];
  }
}

// ============================================================
// Artifact Schema Selection
// ============================================================

function getArtifactSchema(artifactType: DavidArtifactTypeValue) {
  switch (artifactType) {
    case DavidArtifactType.COMPETITIVE_BRIEF:
      return CompetitiveBriefSchema;
    case DavidArtifactType.CUSTOMER_MARKET_BRIEF:
      return CustomerMarketBriefSchema;
    case DavidArtifactType.FORECAST_SIGNAL:
      return ForecastSignalArtifactSchema;
    case DavidArtifactType.EVENT_BRIEF:
      return EventBriefArtifactSchema;
    default:
      return null;
  }
}

/**
 * Determine the artifact type from the trigger type.
 */
function inferArtifactType(
  triggerType: DavidTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): DavidArtifactTypeValue {
  if (triggerData.expectedArtifact) {
    return triggerData.expectedArtifact as DavidArtifactTypeValue;
  }
  switch (triggerType) {
    case DavidTriggerType.FORECAST_SIGNAL:
      return DavidArtifactType.FORECAST_SIGNAL;
    case DavidTriggerType.GOVCON_EVENT:
      return DavidArtifactType.EVENT_BRIEF;
    case DavidTriggerType.COMPETITIVE_SIGNAL:
      return DavidArtifactType.COMPETITIVE_BRIEF;
    case DavidTriggerType.CAPTURE_REQUEST:
    case DavidTriggerType.HUMAN_REQUEST:
    default:
      return DavidArtifactType.COMPETITIVE_BRIEF;
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
}

/**
 * Execute bounded G2X evidence retrieval.
 * Enforces MAX_G2X_CALLS_PER_SIGNAL and MAX_RECORDS_PER_SIGNAL.
 * Enforces DAVID_G2X_ALLOWED_TOOLS allowlist.
 */
async function retrieveEvidence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string,
  triggerType: DavidTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Promise<G2XEvidence> {
  const result: G2XEvidence = { records: [], totalCalls: 0, totalRecords: 0, errors: [] };
  const plan = getG2XPlan(triggerType, triggerData);
  const auth = getG2XAuth();
  const allowedSet = new Set<string>(DAVID_G2X_ALLOWED_TOOLS);

  for (const step of plan) {
    if (result.totalCalls >= MAX_G2X_CALLS_PER_SIGNAL) {
      log.info({ taskId, totalCalls: result.totalCalls }, 'G2X call budget exhausted');
      break;
    }
    if (result.totalRecords >= MAX_RECORDS_PER_SIGNAL) {
      log.info({ taskId, totalRecords: result.totalRecords }, 'G2X record budget exhausted');
      break;
    }

    // Enforce tool boundary
    if (!allowedSet.has(step.tool)) {
      log.warn({ taskId, tool: step.tool }, 'G2X tool not in David allowlist — skipped');
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
      for (const block of content) {
        if (block.text) {
          try {
            const parsed = JSON.parse(block.text);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            const remaining = MAX_RECORDS_PER_SIGNAL - result.totalRecords;
            const bounded = items.slice(0, remaining);
            for (const item of bounded) {
              result.records.push({ tool: step.tool, data: item });
              result.totalRecords++;
            }
          } catch {
            // Non-JSON text content — store as-is
            result.records.push({ tool: step.tool, data: { text: block.text } });
            result.totalRecords++;
          }
        }
      }

      // Track G2X usage
      await supabase.from('david_g2x_observation').insert({
        task_id: taskId,
        tool_name: step.tool,
        record_count: result.records.filter((r) => r.tool === step.tool).length,
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
        data: record.data,
        created_at: new Date().toISOString(),
      })
      .catch(() => {
        // Non-critical — evidence persistence is best-effort
      });
  }

  return result;
}

// ============================================================
// Prompt Construction
// ============================================================

function buildDavidPrompt(
  artifactType: DavidArtifactTypeValue,
  triggerType: DavidTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyProfile: Record<string, any>,
  evidence: G2XEvidence,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingProfile: Record<string, any> | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activePursuits: Array<Record<string, any>>
): string {
  const evidenceSummary = evidence.records
    .slice(0, 20) // Cap evidence context to keep prompt bounded
    .map((r, i) => `[E${i + 1}] (${r.tool}): ${JSON.stringify(r.data).slice(0, 500)}`)
    .join('\n');

  const pursuitContext =
    activePursuits.length > 0
      ? activePursuits
          .slice(0, 5)
          .map((p) => `- ${p.title || p.opportunity_id} (${p.status})`)
          .join('\n')
      : 'None';

  const existingProfileContext = existingProfile
    ? `Existing profile data:\n${JSON.stringify(existingProfile).slice(0, 800)}`
    : 'No existing profile.';

  const schemaName = artifactType.replace(/_/g, ' ').toLowerCase();

  return `You are David, competitive and market intelligence analyst for ${companyProfile.companyName || 'FFTC'}.

COMPANY CONTEXT:
${companyProfile.companyName || 'FFTC'} | NAICS: ${(companyProfile.naicsCodes || []).join(', ')} | Capabilities: ${(companyProfile.capabilities || []).slice(0, 8).join(', ')}
Certifications: ${(companyProfile.certifications || []).join(', ')}

TASK: ${triggerType} — produce a ${schemaName}
Question/Signal: ${triggerData.question || triggerData.signalSummary || triggerData.eventName || triggerData.forecastQuery || 'N/A'}

RETRIEVED EVIDENCE (${evidence.totalRecords} records from ${evidence.totalCalls} G2X calls):
${evidenceSummary || 'No evidence retrieved.'}
${evidence.errors.length > 0 ? `\nEvidence gaps: ${evidence.errors.join('; ')}` : ''}

${existingProfileContext}

ACTIVE PURSUITS:
${pursuitContext}

INSTRUCTIONS:
1. Analyze the evidence to produce a structured ${schemaName}.
2. Reference evidence by provenance (e.g., "Per FPDS award W911QX-23-C-0042") — never "G2X says".
3. Identify implications for ${companyProfile.companyName || 'FFTC'}.
4. If you identify a potential teaming partner, include a partnerCandidate object.
5. Be concise and factual. Do not speculate beyond evidence.

Return ONLY valid JSON matching the ${schemaName} schema. No markdown fences.
If a teaming partner is identified, add a top-level "partnerCandidate" key with: company, reason, relatedOpportunity, evidence (array), confidence (HIGH/MEDIUM/LOW), recommendedResearchQuestion.`;
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Process a single David intelligence task.
 *
 * Called by scheduler every 5 minutes when DAVID_INTELLIGENCE_ENABLED=true.
 *
 * Steps:
 * 1. Check observation window
 * 2. Claim task
 * 3. Load context
 * 4. G2X evidence retrieval (bounded)
 * 5. Build prompt
 * 6. ONE LLM call via gateway
 * 7. Parse and persist artifact
 * 8. Settle observation window
 * 9. Determine projection (POST / STORE_ONLY / WATCH)
 * 10. Update task status
 */
export async function processDavidTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  // 1. Check David observation window
  const isCaptureRequest = await checkIfCaptureRequest(supabase, taskId);

  if (!isCaptureRequest) {
    const { data: obsSlot } = await supabase
      .rpc('claim_david_observation_slot', {
        p_task_id: taskId,
        p_reserved_cost_usd: 0.03,
      })
      .catch(() => ({ data: true })); // RPC not found = no window = no limit

    if (obsSlot === false) {
      log.info({ taskId }, 'David observation window exhausted — skipping task');
      await supabase
        .from('david_intelligence_tasks')
        .update({ status: DavidTaskStatus.SKIPPED, completed_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('status', DavidTaskStatus.PENDING);
      return null;
    }
  }

  // 2. Claim task
  const { data: task, error: claimErr } = await supabase
    .from('david_intelligence_tasks')
    .update({ status: DavidTaskStatus.IN_PROGRESS, started_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('status', DavidTaskStatus.PENDING)
    .select('*')
    .single();

  if (claimErr || !task) {
    log.info({ taskId, error: claimErr?.message }, 'Task claim failed — already claimed or missing');
    return null;
  }

  try {
    const triggerType = task.trigger_type as DavidTriggerTypeValue;
    const triggerData = task.trigger_data || {};

    // 3. Load context
    const [companyProfile, existingProfile, activePursuits] = await Promise.all([
      loadCompanyProfile(supabase),
      loadExistingProfile(supabase, triggerType, triggerData),
      loadActivePursuits(supabase, triggerData),
    ]);

    // 4. G2X evidence retrieval (bounded)
    const evidence = await retrieveEvidence(supabase, taskId, triggerType, triggerData);
    log.info(
      { taskId, totalCalls: evidence.totalCalls, totalRecords: evidence.totalRecords },
      'G2X evidence retrieval complete'
    );

    // 5. Determine artifact type and build prompt
    const artifactType = inferArtifactType(triggerType, triggerData);
    const prompt = buildDavidPrompt(
      artifactType,
      triggerType,
      triggerData,
      companyProfile,
      evidence,
      existingProfile,
      activePursuits
    );

    // 6. Budget setup
    const maxTaskCost = isCaptureRequest ? 0.05 : 0.03;
    const wfScopeId = isCaptureRequest
      ? `capture-${triggerData.captureId || task.id}`
      : `david-intelligence-${task.id}`;
    const taskScopeId = `david-task-${task.id}`;

    if (isCaptureRequest && triggerData.captureId) {
      // Capture requests use the capture workflow budget envelope
      await ensureWorkflowBudget(supabase, `capture-${triggerData.captureId}`, maxTaskCost);
    } else {
      await ensureWorkflowBudget(supabase, wfScopeId, maxTaskCost);
    }
    await ensureTaskBudget(supabase, taskScopeId, maxTaskCost);

    // ONE LLM call — enforced by MAX_DAVID_REASONING_CALLS
    if (MAX_DAVID_REASONING_CALLS < 1) {
      throw new Error('MAX_DAVID_REASONING_CALLS is 0 — no LLM calls permitted');
    }

    const response = await complete({
      agentId: 'david',
      purpose: 'research',
      taskType: 'david_intelligence',
      idempotencyKey: `david:${task.id}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: maxTaskCost,
      workflowId: wfScopeId,
      taskId: taskScopeId,
      opportunityId: triggerData.opportunityId || undefined,
    });

    // 7. Parse response into artifact
    const cleanText = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const rawJson = JSON.parse(cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    // Extract partner candidate if present (before schema validation)
    const partnerCandidate = rawJson.partnerCandidate || null;
    delete rawJson.partnerCandidate;

    // Validate against the appropriate artifact schema
    const schema = getArtifactSchema(artifactType);
    let artifact = rawJson;
    if (schema) {
      const parsed = schema.safeParse(rawJson);
      if (parsed.success) {
        artifact = parsed.data;
      } else {
        log.warn(
          { taskId, errors: parsed.error.issues.slice(0, 3) },
          'Artifact schema validation failed — storing raw'
        );
      }
    }

    // 8. Persist artifact to david_artifacts
    const { data: savedArtifact } = await supabase
      .from('david_artifacts')
      .insert({
        task_id: taskId,
        artifact_type: artifactType,
        trigger_type: triggerType,
        artifact_data: artifact,
        evidence_record_count: evidence.totalRecords,
        g2x_call_count: evidence.totalCalls,
        inference_ledger_id: response.ledgerId,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    // 9. Update company/agency profile if applicable
    await updateProfileIfApplicable(supabase, artifactType, artifact, triggerData);

    // Store partner candidate if identified
    if (partnerCandidate) {
      const candidateParsed = PartnerIntelligenceCandidateSchema.safeParse(partnerCandidate);
      if (candidateParsed.success) {
        await supabase.from('david_artifacts').insert({
          task_id: taskId,
          artifact_type: 'PARTNER_CANDIDATE',
          trigger_type: triggerType,
          artifact_data: candidateParsed.data,
          created_at: new Date().toISOString(),
        });
        log.info(
          { taskId, company: candidateParsed.data.company },
          'Partner intelligence candidate stored'
        );
      }
    }

    // 10. Settle observation window (non-capture tasks only)
    if (!isCaptureRequest) {
      await supabase
        .rpc('settle_david_observation_slot', {
          p_task_id: taskId,
          p_reserved_cost_usd: 0.03,
          p_actual_cost_usd: response.costUsd || 0,
          p_ledger_id: response.ledgerId,
        })
        .catch(() => {}); // Non-critical if observation window doesn't exist
    }

    // 11. Determine projection
    const projection = determineProjection(triggerType, artifact);

    if (projection === 'POST') {
      try {
        await projectDavidIntelligence(supabase, task, {
          id: savedArtifact?.id,
          artifact_type: artifactType,
          artifact_data: artifact,
        });
      } catch (slackErr) {
        log.error(
          { taskId, error: slackErr instanceof Error ? slackErr.message : String(slackErr) },
          'Slack projection failed — DB state is authoritative'
        );
      }
    }

    // 12. Update task status
    await supabase
      .from('david_intelligence_tasks')
      .update({
        status: DavidTaskStatus.COMPLETED,
        completed_at: new Date().toISOString(),
        artifact_id: savedArtifact?.id,
        artifact_type: artifactType,
        projection,
        inference_ledger_id: response.ledgerId,
      })
      .eq('id', taskId);

    log.info(
      { taskId, artifactType, projection, evidenceRecords: evidence.totalRecords },
      'David task completed'
    );

    // For CAPTURE_REQUEST, build DavidResearchResult for James
    if (isCaptureRequest) {
      const researchResult = {
        taskId,
        artifactType,
        summary: extractSummary(artifact, artifactType),
        findings: extractFindings(artifact, artifactType),
        evidenceRefs: extractProvenance(artifact),
        unresolvedQuestions: evidence.errors.slice(0, 5),
        confidence: artifact.confidence || 'MEDIUM',
      };
      const validated = DavidResearchResultSchema.safeParse(researchResult);
      return validated.success ? validated.data : researchResult;
    }

    return artifact;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ taskId, error: msg }, 'David task failed');

    await supabase
      .from('david_intelligence_tasks')
      .update({
        status: DavidTaskStatus.FAILED,
        completed_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', taskId);

    // Settle observation window on failure (non-capture only)
    if (!isCaptureRequest) {
      await supabase
        .rpc('settle_david_observation_slot', {
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
 * Query and process all pending David intelligence tasks.
 * Called by scheduler. Safety-capped at 5 tasks per run.
 */
export async function processPendingDavidTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ processed: number; completed: number; failed: number; skipped: number }> {
  const result = { processed: 0, completed: 0, failed: 0, skipped: 0 };

  const { data: tasks } = await supabase
    .from('david_intelligence_tasks')
    .select('id')
    .eq('status', DavidTaskStatus.PENDING)
    .order('created_at', { ascending: true })
    .limit(5); // Safety cap per processing run

  if (!tasks || tasks.length === 0) return result;

  for (const task of tasks) {
    const outcome = await processDavidTask(supabase, task.id);
    result.processed++;
    if (outcome) {
      result.completed++;
    } else {
      // Distinguish skipped (observation exhausted) from failed
      const { data: check } = await supabase
        .from('david_intelligence_tasks')
        .select('status')
        .eq('id', task.id)
        .single();
      if (check?.status === DavidTaskStatus.SKIPPED) {
        result.skipped++;
      } else {
        result.failed++;
      }
    }
  }

  log.info(result, 'David pending task processing complete');
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
    .from('david_intelligence_tasks')
    .select('trigger_type')
    .eq('id', taskId)
    .single();
  return data?.trigger_type === DavidTriggerType.CAPTURE_REQUEST;
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

async function loadExistingProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  triggerType: DavidTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  if (triggerType === DavidTriggerType.COMPETITIVE_SIGNAL && triggerData.uei) {
    const { data } = await supabase
      .from('company_intelligence_profiles')
      .select('*')
      .eq('uei', triggerData.uei)
      .single();
    return data;
  }
  if (
    (triggerType === DavidTriggerType.FORECAST_SIGNAL ||
      triggerType === DavidTriggerType.GOVCON_EVENT) &&
    triggerData.agencyCode
  ) {
    const { data } = await supabase
      .from('agency_intelligence_profiles')
      .select('*')
      .eq('agency_code', triggerData.agencyCode)
      .single();
    return data;
  }
  return null;
}

async function loadActivePursuits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Array<Record<string, any>>> {
  // Load related active captures/pursuits for context
  const filters: Array<{ column: string; value: string }> = [];
  if (triggerData.opportunityId) {
    filters.push({ column: 'opportunity_id', value: triggerData.opportunityId });
  }
  if (triggerData.agency) {
    filters.push({ column: 'agency', value: triggerData.agency });
  }

  if (filters.length === 0) return [];

  let query = supabase
    .from('capture_aggregates')
    .select('opportunity_id, title, status, agency')
    .in('status', ['active', 'evaluating', 'pursuing'])
    .limit(5);

  // Apply first available filter
  const filter = filters[0];
  query = query.eq(filter.column, filter.value);

  const { data } = await query;
  return data || [];
}

// ============================================================
// Profile Updates
// ============================================================

async function updateProfileIfApplicable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  artifactType: DavidArtifactTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  artifact: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerData: Record<string, any>
): Promise<void> {
  try {
    if (artifactType === DavidArtifactType.COMPETITIVE_BRIEF && artifact.company) {
      const uei = triggerData.uei || null;
      if (uei) {
        await supabase.from('company_intelligence_profiles').upsert(
          {
            uei,
            name: artifact.company,
            awards_summary: artifact.customerHistory || '',
            vehicles: artifact.vehicles || [],
            competitive_assessment: artifact.competitivePosition || '',
            last_refreshed: new Date().toISOString(),
          },
          { onConflict: 'uei' }
        );
      }
    }

    if (artifactType === DavidArtifactType.CUSTOMER_MARKET_BRIEF && artifact.agency) {
      const agencyCode = triggerData.agencyCode || null;
      if (agencyCode) {
        await supabase.from('agency_intelligence_profiles').upsert(
          {
            agency_code: agencyCode,
            name: artifact.agency,
            buying_patterns: artifact.buyingPatterns || '',
            vehicles: artifact.vehicles || [],
            last_refreshed: new Date().toISOString(),
          },
          { onConflict: 'agency_code' }
        );
      }
    }
  } catch (err) {
    log.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Profile update failed — non-critical'
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
  triggerType: DavidTriggerTypeValue,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  artifact: Record<string, any>
): 'POST' | 'STORE_ONLY' | 'WATCH' {
  // Capture requests go back to James, not to Slack
  if (triggerType === DavidTriggerType.CAPTURE_REQUEST) return 'STORE_ONLY';

  // Human requests always project
  if (triggerType === DavidTriggerType.HUMAN_REQUEST) return 'POST';

  // Proactive signals: project if actionable recommendation
  const action = artifact.recommendedAction;
  if (action === 'NO_ACTION') return 'STORE_ONLY';
  if (action === 'WATCH_FORECAST' || action === 'WATCH_RECOMPETE' || action === 'WATCH') {
    return 'WATCH';
  }

  // Default: POST for actionable intelligence
  return 'POST';
}

// ============================================================
// Result Extractors (for CAPTURE_REQUEST → James)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSummary(artifact: Record<string, any>, artifactType: DavidArtifactTypeValue): string {
  switch (artifactType) {
    case DavidArtifactType.COMPETITIVE_BRIEF:
      return `Competitive analysis of ${artifact.company}: ${artifact.competitivePosition || ''}`.slice(
        0,
        1000
      );
    case DavidArtifactType.CUSTOMER_MARKET_BRIEF:
      return `Market analysis of ${artifact.agency}: ${artifact.fftcAlignment || ''}`.slice(0, 1000);
    case DavidArtifactType.FORECAST_SIGNAL:
      return `Forecast signal: ${artifact.expectedScope || ''} (${artifact.maturity || 'UNKNOWN'})`.slice(
        0,
        1000
      );
    case DavidArtifactType.EVENT_BRIEF:
      return `Event: ${artifact.eventName}: ${artifact.whyFftcCares || ''}`.slice(0, 1000);
    default:
      return JSON.stringify(artifact).slice(0, 1000);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFindings(artifact: Record<string, any>, artifactType: DavidArtifactTypeValue): string[] {
  switch (artifactType) {
    case DavidArtifactType.COMPETITIVE_BRIEF:
      return [
        ...(artifact.strengths || []).slice(0, 3),
        ...(artifact.risks || []).slice(0, 3),
        artifact.fftcImplications || '',
      ]
        .filter(Boolean)
        .slice(0, 10);
    case DavidArtifactType.CUSTOMER_MARKET_BRIEF:
      return [
        artifact.procurementHistory || '',
        artifact.buyingPatterns || '',
        artifact.fftcAlignment || '',
      ]
        .filter(Boolean)
        .slice(0, 10);
    case DavidArtifactType.FORECAST_SIGNAL:
      return [artifact.fftcConnection || '', `Maturity: ${artifact.maturity || 'UNKNOWN'}`]
        .filter(Boolean)
        .slice(0, 10);
    case DavidArtifactType.EVENT_BRIEF:
      return [artifact.whyFftcCares || '', artifact.pursuitConnection || '']
        .filter(Boolean)
        .slice(0, 10);
    default:
      return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractProvenance(artifact: Record<string, any>): string[] {
  return (artifact.provenance || []).slice(0, 10);
}
