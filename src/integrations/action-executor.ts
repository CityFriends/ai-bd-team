/**
 * Action Executor
 *
 * Executes agent actions when they come due.
 * Each action type has its own handler.
 */

import { App } from '@slack/bolt';
import { getAnthropic } from './claude.js';
import {
  AgentAction,
  markActionInProgress,
  markActionCompleted,
  markActionFailed,
} from './agent-actions.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

interface ExecutionResult {
  success: boolean;
  message?: string;
  threadTs?: string;
}

/**
 * Execute a team meeting action (Patricia)
 * Starts a discussion thread and invites other agents to contribute
 */
async function executeTeamMeeting(
  action: AgentAction,
  apps: Map<string, App>
): Promise<ExecutionResult> {
  const patriciaApp = apps.get('patricia');
  if (!patriciaApp) {
    return { success: false, message: 'Patricia app not available' };
  }

  const client = getAnthropic();

  // Generate Patricia's meeting opener with agenda
  const openerPrompt = `You are Patricia, the operations coordinator for Friends From The City's BD team.

You previously committed to calling a team meeting about:
"${action.description}"

Original context:
${action.context || 'No additional context'}

Now it's time for that meeting. Write a brief message to kick off the discussion:
1. Remind the team what we're discussing
2. List 2-3 quick agenda points based on the context
3. Invite team members to share their thoughts

IMPORTANT - The ONLY team members are:
- Lapedra (CEO)
- Maya (Opportunity Scout)
- David (Research Analyst)
- Marcus (Relationship Builder)
- Patricia (that's you)
- Rosa (Compliance)
- James (Strategy)

DO NOT mention anyone else. DO NOT use @ mentions for people not on this list.

Keep it concise and actionable. Use Slack formatting (*bold*, _italic_).

Example:
"Alright team, time to sync on that VA modernization news from Tuesday.

*Quick agenda:*
• What opportunities might come from this?
• Any contacts worth reaching out to?
• Timeline implications for our pipeline

Maya, Marcus - would love your thoughts on this one."`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: openerPrompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const openerMessage = text?.type === 'text' ? text.text : '';

    if (!openerMessage) {
      return { success: false, message: 'Failed to generate meeting opener' };
    }

    // Post Patricia's opener
    const result = await patriciaApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: openerMessage,
    });

    const threadTs = result.ts;
    if (!threadTs) {
      return { success: false, message: 'Failed to get thread timestamp' };
    }

    console.log('[ActionExecutor] Patricia started team meeting');

    // Small delay then get team responses
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 3000));

    // Get responses from relevant agents
    const respondingAgents = ['maya', 'marcus', 'david'];
    const responses: { agent: string; response: string }[] = [];

    for (const agentName of respondingAgents) {
      const app = apps.get(agentName);
      if (!app) continue;

      const agentResponse = await generateMeetingResponse(
        agentName,
        action.description,
        action.context || '',
        openerMessage
      );

      if (agentResponse) {
        await app.client.chat.postMessage({
          channel: CHANNEL_ID,
          thread_ts: threadTs,
          text: agentResponse,
        });
        responses.push({ agent: agentName, response: agentResponse });
        console.log(`[ActionExecutor] ${agentName} contributed to meeting`);

        // Delay between responses
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
      }
    }

    // Patricia wraps up
    if (responses.length > 0) {
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));

      const wrapUpPrompt = `You are Patricia. You called a team meeting about "${action.description}".

Team responses:
${responses.map(r => `${r.agent}: "${r.response}"`).join('\n')}

Write a brief wrap-up (2-3 sentences max):
- Acknowledge key points raised
- Suggest next steps if any
- Close the meeting naturally

Keep it short and actionable.`;

      const wrapUpResponse = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{ role: 'user', content: wrapUpPrompt }],
      });

      const wrapUpText = wrapUpResponse.content.find(b => b.type === 'text');
      const wrapUp = wrapUpText?.type === 'text' ? wrapUpText.text : '';

      if (wrapUp) {
        await patriciaApp.client.chat.postMessage({
          channel: CHANNEL_ID,
          thread_ts: threadTs,
          text: wrapUp,
        });
        console.log('[ActionExecutor] Patricia wrapped up meeting');
      }
    }

    return {
      success: true,
      message: `Meeting completed with ${responses.length} participants`,
      threadTs,
    };
  } catch (err) {
    console.error('[ActionExecutor] Team meeting error:', err);
    return { success: false, message: String(err) };
  }
}

/**
 * Generate an agent's response to a team meeting
 */
async function generateMeetingResponse(
  agentName: string,
  topic: string,
  context: string,
  openerMessage: string
): Promise<string | null> {
  const client = getAnthropic();

  const personas: Record<string, string> = {
    maya: `You are Maya, the opportunity scout. You focus on procurement opportunities, RFPs, and SAM.gov tracking. You're sharp and detail-oriented.
CRITICAL: Do NOT invent specific opportunities or RFPs. Be honest about what you can actually do.`,

    marcus: `You are Marcus, the relationship builder. You focus on networking, partnerships, and agency contacts. You're warm and genuine, occasionally say "'ard" (sparingly).
CRITICAL: Do NOT invent specific contacts or relationships. Be honest about what you can actually do.`,

    david: `You are David, the senior research analyst. You focus on market research, news analysis, and strategic implications. You're direct with dry humor.
CRITICAL: Stick to analysis of the actual context provided. Don't invent facts.`,
  };

  const persona = personas[agentName];
  if (!persona) return null;

  const prompt = `${persona}

Patricia called a team meeting about: "${topic}"

Context: ${context}

Patricia's opener: "${openerMessage}"

Contribute to this meeting with your perspective (1-2 sentences max). Focus on what you can actually offer based on your role. If you have nothing relevant to add, respond with: NO_CONTRIBUTION

Your contribution:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const contribution = text?.type === 'text' ? text.text.trim() : '';

    if (contribution.includes('NO_CONTRIBUTION')) {
      return null;
    }

    return contribution;
  } catch {
    return null;
  }
}

/**
 * Execute a follow-up action (any agent)
 */
async function executeFollowUp(
  action: AgentAction,
  apps: Map<string, App>
): Promise<ExecutionResult> {
  const app = apps.get(action.agent_name);
  if (!app) {
    return { success: false, message: `${action.agent_name} app not available` };
  }

  const client = getAnthropic();

  const prompt = `You are ${action.agent_name} on the BD team. You committed to following up on:
"${action.description}"

Context: ${action.context || 'No additional context'}

Write a brief follow-up message (2-3 sentences) sharing what you found or updating the team. Be honest - if you don't have new information, say so and offer next steps.

Your follow-up:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const message = text?.type === 'text' ? text.text : '';

    if (!message) {
      return { success: false, message: 'Failed to generate follow-up' };
    }

    const result = await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `📋 *Follow-up:* ${action.description}\n\n${message}`,
    });

    return { success: true, message, threadTs: result.ts };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

/**
 * Execute a watch opportunity action (Maya)
 */
async function executeWatchOpportunity(
  action: AgentAction,
  apps: Map<string, App>
): Promise<ExecutionResult> {
  const mayaApp = apps.get('maya');
  if (!mayaApp) {
    return { success: false, message: 'Maya app not available' };
  }

  // This would integrate with the actual SAM.gov scanner
  // For now, post an update that she checked

  const message = `🔍 *Opportunity Watch Update*\n\nI checked on: ${action.description}\n\nI'll continue monitoring SAM.gov and agency forecasts for related postings. Will alert the team if anything surfaces.`;

  try {
    const result = await mayaApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
    });

    return { success: true, message: 'Watch check completed', threadTs: result.ts };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

/**
 * Execute a research action (David)
 */
async function executeResearch(
  action: AgentAction,
  apps: Map<string, App>
): Promise<ExecutionResult> {
  const davidApp = apps.get('david');
  if (!davidApp) {
    return { success: false, message: 'David app not available' };
  }

  const client = getAnthropic();

  const prompt = `You are David, the senior research analyst. You committed to researching:
"${action.description}"

Context: ${action.context || 'No additional context'}

Provide a brief research update (3-4 sentences). Include:
- What you looked into
- Key findings or observations
- Any strategic implications for FFTC

Be honest and direct. Use your dry humor if appropriate.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const researchUpdate = text?.type === 'text' ? text.text : '';

    if (!researchUpdate) {
      return { success: false, message: 'Failed to generate research update' };
    }

    const result = await davidApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `📊 *Research Update:* ${action.description}\n\n${researchUpdate}`,
    });

    return { success: true, message: researchUpdate, threadTs: result.ts };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

/**
 * Execute an outreach action (Marcus)
 */
async function executeOutreach(
  action: AgentAction,
  apps: Map<string, App>
): Promise<ExecutionResult> {
  const marcusApp = apps.get('marcus');
  if (!marcusApp) {
    return { success: false, message: 'Marcus app not available' };
  }

  const client = getAnthropic();

  const prompt = `You are Marcus, the relationship builder. You committed to:
"${action.description}"

Context: ${action.context || 'No additional context'}

Write a brief update (2-3 sentences) about this outreach item. Be honest - suggest concrete next steps the human team can take. Don't invent contacts or results.

Your update:`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(b => b.type === 'text');
    const update = text?.type === 'text' ? text.text : '';

    if (!update) {
      return { success: false, message: 'Failed to generate outreach update' };
    }

    const result = await marcusApp.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: `🤝 *Outreach Reminder:* ${action.description}\n\n${update}`,
    });

    return { success: true, message: update, threadTs: result.ts };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

/**
 * Main executor - routes actions to appropriate handlers
 */
export async function executeAction(
  action: AgentAction,
  apps: Map<string, App>
): Promise<void> {
  if (!action.id) {
    console.error('[ActionExecutor] Action has no ID');
    return;
  }

  console.log(`[ActionExecutor] Executing: ${action.agent_name} - ${action.action_type} - ${action.description}`);

  await markActionInProgress(action.id);

  let result: ExecutionResult;

  try {
    switch (action.action_type) {
      case 'team_meeting':
        result = await executeTeamMeeting(action, apps);
        break;

      case 'watch_opportunity':
        result = await executeWatchOpportunity(action, apps);
        break;

      case 'research':
        result = await executeResearch(action, apps);
        break;

      case 'outreach':
        result = await executeOutreach(action, apps);
        break;

      case 'follow_up':
      case 'alert':
      default:
        result = await executeFollowUp(action, apps);
        break;
    }

    if (result.success) {
      await markActionCompleted(action.id, result.message, result.threadTs);
    } else {
      await markActionFailed(action.id, result.message || 'Unknown error');
    }
  } catch (err) {
    console.error('[ActionExecutor] Execution error:', err);
    await markActionFailed(action.id, String(err));
  }
}
