import { getSlackApp, getChannelId } from '../integrations/slack.js';
import { getThreadBySlackTs, createThread, queueAgentTask, setOpportunityDecision } from '../integrations/supabase.js';
import { extractMentions, getAgent } from '../agents/index.js';
import type { AgentName } from '../types/index.js';

// Type for reaction_added event
interface ReactionEvent {
  reaction: string;
  item: {
    type: string;
    channel: string;
    ts: string;
  };
  user: string;
  event_ts: string;
}

// Set up Slack event handlers
export function setupTriggers(): void {
  const app = getSlackApp();
  const channelId = getChannelId();

  // Handle messages in the BD channel
  app.message(async ({ message, say }) => {
    // Only process messages in our channel
    if (message.channel !== channelId) return;

    // Skip bot messages to avoid loops
    if ('bot_id' in message) return;

    // Type guard for message with text
    if (!('text' in message) || !message.text) return;

    const text = message.text;
    const threadTs = 'thread_ts' in message ? message.thread_ts : message.ts;

    console.log(`Message received: ${text.substring(0, 50)}...`);

    // Check for @mentions to agents
    const mentions = extractMentions(text);

    if (mentions.length > 0) {
      // Route to mentioned agents
      for (const agentName of mentions) {
        await handleAgentMention(agentName, text, threadTs);
      }
    }

    // Check for decision responses from Lapedra
    if (isDecisionResponse(text)) {
      await handleDecisionResponse(text, threadTs);
    }
  });

  // Handle reaction added events
  app.event('reaction_added', async ({ event }) => {
    // Only process in our channel
    if (event.item.channel !== channelId) return;

    await handleReaction(event);
  });

  console.log('Slack triggers configured');
}

// Handle when an agent is @mentioned
async function handleAgentMention(
  agentName: AgentName,
  text: string,
  threadTs?: string
): Promise<void> {
  console.log(`Agent ${agentName} mentioned`);

  const { AGENT_DELAYS } = await import('../types/index.js');

  // Determine delay based on agent
  let delay: [number, number];
  switch (agentName) {
    case 'scout':
      delay = AGENT_DELAYS.QUICK_RESPONSE;
      break;
    case 'analyst':
      delay = AGENT_DELAYS.RESEARCH;
      break;
    case 'connector':
      delay = AGENT_DELAYS.PARTNER_SEARCH;
      break;
    case 'strategist':
      delay = AGENT_DELAYS.SYNTHESIS;
      break;
    default:
      delay = AGENT_DELAYS.QUICK_RESPONSE;
  }

  // Get a random delay within the range
  const delayMs = Math.floor(Math.random() * (delay[1] - delay[0] + 1)) + delay[0];

  // Queue the response
  await queueAgentTask(
    agentName,
    'respond',
    new Date(Date.now() + delayMs),
    { message: text },
    undefined,
    threadTs
  );
}

// Check if a message is a decision response
function isDecisionResponse(text: string): boolean {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('go') ||
    lowerText.includes('no-go') ||
    lowerText.includes('pass') ||
    lowerText.includes('pursue') ||
    lowerText.includes('approved') ||
    lowerText.includes('yes') ||
    lowerText.includes('no')
  );
}

// Handle a decision response from Lapedra
async function handleDecisionResponse(text: string, threadTs?: string): Promise<void> {
  if (!threadTs) return;

  // Get the thread context
  const thread = await getThreadBySlackTs(threadTs);
  if (!thread?.opportunity_id) return;

  const lowerText = text.toLowerCase();

  // Determine the decision
  let decision: 'go' | 'no_go' | null = null;

  if (
    lowerText.includes('pursue') ||
    lowerText.includes('approved') ||
    (lowerText.includes('go') && !lowerText.includes('no-go') && !lowerText.includes('no go'))
  ) {
    decision = 'go';
  } else if (
    lowerText.includes('pass') ||
    lowerText.includes('no-go') ||
    lowerText.includes('no go')
  ) {
    decision = 'no_go';
  }

  if (decision) {
    await setOpportunityDecision(thread.opportunity_id, decision);
    console.log(`Decision recorded: ${decision} for opportunity ${thread.opportunity_id}`);

    // Queue strategist to acknowledge
    const { AGENT_DELAYS } = await import('../types/index.js');
    const delay = Math.floor(Math.random() * (AGENT_DELAYS.QUICK_RESPONSE[1] - AGENT_DELAYS.QUICK_RESPONSE[0] + 1)) + AGENT_DELAYS.QUICK_RESPONSE[0];

    await queueAgentTask(
      'strategist',
      'respond',
      new Date(Date.now() + delay),
      {
        message: `Decision received: ${decision === 'go' ? 'GO - pursuing' : 'NO-GO - passing'}`,
        decision,
      },
      thread.opportunity_id,
      threadTs
    );
  }
}

// Handle reaction events
async function handleReaction(event: ReactionEvent): Promise<void> {
  const { reaction, item } = event;

  // Handle handshake reaction (trigger Connector)
  if (reaction === 'handshake' || reaction === '🤝') {
    console.log('Handshake reaction detected - triggering Connector');

    const thread = await getThreadBySlackTs(item.ts);
    if (thread?.opportunity_id) {
      const { AGENT_DELAYS } = await import('../types/index.js');
      const delay = Math.floor(Math.random() * (AGENT_DELAYS.PARTNER_SEARCH[1] - AGENT_DELAYS.PARTNER_SEARCH[0] + 1)) + AGENT_DELAYS.PARTNER_SEARCH[0];

      await queueAgentTask(
        'connector',
        'find_partners',
        new Date(Date.now() + delay),
        {},
        thread.opportunity_id,
        item.ts
      );
    }
  }

  // Handle checkmark reaction (approval)
  if (reaction === 'white_check_mark' || reaction === '✅') {
    console.log('Checkmark reaction detected - handling approval');

    const thread = await getThreadBySlackTs(item.ts);
    if (thread?.opportunity_id) {
      // Check if this is approving outreach drafts
      // The connector would handle this
      const { AGENT_DELAYS } = await import('../types/index.js');
      const delay = Math.floor(Math.random() * (AGENT_DELAYS.QUICK_RESPONSE[1] - AGENT_DELAYS.QUICK_RESPONSE[0] + 1)) + AGENT_DELAYS.QUICK_RESPONSE[0];

      await queueAgentTask(
        'connector',
        'respond',
        new Date(Date.now() + delay),
        { message: 'Approval received via reaction', approved: true },
        thread.opportunity_id,
        item.ts
      );
    }
  }
}

// Create a tracked conversation thread
export async function createTrackedThread(
  slackThreadTs: string,
  opportunityId?: string,
  topic?: string
): Promise<void> {
  await createThread({
    slack_thread_ts: slackThreadTs,
    slack_channel: getChannelId(),
    opportunity_id: opportunityId,
    topic: topic as 'opportunity_review' | 'partner_search' | 'capture_planning' | 'standup' | undefined,
    status: 'active',
  });
}
