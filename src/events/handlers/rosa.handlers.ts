// Rosa Event Handlers
// Rosa listens for: RESEARCH_COMPLETE
// Rosa publishes: RELATIONSHIP_CHECK_COMPLETE

import {
  EventType,
  EventTypes,
  ResearchCompletePayload,
  RelationshipCheckCompletePayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getAnthropic } from '../../integrations/claude.js';
import { replyInThread } from '../../integrations/slack.js';

// ============================================================
// RESEARCH_COMPLETE Handler
// Check relationship/teaming options after research
// ============================================================
const handleResearchComplete: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event, publishChainEvent } = context;
  const payload = event.payload as ResearchCompletePayload;

  console.log(`[Rosa:Handler] Checking relationships for "${payload.title}"`);
  console.log(`  Notice ID: ${payload.noticeId}`);
  console.log(`  Research confidence: ${payload.confidence}`);

  try {
    // Perform relationship check
    const relationshipCheck = await performRelationshipCheck(payload);

    // Build the RELATIONSHIP_CHECK_COMPLETE payload
    const relationshipPayload: RelationshipCheckCompletePayload = {
      noticeId: payload.noticeId,
      title: payload.title,
      teamingRecommendation: relationshipCheck.teamingRecommendation,
      potentialPartners: relationshipCheck.potentialPartners,
      certificationGaps: relationshipCheck.certificationGaps,
      relationshipStrength: relationshipCheck.relationshipStrength,
      confidence: relationshipCheck.confidence,
      summary: relationshipCheck.summary,
    };

    // POST TO SLACK - Make the collaboration visible
    if (event.thread_ts) {
      try {
        const slackMessage = formatRelationshipCheckForSlack(relationshipCheck);
        await replyInThread('connector', slackMessage, event.thread_ts);
        console.log(`[Rosa:Handler] Posted relationship check to thread ${event.thread_ts}`);
      } catch (slackErr) {
        console.warn(`[Rosa:Handler] Failed to post to Slack:`, slackErr);
      }
    }

    // Publish chain event
    const chainResult = await publishChainEvent(
      EventTypes.RELATIONSHIP_CHECK_COMPLETE,
      relationshipPayload as unknown as Record<string, unknown>
    );

    if (!chainResult.success) {
      console.error(
        `[Rosa:Handler] Failed to publish RELATIONSHIP_CHECK_COMPLETE: ${chainResult.error}`
      );
    }

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        teamingRecommendation: relationshipCheck.teamingRecommendation,
        potentialPartnersCount: relationshipCheck.potentialPartners.length,
        certificationGapsCount: relationshipCheck.certificationGaps.length,
      },
    };
  } catch (err) {
    console.error(`[Rosa:Handler] Relationship check failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Relationship check failed',
    };
  }
};

// ============================================================
// Relationship Check Logic
// ============================================================
interface RelationshipCheckResult {
  teamingRecommendation: 'prime' | 'sub' | 'joint_venture' | 'solo' | 'pass';
  potentialPartners: Array<{
    name: string;
    type: 'prime' | 'sub' | 'mentor' | 'jv_partner';
    relationship: 'existing' | 'warm_intro' | 'cold';
    certifications: string[];
    relevantExperience?: string;
    contactInfo?: string;
  }>;
  certificationGaps: Array<{
    certification: string;
    importance: 'required' | 'preferred' | 'nice_to_have';
    partnerCanFill: boolean;
  }>;
  relationshipStrength: 'strong' | 'moderate' | 'weak' | 'none';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
}

async function performRelationshipCheck(
  payload: ResearchCompletePayload
): Promise<RelationshipCheckResult> {
  const client = getAnthropic();

  const prompt = `You are Rosa, a partnerships and teaming specialist for a small civic tech firm. Analyze this opportunity for teaming possibilities.

OPPORTUNITY:
Title: ${payload.title}
Notice ID: ${payload.noticeId}

RESEARCH SUMMARY:
${payload.summary}

INCUMBENT INFO:
${payload.incumbent ? `Name: ${payload.incumbent.name || 'Unknown'}, Advantage: ${payload.incumbent.incumbentAdvantage || 'Unknown'}` : 'No incumbent identified'}

RED FLAGS:
${payload.redFlags.map((f) => `- [${f.severity}] ${f.type}: ${f.description}`).join('\n') || 'None identified'}

GREEN FLAGS:
${payload.greenFlags.map((f) => `- ${f.type}: ${f.description}`).join('\n') || 'None identified'}

Based on federal teaming patterns and relationship strategies, provide:

1. TEAMING RECOMMENDATION:
   - prime: We lead
   - sub: We support a larger prime
   - joint_venture: Partnership structure
   - solo: Go alone
   - pass: Not worth the relationship investment

2. POTENTIAL PARTNERS:
   - Types of partners that would strengthen the bid
   - Relationship status (existing, warm intro, cold)
   - Certifications they bring

3. CERTIFICATION GAPS:
   - What certifications are needed
   - Can partners fill these gaps

Respond in JSON format:
{
  "teamingRecommendation": "prime|sub|joint_venture|solo|pass",
  "potentialPartners": [
    {
      "name": "Partner type description",
      "type": "prime|sub|mentor|jv_partner",
      "relationship": "existing|warm_intro|cold",
      "certifications": ["list"],
      "relevantExperience": "brief description"
    }
  ],
  "certificationGaps": [
    {
      "certification": "string",
      "importance": "required|preferred|nice_to_have",
      "partnerCanFill": boolean
    }
  ],
  "relationshipStrength": "strong|moderate|weak|none",
  "confidence": "high|medium|low",
  "summary": "2-3 sentence teaming summary"
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

    const result = JSON.parse(jsonMatch[0]) as RelationshipCheckResult;

    // Ensure required fields have defaults
    return {
      teamingRecommendation: result.teamingRecommendation || 'solo',
      potentialPartners: result.potentialPartners || [],
      certificationGaps: result.certificationGaps || [],
      relationshipStrength: result.relationshipStrength || 'none',
      confidence: result.confidence || 'low',
      summary: result.summary || 'Relationship check completed.',
    };
  } catch (err) {
    console.error('[Rosa:Handler] Claude analysis failed:', err);

    // Return minimal result on failure
    return {
      teamingRecommendation: 'solo',
      potentialPartners: [],
      certificationGaps: [],
      relationshipStrength: 'none',
      confidence: 'low',
      summary: 'Unable to complete full relationship analysis. Manual review recommended.',
    };
  }
}

// ============================================================
// Slack Formatting
// ============================================================
function formatRelationshipCheckForSlack(check: RelationshipCheckResult): string {
  const recEmoji =
    check.teamingRecommendation === 'prime'
      ? '👑'
      : check.teamingRecommendation === 'sub'
        ? '🤝'
        : check.teamingRecommendation === 'joint_venture'
          ? '🔗'
          : check.teamingRecommendation === 'solo'
            ? '🏃'
            : '⏭️';

  let message = `🤝 *Relationship Check Complete*\n\n`;
  message += `${check.summary}\n\n`;
  message += `*Teaming Recommendation:* ${recEmoji} ${check.teamingRecommendation.replace('_', ' ')}\n`;
  message += `*Relationship Strength:* ${check.relationshipStrength}\n\n`;

  // Potential partners
  if (check.potentialPartners.length > 0) {
    message += `*Potential Partners (${check.potentialPartners.length}):*\n`;
    for (const partner of check.potentialPartners.slice(0, 3)) {
      const relationshipIcon =
        partner.relationship === 'existing'
          ? '✅'
          : partner.relationship === 'warm_intro'
            ? '🟡'
            : '❄️';
      message += `${relationshipIcon} ${partner.name} (${partner.type})\n`;
    }
    if (check.potentialPartners.length > 3) {
      message += `_...and ${check.potentialPartners.length - 3} more_\n`;
    }
    message += '\n';
  }

  // Certification gaps
  const requiredGaps = check.certificationGaps.filter((g) => g.importance === 'required');
  if (requiredGaps.length > 0) {
    message += `*⚠️ Required Cert Gaps:*\n`;
    for (const gap of requiredGaps) {
      const canFill = gap.partnerCanFill ? '(partner can fill)' : '(need to address)';
      message += `• ${gap.certification} ${canFill}\n`;
    }
  }

  message += `\n_Confidence: ${check.confidence} | Handing off to James for go/no-go_`;

  return message;
}

// ============================================================
// Export Handler Map
// ============================================================
export const rosaHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.RESEARCH_COMPLETE, handleResearchComplete],
]);
