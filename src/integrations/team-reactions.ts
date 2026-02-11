/**
 * Team Reactions
 *
 * Allows agents to naturally respond to each other's posts.
 * Currently triggered after David's news digest.
 */

import { App } from '@slack/bolt';
import { getAnthropic } from './claude.js';
import { parseActionFromResponse, createAction } from './agent-actions.js';

interface TeamReaction {
  agentName: string;
  shouldReact: boolean;
  reaction?: string;
}

/**
 * Check if Maya has something to add about the news
 * She might flag potential opportunities or procurement hints
 */
async function getMayaReaction(newsContent: string): Promise<TeamReaction> {
  const client = getAnthropic();

  const prompt = `You are Maya, the opportunity scout for Friends From The City's BD team.

Your background: You're a sharp, detail-oriented scout who finds government contracting opportunities. You speak with confident, warm professionalism.

David just shared this news digest with the team:
${newsContent}

Based on this news, decide if you have something brief and valuable to add. You might:
- Note that news like this often precedes procurement activity
- Mention you'll watch SAM.gov or agency forecasts for related RFPs
- Connect news to the type of work FFTC does (UX, HCD, digital services)

CRITICAL RULES:
- DO NOT invent specific RFPs, opportunities, or numbers you're "tracking" - you don't have real data
- DO NOT claim to have opportunities "in your queue" or "pipeline" - be honest
- Keep it to 1-2 sentences max
- If nothing relevant, respond with exactly: NO_REACTION

GOOD (honest) reactions:
- "News like this usually means RFPs follow in a few months. I'll keep an eye on SAM.gov for VA digital services postings."
- "Worth watching - CMS budget increases often translate to new solicitations."

BAD (dishonest) reactions:
- "I've got three related RFPs in my queue" (you don't have specific RFPs)
- "I'm tracking two opportunities that should drop next month" (you don't know this)

Your response (either a brief honest reaction or NO_REACTION):`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const reaction = text?.type === 'text' ? text.text.trim() : '';

    if (reaction === 'NO_REACTION' || reaction.includes('NO_REACTION')) {
      return { agentName: 'Maya', shouldReact: false };
    }

    return { agentName: 'Maya', shouldReact: true, reaction };
  } catch (err) {
    console.error('[TeamReactions] Maya reaction error:', err);
    return { agentName: 'Maya', shouldReact: false };
  }
}

/**
 * Check if Marcus has technical insight to add
 * He's the engineering lead - only comments on technical matters
 */
async function getMarcusReaction(newsContent: string): Promise<TeamReaction> {
  const client = getAnthropic();

  const prompt = `You are Marcus, the engineering lead for Friends From The City's BD team.

Your background: Former Army officer, now the technical lead. You understand systems architecture, why government IT projects fail, and what good technical solutions look like. You're warm and genuine, occasionally say "'ard" (Philly slang for "alright/cool") but sparingly.

David just shared this news digest with the team:
${newsContent}

Based on this news, decide if you have a brief TECHNICAL insight to add. You might:
- Comment on why a system failure happened from a technical standpoint (if evident from the news)
- Note technical patterns you see in modernization efforts
- Offer perspective on technical challenges agencies face

CRITICAL RULES:
- ONLY comment on TECHNICAL matters - you are NOT doing outreach, networking, or relationship building
- DO NOT offer to reach out to anyone or suggest contacts
- DO NOT commit to any future actions - just offer technical perspective
- If nothing technical to add, respond with exactly: NO_REACTION
- Keep it to 1-2 sentences max

GOOD (technical) reactions:
- "Classic case of trying to modernize without doing proper discovery first. Legacy system dependencies always bite back."
- "From what I'm reading, sounds like a data migration issue - common when agencies rush timelines."

BAD (non-technical) reactions:
- "I'll reach out to contacts there" (you don't do outreach)
- "Worth checking with partners" (not your role)

Your response (either a brief technical reaction or NO_REACTION):`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const reaction = text?.type === 'text' ? text.text.trim() : '';

    if (reaction === 'NO_REACTION' || reaction.includes('NO_REACTION')) {
      return { agentName: 'Marcus', shouldReact: false };
    }

    return { agentName: 'Marcus', shouldReact: true, reaction };
  } catch (err) {
    console.error('[TeamReactions] Marcus reaction error:', err);
    return { agentName: 'Marcus', shouldReact: false };
  }
}

/**
 * Check if Patricia has action items or scheduling notes
 */
async function getPatriciaReaction(newsContent: string): Promise<TeamReaction> {
  const client = getAnthropic();

  const prompt = `You are Patricia, the operations coordinator for Friends From The City's BD team.

Your background: You're organized, proactive, and keep the team on track. You think in terms of action items, deadlines, and coordination.

David just shared this news digest with the team:
${newsContent}

Based on this news, decide if you have a brief operational note to add. You might:
- Suggest the team discuss significant news at the next standup
- Offer to help coordinate follow-up actions
- Note if something seems worth deeper discussion

CRITICAL RULES:
- DO NOT offer to schedule meetings unless you can actually do it (you currently cannot)
- DO NOT claim to know the team's calendar or existing deadlines
- Keep suggestions general and actionable by humans
- Keep it to 1-2 sentences max
- If nothing relevant, respond with exactly: NO_REACTION

GOOD (honest) reactions:
- "If this impacts our pipeline, might be worth discussing at the next team sync."
- "Sounds significant - let me know if you want me to flag this for follow-up."

BAD (overpromising) reactions:
- "Want me to block 30 minutes this week?" (you can't actually schedule meetings yet)
- "I'll add this to Thursday's agenda" (you don't have calendar access)

Your response (either a brief honest reaction or NO_REACTION):`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const reaction = text?.type === 'text' ? text.text.trim() : '';

    if (reaction === 'NO_REACTION' || reaction.includes('NO_REACTION')) {
      return { agentName: 'Patricia', shouldReact: false };
    }

    return { agentName: 'Patricia', shouldReact: true, reaction };
  } catch (err) {
    console.error('[TeamReactions] Patricia reaction error:', err);
    return { agentName: 'Patricia', shouldReact: false };
  }
}

/**
 * Get reactions from team members who have something to add
 * Returns only agents with meaningful reactions (randomly limited to avoid spam)
 */
export async function getTeamReactions(newsContent: string): Promise<TeamReaction[]> {
  console.log('[TeamReactions] Checking for team reactions...');

  // Get reactions from all agents in parallel
  const [mayaReaction, marcusReaction, patriciaReaction] = await Promise.all([
    getMayaReaction(newsContent),
    getMarcusReaction(newsContent),
    getPatriciaReaction(newsContent),
  ]);

  const reactions = [mayaReaction, marcusReaction, patriciaReaction]
    .filter(r => r.shouldReact && r.reaction);

  console.log(`[TeamReactions] ${reactions.length} agents want to respond`);

  // Limit to max 2 reactions to avoid spam
  // Randomly shuffle and take first 2
  const shuffled = reactions.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

/**
 * Post team reactions as thread replies
 * Returns the reactions that were posted (for David's follow-up)
 */
export async function postTeamReactions(
  apps: Map<string, App>,
  channel: string,
  threadTs: string,
  newsContent: string
): Promise<TeamReaction[]> {
  const reactions = await getTeamReactions(newsContent);

  if (reactions.length === 0) {
    console.log('[TeamReactions] No team reactions to post');
    return [];
  }

  const postedReactions: TeamReaction[] = [];

  // Small delay before first reaction (feels more natural)
  await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

  for (const reaction of reactions) {
    const agentKey = reaction.agentName.toLowerCase();
    const app = apps.get(agentKey);

    if (!app) {
      console.log(`[TeamReactions] No app found for ${reaction.agentName}`);
      continue;
    }

    try {
      await app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: reaction.reaction!,
      });
      console.log(`[TeamReactions] ${reaction.agentName} replied in thread`);
      postedReactions.push(reaction);

      // Check if the agent committed to a future action
      // Marcus (engineering lead) doesn't commit to actions - he only gives technical perspective
      if (reaction.agentName.toLowerCase() !== 'marcus') {
        const action = await parseActionFromResponse(
          reaction.agentName.toLowerCase(),
          reaction.reaction!,
          newsContent.substring(0, 500),
          channel,
          threadTs
        );

        if (action) {
          await createAction(action);
          console.log(`[TeamReactions] ${reaction.agentName} committed to action: ${action.action_type}`);
        }
      }

      // Delay between reactions (feels more natural)
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    } catch (err) {
      console.error(`[TeamReactions] Failed to post ${reaction.agentName}'s reaction:`, err);
    }
  }

  return postedReactions;
}

/**
 * Generate David's follow-up response to team comments
 * He wraps up the conversation naturally
 */
export async function getDavidFollowUp(
  newsContent: string,
  teamReactions: TeamReaction[]
): Promise<string | null> {
  if (teamReactions.length === 0) return null;

  const client = getAnthropic();

  const reactionsText = teamReactions
    .map(r => `${r.agentName}: "${r.reaction}"`)
    .join('\n');

  const prompt = `You are David, the senior research analyst for Friends From The City's BD team.

Your background: 42 years old, Korean American, grew up in Jersey, Rutgers grad, lives in Fairfax now. 15+ years in federal contracting research. Direct, dry humor, dad energy.

You just posted a news digest and your teammates responded:

${reactionsText}

Write a brief follow-up (1-2 sentences max) that:
- Acknowledges their input naturally
- Maybe adds one quick thought or confirms next steps
- Wraps up the conversation (you're ending it, not continuing)

Your voice: Direct, a little dry humor if appropriate. Don't be overly enthusiastic.

Examples of good follow-ups:
- "Good catch, Maya. Keep me posted on those RFPs. Marcus, worth a coffee chat with your VA contact if it's not too much of a reach."
- "Appreciate the flags, team. I'll dig deeper on the CMS angle for Wednesday's update."
- "Noted. Maya, let's sync if any of those hit the street this week."

Your brief follow-up:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    return text?.type === 'text' ? text.text.trim() : null;
  } catch (err) {
    console.error('[TeamReactions] David follow-up error:', err);
    return null;
  }
}
