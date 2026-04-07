// Marcus Event Handlers
// Marcus listens for: RESEARCH_COMPLETE, GO_NO_GO_DECISION
// Marcus publishes: TECH_ASSESSMENT_COMPLETE

import { WebClient } from '@slack/web-api';
import {
  EventType,
  EventTypes,
  ResearchCompletePayload,
  GoNoGoDecisionPayload,
  TechAssessmentCompletePayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getAnthropic } from '../../integrations/claude.js';
import { storeMemoryWithEmbedding } from '../../memory/index.js';

// Use Marcus's own tokens for posting to Slack
async function postAsMarcus(message: string, threadTs: string): Promise<void> {
  const botToken = process.env.MARCUS_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!botToken || !channelId) {
    throw new Error('Missing MARCUS_BOT_TOKEN or SLACK_CHANNEL_ID');
  }

  const client = new WebClient(botToken);
  await client.chat.postMessage({
    channel: channelId,
    text: message,
    thread_ts: threadTs,
    username: 'Marcus',
    icon_url:
      'https://bvgtfadggtgnakrxvuim.supabase.co/storage/v1/object/public/agent-avatars/Marcus.jpeg',
  });
}

// ============================================================
// RESEARCH_COMPLETE Handler
// Perform technical assessment after research
// ============================================================
const handleResearchComplete: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event, publishChainEvent } = context;
  const payload = event.payload as ResearchCompletePayload;

  console.log(`[Marcus:Handler] Performing tech assessment for "${payload.title}"`);
  console.log(`  Notice ID: ${payload.noticeId}`);
  console.log(`  Research confidence: ${payload.confidence}`);

  try {
    // Perform technical assessment
    const assessment = await performTechAssessment(payload);

    // Build the TECH_ASSESSMENT_COMPLETE payload
    const techPayload: TechAssessmentCompletePayload = {
      noticeId: payload.noticeId,
      title: payload.title,
      techStack: assessment.techStack,
      compliance: assessment.compliance,
      concerns: assessment.concerns,
      strengths: assessment.strengths,
      recommendation: assessment.recommendation,
      confidence: assessment.confidence,
      summary: assessment.summary,
    };

    // Store tech assessment as memory for future reference
    await storeTechAssessmentMemory(assessment, payload, event.id);

    // POST TO SLACK - Make the collaboration visible (using Marcus's own tokens)
    if (event.thread_ts) {
      try {
        const slackMessage = formatTechAssessmentForSlack(assessment);
        await postAsMarcus(slackMessage, event.thread_ts);
        console.log(`[Marcus:Handler] Posted tech assessment to thread ${event.thread_ts}`);
      } catch (slackErr) {
        console.warn(`[Marcus:Handler] Failed to post to Slack:`, slackErr);
      }
    }

    // Publish chain event
    const chainResult = await publishChainEvent(
      EventTypes.TECH_ASSESSMENT_COMPLETE,
      techPayload as unknown as Record<string, unknown>
    );

    if (!chainResult.success) {
      console.error(
        `[Marcus:Handler] Failed to publish TECH_ASSESSMENT_COMPLETE: ${chainResult.error}`
      );
    }

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        recommendation: assessment.recommendation,
        concernsCount: assessment.concerns.length,
        strengthsCount: assessment.strengths.length,
      },
    };
  } catch (err) {
    console.error(`[Marcus:Handler] Tech assessment failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Tech assessment failed',
    };
  }
};

// ============================================================
// GO_NO_GO_DECISION Handler
// Draft solution architecture on GO decision
// ============================================================
const handleGoNoGoDecision: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as GoNoGoDecisionPayload;

  console.log(`[Marcus:Handler] Received go/no-go decision for "${payload.title}"`);
  console.log(`  Decision: ${payload.decision}`);
  console.log(`  Win probability: ${payload.winProbability}%`);

  // Only act on GO or CONDITIONAL_GO
  if (payload.decision !== 'GO' && payload.decision !== 'CONDITIONAL_GO') {
    console.log(`[Marcus:Handler] Decision is ${payload.decision}, no architecture needed`);
    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'skipped',
        reason: `Decision was ${payload.decision}`,
      },
    };
  }

  // Draft solution architecture (in production, this would create a document)
  console.log(`[Marcus:Handler] Drafting solution architecture for "${payload.title}"`);

  // TODO: Generate architecture document
  // For now, just log that we would do this
  const architectureOutline = {
    noticeId: payload.noticeId,
    title: payload.title,
    sections: [
      'Technical Approach Overview',
      'System Architecture',
      'Technology Stack',
      'Security & Compliance',
      'Integration Strategy',
      'DevOps & Infrastructure',
      'Risk Mitigation',
    ],
    status: 'draft_initiated',
  };

  return {
    success: true,
    result: {
      noticeId: payload.noticeId,
      action: 'architecture_drafted',
      outline: architectureOutline,
    },
  };
};

// ============================================================
// Tech Assessment Logic
// ============================================================
interface TechAssessmentResult {
  techStack: {
    required: string[];
    preferred: string[];
    compatibility: 'high' | 'medium' | 'low';
  };
  compliance: {
    fedRampRequired: boolean;
    fedRampLevel?: 'high' | 'moderate' | 'low' | 'not_required';
    atoRequired: boolean;
    section508: boolean;
    otherCertifications: string[];
  };
  concerns: Array<{
    area: string;
    description: string;
    severity: 'blocker' | 'major' | 'minor';
  }>;
  strengths: Array<{
    area: string;
    description: string;
  }>;
  recommendation: 'strong_fit' | 'good_fit' | 'possible_fit' | 'poor_fit' | 'no_fit';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

async function performTechAssessment(
  payload: ResearchCompletePayload
): Promise<TechAssessmentResult> {
  const client = getAnthropic();

  const prompt = `You are Marcus, an engineering lead specializing in federal technology requirements. Assess the technical aspects of this opportunity.

OPPORTUNITY:
Title: ${payload.title}
Notice ID: ${payload.noticeId}

RESEARCH SUMMARY:
${payload.summary}

RED FLAGS:
${payload.redFlags.map((f) => `- [${f.severity}] ${f.type}: ${f.description}`).join('\n') || 'None identified'}

GREEN FLAGS:
${payload.greenFlags.map((f) => `- ${f.type}: ${f.description}`).join('\n') || 'None identified'}

Based on federal technology patterns and compliance requirements, provide:

1. TECH STACK ANALYSIS:
   - Required technologies
   - Preferred technologies
   - Compatibility with typical civic tech stack

2. COMPLIANCE REQUIREMENTS:
   - FedRAMP requirements
   - ATO requirements
   - Section 508 accessibility
   - Other certifications

3. TECHNICAL CONCERNS:
   - Blockers, major issues, minor issues

4. TECHNICAL STRENGTHS:
   - Areas of advantage

Respond in JSON format:
{
  "techStack": {
    "required": ["list"],
    "preferred": ["list"],
    "compatibility": "high|medium|low"
  },
  "compliance": {
    "fedRampRequired": boolean,
    "fedRampLevel": "high|moderate|low|not_required",
    "atoRequired": boolean,
    "section508": boolean,
    "otherCertifications": ["list"]
  },
  "concerns": [
    {"area": "string", "description": "string", "severity": "blocker|major|minor"}
  ],
  "strengths": [
    {"area": "string", "description": "string"}
  ],
  "recommendation": "strong_fit|good_fit|possible_fit|poor_fit|no_fit",
  "confidence": "high|medium|low",
  "summary": "2-3 sentence technical summary"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
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

    const result = JSON.parse(jsonMatch[0]) as TechAssessmentResult;

    // Ensure required fields have defaults
    return {
      techStack: result.techStack || { required: [], preferred: [], compatibility: 'medium' },
      compliance: result.compliance || {
        fedRampRequired: false,
        atoRequired: false,
        section508: true,
        otherCertifications: [],
      },
      concerns: result.concerns || [],
      strengths: result.strengths || [],
      recommendation: result.recommendation || 'possible_fit',
      confidence: result.confidence || 'low',
      summary: result.summary || 'Technical assessment completed.',
    };
  } catch (err) {
    console.error('[Marcus:Handler] Claude analysis failed:', err);

    // Return minimal result on failure
    return {
      techStack: { required: [], preferred: [], compatibility: 'medium' },
      compliance: {
        fedRampRequired: false,
        atoRequired: false,
        section508: true,
        otherCertifications: [],
      },
      concerns: [],
      strengths: [],
      recommendation: 'possible_fit',
      confidence: 'low',
      summary: 'Unable to complete full technical assessment. Manual review recommended.',
    };
  }
}

// ============================================================
// Memory Storage
// ============================================================
async function storeTechAssessmentMemory(
  assessment: TechAssessmentResult,
  payload: ResearchCompletePayload,
  eventId: string
): Promise<void> {
  try {
    // Build descriptive memory content
    const blockers = assessment.concerns.filter((c) => c.severity === 'blocker');
    const blockerNote =
      blockers.length > 0 ? `Blockers: ${blockers.map((b) => b.area).join(', ')}.` : 'No blockers.';

    const strengthNote =
      assessment.strengths.length > 0
        ? `Strengths: ${assessment.strengths.map((s) => s.area).join(', ')}.`
        : '';

    const complianceNote = assessment.compliance.fedRampRequired
      ? `FedRAMP ${assessment.compliance.fedRampLevel || 'required'}.`
      : '';

    const content =
      `Tech assessment for "${payload.title}": ${assessment.recommendation.replace('_', ' ')}. ${assessment.summary} ${blockerNote} ${strengthNote} ${complianceNote}`.trim();

    // Build tags for querying
    const tags: string[] = [`tech-${assessment.recommendation.replace('_', '-')}`];

    // Agency tag
    if (payload.originalOpportunity?.agency) {
      tags.push(payload.originalOpportunity.agency.toLowerCase().replace(/\s+/g, '-'));
    }

    // Compliance tags
    if (assessment.compliance.fedRampRequired) {
      tags.push('fedramp');
    }
    if (assessment.compliance.atoRequired) {
      tags.push('ato-required');
    }

    // Blockers tag
    if (blockers.length > 0) {
      tags.push('has-blockers');
    }

    // Confidence
    tags.push(`confidence-${assessment.confidence}`);

    // Calculate importance
    let importance = 5;
    if (assessment.recommendation === 'strong_fit' || assessment.recommendation === 'good_fit')
      importance += 2;
    if (assessment.recommendation === 'no_fit') importance += 1;
    if (blockers.length > 0) importance += 1;
    if (assessment.confidence === 'high') importance += 1;
    importance = Math.max(1, Math.min(10, importance));

    await storeMemoryWithEmbedding('marcus', 'observation', content, {
      relatedOpportunityId: payload.noticeId,
      relatedEventId: eventId,
      importance,
      tags,
    });

    console.log(`[Marcus:Handler] Stored tech assessment memory for ${payload.noticeId}`);
  } catch (err) {
    console.warn(`[Marcus:Handler] Failed to store tech assessment memory:`, err);
  }
}

// ============================================================
// Slack Formatting
// ============================================================
function formatTechAssessmentForSlack(assessment: TechAssessmentResult): string {
  const recEmoji =
    assessment.recommendation === 'strong_fit'
      ? '🟢'
      : assessment.recommendation === 'good_fit'
        ? '🟢'
        : assessment.recommendation === 'possible_fit'
          ? '🟡'
          : '🔴';

  let message = `⚙️ *Tech Assessment Complete*\n\n`;
  message += `${assessment.summary}\n\n`;
  message += `*Recommendation:* ${recEmoji} ${assessment.recommendation.replace('_', ' ')}\n`;
  message += `*Tech Compatibility:* ${assessment.techStack.compatibility}\n\n`;

  // Compliance
  const complianceItems: string[] = [];
  if (assessment.compliance.fedRampRequired) {
    complianceItems.push(`FedRAMP ${assessment.compliance.fedRampLevel || 'required'}`);
  }
  if (assessment.compliance.section508) {
    complianceItems.push('Section 508');
  }
  if (assessment.compliance.atoRequired) {
    complianceItems.push('ATO required');
  }
  if (complianceItems.length > 0) {
    message += `*Compliance:* ${complianceItems.join(', ')}\n\n`;
  }

  // Concerns
  const blockers = assessment.concerns.filter((c) => c.severity === 'blocker');
  if (blockers.length > 0) {
    message += `*🚨 Blockers (${blockers.length}):*\n`;
    for (const concern of blockers) {
      message += `• ${concern.area}: ${concern.description}\n`;
    }
    message += '\n';
  }

  // Strengths
  if (assessment.strengths.length > 0) {
    message += `*💪 Strengths (${assessment.strengths.length}):*\n`;
    for (const strength of assessment.strengths.slice(0, 2)) {
      message += `• ${strength.area}: ${strength.description}\n`;
    }
  }

  message += `\n_Confidence: ${assessment.confidence}_`;

  return message;
}

// ============================================================
// Export Handler Map
// ============================================================
export const marcusHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.RESEARCH_COMPLETE, handleResearchComplete],
  [EventTypes.GO_NO_GO_DECISION, handleGoNoGoDecision],
]);
