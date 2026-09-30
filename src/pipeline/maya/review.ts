/**
 * Maya Review — Gateway-Routed Reasoning
 *
 * Quick and full review through llmGateway.complete().
 * No direct provider calls. Full attribution and budgeting.
 */

import { complete } from '../../services/llm-gateway/gateway.js';
import { ensureWorkflowBudget, ensureTaskBudget } from '../../services/llm-gateway/budget.js';
import type {
  QuickReviewInput,
  QuickReviewOutput,
  FullReviewInput,
  FullReviewOutput,
} from './types.js';

// ============================================================
// Quick Review
// ============================================================

export async function runQuickReview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: QuickReviewInput,
  workflowId: string,
  taskId: string
): Promise<QuickReviewOutput> {
  // Ensure budget scopes exist
  await ensureWorkflowBudget(supabase, workflowId, 0.2);
  await ensureTaskBudget(supabase, taskId, 0.05);

  const profile = input.companyProfile;

  const prompt = `You are Maya, an opportunity intelligence analyst for ${profile.name}.

COMPANY PROFILE:
- NAICS: ${profile.primaryNaics.join(', ')}
- Certifications: ${profile.certifications.join(', ')}
- Core capabilities: ${profile.coreCapabilities.join(', ')}
- Strategic agencies: ${profile.agencyExperience.join(', ')}
- Security: ${profile.securityClearance}
- Contract size: $${(profile.contractSizeRange.min / 1e6).toFixed(1)}M–$${(profile.contractSizeRange.max / 1e6).toFixed(0)}M
- Prime/sub strategy: ${profile.primeSubStrategy}

OPPORTUNITY:
Title: ${input.opportunity.title}
Agency: ${input.opportunity.agency || 'Unknown'}
Notice type: ${input.opportunity.noticeType}
NAICS: ${input.opportunity.naics || 'N/A'}
Set-aside: ${input.opportunity.setAside || 'None'}
Deadline: ${input.opportunity.responseDeadline || 'N/A'}
Description: ${(input.opportunity.description || '').slice(0, 1500)}

DETERMINISTIC SCORE: ${input.fitScore.totalScore}/100
Breakdown: ${JSON.stringify(input.fitScore.breakdown)}
Reasons: ${input.fitScore.reasons.join('; ')}
Concerns: ${input.fitScore.concerns.join('; ')}

PAST PERFORMANCE MATCHES:
${input.matchedPastPerformance.map((m) => `- ${m.project} (${m.agency}, ${(m.similarityScore * 100).toFixed(0)}% match): ${m.matchedCapabilities.join(', ')}`).join('\n') || 'None found'}

${input.strategicOverrides.triggered ? `STRATEGIC OVERRIDES: ${input.strategicOverrides.rules.join('; ')}` : ''}

Based on this analysis, provide a quick assessment. Return ONLY valid JSON:
{
  "decision": "PASS" | "WATCH" | "FULL_REVIEW",
  "confidence": 0.0-1.0,
  "rationale": ["reason1", "reason2"],
  "concerns": ["concern1"],
  "missingInformation": ["what would help"]
}`;

  const response = await complete({
    agentId: 'maya',
    purpose: 'classify',
    taskType: 'opportunity_quick_review',
    idempotencyKey: `workflow:${workflowId}:task:${taskId}:maya-quick:v1:attempt:1`,
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: 512,
    workflowId,
    taskId,
    opportunityId: input.opportunity.sourceId,
  });

  try {
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as QuickReviewOutput;
  } catch {
    return {
      decision: 'WATCH',
      confidence: 0.3,
      rationale: ['Could not parse Maya response'],
      concerns: ['Response parsing failed'],
      missingInformation: [],
    };
  }
}

// ============================================================
// Full Review
// ============================================================

export async function runFullReview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: FullReviewInput,
  workflowId: string,
  taskId: string
): Promise<FullReviewOutput> {
  await ensureWorkflowBudget(supabase, workflowId, 0.2);
  await ensureTaskBudget(supabase, taskId, 0.12);

  const profile = input.companyProfile;

  const prompt = `You are Maya, an opportunity intelligence analyst for ${profile.name}.

COMPANY PROFILE:
- NAICS: ${profile.primaryNaics.join(', ')}
- Certifications: ${profile.certifications.join(', ')}
- Core capabilities: ${profile.coreCapabilities.join(', ')}
- Strategic agencies: ${profile.agencyExperience.join(', ')}
- Security: ${profile.securityClearance}
- Prime/sub strategy: ${profile.primeSubStrategy}

OPPORTUNITY:
Title: ${input.opportunity.title}
Agency: ${input.opportunity.agency || 'Unknown'}
Notice type: ${input.opportunity.noticeType}
NAICS: ${input.opportunity.naics || 'N/A'}
Set-aside: ${input.opportunity.setAside || 'None'}
Deadline: ${input.opportunity.responseDeadline || 'N/A'}
Description: ${(input.opportunity.description || '').slice(0, 3000)}

DETERMINISTIC SCORE: ${input.fitScore.totalScore}/100
Breakdown: ${JSON.stringify(input.fitScore.breakdown)}

PAST PERFORMANCE MATCHES:
${input.matchedPastPerformance.map((m) => `- ${m.project} (${m.agency}, ${(m.similarityScore * 100).toFixed(0)}% match): ${m.matchedCapabilities.join(', ')}`).join('\n') || 'None found'}

${input.strategicOverrides.triggered ? `STRATEGIC OVERRIDES: ${input.strategicOverrides.rules.join('; ')}` : ''}

${input.quickReviewResult ? `QUICK REVIEW: ${input.quickReviewResult.decision} (${(input.quickReviewResult.confidence * 100).toFixed(0)}% confidence)\nRationale: ${input.quickReviewResult.rationale.join('; ')}` : ''}

Provide a full assessment. Return ONLY valid JSON:
{
  "recommendation": "PASS" | "WATCH" | "EVALUATE",
  "confidence": 0.0-1.0,
  "strengths": ["strength1", "strength2"],
  "concerns": ["concern1"],
  "matchedPastPerformance": [{"project": "name", "matchedCapabilities": ["cap"], "agencyMatch": true, "similarityScore": 0.8}],
  "strategicAdvantages": ["advantage1"],
  "researchRequests": ["INCUMBENT", "AWARD_HISTORY", "AGENCY", "COMPETITOR", "TECHNICAL", "TEAMING", "VEHICLE"],
  "primeSuitability": "LOW" | "MEDIUM" | "HIGH",
  "meaningfulRolePotential": "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"
}

Only include research requests that are genuinely needed. Do not request all types.`;

  const response = await complete({
    agentId: 'maya',
    purpose: 'reason',
    taskType: 'opportunity_full_review',
    idempotencyKey: `workflow:${workflowId}:task:${taskId}:maya-full:v1:attempt:1`,
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: 1024,
    workflowId,
    taskId,
    opportunityId: input.opportunity.sourceId,
  });

  try {
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as FullReviewOutput;
  } catch {
    return {
      recommendation: 'WATCH',
      confidence: 0.3,
      strengths: [],
      concerns: ['Response parsing failed'],
      matchedPastPerformance: [],
      strategicAdvantages: [],
      researchRequests: [],
      primeSuitability: 'UNKNOWN' as any,
      meaningfulRolePotential: 'UNKNOWN',
    };
  }
}
