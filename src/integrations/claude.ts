import Anthropic from '@anthropic-ai/sdk';
import type { AgentName } from '../types/index.js';
import { metrics, MetricNames } from '../lib/metrics.js';
import { getRequestId } from '../lib/request-context.js';
import {
  trackCost,
  type CallPurpose,
  getRecommendedModel,
  type ModelTier,
} from '../lib/cost-tracker.js';

let anthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

// Model constants
const MODEL_SONNET = 'claude-sonnet-4-20250514';
const MODEL_HAIKU = 'claude-3-5-haiku-20241022';

// Legacy constant for backward compatibility
const MODEL = MODEL_SONNET;

// Export for use in other modules
export { MODEL_SONNET, MODEL_HAIKU, getRecommendedModel, type CallPurpose, type ModelTier };

/**
 * Track Claude API usage metrics (in-memory + persistent)
 */
async function trackApiUsage(
  response: Anthropic.Message,
  operation: string,
  durationMs: number,
  agent?: string,
  purpose?: CallPurpose
): Promise<void> {
  const labels = {
    operation,
    model: response.model,
    ...(agent && { agent }),
  };

  // Track in-memory metrics
  metrics.increment(MetricNames.CLAUDE_CALLS, labels);
  metrics.timing(MetricNames.CLAUDE_LATENCY, durationMs, labels);

  if (response.usage) {
    metrics.increment(MetricNames.CLAUDE_TOKENS_INPUT, labels, response.usage.input_tokens);
    metrics.increment(MetricNames.CLAUDE_TOKENS_OUTPUT, labels, response.usage.output_tokens);

    // Persist to database for cost analysis (fire and forget)
    trackCost({
      agent,
      purpose: purpose || mapOperationToPurpose(operation),
      model: response.model,
      usage: response.usage,
      durationMs,
    }).catch(() => {}); // Ignore errors - don't block main flow
  }
}

/**
 * Map legacy operation names to CallPurpose
 */
function mapOperationToPurpose(operation: string): CallPurpose {
  const mapping: Record<string, CallPurpose> = {
    generateAgentResponse: 'conversation',
    analyzeOpportunityFit: 'opportunity_analysis',
    researchAgency: 'research',
    generateOutreachEmail: 'outreach_draft',
  };
  return mapping[operation] || 'other';
}

/**
 * Track Claude API errors
 */
function trackApiError(operation: string, error: Error, agent?: string): void {
  const labels = {
    operation,
    error_type: error.name,
    ...(agent && { agent }),
  };
  metrics.increment(MetricNames.CLAUDE_ERRORS, labels);
}

/**
 * Get current API usage summary
 */
export function getClaudeApiStats(): {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalErrors: number;
  estimatedCost: string;
} {
  const summary = metrics.getSummary();
  const calls = summary.counters[MetricNames.CLAUDE_CALLS]?.total || 0;
  const inputTokens = summary.counters[MetricNames.CLAUDE_TOKENS_INPUT]?.total || 0;
  const outputTokens = summary.counters[MetricNames.CLAUDE_TOKENS_OUTPUT]?.total || 0;
  const errors = summary.counters[MetricNames.CLAUDE_ERRORS]?.total || 0;

  // Rough cost estimate for Sonnet: $3/M input, $15/M output
  const inputCost = (inputTokens / 1_000_000) * 3;
  const outputCost = (outputTokens / 1_000_000) * 15;
  const estimatedCost = `$${(inputCost + outputCost).toFixed(4)}`;

  return {
    totalCalls: calls,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalErrors: errors,
    estimatedCost,
  };
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentContext {
  opportunity?: {
    title: string;
    agency: string;
    type: string;
    due_date: string;
    description: string;
    fit_score?: number;
  };
  thread_context?: string;
  recent_messages?: Message[];
}

// Generate a response from an agent
export async function generateAgentResponse(
  agent: AgentName,
  systemPrompt: string,
  userMessage: string,
  context?: AgentContext
): Promise<string> {
  const client = getAnthropic();
  const startTime = Date.now();
  const requestId = getRequestId();

  // Build context string
  let contextString = '';
  if (context?.opportunity) {
    contextString += `\n\nCurrent Opportunity:\n`;
    contextString += `- Title: ${context.opportunity.title}\n`;
    contextString += `- Agency: ${context.opportunity.agency}\n`;
    contextString += `- Type: ${context.opportunity.type}\n`;
    contextString += `- Due: ${context.opportunity.due_date}\n`;
    if (context.opportunity.fit_score) {
      contextString += `- Fit Score: ${context.opportunity.fit_score}/100\n`;
    }
    contextString += `- Description: ${context.opportunity.description}\n`;
  }

  if (context?.thread_context) {
    contextString += `\n\nThread Context:\n${context.thread_context}\n`;
  }

  const messages: Message[] = context?.recent_messages || [];
  messages.push({ role: 'user', content: userMessage + contextString });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const durationMs = Date.now() - startTime;
    await trackApiUsage(response, 'generateAgentResponse', durationMs, agent, 'conversation');

    // Log token usage for debugging
    if (response.usage) {
      console.log(
        `[Claude] ${agent} response: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out (${durationMs}ms)${requestId ? ` [${requestId}]` : ''}`
      );
    }

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    return textBlock.text;
  } catch (error) {
    trackApiError('generateAgentResponse', error as Error, agent);
    throw error;
  }
}

// Analyze an opportunity for fit scoring
export async function analyzeOpportunityFit(
  title: string,
  description: string,
  agency: string,
  type: string
): Promise<{
  score: number;
  reasoning: string;
  keywords_matched: string[];
}> {
  const client = getAnthropic();
  const startTime = Date.now();

  const prompt = `Analyze this government contracting opportunity for fit with a human-centered design and digital services company.

Title: ${title}
Agency: ${agency}
Type: ${type}
Description: ${description}

Score from 0-100 based on:
- Keywords (30 points max): human-centered design, HCD, user experience, UX, user research, service design, customer experience, digital services, modernization, agile, prototype, MVP, rapid, iterative, design thinking, web application, portal, cloud, devops
- Priority Agency (20 points max): VA, HHS, DOL, STATE, ED, SBA, GSA
- Set-aside (15 points max): Small business set-asides are positive
- Type (15 points max): RFIs and Sources Sought are lower risk entry points
- Timeline (20 points max): Reasonable timelines are positive, very short or very long are negative

Penalize for: staff augmentation, staffing, body shop, mainframe, COBOL, legacy maintenance, TS/SCI requirements

Respond in JSON format:
{
  "score": <number 0-100>,
  "reasoning": "<2-3 sentence explanation>",
  "keywords_matched": ["<keyword1>", "<keyword2>", ...]
}`;

  try {
    const response = await client.messages.create({
      model: MODEL_HAIKU, // Use Haiku for opportunity scoring (structured JSON output, 10x cheaper)
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    await trackApiUsage(
      response,
      'analyzeOpportunityFit',
      Date.now() - startTime,
      undefined,
      'opportunity_analysis'
    );

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonText = textBlock.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      return JSON.parse(jsonText.trim());
    } catch {
      // Fallback if JSON parsing fails
      return {
        score: 50,
        reasoning: 'Unable to fully analyze opportunity',
        keywords_matched: [],
      };
    }
  } catch (error) {
    trackApiError('analyzeOpportunityFit', error as Error);
    throw error;
  }
}

// Research an agency
export async function researchAgency(
  agencyName: string,
  existingNotes?: string
): Promise<{
  tech_stack: string;
  pain_points: string;
  research_notes: string;
}> {
  const client = getAnthropic();
  const startTime = Date.now();

  const prompt = `Research this government agency for business development purposes:

Agency: ${agencyName}
${existingNotes ? `Existing Notes: ${existingNotes}` : ''}

Provide insights on:
1. Common technology stack and platforms they use
2. Known pain points and challenges
3. General research notes relevant to pursuing contracts

Respond in JSON format:
{
  "tech_stack": "<technologies they commonly use>",
  "pain_points": "<known challenges and pain points>",
  "research_notes": "<other relevant BD insights>"
}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    await trackApiUsage(response, 'researchAgency', Date.now() - startTime, undefined, 'research');

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    try {
      let jsonText = textBlock.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      return JSON.parse(jsonText.trim());
    } catch {
      return {
        tech_stack: 'Unknown',
        pain_points: 'Unknown',
        research_notes: textBlock.text,
      };
    }
  } catch (error) {
    trackApiError('researchAgency', error as Error);
    throw error;
  }
}

// Generate partner outreach email draft
export async function generateOutreachEmail(
  companyName: string,
  opportunityTitle: string,
  opportunityDescription: string,
  companyCapabilities: string
): Promise<{
  subject: string;
  body: string;
}> {
  const client = getAnthropic();
  const startTime = Date.now();

  const prompt = `Draft a teaming partner outreach email for a government contracting opportunity.

Our Company: Friends From The City (human-centered design and digital services)
Partner: ${companyName}
Partner Capabilities: ${companyCapabilities}
Opportunity: ${opportunityTitle}
Description: ${opportunityDescription}

Write a professional but warm email that:
1. Introduces our company briefly
2. Mentions the specific opportunity
3. Explains why we think there's a good teaming fit
4. Suggests a brief call to explore

Keep it concise (under 200 words). Be genuine, not salesy.

Respond in JSON format:
{
  "subject": "<email subject line>",
  "body": "<email body>"
}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    await trackApiUsage(
      response,
      'generateOutreachEmail',
      Date.now() - startTime,
      undefined,
      'outreach_draft'
    );

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    try {
      let jsonText = textBlock.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }
      return JSON.parse(jsonText.trim());
    } catch {
      return {
        subject: `Teaming Opportunity: ${opportunityTitle}`,
        body: textBlock.text,
      };
    }
  } catch (error) {
    trackApiError('generateOutreachEmail', error as Error);
    throw error;
  }
}
