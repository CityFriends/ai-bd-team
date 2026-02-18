// Phrase libraries for natural variation
// The WHAT is determined by data analysis
// These only vary HOW it's expressed

export const MAYA_OPENERS = {
  excited: [
    'Okay team, found something interesting...',
    'This just dropped and I have thoughts.',
    'Eyes on this one',
    'Alright, hear me out on this one',
    'Just surfaced something spicy',
    'Caught this in the morning scan and had to flag it',
    "Ooh okay okay, stop what you're doing",
  ],
  interested: [
    'New one worth looking at',
    'This popped up overnight',
    'Flagging this for the team',
    'Interesting one here',
    'Worth a look',
  ],
  cautious: [
    'Not sure about this but wanted to flag it',
    'This is either really good or really bad',
    'Flagging this but I have questions',
    'Might be a stretch, but...',
    'I know, I know, another one...',
  ],
};

export const DAVID_OPENERS = {
  positive: [
    "Actually, I don't hate this",
    'This might be more interesting than it looks',
    "Okay, I'm pleasantly surprised here",
    'Did some digging. Looking solid.',
    "Here's the thing - this is actually good",
  ],
  neutral: [
    "Took a look. Here's what I'm seeing...",
    'Did some digging. Mixed bag.',
    'Let me break this down...',
    "Here's the thing about this one...",
    'I have concerns, but also some upside',
  ],
  skeptical: [
    'Okay, let me pump the brakes for a second',
    'I have real concerns here',
    'Before we get excited...',
    "Look, I've seen this movie before",
    'Alright, real talk on this opportunity',
  ],
};

export const ROSA_OPENERS = {
  confident: [
    'I know some people here actually...',
    'Oh, I know exactly who to call for this',
    'Funny enough, I was just talking to someone about this agency',
    'Partner-wise, this is looking good',
    "I've got connections here",
  ],
  exploring: [
    'Let me think about who we know...',
    'I might have a connection here',
    'This is interesting from a teaming perspective',
    'Partner-wise, I have some ideas',
    'Let me check my network on this one',
  ],
  limited: [
    'Teaming could be tricky on this one...',
    "Honestly, we're thin on partners here",
    "I don't have great contacts at this agency",
    'Partner landscape is tough on this one',
    "We'd be starting from scratch relationship-wise",
  ],
};

export const JAMES_OPENERS = {
  decisive_go: [
    "Okay, here's how I see it...",
    'Let me give you the bottom line',
    "Alright, decision time. Here's where I land.",
    "I've made my call on this one",
    "Here's my take after hearing everyone",
  ],
  decisive_nogo: [
    "Let's be real about this one",
    'I have to make a tough call here',
    "Look, I've been burned by opportunities like this",
    'Sometimes the right call is to pass',
    "Here's why I'm saying no on this",
  ],
  leaning: [
    "I'm leaning one way, but want to talk it through",
    'Stepping back, the strategic question is...',
    "I've been thinking about this one",
    'Big picture on this...',
    "Let me synthesize what we're saying...",
  ],
  torn: [
    'This could go either way honestly',
    'Good arguments on both sides here',
    "I'm genuinely torn on this one",
    'This is a close call',
    "Need Lapedra's gut on this one",
  ],
};

export const PATRICIA_OPENERS = {
  smooth: [
    "Great discussion team. Here's where we are:",
    'Okay, let me capture the action items',
    'Pulling this together for a decision...',
    'Adding this to our tracker. Quick summary:',
    "Team's aligned. Here's the ask:",
  ],
  after_debate: [
    "Good discussion, even if we didn't all agree.",
    "Appreciate everyone's perspective. Here's where we landed:",
    'That was a healthy debate. Summary:',
    "Okay, James made the call. Here's next steps:",
    'Before this falls off the radar...',
  ],
  urgent: [
    'Timeline is tight on this one. Summary:',
    'We need to move on this today.',
    'Lapedra, flagging this as time-sensitive:',
    'Clock is ticking. Decision needed:',
    "Want to make sure we don't lose momentum here",
  ],
};

// Agreement/disagreement phrases based on ACTUAL analysis
export const DAVID_CONCERNS = {
  timeline: [
    'Timeline concerns me. {days} days is tight for a quality response.',
    "{days} days to proposal? That's aggressive.",
    "Here's the thing - {days} days doesn't give us room for a strong response.",
  ],
  vague_requirements: [
    'Requirements are vague. Only matched {count} of our keywords.',
    "Scope is unclear. I'm seeing a lot of buzzwords, not much substance.",
    "This reads like they don't know what they want yet.",
  ],
  incumbent: [
    'Incumbent advantage is real here. {incumbent} has been on this for years.',
    '{incumbent} is dug in. Hard to unseat without a compelling differentiator.',
    "Let's be real - {incumbent} wrote half these requirements.",
  ],
  set_aside: [
    "We can't prime this - it's a {setAside} set-aside.",
    "Set-aside is {setAside}. We'd need to sub.",
    'This is restricted to {setAside}. Changes our approach.',
  ],
};

export const DAVID_POSITIVES = {
  open_competition: [
    'No incumbent lock here. Competitive landscape is open.',
    'Good news - this looks like a genuinely competitive procurement.',
    'No one has this wired. Real opportunity.',
  ],
  good_fit: [
    'This is in our wheelhouse. Requirements match our core capabilities.',
    'Actually, this reads like they wrote it for us.',
    'Strong keyword match - this is what we do.',
  ],
  good_timeline: [
    '{days} days is good runway. Enough time for a thoughtful response.',
    'Timeline is reasonable. We can put together something strong.',
    'Good timeline - no need to rush this.',
  ],
  agency_history: [
    "We have history with {agency}. That's worth something.",
    "We've won at {agency} before. Relationships are still there.",
    'Good agency for us - {agency} knows our work.',
  ],
};

export const ROSA_PARTNER_PHRASES = {
  strong_match: [
    "I know exactly who to call - {company}. We've teamed with them before.",
    '{company} would be perfect here. Good relationship, right capabilities.',
    'First call is {company}. They owe us one from that {agency} thing.',
  ],
  possible_match: [
    "{company} could work. Haven't teamed directly but I know their BD lead.",
    "I'd explore {company}. Right certifications, and I have a contact.",
    'Worth reaching out to {company}. Heard good things.',
  ],
  weak_options: [
    "Options are limited. Best I've got is {company}, but it's not ideal.",
    "We're thin on partners with {certification} certs.",
    "Honestly, we'd need to build new relationships for this one.",
  ],
};

export const JAMES_RECOMMENDATION_PHRASES = {
  strong_go: [
    'This is a go for me. Strong fit, manageable risks.',
    'We should pursue this. The upside is clear.',
    "I'm saying go. This is what we've been looking for.",
  ],
  go_with_caveat: [
    "I'm saying go, but we need to address {concern}.",
    "Go, with a caveat - {concern} could sink us if we don't handle it.",
    'Pursue, but eyes open on {concern}.',
  ],
  strategic_go: [
    'Even if we lose, we need to be in this conversation. Strategic go.',
    'This is a door-opener. Worth the investment even at lower pwin.',
    'Priority agency, priority work. We have to bid this.',
  ],
  lean_no: [
    "I'm leaning no. Risk/reward isn't there.",
    'Passing on this one. Too many flags.',
    'No-go from me. Better opportunities out there.',
  ],
  override: [
    'I hear the concerns, but strategically we need this.',
    "David, noted. But we can't afford to sit this one out.",
    "This is a judgment call. I'm overriding the risk assessment.",
  ],
};

// Emoji reactions with meaning
export const REACTIONS = {
  watching: ['eyes'], // watching this
  agree: ['100', 'fire', 'dart'], // strongly agree
  good_point: ['point_right', 'bulb'], // good point
  concern: ['thinking_face', 'warning'], // not sure / concern
  support: ['raised_hands', 'muscle'], // support
  thanks: ['pray', 'sparkles'], // thanks/appreciation
};

// Helper to pick random from array
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Helper to fill template
export function fill(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}
