/**
 * James Task Processor — Capture Assessment + Resynthesis
 *
 * Follows Maya task-processor pattern: claim, load, budget, prompt,
 * Gateway call, Zod validate, update, emit.
 */

import { complete } from '../../services/llm-gateway/gateway.js';
import { ensureTaskBudget } from '../../services/llm-gateway/budget.js';
import { SupabaseCompanyProfileRepository } from '../../pipeline/maya/company-repository.js';
import { normalizeSetAside, formatSetAsideForPrompt } from '../../pipeline/maya/set-aside.js';
import { classifyAcquisitionNature } from '../../pipeline/maya/acquisition-classifier.js';
import { emitEvent, CAPTURE_EVENT_TYPES } from './events.js';
import { JamesCaptureDecisionSchema, CAPTURE_BUDGET } from './types.js';
import type { JamesCaptureDecision } from './types.js';
import { recordDecision, getCaptureContext, getRemainingCaptureBudget } from './capture-manager.js';

/**
 * Process James initial assessment for a capture.
 * Returns the decision or null on failure.
 */
export async function processInitialAssessment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string
): Promise<JamesCaptureDecision | null> {
  const ctx = await getCaptureContext(supabase, captureId);
  if (!ctx) return null;

  const { capture, opportunity } = ctx;
  if (!opportunity) return null;

  try {
    // Emit start event
    await emitEvent(supabase, {
      eventType: CAPTURE_EVENT_TYPES.JAMES_ASSESSMENT_STARTED,
      aggregateType: 'capture',
      aggregateId: captureId,
      opportunityId: capture.opportunity_id,
      actorType: 'AGENT',
      actorId: 'james',
      source: 'james-task-processor',
      correlationId: `capture:${captureId}`,
      idempotencyKey: `james:initial:${captureId}:v1`,
      schemaVersion: 1,
      payload: {},
    });

    // Load org data
    const repo = new SupabaseCompanyProfileRepository(supabase);
    const [profile, pp, prefs] = await Promise.all([
      repo.getCompanyProfile(),
      repo.getPastPerformance(),
      repo.getPursuitPreferences(),
    ]);

    // Normalize set-aside
    const setAsideInfo = normalizeSetAside(
      opportunity.set_aside,
      opportunity.set_aside_description,
      profile.certifications,
      profile.setAsides
    );
    const setAsidePrompt = formatSetAsideForPrompt(setAsideInfo);
    const acq = classifyAcquisitionNature(opportunity.title, opportunity.description || '');

    // Check budget
    const remaining = await getRemainingCaptureBudget(supabase, captureId);
    if (remaining < 0.005) {
      await emitEvent(supabase, {
        eventType: CAPTURE_EVENT_TYPES.CAPTURE_BUDGET_EXHAUSTED,
        aggregateType: 'capture',
        aggregateId: captureId,
        opportunityId: capture.opportunity_id,
        actorType: 'SYSTEM',
        source: 'james-task-processor',
        correlationId: `capture:${captureId}`,
        idempotencyKey: `budget-exhausted:${captureId}:initial`,
        schemaVersion: 1,
        payload: { remaining },
      });
      return null;
    }

    // Ensure budgets
    const wfScopeId = `capture-${captureId}`;
    const taskScopeId = `james-initial-${captureId}`;
    await ensureTaskBudget(supabase, taskScopeId, CAPTURE_BUDGET.INITIAL_ASSESSMENT_USD);

    // Maya's assessment
    const mayaDecision = opportunity.maya_quick_review;

    // Build prompt
    const prompt = buildInitialPrompt(
      opportunity,
      mayaDecision,
      profile,
      prefs,
      pp,
      setAsidePrompt,
      acq
    );

    // Gateway call
    const response = await complete({
      agentId: 'james',
      purpose: 'reason',
      taskType: 'james_capture_initial',
      idempotencyKey: `james:initial:${captureId}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: CAPTURE_BUDGET.INITIAL_ASSESSMENT_USD,
      workflowId: wfScopeId,
      taskId: taskScopeId,
      opportunityId: capture.opportunity_id,
    });

    // Parse + validate
    const cleanText = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const raw = JSON.parse(cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const decision = JamesCaptureDecisionSchema.parse(raw);

    // Record immutable decision version
    const version = await recordDecision(
      supabase,
      captureId,
      decision.recommendation,
      decision.confidence,
      decision,
      capture.research_round,
      response.ledgerId,
      response.model
    );

    // Emit completion event
    await emitEvent(supabase, {
      eventType: CAPTURE_EVENT_TYPES.JAMES_ASSESSMENT_COMPLETED,
      aggregateType: 'capture',
      aggregateId: captureId,
      opportunityId: capture.opportunity_id,
      actorType: 'AGENT',
      actorId: 'james',
      source: 'james-task-processor',
      correlationId: `capture:${captureId}`,
      idempotencyKey: `james:initial-complete:${captureId}:v${version}`,
      schemaVersion: 1,
      payload: {
        recommendation: decision.recommendation,
        confidence: decision.confidence,
        version,
      },
    });

    return decision;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause = (err as any)?.cause?.message || '';
    console.error(
      `[JamesTaskProcessor] Initial assessment failed for ${captureId}:`,
      msg,
      cause ? `(cause: ${cause})` : ''
    );
    return null;
  }
}

/**
 * Process James resynthesis after specialist research completes.
 */
export async function processResynthesis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  round: number
): Promise<JamesCaptureDecision | null> {
  const ctx = await getCaptureContext(supabase, captureId);
  if (!ctx) return null;

  const { capture, opportunity, specialistArtifacts, decisionRecords } = ctx;
  if (!opportunity) return null;

  try {
    await emitEvent(supabase, {
      eventType: CAPTURE_EVENT_TYPES.JAMES_RESYNTHESIS_STARTED,
      aggregateType: 'capture',
      aggregateId: captureId,
      opportunityId: capture.opportunity_id,
      actorType: 'AGENT',
      actorId: 'james',
      source: 'james-task-processor',
      correlationId: `capture:${captureId}`,
      idempotencyKey: `james:resynth-start:${captureId}:r${round}`,
      schemaVersion: 1,
      payload: { round },
    });

    // Check budget
    const remaining = await getRemainingCaptureBudget(supabase, captureId);
    if (remaining < 0.005) {
      await emitEvent(supabase, {
        eventType: CAPTURE_EVENT_TYPES.CAPTURE_BUDGET_EXHAUSTED,
        aggregateType: 'capture',
        aggregateId: captureId,
        opportunityId: capture.opportunity_id,
        actorType: 'SYSTEM',
        source: 'james-task-processor',
        correlationId: `capture:${captureId}`,
        idempotencyKey: `budget-exhausted:${captureId}:r${round}`,
        schemaVersion: 1,
        payload: { remaining, round },
      });
      return null;
    }

    const wfScopeId = `capture-${captureId}`;
    const taskScopeId = `james-resynth-${captureId}-r${round}`;
    await ensureTaskBudget(supabase, taskScopeId, CAPTURE_BUDGET.RESYNTHESIS_USD);

    // Load org data
    const repo = new SupabaseCompanyProfileRepository(supabase);
    const [profile, prefs] = await Promise.all([
      repo.getCompanyProfile(),
      repo.getPursuitPreferences(),
    ]);

    // Build resynthesis prompt
    const prompt = buildResynthesisPrompt(
      opportunity,
      decisionRecords,
      specialistArtifacts,
      profile,
      prefs,
      round
    );

    const response = await complete({
      agentId: 'james',
      purpose: 'reason',
      taskType: 'james_capture_resynthesis',
      idempotencyKey: `james:resynth:${captureId}:r${round}`,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2048,
      maxCostUsd: CAPTURE_BUDGET.RESYNTHESIS_USD,
      workflowId: wfScopeId,
      taskId: taskScopeId,
      opportunityId: capture.opportunity_id,
    });

    const cleanText = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const raw = JSON.parse(cleanText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const decision = JamesCaptureDecisionSchema.parse(raw);

    const version = await recordDecision(
      supabase,
      captureId,
      decision.recommendation,
      decision.confidence,
      decision,
      round,
      response.ledgerId,
      response.model
    );

    await emitEvent(supabase, {
      eventType: CAPTURE_EVENT_TYPES.JAMES_RESYNTHESIS_COMPLETED,
      aggregateType: 'capture',
      aggregateId: captureId,
      opportunityId: capture.opportunity_id,
      actorType: 'AGENT',
      actorId: 'james',
      source: 'james-task-processor',
      correlationId: `capture:${captureId}`,
      idempotencyKey: `james:resynth-complete:${captureId}:r${round}:v${version}`,
      schemaVersion: 1,
      payload: {
        recommendation: decision.recommendation,
        confidence: decision.confidence,
        round,
        version,
      },
    });

    return decision;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JamesTaskProcessor] Resynthesis failed for ${captureId} round ${round}:`, msg);
    return null;
  }
}

// ============================================================
// Prompt Builders
// ============================================================

function buildInitialPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opp: any,
  mayaDecision: any,
  profile: any,
  prefs: any,
  pp: any[],
  setAsidePrompt: string,
  acq: { nature: string; confidence: string; signals: string[] }
): string {
  const ppSummary = pp
    .slice(0, 3)
    .map((p) => `${p.project} (${p.agency})`)
    .join('; ');
  return `You are James, Capture Strategist for ${profile.companyName}. Be concise.

EVALUATE this opportunity. Recommend GO, NO_GO, or MORE_RESEARCH_REQUIRED.

COMPANY: NAICS ${profile.naicsCodes.join(',')} | Certs: ${profile.certifications.slice(0, 3).join(',')} | Capabilities: ${profile.capabilities.slice(0, 6).join(',')}
Agency experience: ${prefs.agencyExperience.join(',')} | Security: Public trust only | Excluded: ${prefs.excludedClearance.join(',')}
PP: ${ppSummary || 'None'} | Sweet spot: $${(prefs.contractSizeSweetMin / 1e6).toFixed(1)}M–$${(prefs.contractSizeSweetMax / 1e6).toFixed(0)}M

OPP: ${opp.title}
Agency: ${opp.agency || '?'} | NAICS: ${opp.naics || '?'} | PSC: ${opp.psc || '?'} | Set-aside: ${setAsidePrompt}
Deadline: ${opp.response_deadline?.slice(0, 10) || '?'} | Acq: ${acq.nature} (${acq.confidence}) | Sol: ${opp.solicitation_number || '?'} | Score: ${opp.fit_score}/100

MAYA: ${mayaDecision?.recommendation || '?'} (${mayaDecision?.confidence || '?'}%) — ${mayaDecision?.rationale?.slice(0, 200) || '?'}

SCOPE: ${(opp.description || '').slice(0, 1500)}

IMMEDIATE NO_GO if: TS/SCI/facility clearance required, staff augmentation, clearly irrelevant work.

GROUNDING RULES:
- Absence of a capability from the company profile does NOT prove FFTC lacks it. Use "not demonstrated in available evidence" or UNKNOWN, not "FFTC lacks X."
- Only cite specific facts (competitors, contract values, timelines, clearance durations) if they come from the supplied evidence. Do not introduce unsupported external facts.
- The opportunity evidence and company profile are your primary sources. General strategy reasoning is permitted; fabricated specifics are not.

Each dimension: {"assessment":"STRONG|MODERATE|WEAK|BLOCKING|UNKNOWN","evidenceRefs":["max5"],"concerns":["max5"],"confidence":"HIGH|MEDIUM|LOW"}
NOTE: dimension confidence is a STRING (HIGH/MEDIUM/LOW), NOT a number.

Return ONLY valid JSON (no markdown):
{"recommendation":"GO"|"NO_GO"|"MORE_RESEARCH_REQUIRED","confidence":0-100,"customerFit":{dim},"capabilityFit":{dim},"acquisitionFit":{dim},"competitivePosition":{dim},"deliveryFeasibility":{dim},"businessCase":{dim},"primeSubPosture":"PRIME|SUB|TEAMING_DEPENDENT|UNCLEAR","strongestReasonsToPursue":["max3"],"criticalRisks":["max3"],"unresolvedQuestions":["max3"],"requestedResearch":[{"type":"COMPETITIVE_INTELLIGENCE|TECHNICAL_ASSESSMENT|PARTNER_SEARCH|ACQUISITION_INTERPRETATION","question":"specific","whyDecisionBlocking":"why","priority":"REQUIRED|USEFUL"}],"specialistFindingsUsed":[],"rationale":"max600","recommendedNextActions":["max3"]}
Be concise. Short evidence refs. Max 3 research needs.`;
}

function buildResynthesisPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opp: any,
  decisionRecords: any[],
  artifacts: any[],
  profile: any,
  _prefs: any,
  round: number
): string {
  const prevDecision = decisionRecords[decisionRecords.length - 1];
  const artifactSummaries = artifacts
    .filter((a: { artifact_source: string }) => a.artifact_source !== 'TEST_FIXTURE')
    .map(
      (a: { finding: string; assessment: string; confidence: string }) =>
        `[${a.assessment}/${a.confidence}] ${a.finding.slice(0, 300)}`
    )
    .join('\n');

  return `You are James, Capture Strategist for ${profile.companyName}.

RESYNTHESIS ROUND ${round}: Incorporate new specialist research and update your capture recommendation.

OPPORTUNITY: ${opp.title}
Agency: ${opp.agency || 'Unknown'} | Solicitation: ${opp.solicitation_number || 'N/A'}

PREVIOUS ASSESSMENT (v${prevDecision?.decision_version || 0}):
Recommendation: ${prevDecision?.recommendation || 'N/A'}
Confidence: ${prevDecision?.confidence || 'N/A'}%

SPECIALIST FINDINGS:
${artifactSummaries || 'No specialist findings available.'}

Reassess all 6 dimensions incorporating the new evidence. Produce updated GO/NO_GO/MORE_RESEARCH_REQUIRED.

If this is round ${round} of ${CAPTURE_BUDGET.MAX_AUTONOMOUS_ROUNDS} maximum autonomous rounds and information remains genuinely unknowable, return MORE_RESEARCH_REQUIRED with remaining uncertainty stated. Do not request additional autonomous research beyond the limit.

Return ONLY JSON (same schema as initial assessment).`;
}
