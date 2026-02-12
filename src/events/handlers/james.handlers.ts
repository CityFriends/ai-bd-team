// James Event Handlers
// James listens for: RESEARCH_COMPLETE, TECH_ASSESSMENT_COMPLETE, RELATIONSHIP_CHECK_COMPLETE
// James publishes: GO_NO_GO_DECISION

import {
  EventType,
  EventTypes,
  ResearchCompletePayload,
  TechAssessmentCompletePayload,
  RelationshipCheckCompletePayload,
  GoNoGoDecisionPayload,
  ClaimedEvent,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getEventsByThread } from '../eventBus.js';
import { getAnthropic } from '../../integrations/claude.js';
import {
  checkOpportunityAgainstRules,
  formatViolationsForPrompt,
  recordRulesApplied,
  type RuleCheckResult,
} from '../../playbook/index.js';

// Cache for accumulating inputs before making decision
// In production, this would be stored in the database
const decisionInputsCache: Map<
  string,
  {
    research?: ResearchCompletePayload;
    techAssessment?: TechAssessmentCompletePayload;
    relationshipCheck?: RelationshipCheckCompletePayload;
    lastUpdated: Date;
  }
> = new Map();

// ============================================================
// RESEARCH_COMPLETE Handler
// Store research results and check if ready for decision
// ============================================================
const handleResearchComplete: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as ResearchCompletePayload;

  console.log(`[James:Handler] Received research for "${payload.title}"`);

  // Store the research result
  const noticeId = payload.noticeId;
  const cached = decisionInputsCache.get(noticeId) || { lastUpdated: new Date() };
  cached.research = payload;
  cached.lastUpdated = new Date();
  decisionInputsCache.set(noticeId, cached);

  // Check if we have all inputs
  const readyForDecision = await checkReadyForDecision(noticeId, context.event);

  if (readyForDecision) {
    return await makeDecision(context, noticeId);
  }

  console.log(`[James:Handler] Waiting for more inputs for "${payload.title}"`);
  return {
    success: true,
    result: {
      noticeId,
      status: 'waiting_for_inputs',
      hasResearch: true,
      hasTechAssessment: !!cached.techAssessment,
      hasRelationshipCheck: !!cached.relationshipCheck,
    },
  };
};

// ============================================================
// TECH_ASSESSMENT_COMPLETE Handler
// ============================================================
const handleTechAssessmentComplete: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as TechAssessmentCompletePayload;

  console.log(`[James:Handler] Received tech assessment for "${payload.title}"`);

  // Store the tech assessment result
  const noticeId = payload.noticeId;
  const cached = decisionInputsCache.get(noticeId) || { lastUpdated: new Date() };
  cached.techAssessment = payload;
  cached.lastUpdated = new Date();
  decisionInputsCache.set(noticeId, cached);

  // Check if we have all inputs
  const readyForDecision = await checkReadyForDecision(noticeId, context.event);

  if (readyForDecision) {
    return await makeDecision(context, noticeId);
  }

  console.log(`[James:Handler] Waiting for more inputs for "${payload.title}"`);
  return {
    success: true,
    result: {
      noticeId,
      status: 'waiting_for_inputs',
      hasResearch: !!cached.research,
      hasTechAssessment: true,
      hasRelationshipCheck: !!cached.relationshipCheck,
    },
  };
};

// ============================================================
// RELATIONSHIP_CHECK_COMPLETE Handler
// ============================================================
const handleRelationshipCheckComplete: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as RelationshipCheckCompletePayload;

  console.log(`[James:Handler] Received relationship check for "${payload.title}"`);

  // Store the relationship check result
  const noticeId = payload.noticeId;
  const cached = decisionInputsCache.get(noticeId) || { lastUpdated: new Date() };
  cached.relationshipCheck = payload;
  cached.lastUpdated = new Date();
  decisionInputsCache.set(noticeId, cached);

  // Check if we have all inputs
  const readyForDecision = await checkReadyForDecision(noticeId, context.event);

  if (readyForDecision) {
    return await makeDecision(context, noticeId);
  }

  console.log(`[James:Handler] Waiting for more inputs for "${payload.title}"`);
  return {
    success: true,
    result: {
      noticeId,
      status: 'waiting_for_inputs',
      hasResearch: !!cached.research,
      hasTechAssessment: !!cached.techAssessment,
      hasRelationshipCheck: true,
    },
  };
};

// ============================================================
// Decision Making Logic
// ============================================================
async function checkReadyForDecision(noticeId: string, event: ClaimedEvent): Promise<boolean> {
  const cached = decisionInputsCache.get(noticeId);
  if (!cached) return false;

  // We need at least research to make a decision
  if (!cached.research) return false;

  // If we have all three inputs, definitely ready
  if (cached.research && cached.techAssessment && cached.relationshipCheck) {
    return true;
  }

  // Check if other inputs have arrived via event chain
  if (event.thread_ts) {
    const chainEvents = await getEventsByThread(event.thread_ts);

    for (const chainEvent of chainEvents) {
      if (chainEvent.event_type === EventTypes.TECH_ASSESSMENT_COMPLETE && !cached.techAssessment) {
        cached.techAssessment = chainEvent.payload as unknown as TechAssessmentCompletePayload;
      }
      if (
        chainEvent.event_type === EventTypes.RELATIONSHIP_CHECK_COMPLETE &&
        !cached.relationshipCheck
      ) {
        cached.relationshipCheck =
          chainEvent.payload as unknown as RelationshipCheckCompletePayload;
      }
    }

    decisionInputsCache.set(noticeId, cached);
  }

  // Ready if we have at least research + one other
  return !!(cached.research && (cached.techAssessment || cached.relationshipCheck));
}

async function makeDecision(
  context: EventHandlerContext,
  noticeId: string
): Promise<EventHandlerResult> {
  const { publishChainEvent } = context;
  const cached = decisionInputsCache.get(noticeId);

  if (!cached || !cached.research) {
    return {
      success: false,
      error: 'No research data available for decision',
    };
  }

  console.log(`[James:Handler] Making go/no-go decision for "${cached.research.title}"`);

  try {
    // ─── CONSULT THE PLAYBOOK ───
    // Check this opportunity against the team's learned rules
    console.log(`[James:Handler] Consulting playbook for "${cached.research.title}"`);

    // Build opportunity context from available data
    // Research payload has limited fields, so we extract what's available
    const opportunityContext = {
      noticeId,
      title: cached.research.title,
      // Agency might be in agencyIntel or incumbent context
      agency: cached.research.agencyIntel?.preferredVendors
        ? cached.research.summary.match(/agency[:\s]+([A-Z]{2,10})/i)?.[1]
        : undefined,
      // Value might be in incumbent's contract value as a proxy
      value: cached.research.incumbent?.contractValue,
      // Days to respond would need to come from original opportunity - not available here
      daysToRespond: undefined,
    };

    const playbookCheck = await checkOpportunityAgainstRules(opportunityContext);

    if (playbookCheck.violations.length > 0) {
      console.log(
        `[James:Handler] Playbook flagged ${playbookCheck.violations.length} concern(s): ${playbookCheck.summary}`
      );
    }

    // Generate decision using Claude, including playbook context
    const decision = await generateDecision(
      cached.research,
      cached.techAssessment,
      cached.relationshipCheck,
      playbookCheck
    );

    // Record which rules were applied to this opportunity
    if (playbookCheck.passed.length > 0) {
      await recordRulesApplied(
        { noticeId, title: cached.research.title },
        playbookCheck.passed,
        'james'
      );
    }

    // Build the GO_NO_GO_DECISION payload
    const decisionPayload: GoNoGoDecisionPayload = {
      noticeId,
      title: cached.research.title,
      decision: decision.decision,
      winProbability: decision.winProbability,
      keyFactors: decision.keyFactors,
      risks: decision.risks,
      conditions: decision.conditions,
      openQuestions: decision.openQuestions,
      inputsReceived: {
        research: true,
        techAssessment: !!cached.techAssessment,
        relationshipCheck: !!cached.relationshipCheck,
      },
      rationale: decision.rationale,
      confidence: decision.confidence,
    };

    // Publish chain event
    const chainResult = await publishChainEvent(
      EventTypes.GO_NO_GO_DECISION,
      decisionPayload as unknown as Record<string, unknown>
    );

    if (!chainResult.success) {
      console.error(`[James:Handler] Failed to publish GO_NO_GO_DECISION: ${chainResult.error}`);
    }

    // Clean up cache
    decisionInputsCache.delete(noticeId);

    return {
      success: true,
      result: {
        noticeId,
        decision: decision.decision,
        winProbability: decision.winProbability,
        confidence: decision.confidence,
      },
    };
  } catch (err) {
    console.error(`[James:Handler] Decision generation failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Decision generation failed',
    };
  }
}

interface DecisionResult {
  decision: 'GO' | 'NO_GO' | 'CONDITIONAL_GO' | 'NEEDS_MORE_INFO';
  winProbability: number;
  keyFactors: Array<{
    factor: string;
    impact: 'positive' | 'negative' | 'neutral';
    weight: number;
  }>;
  risks: Array<{
    risk: string;
    likelihood: 'high' | 'medium' | 'low';
    mitigation?: string;
  }>;
  conditions?: string[];
  openQuestions?: string[];
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================
// Format Playbook Results for Prompt
// ============================================================
function formatPlaybookForPrompt(playbookCheck: RuleCheckResult): string {
  if (playbookCheck.violations.length === 0 && playbookCheck.passed.length === 0) {
    return '';
  }

  let section = '\n📋 TEAM PLAYBOOK (learned rules from past outcomes):\n';

  // Show recommendation summary
  if (playbookCheck.recommendation === 'stop') {
    section += `⛔ PLAYBOOK RECOMMENDATION: ${playbookCheck.summary}\n\n`;
  } else if (playbookCheck.recommendation === 'caution') {
    section += `⚠️ PLAYBOOK RECOMMENDATION: ${playbookCheck.summary}\n\n`;
  } else {
    section += `✅ PLAYBOOK RECOMMENDATION: ${playbookCheck.summary}\n\n`;
  }

  // Format violations
  if (playbookCheck.violations.length > 0) {
    section += formatViolationsForPrompt(playbookCheck.violations);
    section += '\n';
  }

  // Show passed rules (briefly)
  if (playbookCheck.passed.length > 0) {
    section += `✓ ${playbookCheck.passed.length} rule(s) passed:\n`;
    for (const rule of playbookCheck.passed.slice(0, 3)) {
      const confidence = Math.round(rule.confidence * 100);
      section += `  • [${confidence}%] ${rule.rule.slice(0, 80)}${rule.rule.length > 80 ? '...' : ''}\n`;
    }
    if (playbookCheck.passed.length > 3) {
      section += `  ... and ${playbookCheck.passed.length - 3} more\n`;
    }
  }

  section +=
    '\nIMPORTANT: These rules are based on our actual win/loss data. You can override them with good reason, but explain why in your rationale.\n';

  return section;
}

async function generateDecision(
  research: ResearchCompletePayload,
  techAssessment?: TechAssessmentCompletePayload,
  relationshipCheck?: RelationshipCheckCompletePayload,
  playbookCheck?: RuleCheckResult
): Promise<DecisionResult> {
  const client = getAnthropic();

  // Format playbook violations for the prompt
  const playbookSection = playbookCheck ? formatPlaybookForPrompt(playbookCheck) : '';

  const prompt = `You are James, a strategic capture manager. Make a go/no-go recommendation for this opportunity.

OPPORTUNITY:
Title: ${research.title}
Notice ID: ${research.noticeId}

RESEARCH (from David):
Summary: ${research.summary}
Confidence: ${research.confidence}
Red Flags (${research.redFlags.length}):
${research.redFlags.map((f) => `- [${f.severity}] ${f.type}: ${f.description}`).join('\n') || 'None'}
Green Flags (${research.greenFlags.length}):
${research.greenFlags.map((f) => `- ${f.type}: ${f.description}`).join('\n') || 'None'}
Incumbent: ${research.incumbent?.name || 'Unknown'} (Advantage: ${research.incumbent?.incumbentAdvantage || 'Unknown'})

${
  techAssessment
    ? `
TECH ASSESSMENT (from Marcus):
Recommendation: ${techAssessment.recommendation}
Confidence: ${techAssessment.confidence}
Summary: ${techAssessment.summary}
Concerns (${techAssessment.concerns.length}):
${techAssessment.concerns.map((c) => `- [${c.severity}] ${c.area}: ${c.description}`).join('\n') || 'None'}
FedRAMP Required: ${techAssessment.compliance.fedRampRequired}
`
    : 'TECH ASSESSMENT: Not yet received'
}

${
  relationshipCheck
    ? `
RELATIONSHIP CHECK (from Rosa):
Teaming Recommendation: ${relationshipCheck.teamingRecommendation}
Relationship Strength: ${relationshipCheck.relationshipStrength}
Confidence: ${relationshipCheck.confidence}
Summary: ${relationshipCheck.summary}
Potential Partners: ${relationshipCheck.potentialPartners.length}
Certification Gaps: ${relationshipCheck.certificationGaps.length}
`
    : 'RELATIONSHIP CHECK: Not yet received'
}
${playbookSection}
Make a strategic go/no-go recommendation. Consider:
- Win probability based on all factors
- Resource investment vs likelihood of success
- Strategic value beyond this contract
- Risk tolerance for a small firm

Respond in JSON format:
{
  "decision": "GO|NO_GO|CONDITIONAL_GO|NEEDS_MORE_INFO",
  "winProbability": 0-100,
  "keyFactors": [
    {"factor": "string", "impact": "positive|negative|neutral", "weight": 1-10}
  ],
  "risks": [
    {"risk": "string", "likelihood": "high|medium|low", "mitigation": "optional string"}
  ],
  "conditions": ["list of conditions for CONDITIONAL_GO"],
  "openQuestions": ["list of questions for NEEDS_MORE_INFO"],
  "rationale": "2-3 sentence strategic rationale",
  "confidence": "high|medium|low"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON from response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]) as DecisionResult;

    // Ensure required fields have defaults
    return {
      decision: result.decision || 'NEEDS_MORE_INFO',
      winProbability: result.winProbability || 0,
      keyFactors: result.keyFactors || [],
      risks: result.risks || [],
      conditions: result.conditions,
      openQuestions: result.openQuestions,
      rationale: result.rationale || 'Decision generated.',
      confidence: result.confidence || 'low',
    };
  } catch (err) {
    console.error('[James:Handler] Claude analysis failed:', err);

    // Return minimal result on failure
    return {
      decision: 'NEEDS_MORE_INFO',
      winProbability: 0,
      keyFactors: [],
      risks: [],
      openQuestions: ['Unable to generate automated decision - manual review required'],
      rationale: 'Automated decision failed. Please review manually.',
      confidence: 'low',
    };
  }
}

// ============================================================
// Export Handler Map
// ============================================================
export const jamesHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.RESEARCH_COMPLETE, handleResearchComplete],
  [EventTypes.TECH_ASSESSMENT_COMPLETE, handleTechAssessmentComplete],
  [EventTypes.RELATIONSHIP_CHECK_COMPLETE, handleRelationshipCheckComplete],
]);
