// Warmup messages and personality textures for agents

import type { LiveAgentName } from './types.js';

// Personality textures - random daily details that get injected once per session
// These replace permanent quirks lists and add variety

// Maya textures - moods only, not activities
const mayaTextures = [
  'Maya is feeling sore from training',
  'Maya is in a great mood',
  'Maya is feeling good today',
  'Maya is annoyed at the Metro',
  'Maya has true crime thoughts swirling',
  'Maya is caffeinated and hyped',
  'Maya is tired but pushing through',
  'Maya is excited about an upcoming Spelman event',
  'Maya is energized',
  'Maya is slightly frazzled',
];

// David textures - moods only, not activities
const davidTextures = [
  'David is coping without his coffee machine',
  'David is in a good mood after a little league win',
  'David is pleasantly tired from a K-drama binge',
  'David is thinking about ramen',
  'David is in detective mode',
  'David is dealing with snow day chaos energy',
  'David is in a brewing mood',
  'David needs a mental break',
];

// Rosa textures - moods only, not activities
const rosaTextures = [
  'Rosa is in dinner party planning mode',
  'Rosa is buzzing with new contacts',
  'Rosa is distracted by college app stress at home',
  'Rosa is wired on Cuban coffee',
  'Rosa is in a great mood',
  'Rosa has family visiting energy',
  'Rosa is voice-tired from calls',
  'Rosa is feeling connected',
];

// James textures - moods only, not activities
const jamesTextures = [
  'James is in a good headspace',
  'James is on his third coffee already',
  'James is in proud dad mode',
  'James is in strategy mode',
  'James has thoughts about bad proposals',
  'James is in a contemplative mood today',
  'James is grumpy about the Commanders',
  'James is satisfied and well-fed',
];

// Patricia textures - moods only, not activities (she was narrating these)
const patriciaTextures = [
  'Patricia is feeling centered today',
  "Patricia's cat Outlook is being chaotic",
  'Patricia is in organized mode',
  'Patricia is tracking five deadlines and surprisingly calm',
  'Patricia is tired but focused',
  'Patricia is in full project manager mode today',
  'Patricia is experimenting with a new productivity system',
  'Patricia is recovered from a chaotic morning',
];

// Jodie textures - moods only, not activities
const jodieTextures = [
  'Jodie is running on caffeine',
  "Jodie's cat Semicolon is being extra needy",
  'Jodie is feeling linguistically satisfied',
  'Jodie is in her element with compliance work',
  'Jodie is feeling accomplished',
  "Jodie's red pen is ready",
  "Jodie's deadline energy is activated",
  'Jodie is in a productive headspace',
];

// Marcus personality textures - moods only, NO activity suggestions
// Removed: "in the zone", "chess.com open", "focus mode", "ready to cut through"
// These made him sound like he was actively working when he's stateless
const marcusTextures = [
  'Marcus is feeling clear-headed today',
  'Marcus is caffeinated',
  "Marcus is hungry — thinking about his mom's griot",
  'Kernel is being needy today',
  'Marcus is in a good mood',
  'Marcus is slightly annoyed at overengineered code in general',
  'Marcus is thinking about F1 strategy',
  'Kernel is napping',
];

const agentTextures: Record<LiveAgentName, string[]> = {
  maya: mayaTextures,
  david: davidTextures,
  rosa: rosaTextures,
  james: jamesTextures,
  patricia: patriciaTextures,
  jodie: jodieTextures,
  marcus: marcusTextures,
};

// Cache selected texture per agent per session (so it's consistent within a conversation)
const sessionTextures: Record<string, string> = {};

/**
 * Get a random personality texture for an agent.
 * Caches the selection for the session so the same texture is used consistently.
 */
export function getAgentTexture(agent: LiveAgentName, sessionId?: string): string {
  const cacheKey = sessionId ? `${agent}-${sessionId}` : agent;

  if (!sessionTextures[cacheKey]) {
    const textures = agentTextures[agent] || [];
    if (textures.length > 0) {
      sessionTextures[cacheKey] = textures[Math.floor(Math.random() * textures.length)];
    } else {
      sessionTextures[cacheKey] = '';
    }
  }

  return sessionTextures[cacheKey];
}

/**
 * Clear cached textures (call at start of new day or when desired)
 */
export function clearTextureCache(): void {
  Object.keys(sessionTextures).forEach((key) => delete sessionTextures[key]);
}

// Warmup conversation pairs - DISABLED
// These were causing identity confusion by creating false conversation history.
// Agents would adopt other agents' voices (especially Jodie's) because the
// warmup + thread context created ambiguous identity signals.
//
// To re-enable, uncomment the warmup logic in buildWarmupMessages() below.

/**
 * Build warmup messages for the conversation.
 * Returns an array of message objects ready for the messages array.
 *
 * NOTE: Warmups disabled to prevent identity confusion.
 * These created false conversation history that could make agents
 * adopt voices from other agents in the thread context.
 */
export function buildWarmupMessages(
  _agent: LiveAgentName
): Array<{ role: 'assistant' | 'user'; content: string }> {
  // DISABLED: Warmups were contributing to identity confusion
  // Agents were adopting other agents' voices (especially Jodie's)
  // because the warmup + thread context created ambiguous identity signals
  return [];

  // Original implementation (kept for reference):
  // if (Math.random() > 0.5) {
  //   return [];
  // }
  // const warmup = genericWarmups[Math.floor(Math.random() * genericWarmups.length)];
  // return warmup.map((msg) => ({ role: msg.role, content: msg.content }));
}

/**
 * Format the agent mood line including personality texture.
 */
export function formatAgentMoodLine(agent: LiveAgentName, sessionId?: string): string {
  const texture = getAgentTexture(agent, sessionId);
  if (texture) {
    return `TODAY'S VIBE: ${texture}`;
  }
  return '';
}
