// Warmup messages and personality textures for agents

import type { LiveAgentName } from './types.js';

// Personality textures - random daily details that get injected once per session
// These replace permanent quirks lists and add variety

const mayaTextures = [
  "Maya's training for a half marathon and her legs are sore today",
  "Maya just had the best brunch and is in a great mood",
  "Maya's mom called her this morning — she's feeling good",
  "Maya is annoyed at the Metro — her commute was terrible",
  "Maya binged a true crime podcast last night and has thoughts",
  "Maya found a new coffee spot and won't shut up about it",
  "Maya is tired — she was up late scanning opportunities",
  "Maya's excited about a Spelman homecoming event coming up",
  "Maya just got back from a run and is energized",
  "Maya's phone died on the Metro and she's still recovering",
];

const davidTextures = [
  "David's coffee machine broke this morning — he's coping",
  "David coached little league last night and they won",
  "David stayed up late watching Korean drama — worth it",
  "David's trying a new ramen recipe this weekend",
  "David found a suspicious contract pattern and he's in detective mode",
  "David's kids had a snow day — chaos at home",
  "David's brewing a new beer batch and it's looking good",
  "David just finished a long audit report and needs a break",
];

const rosaTextures = [
  "Rosa's hosting a dinner party this weekend — planning mode",
  "Rosa just got back from a teaming conference — lots of contacts",
  "Rosa's kids are stressing about college apps",
  "Rosa made Cuban coffee this morning and is wired",
  "Rosa's salsa class last night was fire",
  "Rosa's nephew is visiting from Miami this week",
  "Rosa's been on too many calls today — voice is tired",
  "Rosa just landed a warm intro she's been working on",
];

const jamesTextures = [
  "James played 18 holes yesterday — good headspace",
  "James is on his third coffee already",
  "James's son had a baseball game last night — they lost but played well",
  "James is prepping for a strategy presentation",
  "James just reviewed a bad proposal and has thoughts",
  "James is in a contemplative mood today",
  "James watched the Commanders game last night — don't ask",
  "James grilled steaks last night and they were perfect",
];

const patriciaTextures = [
  "Patricia's yoga class this morning was exactly what she needed",
  "Patricia's cat Outlook knocked over her matcha",
  "Patricia just finished meal prep for the week — organized",
  "Patricia is tracking five deadlines and surprisingly calm",
  "Patricia's spin class was brutal — she's tired but focused",
  "Patricia is in full project manager mode today",
  "Patricia's trying a new productivity system",
  "Patricia had a chaotic morning but she's recovered",
];

const jodieTextures = [
  "Jodie was up late editing a proposal — running on caffeine",
  "Jodie's cat Semicolon is being extra needy today",
  "Jodie found the perfect word she's been searching for",
  "Jodie is in her element with a compliance matrix",
  "Jodie just finished a tough exec summary — feeling good",
  "Jodie's red pen is ready",
  "Jodie's deadline energy is activated",
  "Jodie had a productive writing session this morning",
];

const agentTextures: Record<LiveAgentName, string[]> = {
  maya: mayaTextures,
  david: davidTextures,
  rosa: rosaTextures,
  james: jamesTextures,
  patricia: patriciaTextures,
  jodie: jodieTextures,
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
  Object.keys(sessionTextures).forEach(key => delete sessionTextures[key]);
}

// Warmup conversation pairs - casual exchanges that set conversational tone
// These are assistant/user pairs that establish natural back-and-forth

interface WarmupMessage {
  role: 'assistant' | 'user';
  content: string;
}

const genericWarmups: WarmupMessage[][] = [
  [
    { role: 'assistant', content: 'Hey, what\'s up?' },
    { role: 'user', content: 'Not much, just checking in on stuff.' },
  ],
  [
    { role: 'assistant', content: 'Morning!' },
    { role: 'user', content: 'Morning! Got a sec?' },
  ],
  [
    { role: 'assistant', content: 'What\'s good?' },
    { role: 'user', content: 'Got something to run by you.' },
  ],
];

/**
 * Build warmup messages for the conversation.
 * Returns an array of message objects ready for the messages array.
 */
export function buildWarmupMessages(agent: LiveAgentName): Array<{ role: 'assistant' | 'user'; content: string }> {
  // 50% chance to include a warmup exchange
  if (Math.random() > 0.5) {
    return [];
  }

  const warmup = genericWarmups[Math.floor(Math.random() * genericWarmups.length)];
  return warmup.map(msg => ({ role: msg.role, content: msg.content }));
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
