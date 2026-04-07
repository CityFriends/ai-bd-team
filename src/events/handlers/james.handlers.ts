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
  ProposalContentPostedPayload,
  ClaimedEvent,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getEventsByThread } from '../eventBus.js';
import { getAnthropic } from '../../integrations/claude.js';
import { replyInThread } from '../../integrations/slack.js';
import {
  checkOpportunityAgainstRules,
  formatViolationsForPrompt,
  recordRulesApplied,
  type RuleCheckResult,
} from '../../playbook/index.js';
import {
  storeMemoryWithEmbedding,
  getImportantMemories,
  searchMemoriesByTags,
  type AgentMemory,
} from '../../memory/index.js';

// Cache TTL: 2 hours (after which stale entries are cleaned up)
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

// Timeout for waiting for all inputs: 10 minutes
const INPUT_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

// Cache for accumulating inputs before making decision
// In production, this would be stored in the database
const decisionInputsCache: Map<
  string,
  {
    research?: ResearchCompletePayload;
    techAssessment?: TechAssessmentCompletePayload;
    relationshipCheck?: RelationshipCheckCompletePayload;
    firstInputAt: Date;
    lastUpdated: Date;
  }
> = new Map();

// Clean up stale cache entries periodically
function cleanupStaleCache(): void {
  const now = Date.now();
  for (const [noticeId, cached] of decisionInputsCache.entries()) {
    if (now - cached.lastUpdated.getTime() > CACHE_TTL_MS) {
      console.log(`[James:Handler] Cleaning up stale cache entry for ${noticeId}`);
      decisionInputsCache.delete(noticeId);
    }
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupStaleCache, 15 * 60 * 1000);

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
  const now = new Date();
  const cached = decisionInputsCache.get(noticeId) || { firstInputAt: now, lastUpdated: now };
  cached.research = payload;
  cached.lastUpdated = now;
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
  const now = new Date();
  const cached = decisionInputsCache.get(noticeId) || { firstInputAt: now, lastUpdated: now };
  cached.techAssessment = payload;
  cached.lastUpdated = now;
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
  const now = new Date();
  const cached = decisionInputsCache.get(noticeId) || { firstInputAt: now, lastUpdated: now };
  cached.relationshipCheck = payload;
  cached.lastUpdated = now;
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

  // If we have all three inputs, definitely ready
  if (cached.research && cached.techAssessment && cached.relationshipCheck) {
    console.log(`[James:Handler] All 3 inputs received for ${noticeId}, ready for decision`);
    return true;
  }

  // Check if we've waited long enough (timeout after 10 minutes)
  const waitTime = Date.now() - cached.firstInputAt.getTime();
  if (waitTime >= INPUT_WAIT_TIMEOUT_MS) {
    // Timeout: proceed with available inputs
    const hasInputs = cached.techAssessment || cached.relationshipCheck;
    if (hasInputs) {
      console.log(
        `[James:Handler] Timeout reached for ${noticeId}, proceeding with available inputs ` +
          `(tech: ${!!cached.techAssessment}, relationship: ${!!cached.relationshipCheck})`
      );
      return true;
    }
  }

  // Not ready yet - waiting for more inputs
  const inputsStatus = [
    `research: ✓`,
    `tech: ${cached.techAssessment ? '✓' : '⏳'}`,
    `relationship: ${cached.relationshipCheck ? '✓' : '⏳'}`,
  ].join(', ');
  console.log(
    `[James:Handler] Waiting for inputs (${inputsStatus}) - ${Math.round(waitTime / 1000)}s elapsed`
  );

  return false;
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

    // Build opportunity context from original opportunity data (passed through research)
    const original = cached.research.originalOpportunity;
    const opportunityContext = {
      noticeId,
      title: cached.research.title,
      agency: original?.agency,
      value: original?.value ?? cached.research.incumbent?.contractValue ?? undefined,
      daysToRespond: original?.deadline
        ? Math.ceil((new Date(original.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : undefined,
    };

    const playbookCheck = await checkOpportunityAgainstRules(opportunityContext);

    if (playbookCheck.violations.length > 0) {
      console.log(
        `[James:Handler] Playbook flagged ${playbookCheck.violations.length} concern(s): ${playbookCheck.summary}`
      );
    }

    // Retrieve relevant memories from past experiences
    const agency = cached.research.originalOpportunity?.agency;
    const memories = await getRelevantMemories(agency);
    if (memories.length > 0) {
      console.log(`[James:Handler] Retrieved ${memories.length} relevant memories for context`);
    }

    // Generate decision using Claude, including playbook and memory context
    const decision = await generateDecision(
      cached.research,
      cached.techAssessment,
      cached.relationshipCheck,
      playbookCheck,
      memories
    );

    // Record which rules were applied to this opportunity
    if (playbookCheck.passed.length > 0) {
      await recordRulesApplied(
        { noticeId, title: cached.research.title },
        playbookCheck.passed,
        'james'
      );
    }

    // Store decision as memory for future reference
    await storeDecisionMemory(decision, cached.research, context.event.id);

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

    // POST TO SLACK - Make the decision visible
    if (context.event.thread_ts) {
      try {
        const slackMessage = formatDecisionForSlack(decision, decisionPayload);
        await replyInThread('strategist', slackMessage, context.event.thread_ts);
        console.log(`[James:Handler] Posted decision to thread ${context.event.thread_ts}`);
      } catch (slackErr) {
        console.warn(`[James:Handler] Failed to post to Slack:`, slackErr);
      }
    }

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
// Memory Retrieval for Decision Context
// ============================================================
async function getRelevantMemories(agency?: string): Promise<AgentMemory[]> {
  const memories: AgentMemory[] = [];

  try {
    // Get important insights from all agents
    const [davidInsights, jamesInsights, marcusInsights, rosaInsights] = await Promise.all([
      getImportantMemories('david', 7, 5),
      getImportantMemories('james', 7, 5),
      getImportantMemories('marcus', 7, 5),
      getImportantMemories('rosa', 7, 5),
    ]);

    memories.push(...davidInsights, ...jamesInsights, ...marcusInsights, ...rosaInsights);

    // If we have an agency, also search for agency-specific memories
    if (agency) {
      const agencyTag = agency.toLowerCase().replace(/\s+/g, '-');
      const [davidAgency, jamesAgency] = await Promise.all([
        searchMemoriesByTags('david', [agencyTag], 3),
        searchMemoriesByTags('james', [agencyTag], 3),
      ]);
      memories.push(...davidAgency, ...jamesAgency);
    }

    // Deduplicate by ID
    const seen = new Set<string>();
    return memories.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  } catch (err) {
    console.warn('[James:Handler] Failed to retrieve memories:', err);
    return [];
  }
}

function formatMemoriesForPrompt(memories: AgentMemory[]): string {
  if (memories.length === 0) return '';

  let section = '\n📚 TEAM MEMORY (past experiences & insights):\n';

  // Group by type
  const insights = memories.filter((m) => m.memory_type === 'insight');
  const reflections = memories.filter((m) => m.memory_type === 'reflection');
  const observations = memories.filter((m) => m.memory_type === 'observation');

  if (insights.length > 0) {
    section += '\n*Insights:*\n';
    for (const m of insights.slice(0, 3)) {
      section += `  • [${m.agent}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}\n`;
    }
  }

  if (reflections.length > 0) {
    section += '\n*Patterns:*\n';
    for (const m of reflections.slice(0, 2)) {
      section += `  • [${m.agent}] ${m.content.slice(0, 150)}${m.content.length > 150 ? '...' : ''}\n`;
    }
  }

  if (observations.length > 0) {
    section += '\n*Recent Observations:*\n';
    for (const m of observations.slice(0, 3)) {
      section += `  • [${m.agent}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}\n`;
    }
  }

  section +=
    '\nConsider these past experiences when making your decision, but weigh current data appropriately.\n';

  return section;
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
  playbookCheck?: RuleCheckResult,
  memories?: AgentMemory[]
): Promise<DecisionResult> {
  const client = getAnthropic();

  // Format playbook violations for the prompt
  const playbookSection = playbookCheck ? formatPlaybookForPrompt(playbookCheck) : '';

  // Format memories for the prompt
  const memorySection = memories ? formatMemoriesForPrompt(memories) : '';

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
${playbookSection}${memorySection}
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
// Memory Storage
// ============================================================
async function storeDecisionMemory(
  decision: DecisionResult,
  research: ResearchCompletePayload,
  eventId: string
): Promise<void> {
  try {
    // Build descriptive memory content
    const positiveFactors = decision.keyFactors
      .filter((f) => f.impact === 'positive')
      .map((f) => f.factor)
      .slice(0, 3);
    const negativeFactors = decision.keyFactors
      .filter((f) => f.impact === 'negative')
      .map((f) => f.factor)
      .slice(0, 3);

    const positiveNote =
      positiveFactors.length > 0 ? `Positives: ${positiveFactors.join('; ')}.` : '';
    const negativeNote =
      negativeFactors.length > 0 ? `Concerns: ${negativeFactors.join('; ')}.` : '';

    const content =
      `Decision: ${decision.decision} for "${research.title}" (${research.originalOpportunity?.agency || 'unknown agency'}). Win probability: ${decision.winProbability}%. ${decision.rationale} ${positiveNote} ${negativeNote}`.trim();

    // Build tags for querying
    const tags: string[] = [`decision-${decision.decision.toLowerCase().replace('_', '-')}`];

    // Agency tag
    if (research.originalOpportunity?.agency) {
      tags.push(research.originalOpportunity.agency.toLowerCase().replace(/\s+/g, '-'));
    }

    // Win probability buckets
    if (decision.winProbability >= 70) {
      tags.push('high-probability');
    } else if (decision.winProbability >= 40) {
      tags.push('medium-probability');
    } else {
      tags.push('low-probability');
    }

    // Confidence
    tags.push(`confidence-${decision.confidence}`);

    // Calculate importance based on decision type and probability
    let importance = 6;
    if (decision.decision === 'GO') importance += 2;
    if (decision.decision === 'NO_GO') importance += 1; // Still valuable to remember why we passed
    if (decision.winProbability >= 70) importance += 1;
    if (decision.confidence === 'high') importance += 1;
    importance = Math.max(1, Math.min(10, importance)); // Clamp to 1-10

    await storeMemoryWithEmbedding('james', 'observation', content, {
      relatedOpportunityId: research.noticeId,
      relatedEventId: eventId,
      importance,
      tags,
    });

    console.log(`[James:Handler] Stored decision memory for ${research.noticeId}`);
  } catch (err) {
    // Don't fail the handler if memory storage fails
    console.warn(`[James:Handler] Failed to store decision memory:`, err);
  }
}

// ============================================================
// Slack Formatting
// ============================================================
function formatDecisionForSlack(decision: DecisionResult, payload: GoNoGoDecisionPayload): string {
  const decisionEmoji =
    decision.decision === 'GO'
      ? '🟢'
      : decision.decision === 'NO_GO'
        ? '🔴'
        : decision.decision === 'CONDITIONAL_GO'
          ? '🟡'
          : '❓';

  let message = `🎯 *Go/No-Go Decision*\n\n`;
  message += `*Decision:* ${decisionEmoji} *${decision.decision.replace('_', ' ')}*\n`;
  message += `*Win Probability:* ${decision.winProbability}%\n`;
  message += `*Confidence:* ${decision.confidence}\n\n`;

  message += `*Rationale:*\n${decision.rationale}\n\n`;

  // Key factors
  const positiveFactors = decision.keyFactors.filter((f) => f.impact === 'positive');
  const negativeFactors = decision.keyFactors.filter((f) => f.impact === 'negative');

  if (positiveFactors.length > 0) {
    message += `*✅ Positive Factors:*\n`;
    for (const factor of positiveFactors.slice(0, 2)) {
      message += `• ${factor.factor}\n`;
    }
  }

  if (negativeFactors.length > 0) {
    message += `*⚠️ Concerns:*\n`;
    for (const factor of negativeFactors.slice(0, 2)) {
      message += `• ${factor.factor}\n`;
    }
  }

  // Conditions for conditional go
  if (decision.decision === 'CONDITIONAL_GO' && decision.conditions?.length) {
    message += `\n*Conditions:*\n`;
    for (const condition of decision.conditions) {
      message += `• ${condition}\n`;
    }
  }

  // Inputs received
  const inputs = payload.inputsReceived;
  const inputsReceived = [
    inputs.research ? 'David ✓' : 'David ⏳',
    inputs.techAssessment ? 'Marcus ✓' : 'Marcus ⏳',
    inputs.relationshipCheck ? 'Rosa ✓' : 'Rosa ⏳',
  ].join(' | ');
  message += `\n_Inputs: ${inputsReceived}_`;

  if (decision.decision === 'GO' || decision.decision === 'CONDITIONAL_GO') {
    message += `\n\n<@U0AC0SVD3MH> — Ready to pursue? Patricia will set up the schedule once you confirm.`;
  }

  return message;
}

// ============================================================
// PROPOSAL_CONTENT_POSTED Handler
// Strategic review of Jodie's proposal content before human review
// ============================================================
const handleProposalContentPosted: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as ProposalContentPostedPayload;

  console.log(
    `[James:Handler] Reviewing proposal content: ${payload.sectionType} for "${payload.opportunityTitle}"`
  );

  try {
    const client = getAnthropic();

    const prompt = `You are James, the BD strategist. Jodie just posted proposal content and needs your strategic review before Lapedra sees it.

OPPORTUNITY: ${payload.opportunityTitle}
SECTION: ${payload.sectionType.replace('_', ' ')}
TITLE: ${payload.sectionTitle}

CONTENT PREVIEW:
${payload.contentPreview}

${payload.reviewNotes ? `JODIE'S NOTES: ${payload.reviewNotes}` : ''}

Review this content for STRATEGIC ALIGNMENT:
1. Win theme alignment - Does it hit our discriminators?
2. Evaluator focus - Will this resonate with scoring criteria?
3. Proof points - Are claims backed with evidence?
4. Competitive positioning - Does it differentiate us?

Be specific and actionable. You're not editing prose - you're checking strategy fit.

Respond in JSON:
{
  "approved": boolean,
  "strategicScore": 1-10,
  "strengths": ["what's working well"],
  "concerns": ["specific issues to address"],
  "suggestions": ["actionable improvements"],
  "readyForLapedra": boolean,
  "summary": "1-2 sentence strategic assessment"
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const review = JSON.parse(jsonMatch[0]);

    // Post review to Slack thread
    if (event.thread_ts) {
      const statusEmoji = review.approved ? '✅' : review.readyForLapedra ? '🟡' : '🔴';
      let slackMessage = `${statusEmoji} *Strategic Review*\n\n`;
      slackMessage += `*Score:* ${review.strategicScore}/10\n`;
      slackMessage += `*Assessment:* ${review.summary}\n\n`;

      if (review.strengths.length > 0) {
        slackMessage += `*Strengths:*\n`;
        for (const s of review.strengths.slice(0, 3)) {
          slackMessage += `• ${s}\n`;
        }
      }

      if (review.concerns.length > 0) {
        slackMessage += `\n*Concerns:*\n`;
        for (const c of review.concerns.slice(0, 3)) {
          slackMessage += `• ${c}\n`;
        }
      }

      if (review.suggestions.length > 0 && !review.approved) {
        slackMessage += `\n*Suggestions:*\n`;
        for (const s of review.suggestions.slice(0, 2)) {
          slackMessage += `• ${s}\n`;
        }
      }

      if (review.readyForLapedra) {
        slackMessage += `\n@Lapedra — reviewed and ready for your eyes.`;
      } else {
        slackMessage += `\n@Jodie — address concerns above, then I'll flag Lapedra.`;
      }

      await replyInThread('strategist', slackMessage, event.thread_ts);
      console.log(`[James:Handler] Posted proposal review to thread`);
    }

    return {
      success: true,
      result: {
        opportunityTitle: payload.opportunityTitle,
        sectionType: payload.sectionType,
        approved: review.approved,
        strategicScore: review.strategicScore,
        readyForLapedra: review.readyForLapedra,
      },
    };
  } catch (err) {
    console.error(`[James:Handler] Proposal review failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Proposal review failed',
    };
  }
};

// ============================================================
// Export Handler Map
// ============================================================
export const jamesHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.RESEARCH_COMPLETE, handleResearchComplete],
  [EventTypes.TECH_ASSESSMENT_COMPLETE, handleTechAssessmentComplete],
  [EventTypes.RELATIONSHIP_CHECK_COMPLETE, handleRelationshipCheckComplete],
  [EventTypes.PROPOSAL_CONTENT_POSTED, handleProposalContentPosted],
]);
