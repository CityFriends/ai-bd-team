/**
 * Response Gating
 *
 * Controls when agents should respond based on:
 * 1. Whether they're directly @mentioned
 * 2. Whether the topic is in their domain
 * 3. Whether another agent has already covered it
 *
 * This prevents the "everyone piles on" pattern where all agents
 * respond with similar opinions to every message.
 */

import type { LiveAgentName } from './types.js';

/**
 * Agent domain keywords - based on actual system prompts
 *
 * Each agent responds to messages containing their domain keywords.
 * More specific keywords = higher confidence match.
 */
const AGENT_DOMAINS: Record<LiveAgentName, string[]> = {
  james: [
    // Strategy & capture
    'strategy',
    'strategic',
    'capture',
    'go/no-go',
    'go no go',
    'bid decision',
    'should we bid',
    'worth pursuing',
    'win probability',
    'pwin',
    'price to win',
    'price-to-win',
    // Color teams & reviews
    'color team',
    'pink team',
    'red team',
    'gold team',
    'gate review',
    'black hat',
    // BD leadership
    'final call',
    'recommendation',
    'my take',
    'bottom line',
    'decision',
  ],

  maya: [
    // SAM.gov & sourcing
    'sam.gov',
    'sam gov',
    'opportunity',
    'opportunities',
    'solicitation',
    'notice id',
    'found this',
    'new opp',
    'new opportunity',
    // RFP types
    'rfp',
    'rfi',
    'rfq',
    'sources sought',
    'presolicitation',
    // Sourcing details
    'naics',
    'set-aside',
    'set aside',
    'small business',
    '8(a)',
    'wosb',
    'sdvosb',
    'hubzone',
    'recompete',
    'new work',
    'due date',
    'deadline',
  ],

  david: [
    // Research & analysis
    'incumbent',
    'incumbents',
    'current contractor',
    'contract data',
    'usaspending',
    'usa spending',
    'fpds',
    // Risk & red flags
    'red flag',
    'red flags',
    'risk',
    'risks',
    'concern',
    'concerns',
    'warning',
    // Agency research
    'agency',
    'agency research',
    'protest',
    'protests',
    'gao',
    // FAR & compliance
    'far ',
    'far part',
    'dfar',
    'cpar',
    'cpars',
    'oci',
    'organizational conflict',
    // Pricing analysis
    'pricing',
    'pricing dynamics',
    'price analysis',
  ],

  rosa: [
    // Teaming & partnerships
    'teaming',
    'team with',
    'partner',
    'partners',
    'partnership',
    'subcontractor',
    'subcontract',
    'sub to',
    'prime',
    'priming',
    // Teaming structures
    'jv',
    'joint venture',
    'mentor-protégé',
    'mentor protege',
    'workshare',
    'work share',
    // Small business
    'small business',
    'utilization',
    'set-aside',
  ],

  patricia: [
    // PM & tracking
    'deadline',
    'deadlines',
    'due',
    'action item',
    'action items',
    'tracking',
    'track this',
    'status',
    'status update',
    // Proposal management
    'schedule',
    'timeline',
    'compliance matrix',
    'shred-out',
    'shredout',
    'section assignment',
    // Reviews & process
    'review cycle',
    'orals prep',
    'debrief',
    'q&a period',
    // Dependencies
    'blocking',
    'blocked',
    'dependency',
    'dependencies',
    'who owns',
    // Feedback
    'feedback',
    'bug',
    'issue',
    'great catch',
  ],

  jodie: [
    // Proposal writing
    'write',
    'writing',
    'draft',
    'drafting',
    'edit',
    'editing',
    'proposal',
    // Sections
    'section l',
    'section m',
    'executive summary',
    'tech approach',
    'technical approach',
    'management approach',
    'past performance',
    // Writing craft
    'compliance',
    'compliant',
    'page limit',
    'word count',
    'discriminator',
    'win theme',
    'shipley',
    // Case studies
    'case study',
    'case studies',
  ],

  marcus: [
    // Technical review
    'technical',
    'architecture',
    'architect',
    'codebase',
    'code review',
    'repo',
    'repository',
    'github',
    // Gov compliance
    'fedramp',
    'fed ramp',
    'ato',
    'authority to operate',
    'section 508',
    'accessibility',
    'wcag',
    // Gov tech
    'cloud.gov',
    'login.gov',
    'uswds',
    'design system',
    // Stack & tools
    'tech stack',
    'stack',
    'api',
    'database',
    'infrastructure',
    'devops',
    'ci/cd',
  ],
};

/**
 * Check if a message is in an agent's domain
 *
 * @param agentName - The agent to check
 * @param messageText - The message text
 * @returns Match result with confidence
 */
export function isInAgentDomain(
  agentName: LiveAgentName,
  messageText: string
): {
  isMatch: boolean;
  matchedKeywords: string[];
  confidence: 'high' | 'medium' | 'low';
} {
  const domains = AGENT_DOMAINS[agentName] || [];
  const lowerText = messageText.toLowerCase();

  const matchedKeywords: string[] = [];

  for (const keyword of domains) {
    if (lowerText.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
    }
  }

  // Confidence based on number of matches
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (matchedKeywords.length >= 3) {
    confidence = 'high';
  } else if (matchedKeywords.length >= 1) {
    confidence = 'medium';
  }

  return {
    isMatch: matchedKeywords.length > 0,
    matchedKeywords,
    confidence,
  };
}

/**
 * Find which agent is the best match for a message
 *
 * @param messageText - The message text
 * @returns Best matching agent and their match details
 */
export function findBestAgentMatch(messageText: string): {
  agent: LiveAgentName | null;
  matchedKeywords: string[];
  confidence: 'high' | 'medium' | 'low';
  allMatches: Array<{ agent: LiveAgentName; keywords: string[]; count: number }>;
} {
  const allAgents: LiveAgentName[] = [
    'maya',
    'david',
    'rosa',
    'james',
    'patricia',
    'jodie',
    'marcus',
  ];
  const allMatches: Array<{ agent: LiveAgentName; keywords: string[]; count: number }> = [];

  for (const agent of allAgents) {
    const match = isInAgentDomain(agent, messageText);
    if (match.isMatch) {
      allMatches.push({
        agent,
        keywords: match.matchedKeywords,
        count: match.matchedKeywords.length,
      });
    }
  }

  // Sort by match count (descending)
  allMatches.sort((a, b) => b.count - a.count);

  if (allMatches.length === 0) {
    return {
      agent: null,
      matchedKeywords: [],
      confidence: 'low',
      allMatches: [],
    };
  }

  const best = allMatches[0];
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (best.count >= 3) {
    confidence = 'high';
  } else if (best.count >= 1) {
    confidence = 'medium';
  }

  return {
    agent: best.agent,
    matchedKeywords: best.keywords,
    confidence,
    allMatches,
  };
}

/**
 * Determine if an agent should respond based on gating rules
 *
 * Rules (in order):
 * 1. If directly @mentioned → RESPOND
 * 2. If another agent was @mentioned → STAY QUIET
 * 3. If topic is clearly in agent's domain → RESPOND
 * 4. If another agent is a better match → STAY QUIET
 * 5. Default → STAY QUIET (let the right agent handle it)
 *
 * @param agentName - The agent checking if they should respond
 * @param messageText - The message text
 * @param isDirectMention - Whether this agent was directly @mentioned
 * @param otherAgentMentioned - Whether a different agent was @mentioned
 * @returns Gate decision
 */
export function checkResponseGate(
  agentName: LiveAgentName,
  messageText: string,
  isDirectMention: boolean,
  otherAgentMentioned: boolean
): {
  shouldRespond: boolean;
  reason: string;
  domainMatch?: {
    isMatch: boolean;
    keywords: string[];
    confidence: 'high' | 'medium' | 'low';
  };
} {
  // Rule 1: Always respond if directly @mentioned
  if (isDirectMention) {
    return {
      shouldRespond: true,
      reason: 'Directly @mentioned',
    };
  }

  // Rule 2: Stay quiet if another agent was specifically @mentioned
  if (otherAgentMentioned) {
    return {
      shouldRespond: false,
      reason: 'Another agent was @mentioned - letting them handle it',
    };
  }

  // Rule 3 & 4: Check domain match
  const myMatch = isInAgentDomain(agentName, messageText);
  const bestMatch = findBestAgentMatch(messageText);

  // If no domain matches at all, stay quiet
  if (!myMatch.isMatch && !bestMatch.agent) {
    return {
      shouldRespond: false,
      reason: 'No domain match - staying quiet',
      domainMatch: {
        isMatch: myMatch.isMatch,
        keywords: myMatch.matchedKeywords,
        confidence: myMatch.confidence,
      },
    };
  }

  // If I'm the best match, respond
  if (bestMatch.agent === agentName) {
    return {
      shouldRespond: true,
      reason: `Domain match: ${myMatch.matchedKeywords.join(', ')}`,
      domainMatch: {
        isMatch: true,
        keywords: myMatch.matchedKeywords,
        confidence: myMatch.confidence,
      },
    };
  }

  // If I match but someone else is a better match, stay quiet
  if (myMatch.isMatch && bestMatch.agent !== agentName) {
    return {
      shouldRespond: false,
      reason: `${bestMatch.agent} is a better match (${bestMatch.matchedKeywords.join(', ')}) - staying quiet`,
      domainMatch: {
        isMatch: myMatch.isMatch,
        keywords: myMatch.matchedKeywords,
        confidence: myMatch.confidence,
      },
    };
  }

  // Default: stay quiet
  return {
    shouldRespond: false,
    reason: 'No strong domain match - staying quiet',
    domainMatch: {
      isMatch: myMatch.isMatch,
      keywords: myMatch.matchedKeywords,
      confidence: myMatch.confidence,
    },
  };
}

/**
 * Check if the topic was already covered by another agent in the thread
 *
 * @param threadMessages - Messages in the thread
 * @param currentAgentName - The agent checking
 * @param messageText - The current message being responded to
 * @returns Whether topic was already covered
 */
export function wasTopicAlreadyCovered(
  threadMessages: Array<{ author: string; text: string }>,
  currentAgentName: LiveAgentName,
  messageText: string
): {
  wasCovered: boolean;
  coveredBy?: string;
  reason?: string;
} {
  const allAgents: LiveAgentName[] = [
    'maya',
    'david',
    'rosa',
    'james',
    'patricia',
    'jodie',
    'marcus',
  ];
  const myMatch = isInAgentDomain(currentAgentName, messageText);

  if (!myMatch.isMatch) {
    return { wasCovered: false };
  }

  // Check if another agent already responded to this domain
  for (const msg of threadMessages) {
    const authorLower = msg.author.toLowerCase() as LiveAgentName;

    // Skip if it's from the current agent or not from an agent
    if (authorLower === currentAgentName || !allAgents.includes(authorLower)) {
      continue;
    }

    // If they mentioned the same keywords we would, they already covered it
    const overlappingKeywords = myMatch.matchedKeywords.filter((kw) =>
      msg.text.toLowerCase().includes(kw.toLowerCase())
    );

    if (overlappingKeywords.length > 0) {
      return {
        wasCovered: true,
        coveredBy: msg.author,
        reason: `${msg.author} already addressed: ${overlappingKeywords.join(', ')}`,
      };
    }
  }

  return { wasCovered: false };
}
