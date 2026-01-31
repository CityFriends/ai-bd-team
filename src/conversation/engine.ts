// Conversation Engine
// Orchestrates threaded, reactive discussions between agents

import { getSlackApp, getChannelId } from '../integrations/slack.js';
import { getOpportunity, getAgency, getSupabase } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import type { Opportunity, Agency, Company, AgentName } from '../types/index.js';
import {
  analyzeOpportunity,
  analyzePartners,
  analyzeStrategy,
  determineConversationDynamic,
  type OpportunityAnalysis,
  type PartnerAnalysis,
  type StrategicAnalysis,
  type ConversationDynamic,
} from './analysis.js';
import {
  MAYA_OPENERS,
  DAVID_OPENERS,
  ROSA_OPENERS,
  JAMES_OPENERS,
  PATRICIA_OPENERS,
  DAVID_CONCERNS,
  DAVID_POSITIVES,
  ROSA_PARTNER_PHRASES,
  JAMES_RECOMMENDATION_PHRASES,
  REACTIONS,
  pick,
  fill,
} from './phrases.js';

// Agent display info for posting
const AGENT_INFO: Record<AgentName, { emoji: string; displayName: string; name: string }> = {
  scout: { emoji: '🔍', displayName: 'Scout', name: 'Maya' },
  analyst: { emoji: '📊', displayName: 'Analyst', name: 'David' },
  connector: { emoji: '🤝', displayName: 'Connector', name: 'Rosa' },
  strategist: { emoji: '🎯', displayName: 'Strategist', name: 'James' },
  pm: { emoji: '📋', displayName: 'PM', name: 'Patricia' },
};

interface ConversationContext {
  opportunity: Opportunity;
  agency: Agency | null;
  partners: Company[];
  oppAnalysis: OpportunityAnalysis;
  partnerAnalysis: PartnerAnalysis;
  strategyAnalysis: StrategicAnalysis;
  dynamic: ConversationDynamic;
  threadTs: string;
  mainChannelTs: string;
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Random delay within range
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Post as agent
async function postAsAgent(
  agent: AgentName,
  text: string,
  threadTs?: string
): Promise<string> {
  const { emoji, displayName } = AGENT_INFO[agent];
  const app = getSlackApp();
  const channel = getChannelId();

  const result = await app.client.chat.postMessage({
    channel,
    text: `${emoji} *${displayName}*\n\n${text}`,
    thread_ts: threadTs,
    unfurl_links: false,
    unfurl_media: false,
  });

  return result.ts || '';
}

// Add reaction to message
async function addReaction(messageTs: string, reaction: string): Promise<void> {
  const app = getSlackApp();
  const channel = getChannelId();

  try {
    await app.client.reactions.add({
      channel,
      timestamp: messageTs,
      name: reaction,
    });
  } catch (error) {
    // Reaction may already exist or be invalid, ignore
  }
}

// Maybe add a reaction (30-50% chance)
async function maybeReact(messageTs: string, sentiment: 'positive' | 'concern' | 'watching'): Promise<void> {
  if (Math.random() > 0.4) return; // 40% chance to react

  let reactionPool: string[];
  switch (sentiment) {
    case 'positive':
      reactionPool = [...REACTIONS.agree, ...REACTIONS.good_point];
      break;
    case 'concern':
      reactionPool = REACTIONS.concern;
      break;
    case 'watching':
      reactionPool = REACTIONS.watching;
      break;
  }

  await addReaction(messageTs, pick(reactionPool));
}

// Get Maya's opener based on fit score
function getMayaOpener(fitScore: number): string {
  if (fitScore >= 80) {
    return pick(MAYA_OPENERS.excited);
  } else if (fitScore >= 60) {
    return pick(MAYA_OPENERS.interested);
  } else {
    return pick(MAYA_OPENERS.cautious);
  }
}

// Get David's opener based on sentiment
function getDavidOpener(sentiment: 'positive' | 'neutral' | 'skeptical'): string {
  return pick(DAVID_OPENERS[sentiment]);
}

// Get Rosa's opener based on partner confidence
function getRosaOpener(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return pick(ROSA_OPENERS.confident);
    case 'medium':
      return pick(ROSA_OPENERS.exploring);
    case 'low':
      return pick(ROSA_OPENERS.limited);
  }
}

// Get James's opener based on recommendation
function getJamesOpener(rec: StrategicAnalysis['recommendation']): string {
  switch (rec) {
    case 'go':
      return pick(JAMES_OPENERS.decisive_go);
    case 'no_go':
      return pick(JAMES_OPENERS.decisive_nogo);
    case 'lean_go':
    case 'lean_no':
      return pick(JAMES_OPENERS.leaning);
    case 'torn':
      return pick(JAMES_OPENERS.torn);
  }
}

// Get Patricia's opener based on conversation type
function getPatriciaOpener(type: ConversationDynamic['type'], urgent: boolean): string {
  if (urgent) {
    return pick(PATRICIA_OPENERS.urgent);
  } else if (type === 'tension' || type === 'debate') {
    return pick(PATRICIA_OPENERS.after_debate);
  } else {
    return pick(PATRICIA_OPENERS.smooth);
  }
}

// Build Maya's message
function buildMayaMessage(opp: Opportunity, analysis: OpportunityAnalysis): string {
  const opener = getMayaOpener(opp.fit_score || 0);

  let message = `${opener}\n\n`;
  message += `*${opp.title}*\n`;
  message += `${opp.agency || 'Unknown'} · ${opp.type || 'Unknown'}`;
  if (opp.est_value) message += ` · ${opp.est_value}`;
  if (analysis.daysUntilDue) message += ` · ${analysis.daysUntilDue} days`;
  message += `\n\n`;

  // Short description
  if (opp.description) {
    const snippet = opp.description.length > 200
      ? opp.description.substring(0, 200) + '...'
      : opp.description;
    message += `_${snippet}_\n\n`;
  }

  message += `Fit: *${opp.fit_score}/100*`;
  if (analysis.keywordsMatched.length > 0) {
    message += ` (${analysis.keywordsMatched.slice(0, 3).join(', ')})`;
  }
  message += `\n\n`;

  message += `@David, what do you think?`;

  return message;
}

// Build David's message
function buildDavidMessage(
  ctx: ConversationContext,
  isReplyToMaya: boolean
): string {
  const { oppAnalysis, dynamic } = ctx;
  const opener = getDavidOpener(oppAnalysis.davidSentiment);

  let message = '';

  if (isReplyToMaya && oppAnalysis.davidSentiment === 'skeptical' && oppAnalysis.fitScore >= 70) {
    // Acknowledge Maya's find but express concern
    message = `Interesting find Maya, but ${opener.toLowerCase()}\n\n`;
  } else if (isReplyToMaya && oppAnalysis.davidSentiment === 'positive') {
    message = `Good catch Maya. ${opener}\n\n`;
  } else {
    message = `${opener}\n\n`;
  }

  // The good
  if (oppAnalysis.davidPositives.length > 0) {
    message += `*The good:* ${oppAnalysis.davidPositives.join('. ')}.\n\n`;
  }

  // The concerns
  if (oppAnalysis.davidConcerns.length > 0) {
    message += `*The concern:* ${oppAnalysis.davidConcerns.join('. ')}.\n\n`;
  }

  // My read
  message += `*My read:* `;
  if (oppAnalysis.davidSentiment === 'positive') {
    message += `Worth pursuing. Risks are manageable.\n\n`;
  } else if (oppAnalysis.davidSentiment === 'skeptical') {
    message += `I have concerns. Not saying no, but we need to go in eyes open.\n\n`;
  } else {
    message += `Could go either way. Depends on what Rosa finds on partners.\n\n`;
  }

  message += `@Rosa, what's the partner situation look like?`;

  return message;
}

// Build Rosa's message
function buildRosaMessage(ctx: ConversationContext): string {
  const { partnerAnalysis, oppAnalysis, dynamic } = ctx;
  const opener = getRosaOpener(partnerAnalysis.partnerConfidence);

  let message = '';

  // If David was skeptical but Rosa has connections
  if (oppAnalysis.davidSentiment === 'skeptical' && partnerAnalysis.partnerConfidence === 'high') {
    message = `David, I hear you on the concerns, but ${opener.toLowerCase()}\n\n`;
  } else {
    message = `${opener}\n\n`;
  }

  // Partner details
  if (partnerAnalysis.strongMatches.length > 0) {
    const partner = partnerAnalysis.strongMatches[0];
    message += `Best option: *${partner.name}*`;
    if (partner.certifications?.length) {
      message += ` (${partner.certifications.slice(0, 2).join(', ')})`;
    }
    message += `\n`;
    if (partner.relationship_status === 'teamed') {
      message += `We've teamed with them before - good relationship.\n\n`;
    } else {
      message += `I know their BD lead. Can reach out.\n\n`;
    }
  } else if (partnerAnalysis.possibleMatches.length > 0) {
    message += `A few options to explore:\n`;
    for (const partner of partnerAnalysis.possibleMatches.slice(0, 2)) {
      message += `• ${partner.name}`;
      if (partner.certifications?.length) {
        message += ` - ${partner.certifications[0]}`;
      }
      message += `\n`;
    }
    message += `\nWould need to build the relationship, but doable.\n\n`;
  } else {
    message += `Honestly, we're thin on partners here. `;
    if (partnerAnalysis.missingCertifications.length > 0) {
      message += `Need someone with ${partnerAnalysis.missingCertifications.join(', ')}.\n\n`;
    } else {
      message += `Would be starting from scratch.\n\n`;
    }
  }

  message += `@James, over to you for the call.`;

  return message;
}

// Build James's message
function buildJamesMessage(ctx: ConversationContext): string {
  const { strategyAnalysis, oppAnalysis, partnerAnalysis, dynamic, opportunity } = ctx;
  const opener = getJamesOpener(strategyAnalysis.recommendation);

  let message = `${opener}\n\n`;

  // If overriding skepticism
  if (strategyAnalysis.override && oppAnalysis.davidSentiment === 'skeptical') {
    message += `David, I hear the concerns. But `;
    message += pick([
      `strategically we need to be in this conversation.`,
      `this agency is too important to sit out.`,
      `even at lower pwin, the door-opener value is worth it.`,
    ]);
    message += `\n\n`;
  }

  // The recommendation
  message += `*Bottom line:* `;
  switch (strategyAnalysis.recommendation) {
    case 'go':
      message += `GO. ${strategyAnalysis.keyFactors.slice(0, 2).join('. ')}.\n\n`;
      break;
    case 'lean_go':
      message += `Leaning GO. ${strategyAnalysis.keyFactors[0]}.\n\n`;
      break;
    case 'no_go':
      message += `NO-GO. ${strategyAnalysis.keyFactors.slice(0, 2).join('. ')}.\n\n`;
      break;
    case 'lean_no':
      message += `Leaning NO. Risks outweigh potential.\n\n`;
      break;
    case 'torn':
      message += `Close call. Good arguments both ways.\n\n`;
      break;
  }

  // Win probability
  const pwinEmoji = strategyAnalysis.winProbability === 'high' ? '🟢' :
                    strategyAnalysis.winProbability === 'medium' ? '🟡' : '🔴';
  message += `Win probability: ${pwinEmoji} ${strategyAnalysis.winProbability.toUpperCase()}\n\n`;

  // Next steps if go
  if (strategyAnalysis.recommendation === 'go' || strategyAnalysis.recommendation === 'lean_go') {
    message += `*If we move:*\n`;
    if (partnerAnalysis.strongMatches.length > 0) {
      message += `• Rosa reaches out to ${partnerAnalysis.strongMatches[0].name}\n`;
    }
    message += `• Start capture planning\n`;
    message += `• Review full requirements\n\n`;
  }

  message += `@Lapedra - your call.`;

  return message;
}

// Build Patricia's summary message for main channel
function buildPatriciaSummary(ctx: ConversationContext): string {
  const { opportunity, strategyAnalysis, dynamic, partnerAnalysis, oppAnalysis } = ctx;

  const urgent = oppAnalysis.daysUntilDue !== null && oppAnalysis.daysUntilDue < 30;
  const opener = getPatriciaOpener(dynamic.type, urgent);

  let message = `${opener}\n\n`;

  message += `*${opportunity.title}*\n`;
  message += `${opportunity.agency} · ${opportunity.type}`;
  if (oppAnalysis.daysUntilDue) message += ` · ${oppAnalysis.daysUntilDue}d until due`;
  message += `\n\n`;

  // Team status
  message += `✅ Identified (Maya)\n`;
  message += `✅ Researched (David)\n`;
  message += `✅ Partners reviewed (Rosa)\n`;

  const recEmoji = strategyAnalysis.recommendation === 'go' || strategyAnalysis.recommendation === 'lean_go'
    ? '✅' : strategyAnalysis.recommendation === 'no_go' ? '❌' : '🤔';
  message += `${recEmoji} Recommendation: *${strategyAnalysis.recommendation.toUpperCase().replace('_', ' ')}* (James)\n\n`;

  // The ask
  message += `⏳ *Pending: @Lapedra's decision*\n\n`;

  if (dynamic.type === 'tension') {
    message += `_Note: Team had some debate on this one - see thread for full discussion._\n\n`;
  }

  const recText = strategyAnalysis.recommendation === 'go' || strategyAnalysis.recommendation === 'lean_go'
    ? 'pursue' : 'pass';
  message += `Team recommends we ${recText}. Reply *GO* or *PASS*.`;

  return message;
}

// Run the full conversation
export async function runConversation(
  opportunityId: string,
  delayMs: number = 15000
): Promise<void> {
  console.log('ConversationEngine: Starting conversation...');

  // Load all data
  const opportunity = await getOpportunity(opportunityId);
  if (!opportunity) {
    throw new Error(`Opportunity ${opportunityId} not found`);
  }

  const agency = opportunity.agency ? await getAgency(opportunity.agency) : null;

  // Get partners
  const supabase = getSupabase();
  const { data: partners } = await supabase
    .from('companies')
    .select('*')
    .limit(10);

  // Run analysis
  console.log('ConversationEngine: Analyzing opportunity...');
  const oppAnalysis = analyzeOpportunity(opportunity, agency);
  const partnerAnalysis = analyzePartners(opportunity, partners || [], oppAnalysis);
  const strategyAnalysis = analyzeStrategy(opportunity, oppAnalysis, partnerAnalysis);
  const dynamic = determineConversationDynamic(oppAnalysis, partnerAnalysis, strategyAnalysis);

  console.log(`ConversationEngine: Dynamic = ${dynamic.type}, David = ${oppAnalysis.davidSentiment}, Rec = ${strategyAnalysis.recommendation}`);

  // Step 1: Maya posts in main channel
  console.log('ConversationEngine: Maya posting...');
  const mayaMessage = buildMayaMessage(opportunity, oppAnalysis);
  const mainChannelTs = await postAsAgent('scout', mayaMessage);

  const ctx: ConversationContext = {
    opportunity,
    agency,
    partners: partners || [],
    oppAnalysis,
    partnerAnalysis,
    strategyAnalysis,
    dynamic,
    threadTs: mainChannelTs,
    mainChannelTs,
  };

  await sleep(randomDelay(delayMs * 0.8, delayMs * 1.2));

  // Step 2: David replies in thread
  console.log('ConversationEngine: David replying...');
  const davidMessage = buildDavidMessage(ctx, true);
  const davidTs = await postAsAgent('analyst', davidMessage, mainChannelTs);

  // Maybe Maya reacts
  if (oppAnalysis.davidSentiment === 'positive') {
    await maybeReact(davidTs, 'positive');
  } else if (oppAnalysis.davidSentiment === 'skeptical') {
    await maybeReact(davidTs, 'watching');
  }

  await sleep(randomDelay(delayMs * 0.8, delayMs * 1.2));

  // Step 3: Rosa replies in thread
  console.log('ConversationEngine: Rosa replying...');
  const rosaMessage = buildRosaMessage(ctx);
  const rosaTs = await postAsAgent('connector', rosaMessage, mainChannelTs);

  // Maybe David reacts
  if (partnerAnalysis.partnerConfidence === 'high') {
    await maybeReact(rosaTs, 'positive');
  }

  await sleep(randomDelay(delayMs * 0.8, delayMs * 1.2));

  // Step 4: James synthesizes in thread
  console.log('ConversationEngine: James synthesizing...');
  const jamesMessage = buildJamesMessage(ctx);
  const jamesTs = await postAsAgent('strategist', jamesMessage, mainChannelTs);

  // Team reacts to James
  await maybeReact(jamesTs, strategyAnalysis.recommendation === 'go' ? 'positive' : 'watching');

  await sleep(randomDelay(delayMs * 0.8, delayMs * 1.2));

  // Step 5: Patricia posts summary in MAIN CHANNEL (not thread)
  console.log('ConversationEngine: Patricia summarizing...');
  const patriciaSummary = buildPatriciaSummary(ctx);
  await postAsAgent('pm', patriciaSummary);

  console.log('ConversationEngine: Conversation complete');
}
