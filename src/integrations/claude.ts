import Anthropic from '@anthropic-ai/sdk';
import type { AgentName } from '../types/index.js';

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

const MODEL = 'claude-sonnet-4-20250514';

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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  });

  // Extract text from response
  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(block => block.type === 'text');
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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(block => block.type === 'text');
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

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(block => block.type === 'text');
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
}
