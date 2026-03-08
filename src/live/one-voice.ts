/**
 * One Voice Synthesis
 *
 * When a human asks a question that could involve multiple agents,
 * James (or designated lead) gathers input internally and presents
 * one unified response instead of 7 separate agent responses.
 *
 * This prevents:
 * - Human: "What do we think about this RFP?"
 * - [7 separate agent responses with similar opinions]
 *
 * And creates:
 * - Human: "What do we think about this RFP?"
 * - James: "Here's the team's assessment: [synthesized response]"
 */

import { getAnthropic } from '../integrations/claude.js';
import type { LiveAgentName } from './types.js';

// The designated synthesis lead
const SYNTHESIS_LEAD: LiveAgentName = 'james';

// Patterns that trigger team synthesis (questions to the whole team)
const SYNTHESIS_TRIGGERS = [
  // Direct team questions
  'what do we think',
  'what does the team think',
  'team thoughts',
  'team opinion',
  "what's everyone's take",
  "what's the team's take",
  'thoughts?',
  'opinions?',
  // Assessment requests
  'assess this',
  'assessment',
  'evaluate this',
  'evaluation',
  'analyze this',
  // Go/no-go
  'should we bid',
  'should we pursue',
  'go or no-go',
  'go/no-go',
  'worth pursuing',
  // General team queries
  'what do you all think',
  'everyone weigh in',
];

/**
 * Agent expertise areas for consultation
 */
const AGENT_EXPERTISE: Record<LiveAgentName, { role: string; askAbout: string }> = {
  maya: {
    role: 'Opportunity Scout',
    askAbout:
      'SAM.gov details, solicitation type, NAICS, set-asides, deadline, red flags in the solicitation',
  },
  david: {
    role: 'Analyst',
    askAbout: 'Incumbent analysis, contract history, agency patterns, risk assessment, red flags',
  },
  rosa: {
    role: 'Teaming Strategist',
    askAbout: 'Teaming needs, potential partners, prime/sub dynamics, capability gaps',
  },
  james: {
    role: 'BD Strategist',
    askAbout: 'Win probability, strategic fit, capture approach, recommendation',
  },
  patricia: {
    role: 'Project Manager',
    askAbout: 'Timeline feasibility, resource availability, scheduling conflicts',
  },
  jodie: {
    role: 'Proposal Writer',
    askAbout: 'Past performance fit, writing complexity, compliance considerations',
  },
  marcus: {
    role: 'Technical Lead',
    askAbout: 'Technical requirements fit, stack alignment, FedRAMP/ATO considerations',
  },
};

/**
 * Check if a message should trigger team synthesis
 */
export function shouldTriggerSynthesis(
  messageText: string,
  isFromHuman: boolean,
  isTeamMention: boolean
): boolean {
  // Only synthesize for human questions
  if (!isFromHuman) {
    return false;
  }

  const lowerText = messageText.toLowerCase();

  // Check for explicit team mentions
  if (isTeamMention) {
    // If it's a question, synthesize
    if (lowerText.includes('?')) {
      return true;
    }
  }

  // Check for synthesis trigger phrases
  for (const trigger of SYNTHESIS_TRIGGERS) {
    if (lowerText.includes(trigger)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the synthesis lead agent
 */
export function getSynthesisLead(): LiveAgentName {
  return SYNTHESIS_LEAD;
}

/**
 * Check if an agent is the synthesis lead
 */
export function isSynthesisLead(agentName: LiveAgentName): boolean {
  return agentName === SYNTHESIS_LEAD;
}

/**
 * Generate a prompt for consulting a specific agent
 */
function buildConsultationPrompt(
  agentName: LiveAgentName,
  question: string,
  context: string
): string {
  const expertise = AGENT_EXPERTISE[agentName];

  return `You are ${agentName}, the ${expertise.role} for Friends From The City.

A team member asked: "${question}"

Context:
${context}

Based on your expertise in ${expertise.askAbout}, provide a brief (2-3 sentence) assessment. Be direct and specific. If you don't have enough information, say so briefly.

Focus ONLY on your area of expertise. Don't comment on other agents' domains.`;
}

/**
 * Consult an individual agent internally (no Slack post)
 *
 * This generates what the agent would say without actually posting.
 */
async function consultAgent(
  agentName: LiveAgentName,
  question: string,
  context: string
): Promise<{ agent: LiveAgentName; response: string }> {
  const client = getAnthropic();
  const prompt = buildConsultationPrompt(agentName, question, context);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text : 'No input available.';

    return { agent: agentName, response: text };
  } catch (error) {
    console.error(`[OneVoice] Error consulting ${agentName}:`, error);
    return { agent: agentName, response: 'Unable to provide input at this time.' };
  }
}

/**
 * Gather input from all relevant agents
 *
 * Determines which agents should be consulted based on the question,
 * then queries them in parallel.
 */
export async function gatherTeamInput(
  question: string,
  context: string,
  relevantAgents?: LiveAgentName[]
): Promise<Array<{ agent: LiveAgentName; response: string }>> {
  // Default to consulting all agents except the synthesis lead
  const agentsToConsult: LiveAgentName[] = relevantAgents || [
    'maya',
    'david',
    'rosa',
    'patricia',
    'jodie',
    'marcus',
  ];

  // Consult all agents in parallel
  const consultations = await Promise.all(
    agentsToConsult.map((agent) => consultAgent(agent, question, context))
  );

  return consultations;
}

/**
 * Build the synthesis prompt for James
 */
function buildSynthesisPrompt(
  question: string,
  context: string,
  teamInput: Array<{ agent: LiveAgentName; response: string }>
): string {
  const inputSummary = teamInput
    .map((input) => {
      const expertise = AGENT_EXPERTISE[input.agent];
      return `**${input.agent}** (${expertise.role}):\n${input.response}`;
    })
    .join('\n\n');

  return `You are James, the BD Strategist for Friends From The City. A team member asked:

"${question}"

Context:
${context}

Your team has provided their assessments:

${inputSummary}

---

Synthesize the team's input into ONE clear, actionable response. Structure your response as:

1. **Bottom Line** (1 sentence recommendation)
2. **Key Points** (3-4 bullets covering the most important findings from the team)
3. **Next Steps** (what should happen now)

Be direct and decisive. This is the ONE response the human will see - make it count.

Do NOT list each agent's input separately. SYNTHESIZE it into a coherent assessment.`;
}

/**
 * Synthesize team input into one response
 *
 * James takes all agent input and creates one unified response.
 */
export async function synthesizeTeamResponse(
  question: string,
  context: string,
  teamInput: Array<{ agent: LiveAgentName; response: string }>
): Promise<string> {
  const client = getAnthropic();
  const prompt = buildSynthesisPrompt(question, context, teamInput);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text : 'Unable to synthesize team response.';
  } catch (error) {
    console.error('[OneVoice] Error synthesizing response:', error);
    return 'Unable to synthesize team response at this time.';
  }
}

/**
 * Full One Voice flow: gather input and synthesize
 *
 * Used by James when a synthesis trigger is detected.
 */
export async function generateOneVoiceResponse(
  question: string,
  context: string
): Promise<{
  synthesizedResponse: string;
  teamInput: Array<{ agent: LiveAgentName; response: string }>;
}> {
  console.log('[OneVoice] Gathering team input...');

  // Gather input from all agents
  const teamInput = await gatherTeamInput(question, context);

  console.log(`[OneVoice] Received input from ${teamInput.length} agents, synthesizing...`);

  // Synthesize into one response
  const synthesizedResponse = await synthesizeTeamResponse(question, context, teamInput);

  return {
    synthesizedResponse,
    teamInput,
  };
}

/**
 * Format the synthesized response for Slack
 *
 * Adds a note that this is a team synthesis.
 */
export function formatSynthesizedResponse(
  response: string,
  agentsConsulted: LiveAgentName[]
): string {
  const agentNames = agentsConsulted.map((a) => a.charAt(0).toUpperCase() + a.slice(1));

  return `${response}

_Team synthesis based on input from ${agentNames.join(', ')}_`;
}
