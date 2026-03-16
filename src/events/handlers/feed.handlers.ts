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
import { getAnthropic, MODEL_HAIKU } from '../../integrations/claude.js';
import { trackCost, shouldSkipClaudeCall } from '../../lib/cost-tracker.js';
import {
  createFeedPost,
  addReaction,
  checkAgentRateLimit,
  hasAgentReacted,
  hasAgentReplied,
  getFeedPost,
  getThreadChain,
  type FeedPostType,
  type FeedPost,
} from '../../integrations/database/feed.js';
import { publishEvent } from '../eventBus.js';
import type { LiveAgentName } from '../../live/types.js';
import { syncReactionAsComment, syncReplyAsComment } from '../../live/feed-to-notion.js';

// ============================================================
// Thread Reply Limits (prevent runaway reply loops)
// ============================================================

const MAX_REPLIES_PER_THREAD = 15; // Hard cap on total replies in any thread
const MAX_AGENT_REPLIES_PER_THREAD = 2; // Max times one agent can reply in a thread
const MAX_REPLY_DEPTH = 2; // Don't reply to replies-of-replies (0 = original, 1 = reply, 2 = reply-to-reply)

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
// Thread Limit Checks
// ============================================================

interface ThreadLimitCheck {
  canReply: boolean;
  reason?: string;
}

/**
 * Check if replying to this post would exceed thread limits.
 * Prevents runaway reply loops by limiting:
 * - Total replies in a thread
 * - Replies per agent per thread
 * - Reply depth (no replies to replies-of-replies)
 */
async function checkThreadLimits(
  postId: string,
  agent: LiveAgentName,
  payload: FeedPostCreatedPayload
): Promise<ThreadLimitCheck> {
  // If this is a reply to something, check the thread
  const replyToPostId = payload.replyToPostId;

  // Calculate reply depth - if the post we're considering is itself a reply, we're at depth 1+
  let currentDepth = 0;
  if (replyToPostId) {
    // This post is a reply, so any reply to it is at least depth 2
    currentDepth = 1;

    // Check if the parent is also a reply (would make this depth 2+)
    const parentPost = await getFeedPost(replyToPostId);
    if (parentPost?.reply_to_post_id) {
      currentDepth = 2;

      // Check if grandparent is also a reply
      const grandparentPost = await getFeedPost(parentPost.reply_to_post_id);
      if (grandparentPost?.reply_to_post_id) {
        currentDepth = 3;
      }
    }
  }

  // Don't reply to deeply nested posts
  if (currentDepth >= MAX_REPLY_DEPTH) {
    return {
      canReply: false,
      reason: `Thread too deep (depth ${currentDepth}, max ${MAX_REPLY_DEPTH})`,
    };
  }

  // Get the full thread to check limits
  const thread = await getThreadChain(postId);
  if (thread.length === 0) {
    return { canReply: true }; // Can't check, allow
  }

  // Find the root post (first in chain)
  const rootPost = thread[0];

  // Count total replies in thread (all posts except root)
  const totalReplies = thread.length - 1;
  if (totalReplies >= MAX_REPLIES_PER_THREAD) {
    return {
      canReply: false,
      reason: `Thread at max replies (${totalReplies}/${MAX_REPLIES_PER_THREAD})`,
    };
  }

  // Count this agent's replies in the thread
  const agentReplies = thread.filter(
    (p: FeedPost) => p.author === agent && p.id !== rootPost.id
  ).length;
  if (agentReplies >= MAX_AGENT_REPLIES_PER_THREAD) {
    return {
      canReply: false,
      reason: `Agent already replied ${agentReplies} times in this thread (max ${MAX_AGENT_REPLIES_PER_THREAD})`,
    };
  }

  return { canReply: true };
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
  // Check local heuristics first - avoid Claude call if we can
  const skipCheck = shouldSkipClaudeCall({
    relevanceScore,
    importance: payload.importance,
    isOwnPost: payload.author === agent,
  });

  if (skipCheck.skip) {
    return { shouldRespond: false, responseType: 'none' };
  }

  // Check if agent already engaged with this post (no Claude call needed)
  const [alreadyReacted, alreadyReplied] = await Promise.all([
    hasAgentReacted(payload.postId, agent),
    hasAgentReplied(payload.postId, agent),
  ]);

  if (alreadyReacted || alreadyReplied) {
    return { shouldRespond: false, responseType: 'none' };
  }

  // Check thread limits - prevent runaway reply loops
  const threadCheck = await checkThreadLimits(payload.postId, agent, payload);
  if (!threadCheck.canReply) {
    console.log(`[FeedHandler:${agent}] Thread limit reached: ${threadCheck.reason}`);
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

  // Medium relevance = maybe just react (no Claude call needed)
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
  // Use Claude HAIKU for engagement decisions (cheaper, still capable)
  const client = getAnthropic();
  const interests = AGENT_FEED_INTERESTS[agent];
  const startTime = Date.now();

  const prompt = `You are ${agent}, ${interests.tags.slice(0, 3).join('/')} specialist.

Teammate post: [${payload.author}] (${payload.postType}): "${payload.content}"

Decide: REPLY (add value), REACT (upvote/curious), BUILD (extend idea), or NONE.

Rules: Only reply if you add genuine value. Be concise. 1-2 sentences max.

JSON response:
{"decision": "reply|react|build|none", "reaction": "upvote|curious", "replyContent": "..."}`;

  try {
    const response = await client.messages.create({
      model: MODEL_HAIKU, // Use Haiku for engagement decisions (10x cheaper)
      max_tokens: 200, // Reduced - we only need short responses
      messages: [{ role: 'user', content: prompt }],
    });

    // Track cost
    if (response.usage) {
      const durationMs = Date.now() - startTime;
      trackCost({
        agent,
        purpose: 'engagement_decision',
        model: MODEL_HAIKU,
        usage: response.usage,
        durationMs,
        metadata: { postAuthor: payload.author, postType: payload.postType },
      }).catch(() => {});
    }

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

        // Sync reaction to Notion as a comment
        const parentPost = await getFeedPost(payload.postId);
        if (parentPost) {
          syncReactionAsComment(parentPost, agent, decision.reactionType).catch((err) => {
            console.warn(`[FeedHandler:${agent}] Failed to sync reaction to Notion:`, err);
          });
        }

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

          // Sync reply to Notion as a comment on parent post
          const parentPost = await getFeedPost(payload.postId);
          if (parentPost) {
            syncReplyAsComment(parentPost, replyPost).catch((err) => {
              console.warn(`[FeedHandler:${agent}] Failed to sync reply to Notion:`, err);
            });
          }

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
