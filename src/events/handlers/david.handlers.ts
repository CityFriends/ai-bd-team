// David Event Handlers
// David listens for: NEW_OPPORTUNITY
// David publishes: RESEARCH_COMPLETE

import {
  EventType,
  EventTypes,
  NewOpportunityPayload,
  ResearchCompletePayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getAnthropic } from '../../integrations/claude.js';
import { replyInThread } from '../../integrations/slack.js';

// ============================================================
// NEW_OPPORTUNITY Handler
// Research incumbent, red flags, agency intel
// ============================================================
const handleNewOpportunity: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event, publishChainEvent } = context;
  const payload = event.payload as NewOpportunityPayload;

  console.log(`[David:Handler] Researching opportunity "${payload.title}"`);
  console.log(`  Notice ID: ${payload.noticeId}`);
  console.log(`  Score: ${payload.score}`);
  console.log(`  Agency: ${payload.agency || 'Unknown'}`);

  try {
    // Perform research using Claude
    const research = await performResearch(payload);

    // Build the RESEARCH_COMPLETE payload with original opportunity context
    const researchPayload: ResearchCompletePayload = {
      noticeId: payload.noticeId,
      title: payload.title,
      // Pass through original opportunity data for downstream handlers
      originalOpportunity: {
        agency: payload.agency,
        value: payload.value,
        deadline: payload.deadline,
        naics: payload.naics,
        setAside: payload.setAside,
        url: payload.url,
        score: payload.score,
      },
      incumbent: research.incumbent,
      redFlags: research.redFlags,
      greenFlags: research.greenFlags,
      agencyIntel: research.agencyIntel,
      confidence: research.confidence,
      sources: research.sources,
      summary: research.summary,
    };

    // POST TO SLACK - Make the collaboration visible
    if (event.thread_ts) {
      try {
        const slackMessage = formatResearchForSlack(research, payload);
        await replyInThread('analyst', slackMessage, event.thread_ts);
        console.log(`[David:Handler] Posted research to thread ${event.thread_ts}`);
      } catch (slackErr) {
        console.warn(`[David:Handler] Failed to post to Slack:`, slackErr);
        // Continue - don't fail the handler just because Slack failed
      }
    }

    // Publish RESEARCH_COMPLETE to Marcus (tech assessment) and Rosa (relationships) in parallel
    // James will wait for their outputs (TECH_ASSESSMENT_COMPLETE, RELATIONSHIP_CHECK_COMPLETE)
    console.log(`[David:Handler] Publishing RESEARCH_COMPLETE to Marcus and Rosa...`);

    const [marcusResult, rosaResult] = await Promise.all([
      publishChainEvent(
        EventTypes.RESEARCH_COMPLETE,
        researchPayload as unknown as Record<string, unknown>,
        undefined, // priority
        'marcus' // target Marcus for tech assessment
      ),
      publishChainEvent(
        EventTypes.RESEARCH_COMPLETE,
        researchPayload as unknown as Record<string, unknown>,
        undefined, // priority
        'rosa' // target Rosa for relationship check
      ),
    ]);

    console.log(
      `[David:Handler] Marcus event: ${marcusResult.success ? '✓' : '✗'} ${marcusResult.eventId || marcusResult.error}`
    );
    console.log(
      `[David:Handler] Rosa event: ${rosaResult.success ? '✓' : '✗'} ${rosaResult.eventId || rosaResult.error}`
    );

    const chainResults = { marcus: marcusResult, rosa: rosaResult };

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        redFlagsFound: research.redFlags.length,
        greenFlagsFound: research.greenFlags.length,
        confidence: research.confidence,
        // Chain events published to Marcus and Rosa
        chainEventResults: chainResults,
      },
    };
  } catch (err) {
    console.error(`[David:Handler] Research failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Research failed',
    };
  }
};

// ============================================================
// Research Logic
// ============================================================
interface ResearchResult {
  incumbent?: {
    name?: string;
    contractNumber?: string;
    contractValue?: number;
    performanceRating?: string;
    incumbentAdvantage?: 'high' | 'medium' | 'low' | 'unknown';
  };
  redFlags: Array<{
    type: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  greenFlags: Array<{
    type: string;
    description: string;
  }>;
  agencyIntel?: {
    recentAwards?: number;
    preferredVendors?: string[];
    budgetTrend?: 'increasing' | 'stable' | 'decreasing' | 'unknown';
  };
  confidence: 'high' | 'medium' | 'low';
  sources: string[];
  summary: string;
}

async function performResearch(payload: NewOpportunityPayload): Promise<ResearchResult> {
  const client = getAnthropic();

  const prompt = `You are David, an experienced federal contract analyst. Analyze this opportunity and provide research findings.

OPPORTUNITY:
Title: ${payload.title}
Notice ID: ${payload.noticeId}
Agency: ${payload.agency || 'Unknown'}
Value: ${payload.value ? `$${payload.value.toLocaleString()}` : 'Unknown'}
NAICS: ${payload.naics || 'Unknown'}
Set-Aside: ${payload.setAside || 'None specified'}
Deadline: ${payload.deadline || 'Unknown'}

Based on your knowledge of federal contracting patterns, provide:

1. INCUMBENT ANALYSIS:
   - Likely incumbent (if recompete)
   - Incumbent advantage level

2. RED FLAGS (concerns):
   - Wired indicators
   - Unrealistic timeline
   - Budget red flags
   - Compliance concerns

3. GREEN FLAGS (positive indicators):
   - Open competition signals
   - Good fit indicators
   - Agency accessibility

4. AGENCY INTEL:
   - Budget trends
   - Preferred vendor patterns

Respond in JSON format:
{
  "incumbent": {
    "name": "string or null",
    "incumbentAdvantage": "high|medium|low|unknown"
  },
  "redFlags": [
    {"type": "string", "description": "string", "severity": "high|medium|low"}
  ],
  "greenFlags": [
    {"type": "string", "description": "string"}
  ],
  "agencyIntel": {
    "budgetTrend": "increasing|stable|decreasing|unknown"
  },
  "confidence": "high|medium|low",
  "sources": ["list of sources"],
  "summary": "2-3 sentence summary of findings"
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

    const result = JSON.parse(jsonMatch[0]) as ResearchResult;

    // Ensure required fields have defaults
    return {
      incumbent: result.incumbent,
      redFlags: result.redFlags || [],
      greenFlags: result.greenFlags || [],
      agencyIntel: result.agencyIntel,
      confidence: result.confidence || 'low',
      sources: result.sources || ['Analysis'],
      summary: result.summary || 'Research completed.',
    };
  } catch (err) {
    console.error('[David:Handler] Claude analysis failed:', err);

    // Return minimal result on failure
    return {
      redFlags: [],
      greenFlags: [],
      confidence: 'low',
      sources: ['Limited analysis'],
      summary: 'Unable to complete full analysis. Manual review recommended.',
    };
  }
}

// ============================================================
// Slack Formatting
// ============================================================
function formatResearchForSlack(research: ResearchResult, _payload: NewOpportunityPayload): string {
  let message = `📋 *Research Complete*\n\n`;
  message += `${research.summary}\n\n`;

  // Incumbent
  if (research.incumbent?.name) {
    const advantage = research.incumbent.incumbentAdvantage || 'unknown';
    message += `*Incumbent:* ${research.incumbent.name} (${advantage} advantage)\n\n`;
  }

  // Red flags
  if (research.redFlags.length > 0) {
    message += `*🚩 Red Flags (${research.redFlags.length}):*\n`;
    for (const flag of research.redFlags.slice(0, 3)) {
      const emoji = flag.severity === 'high' ? '🔴' : flag.severity === 'medium' ? '🟡' : '🟢';
      message += `${emoji} ${flag.type}: ${flag.description}\n`;
    }
    if (research.redFlags.length > 3) {
      message += `_...and ${research.redFlags.length - 3} more_\n`;
    }
    message += '\n';
  }

  // Green flags
  if (research.greenFlags.length > 0) {
    message += `*✅ Green Flags (${research.greenFlags.length}):*\n`;
    for (const flag of research.greenFlags.slice(0, 3)) {
      message += `• ${flag.type}: ${flag.description}\n`;
    }
    if (research.greenFlags.length > 3) {
      message += `_...and ${research.greenFlags.length - 3} more_\n`;
    }
    message += '\n';
  }

  message += `_Confidence: ${research.confidence} | Handing off to Marcus and Rosa for assessments_`;

  return message;
}

// ============================================================
// Export Handler Map
// ============================================================
export const davidHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.NEW_OPPORTUNITY, handleNewOpportunity],
]);
