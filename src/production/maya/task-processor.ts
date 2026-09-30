/**
 * Maya Review Task Processor
 *
 * Events wake workflows. Tasks wake agents.
 *
 * Processes pending maya_review_tasks through the LLM Gateway.
 * Emits completion events. Creates Slack briefs for EVALUATE.
 */

import { z } from 'zod';
import { complete } from '../../services/llm-gateway/gateway.js';
import { ensureWorkflowBudget, ensureTaskBudget } from '../../services/llm-gateway/budget.js';
import { calculateFitScore, type ScoringContext } from '../../pipeline/maya/fit-score.js';
import { matchPastPerformance } from '../../pipeline/maya/company-profile.js';
import { classifyAcquisitionNature } from '../../pipeline/maya/acquisition-classifier.js';
import { checkStrategicOverrides } from '../../pipeline/maya/strategic.js';
import { SupabaseCompanyProfileRepository } from '../../pipeline/maya/company-repository.js';
import { normalizeSetAside, formatSetAsideForPrompt } from '../../pipeline/maya/set-aside.js';
import { emitEvent, MAYA_EVENT_TYPES } from './events.js';
import { postOpportunityBrief } from './slack-surface.js';
import type { NormalizedOpportunity } from '../../pipeline/maya/types.js';

// Compact Zod schema — bounded arrays and string lengths
export const MayaDecisionSchema = z.object({
  recommendation: z.enum(['EVALUATE', 'WATCH', 'PASS']),
  confidence: z.number().int().min(0).max(100),
  acquisitionNature: z.string().max(200),
  fitReasons: z.array(z.string().max(200)).max(3),
  concerns: z.array(z.string().max(200)).max(3),
  evidenceUsed: z.array(z.string().max(200)).max(5),
  missingInformation: z.array(z.string().max(200)).max(3),
  researchRequests: z
    .array(
      z.object({
        type: z.enum([
          'SAM_FOLLOWUP',
          'SOLICITATION_DOCUMENT_REVIEW',
          'SOURCE_REFRESH',
          'ACQUISITION_CLARIFICATION',
          'CUSTOMER_INFORMATION_GAP',
        ]),
        reason: z.string().max(200),
      })
    )
    .max(2),
  rationale: z.string().max(800),
});

export type MayaDecision = z.infer<typeof MayaDecisionSchema>;

/**
 * Process one pending Maya review task.
 * Returns the Maya decision or null on failure.
 */
export async function processReviewTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  taskId: string
): Promise<MayaDecision | null> {
  // 1. Claim the task
  const { data: task, error: claimErr } = await supabase
    .from('maya_review_tasks')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('status', 'pending')
    .select('*')
    .single();

  if (claimErr || !task) return null; // Already claimed or not found

  try {
    // 2. Load opportunity data
    const { data: opp } = await supabase
      .from('pipeline_opportunities')
      .select('*')
      .eq('source_id', task.opportunity_id)
      .single();

    if (!opp) throw new Error(`Opportunity not found: ${task.opportunity_id}`);

    // 3. Load org data
    const repo = new SupabaseCompanyProfileRepository(supabase);
    const [profile, pp, prefs] = await Promise.all([
      repo.getCompanyProfile(),
      repo.getPastPerformance(),
      repo.getPursuitPreferences(),
    ]);

    // 4. Score
    const normalized: NormalizedOpportunity = {
      sourceId: opp.source_id,
      source: opp.source,
      solicitationNumber: opp.solicitation_number,
      title: opp.title,
      description: opp.description,
      synopsis: null,
      agency: opp.agency,
      subAgency: opp.sub_agency,
      office: opp.office,
      noticeType: opp.notice_type,
      naics: opp.naics,
      psc: opp.psc,
      setAside: opp.set_aside,
      setAsideDescription: opp.set_aside_description,
      postedDate: opp.posted_date,
      responseDeadline: opp.response_deadline,
      estimatedValue: opp.estimated_value ? Number(opp.estimated_value) : null,
      placeOfPerformance: opp.place_of_performance,
      vehicle: null,
      sourceUrl: opp.source_url,
      attachments: opp.attachments || [],
      active: opp.active,
      archived: opp.archived,
      cancelled: opp.cancelled,
      rawHash: opp.raw_hash,
      materialHash: opp.material_hash,
    };

    const ctx: ScoringContext = { profile, pastPerformance: pp, preferences: prefs };
    const fitScore = calculateFitScore(normalized, ctx);
    const ppM = matchPastPerformance(
      { agency: opp.agency, title: opp.title, description: opp.description, naics: opp.naics },
      pp
    );
    const acq = classifyAcquisitionNature(opp.title, opp.description || '');
    const override = checkStrategicOverrides(normalized, fitScore as any, prefs, profile);

    // 5. Budget
    const guardrails = await supabase
      .from('maya_cost_guardrails')
      .select('*')
      .eq('config_name', 'default')
      .single();
    const maxTaskCost = Number(guardrails?.data?.max_task_cost_usd || 0.02);
    const maxWfCost = Number(guardrails?.data?.max_workflow_cost_usd || 0.03);

    const wfScopeId = `maya-review-${task.opportunity_id}`;
    const taskScopeId = `maya-task-${task.id}`;
    await ensureWorkflowBudget(supabase, wfScopeId, maxWfCost);
    await ensureTaskBudget(supabase, taskScopeId, maxTaskCost);

    // 6. Normalize set-aside
    const setAsideInfo = normalizeSetAside(
      opp.set_aside,
      opp.set_aside_description,
      profile.certifications,
      profile.setAsides
    );
    const setAsidePrompt = formatSetAsideForPrompt(setAsideInfo);

    // 7. Build prompt
    const prompt = `You are Maya, opportunity intelligence analyst for ${profile.companyName}.

MISSION: Should this opportunity receive further BD evaluation?

COMPANY: NAICS ${profile.naicsCodes.join(',')} | Certs: ${profile.certifications.slice(0, 3).join(',')} | Capabilities: ${profile.capabilities.slice(0, 8).join(',')} | Agency experience: ${prefs.agencyExperience.join(',')} | Security: Public trust only
NOTE: FFTC is open to qualified opportunities from ALL federal agencies. Agency experience is a positive signal, not a requirement.

OPPORTUNITY: ${opp.title}
Agency: ${opp.agency || 'Unknown'} | NAICS: ${opp.naics || 'N/A'} | PSC: ${opp.psc || 'N/A'}
Set-aside: ${setAsidePrompt} | Deadline: ${opp.response_deadline?.slice(0, 10) || 'N/A'}
Acquisition: ${acq.nature} (${acq.confidence}) — ${acq.signals.slice(0, 3).join('; ')}

SCORE: ${fitScore.totalScore}/100 ${JSON.stringify(fitScore.breakdown)}
${
  ppM.length > 0
    ? `PP: ${ppM
        .slice(0, 2)
        .map((m) => `${m.project}(${m.agency},${(m.similarityScore * 100).toFixed(0)}%)`)
        .join('; ')}`
    : 'No relevant PP'
}
${override.triggered ? `OVERRIDES: ${override.rules.join('; ')}` : ''}

SCOPE: ${(opp.description || '').slice(0, 1800)}

REASONING: 1. What is being bought? 2. What maps to FFTC services? 3. Services or COTS? 4. CAN vs SHOULD compete.
For clear COTS/licensing → PASS. For ambiguous → WATCH.

Return ONLY JSON (no markdown): {"recommendation":"EVALUATE"|"WATCH"|"PASS","confidence":0-100,"acquisitionNature":"max200","fitReasons":["max3"],"concerns":["max3"],"evidenceUsed":["max5"],"missingInformation":["max3"],"researchRequests":[{"type":"SAM_FOLLOWUP|SOLICITATION_DOCUMENT_REVIEW|SOURCE_REFRESH|ACQUISITION_CLARIFICATION|CUSTOMER_INFORMATION_GAP","reason":""}],"rationale":"max600chars"}
Research types: SAM_FOLLOWUP (check SAM updates), SOLICITATION_DOCUMENT_REVIEW (review attached docs), SOURCE_REFRESH (re-fetch evidence), ACQUISITION_CLARIFICATION (ambiguous procurement type), CUSTOMER_INFORMATION_GAP (info humans should eventually pursue).
Be concise. Max 3 reasons, 3 concerns. Do not repeat source text.`;

    // 7. Gateway call
    const response = await complete({
      agentId: 'maya',
      purpose: 'classify',
      taskType: 'maya_commissioning_review',
      idempotencyKey: `maya:${task.idempotency_key}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: maxTaskCost,
      workflowId: wfScopeId,
      taskId: taskScopeId,
      opportunityId: task.opportunity_id,
    });

    // 8. Parse + validate
    const cleanText = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const raw = JSON.parse(cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const decision = MayaDecisionSchema.parse(raw);

    // 9. Update task
    await supabase
      .from('maya_review_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        recommendation: decision.recommendation,
        confidence: decision.confidence,
        decision_payload: decision,
        inference_ledger_id: response.ledgerId,
        model_route: response.model,
      })
      .eq('id', taskId);

    // 10. Update opportunity
    await supabase
      .from('pipeline_opportunities')
      .update({
        maya_task_id: taskId,
        maya_recommendation: decision.recommendation,
        maya_confidence: decision.confidence,
        maya_quick_review: decision,
        maya_decision_at: new Date().toISOString(),
      })
      .eq('source_id', task.opportunity_id);

    // 11. Emit completion event
    const correlationId = `opp:${task.opportunity_id}`;
    const decisionEventType =
      decision.recommendation === 'EVALUATE'
        ? MAYA_EVENT_TYPES.MAYA_EVALUATE
        : decision.recommendation === 'WATCH'
          ? MAYA_EVENT_TYPES.MAYA_WATCH
          : MAYA_EVENT_TYPES.MAYA_PASS;

    await emitEvent(supabase, {
      eventType: decisionEventType,
      aggregateType: 'opportunity',
      aggregateId: task.opportunity_id,
      opportunityId: task.opportunity_id,
      actorType: 'AGENT',
      actorId: 'maya',
      source: 'maya-review',
      correlationId,
      idempotencyKey: `decision:${task.idempotency_key}`,
      schemaVersion: 1,
      payload: { recommendation: decision.recommendation, confidence: decision.confidence, taskId },
    });

    // 12. Post to Slack if EVALUATE and projection enabled
    if (decision.recommendation === 'EVALUATE') {
      try {
        const channelId = process.env.SLACK_CHANNEL_ID;
        const slackToken = process.env.MAYA_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
        if (channelId && slackToken) {
          const { WebClient } = await import('@slack/web-api');
          const slackClient = new WebClient(slackToken);
          await postOpportunityBrief(
            supabase,
            slackClient,
            channelId,
            task.opportunity_id,
            taskId,
            {
              title: opp.title,
              agency: opp.agency,
              setAside: setAsidePrompt,
              naics: opp.naics,
              responseDeadline: opp.response_deadline,
              sourceUrl: opp.source_url,
            },
            decision,
            opp.material_hash
          );
        }
      } catch (slackErr) {
        console.error(
          `[MayaTaskProcessor] Slack projection failed:`,
          slackErr instanceof Error ? slackErr.message : slackErr
        );
        // Slack failure does not fail the review — DB state is authoritative
      }
    }

    return decision;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('maya_review_tasks')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', taskId);
    console.error(`[MayaTaskProcessor] Task ${taskId} failed:`, msg);
    return null;
  }
}

/**
 * Process all pending Maya review tasks (bounded by guardrails).
 */
export async function processPendingReviews(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ processed: number; evaluate: number; watch: number; pass: number; failed: number }> {
  const result = { processed: 0, evaluate: 0, watch: 0, pass: 0, failed: 0 };

  const { data: tasks } = await supabase
    .from('maya_review_tasks')
    .select('id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5); // Safety cap per processing run

  if (!tasks || tasks.length === 0) return result;

  for (const task of tasks) {
    const decision = await processReviewTask(supabase, task.id);
    result.processed++;
    if (!decision) {
      result.failed++;
      continue;
    }
    if (decision.recommendation === 'EVALUATE') result.evaluate++;
    else if (decision.recommendation === 'WATCH') result.watch++;
    else result.pass++;
  }

  return result;
}
