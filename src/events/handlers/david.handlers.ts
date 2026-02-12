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

    // Build the RESEARCH_COMPLETE payload
    const researchPayload: ResearchCompletePayload = {
      noticeId: payload.noticeId,
      title: payload.title,
      incumbent: research.incumbent,
      redFlags: research.redFlags,
      greenFlags: research.greenFlags,
      agencyIntel: research.agencyIntel,
      confidence: research.confidence,
      sources: research.sources,
      summary: research.summary,
    };

    // Publish chain event
    const chainResult = await publishChainEvent(
      EventTypes.RESEARCH_COMPLETE,
      researchPayload as unknown as Record<string, unknown>
    );

    if (!chainResult.success) {
      console.error(`[David:Handler] Failed to publish RESEARCH_COMPLETE: ${chainResult.error}`);
    }

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        redFlagsFound: research.redFlags.length,
        greenFlagsFound: research.greenFlags.length,
        confidence: research.confidence,
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
// Export Handler Map
// ============================================================
export const davidHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.NEW_OPPORTUNITY, handleNewOpportunity],
]);
