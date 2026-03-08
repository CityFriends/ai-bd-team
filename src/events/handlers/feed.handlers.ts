/**
 * Feed Event Handlers
 *
 * Agents watch the internal feed and decide whether to respond to posts.
 * This enables emergent agent-to-agent interaction where agents build on,
 * challenge, or react to each other's observations and ideas.
 */

import {
  EventType,
  EventTypes,
  type FeedPostCreatedPayload,
  type FeedReactionType,
} from '../eventTypes.js';
import type { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { getAnthropic } from '../../integrations/claude.js';
import {
  createFeedPost,
  addReaction,
  checkAgentRateLimit,
  type FeedPostType,
} from '../../integrations/database/feed.js';
import { publishEvent } from '../eventBus.js';
import type { LiveAgentName } from '../../live/types.js';

// ============================================================
// Domain-based Relevance Mapping
// ============================================================

const AGENT_FEED_INTERESTS: Record<
  LiveAgentName,
  {
    postTypes: FeedPostType[];
    tags: string[];
    keywords: string[];
  }
> = {
  maya: {
    postTypes: ['observation', 'question', 'pattern'],
    tags: ['opportunities', 'sam-gov', 'solicitation', 'naics', 'pipeline'],
    keywords: ['opportunity', 'rfp', 'rfi', 'sam.gov', 'solicitation', 'bid', 'procurement'],
  },
  david: {
    postTypes: ['observation', 'question', 'pattern', 'prediction'],
    tags: ['research', 'incumbent', 'agency', 'risk', 'red-flag', 'intel'],
    keywords: ['incumbent', 'research', 'risk', 'agency', 'analysis', 'due diligence', 'red flag'],
  },
  rosa: {
    postTypes: ['observation', 'question', 'idea'],
    tags: ['teaming', 'partners', 'relationships', 'capabilities', '8a', 'sdvosb'],
    keywords: ['partner', 'team', 'subcontract', 'prime', 'capability', 'relationship', 'jv'],
  },
  james: {
    postTypes: ['observation', 'question', 'idea', 'pattern', 'prediction'],
    tags: ['strategy', 'decision', 'win', 'capture', 'go-no-go'],
    keywords: ['strategy', 'decision', 'go/no-go', 'win', 'probability', 'capture', 'pursue'],
  },
  marcus: {
    postTypes: ['observation', 'question', 'idea'],
    tags: ['technical', 'fedramp', 'compliance', 'architecture', 'stack'],
    keywords: ['technical', 'fedramp', 'ato', 'compliance', 'architecture', 'stack', 'cloud'],
  },
  jodie: {
    postTypes: ['observation', 'question', 'idea'],
    tags: ['proposal', 'writing', 'compliance', 'narrative', 'past-performance'],
    keywords: ['proposal', 'writing', 'section', 'compliance', 'narrative', 'past performance'],
  },
  patricia: {
    postTypes: ['observation', 'question'],
    tags: ['timeline', 'deadline', 'workflow', 'coordination', 'tracking'],
    keywords: ['timeline', 'deadline', 'schedule', 'coordination', 'workflow', 'status'],
  },
};

// ============================================================
// Relevance Scoring
// ============================================================

function calculateRelevanceScore(agent: LiveAgentName, payload: FeedPostCreatedPayload): number {
  const interests = AGENT_FEED_INTERESTS[agent];
  if (!interests) return 0;

  let score = 0;

  // Don't respond to own posts
  if (payload.author === agent) {
    return 0;
  }

  // Post type match
  if (interests.postTypes.includes(payload.postType as FeedPostType)) {
    score += 0.3;
  }

  // Tag overlap
  const postTags = payload.tags || [];
  const tagOverlap = postTags.filter((t) => interests.tags.includes(t.toLowerCase())).length;
  score += Math.min(tagOverlap * 0.15, 0.3);

  // Keyword match in content
  const contentLower = payload.content.toLowerCase();
  const keywordMatches = interests.keywords.filter((k) => contentLower.includes(k)).length;
  score += Math.min(keywordMatches * 0.1, 0.3);

  // Questions get higher relevance (agents should help each other)
  if (payload.postType === 'question') {
    score += 0.2;
  }

  // High importance posts deserve attention
  if (payload.importance >= 7) {
    score += 0.1;
  }

  return Math.min(score, 1.0);
}

// ============================================================
// Response Decision
// ============================================================

interface ResponseDecision {
  shouldRespond: boolean;
  responseType: 'reply' | 'reaction' | 'build' | 'none';
  reactionType?: FeedReactionType;
  replyContent?: string;
  replyPostType?: FeedPostType;
}

async function decideResponse(
  agent: LiveAgentName,
  payload: FeedPostCreatedPayload,
  relevanceScore: number
): Promise<ResponseDecision> {
  // Low relevance = no response
  if (relevanceScore < 0.3) {
    return { shouldRespond: false, responseType: 'none' };
  }

  // Check rate limit - don't overwhelm the feed
  const rateCheck = await checkAgentRateLimit(agent, 5, 1);
  if (!rateCheck.canPost) {
    // Can still react, just not post
    if (relevanceScore >= 0.4 && Math.random() < 0.3) {
      return {
        shouldRespond: true,
        responseType: 'reaction',
        reactionType: payload.postType === 'question' ? 'curious' : 'upvote',
      };
    }
    return { shouldRespond: false, responseType: 'none' };
  }

  // Medium relevance = maybe just react
  if (relevanceScore < 0.5) {
    // 30% chance of reaction
    if (Math.random() < 0.3) {
      return {
        shouldRespond: true,
        responseType: 'reaction',
        reactionType: payload.postType === 'question' ? 'curious' : 'upvote',
      };
    }
    return { shouldRespond: false, responseType: 'none' };
  }

  // High relevance = consider reply
  // Use Claude to decide
  const client = getAnthropic();
  const interests = AGENT_FEED_INTERESTS[agent];

  const prompt = `You are ${agent}, ${interests.tags.slice(0, 3).join('/')} specialist for a federal contracting team.

A teammate posted this on your internal feed:

[${payload.author}] (${payload.postType}): "${payload.content}"
Tags: ${(payload.tags || []).join(', ') || 'none'}

Based on your expertise in ${interests.keywords.slice(0, 5).join(', ')}, decide how to respond:

1. REPLY - You have something valuable to add (expertise, perspective, answer)
2. REACT - You find it interesting but don't have much to add (upvote, curious)
3. BUILD - You want to extend the idea with your own take
4. NONE - Not relevant enough for you to engage

IMPORTANT:
- Only reply if you genuinely add value
- Don't just agree for the sake of it
- Be concise (1-2 sentences for replies)
- Match their energy level

Respond in JSON:
{
  "decision": "reply|react|build|none",
  "reasoning": "Brief explanation",
  "reaction": "upvote|curious|important" (if react),
  "replyContent": "Your reply" (if reply/build)
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { shouldRespond: false, responseType: 'none' };
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { shouldRespond: false, responseType: 'none' };
    }

    const decision = JSON.parse(jsonMatch[0]) as {
      decision: 'reply' | 'react' | 'build' | 'none';
      reaction?: FeedReactionType;
      replyContent?: string;
    };

    if (decision.decision === 'none') {
      return { shouldRespond: false, responseType: 'none' };
    }

    // Map 'react' from prompt to 'reaction' for our type
    const responseType =
      decision.decision === 'react' ? 'reaction' : (decision.decision as 'reply' | 'build');

    return {
      shouldRespond: true,
      responseType,
      reactionType: decision.reaction,
      replyContent: decision.replyContent,
      replyPostType: decision.decision === 'build' ? 'build' : 'observation',
    };
  } catch (err) {
    console.error(`[FeedHandler:${agent}] Decision error:`, err);
    return { shouldRespond: false, responseType: 'none' };
  }
}

// ============================================================
// Feed Post Handler Factory
// ============================================================

function createFeedPostHandler(agent: LiveAgentName): EventHandler {
  return async (context: EventHandlerContext): Promise<EventHandlerResult> => {
    const { event } = context;
    const payload = event.payload as FeedPostCreatedPayload;

    // Calculate relevance
    const relevanceScore = calculateRelevanceScore(agent, payload);

    if (relevanceScore === 0) {
      return { success: true, result: { skipped: true, reason: 'own post or no relevance' } };
    }

    console.log(
      `[FeedHandler:${agent}] Evaluating post from ${payload.author} (relevance: ${relevanceScore.toFixed(2)})`
    );

    // Decide response
    const decision = await decideResponse(agent, payload, relevanceScore);

    if (!decision.shouldRespond) {
      return { success: true, result: { responded: false, relevance: relevanceScore } };
    }

    // Execute response
    try {
      if (decision.responseType === 'reaction' && decision.reactionType) {
        await addReaction(payload.postId, agent, decision.reactionType);
        console.log(`[FeedHandler:${agent}] Added ${decision.reactionType} reaction`);
        return { success: true, result: { reacted: decision.reactionType } };
      }

      if (
        (decision.responseType === 'reply' || decision.responseType === 'build') &&
        decision.replyContent
      ) {
        const replyPost = await createFeedPost({
          author: agent,
          postType: decision.replyPostType || 'observation',
          content: decision.replyContent,
          replyToPostId: payload.postId,
          importance: 5,
        });

        if (replyPost) {
          console.log(`[FeedHandler:${agent}] Posted reply: ${replyPost.content.slice(0, 50)}...`);

          // Publish event so other agents can see the reply
          await publishEvent({
            eventType: EventTypes.FEED_POST_REPLY,
            sourceAgent: agent,
            payload: {
              parentPostId: payload.postId,
              replyPostId: replyPost.id,
              author: agent,
              content: replyPost.content,
              replyType: decision.responseType === 'build' ? 'build' : 'agree',
            },
          });

          return { success: true, result: { replied: true, postId: replyPost.id } };
        }
      }

      return { success: true, result: { responded: false } };
    } catch (err) {
      console.error(`[FeedHandler:${agent}] Response error:`, err);
      return { success: false, error: err instanceof Error ? err.message : 'Response failed' };
    }
  };
}

// ============================================================
// Export Handler Maps for Each Agent
// ============================================================

export const feedHandlersMaya: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('maya')],
]);

export const feedHandlersDavid: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('david')],
]);

export const feedHandlersRosa: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('rosa')],
]);

export const feedHandlersJames: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('james')],
]);

export const feedHandlersMarcus: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('marcus')],
]);

export const feedHandlersJodie: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('jodie')],
]);

export const feedHandlersPatricia: Map<EventType, EventHandler> = new Map([
  [EventTypes.FEED_POST_CREATED, createFeedPostHandler('patricia')],
]);

// Combine all feed handlers by agent
export const feedHandlersByAgent: Record<LiveAgentName, Map<EventType, EventHandler>> = {
  maya: feedHandlersMaya,
  david: feedHandlersDavid,
  rosa: feedHandlersRosa,
  james: feedHandlersJames,
  marcus: feedHandlersMarcus,
  jodie: feedHandlersJodie,
  patricia: feedHandlersPatricia,
};

/**
 * Get feed handlers for a specific agent
 */
export function getFeedHandlersForAgent(agent: LiveAgentName): Map<EventType, EventHandler> {
  return feedHandlersByAgent[agent] || new Map();
}
