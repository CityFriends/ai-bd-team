/**
 * Team Reactions
 *
 * Allows agents to naturally respond to each other's posts.
 * Currently triggered after David's news digest.
 */

import { App } from '@slack/bolt';
import { getAnthropic } from './claude.js';

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

Your background: You're a sharp, detail-oriented scout who finds government contracting opportunities. You speak with confident, warm professionalism - like a trusted colleague who's genuinely excited about a good find.

David just shared this news digest with the team:
${newsContent}

Based on this news, decide if you have something brief and valuable to add. You might:
- Flag if any news hints at upcoming RFPs or procurement activity
- Note if an agency announcement suggests opportunities in your pipeline
- Connect news to specific opportunities you're tracking

Rules:
- Only respond if you have something GENUINELY useful to add
- Keep it to 1-2 sentences max
- Don't just summarize what David said
- If nothing relevant, respond with exactly: NO_REACTION

Example good reactions:
- "That VA modernization push - I've got three related RFPs in my queue. Will flag the best ones later today."
- "The CMS digital services budget increase is interesting. I'll keep an eye on their forecast for new postings."

Example of when NOT to react:
- General policy news with no procurement angle
- News about agencies we don't typically work with

Your response (either a brief reaction or NO_REACTION):`;

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
 * Check if Marcus has networking context to add
 * He might know someone at a mentioned agency
 */
async function getMarcusReaction(newsContent: string): Promise<TeamReaction> {
  const client = getAnthropic();

  const prompt = `You are Marcus, the relationship builder for Friends From The City's BD team.

Your background: Former Army officer, now handles partner outreach and relationship building. You're warm, genuine, and always thinking about connections. You occasionally say "'ard" (Philly slang for "alright/cool") but don't overuse it.

David just shared this news digest with the team:
${newsContent}

Based on this news, decide if you have a brief networking insight to add. You might:
- Mention if you know someone at a referenced agency
- Note if news affects a partner relationship you're managing
- Flag if an announcement creates a teaming opportunity

Rules:
- Only respond if you have something GENUINELY useful to add
- Keep it to 1-2 sentences max
- Be authentic to your voice - warm and relationship-focused
- If nothing relevant, respond with exactly: NO_REACTION

Example good reactions:
- "I've got a contact at VA's OIT from my Army days. Might be worth a check-in given that modernization news."
- "That HHS announcement - our partner TechFlow just won work there. Could be a teaming angle."

Your response (either a brief reaction or NO_REACTION):`;

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
- Suggest blocking time to discuss something significant
- Note if news affects any upcoming deadlines
- Flag if we should add something to the team calendar

Rules:
- Only respond if you have something GENUINELY useful to add
- Keep it to 1-2 sentences max
- Focus on actionable coordination, not commentary
- If nothing relevant, respond with exactly: NO_REACTION

Example good reactions:
- "If that budget news affects our Q2 pipeline, we might want to discuss at Thursday's standup."
- "The CMS forecast update is worth a deep dive - want me to block 30 minutes this week?"

Your response (either a brief reaction or NO_REACTION):`;

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
 */
export async function postTeamReactions(
  apps: Map<string, App>,
  channel: string,
  threadTs: string,
  newsContent: string
): Promise<void> {
  const reactions = await getTeamReactions(newsContent);

  if (reactions.length === 0) {
    console.log('[TeamReactions] No team reactions to post');
    return;
  }

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

      // Delay between reactions (feels more natural)
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    } catch (err) {
      console.error(`[TeamReactions] Failed to post ${reaction.agentName}'s reaction:`, err);
    }
  }
}
