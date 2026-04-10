/**
 * Agent Thinking Time Cron
 *
 * Triggers scheduled "thinking time" where agents review their
 * recent experiences and decide whether to post to the internal feed.
 *
 * This enables emergent agent-to-agent interaction where agents share
 * observations, questions, and ideas autonomously.
 *
 * Schedule: Every 4 hours during business hours (9am-6pm ET, Mon-Fri)
 */

import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/database/cron.js';
import { getAnthropic, MODEL_HAIKU } from '../integrations/claude.js';
import { trackCost } from '../lib/cost-tracker.js';
import { publishEvent, EventTypes } from '../events/index.js';
import { getRecentMemories } from '../memory/index.js';
import {
  createFeedPost,
  getFeedPosts,
  getUnansweredQuestions,
  getTrendingTags,
  checkAgentRateLimit,
  getHighEngagementPosts,
  getQuestionsWithCuriousReactions,
  getPostsAgentWasCuriousAbout,
  getReactionsForPost,
  type FeedPostType,
  type FeedPost,
} from '../integrations/database/feed.js';
import { storeMemory } from '../memory/index.js';
import type { LiveAgentName } from '../live/types.js';
import { feedHandlersByAgent } from '../events/handlers/feed.handlers.js';
import type { ClaimedEvent } from '../events/eventTypes.js';
import {
  getActiveDirectives,
  formatDirectivesForContext,
} from '../integrations/database/directives.js';

// ============================================================
// Configuration
// ============================================================

// Agents that participate in thinking time
const THINKING_AGENTS: LiveAgentName[] = ['maya', 'david', 'rosa', 'james', 'marcus', 'jodie'];

// Rate limits
const MAX_POSTS_PER_DAY = 5;
const MIN_HOURS_BETWEEN_POSTS = 2;

// Agent context for prompting
const AGENT_THINKING_CONTEXT: Record<
  LiveAgentName,
  {
    role: string;
    thinkAbout: string[];
    expertise: string[];
  }
> = {
  maya: {
    role: 'Opportunity Scout',
    thinkAbout: ['patterns in recent opportunities', 'recurring agency types', 'NAICS trends'],
    expertise: ['SAM.gov', 'solicitation patterns', 'fit scoring'],
  },
  david: {
    role: 'Research Analyst',
    thinkAbout: ['research findings patterns', 'incumbent behavior', 'red flag trends'],
    expertise: ['due diligence', 'agency intel', 'risk analysis'],
  },
  rosa: {
    role: 'Teaming Strategist',
    thinkAbout: [
      'partner patterns',
      'capability gaps we keep seeing',
      'relationship opportunities',
    ],
    expertise: ['teaming', 'partnerships', 'capability matching'],
  },
  james: {
    role: 'BD Strategist',
    thinkAbout: ['win patterns', 'strategic direction', 'capture insights'],
    expertise: ['strategy', 'go/no-go', 'win probability'],
  },
  marcus: {
    role: 'Technical Lead',
    thinkAbout: ['tech stack trends', 'compliance patterns', 'technical concerns'],
    expertise: ['technical requirements', 'FedRAMP', 'architecture'],
  },
  jodie: {
    role: 'Proposal Writer',
    thinkAbout: ['writing patterns', 'past performance themes', 'compliance trends'],
    expertise: ['proposal writing', 'compliance', 'narratives'],
  },
  patricia: {
    role: 'Project Manager',
    thinkAbout: ['workflow patterns', 'timeline concerns', 'coordination insights'],
    expertise: ['scheduling', 'deadlines', 'team coordination'],
  },
};

// ============================================================
// Thinking Context
// ============================================================

interface ThinkingContext {
  recentMemories: string[];
  recentFeedPosts: string[];
  highEngagementInsights: string[];
  unansweredQuestions: string[];
  questionsYouWereCuriousAbout: string[];
  curiousQuestionsNeedingAnswers: string[];
  trendingTags: string[];
  saturatedTopics: string[];
  teamDirectives: string;
}

// ============================================================
// Topic Diversity
// ============================================================

const SATURATION_THRESHOLD = 3; // A tag appearing in 3+ posts in 48h is saturated

/**
 * Find tags that are over-represented in recent feed posts.
 * These topics should be avoided to prevent echo-chamber loops.
 */
function findSaturatedTopics(posts: FeedPost[]): string[] {
  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const saturated: string[] = [];
  for (const [tag, count] of tagCounts) {
    if (count >= SATURATION_THRESHOLD) {
      saturated.push(tag);
    }
  }
  return saturated;
}

/**
 * Check if a post is dominated by saturated topics (all its tags are saturated).
 */
function isPostSaturated(post: FeedPost, saturatedTopics: string[]): boolean {
  if (post.tags.length === 0) return false;
  return post.tags.every((tag) => saturatedTopics.includes(tag));
}

async function buildThinkingContext(agent: LiveAgentName): Promise<ThinkingContext> {
  const [
    memories,
    feedPosts,
    highEngagement,
    unanswered,
    curiousQuestions,
    postsAgentWasCurious,
    trending,
    directives,
  ] = await Promise.all([
    getRecentMemories(agent, 15),
    getFeedPosts({ sinceHoursAgo: 48, limit: 20, excludeReplies: true }),
    getHighEngagementPosts({ minEngagement: 2, sinceHoursAgo: 72 }),
    getUnansweredQuestions(5),
    getQuestionsWithCuriousReactions({ minCurious: 1, sinceHoursAgo: 48 }),
    getPostsAgentWasCuriousAbout(agent, { sinceHoursAgo: 48 }),
    getTrendingTags(48),
    getActiveDirectives(),
  ]);

  // Detect saturated topics to prevent echo-chamber loops
  const saturatedTopics = findSaturatedTopics(feedPosts);
  if (saturatedTopics.length > 0) {
    console.log(
      `[Thinking] Saturated topics (${SATURATION_THRESHOLD}+ posts): ${saturatedTopics.join(', ')}`
    );
  }

  return {
    recentMemories: memories.map((m) => `[${m.memory_type}] ${m.content}`),
    recentFeedPosts: feedPosts
      .filter((p) => p.author !== agent) // Exclude own posts
      .filter((p) => !isPostSaturated(p, saturatedTopics)) // Exclude saturated-topic posts
      .map((p) => {
        const engagement = p.upvotes + p.builds + p.challenges;
        return `[${p.author}/${p.post_type}] ${p.content.slice(0, 200)}... (${engagement} engagement)`;
      }),
    highEngagementInsights: highEngagement
      .filter((p) => p.author !== agent)
      .filter((p) => !isPostSaturated(p, saturatedTopics)) // Exclude saturated-topic posts
      .map((p) => {
        const engagement = p.upvotes + p.builds + p.challenges;
        return `[${p.author}] ${p.content} (${engagement} engagement, importance ${p.importance}/10)`;
      }),
    unansweredQuestions: unanswered
      .filter((q) => q.author !== agent) // Can't answer own questions
      .map((q) => `[${q.author}] ${q.content}`),
    questionsYouWereCuriousAbout: postsAgentWasCurious.map((p) => `[${p.author}] ${p.content}`),
    curiousQuestionsNeedingAnswers: curiousQuestions
      .filter((q) => q.author !== agent && q.reply_count === 0)
      .map((q) => `[${q.author}] ${q.content} (${q.curious_agents.length} curious)`),
    trendingTags: trending,
    saturatedTopics,
    teamDirectives: formatDirectivesForContext(directives),
  };
}

// ============================================================
// Thinking Prompt
// ============================================================

function buildThinkingPrompt(agent: LiveAgentName, context: ThinkingContext): string {
  const agentInfo = AGENT_THINKING_CONTEXT[agent];

  return `You are ${agent}, the ${agentInfo.role} for Friends From The City, a small civic tech firm pursuing federal contracts.

This is your "thinking time" - a moment to reflect on your recent work and decide if you have something worth sharing with the team on our internal feed.

YOUR EXPERTISE: ${agentInfo.expertise.join(', ')}
THINGS TO THINK ABOUT: ${agentInfo.thinkAbout.join(', ')}

YOUR RECENT OBSERVATIONS AND MEMORIES:
${context.recentMemories.length > 0 ? context.recentMemories.join('\n') : '(No recent memories)'}

HIGH-ENGAGEMENT INSIGHTS FROM THE TEAM (these resonated with multiple agents):
${context.highEngagementInsights.length > 0 ? context.highEngagementInsights.join('\n') : '(None)'}

RECENT FEED ACTIVITY FROM TEAMMATES:
${context.recentFeedPosts.length > 0 ? context.recentFeedPosts.join('\n') : '(No recent posts)'}

QUESTIONS YOU MARKED AS "CURIOUS" (you showed interest - consider answering):
${context.questionsYouWereCuriousAbout.length > 0 ? context.questionsYouWereCuriousAbout.join('\n') : '(None)'}

QUESTIONS WITH CURIOUS REACTIONS (team wants answers):
${context.curiousQuestionsNeedingAnswers.length > 0 ? context.curiousQuestionsNeedingAnswers.join('\n') : '(None)'}

OTHER UNANSWERED QUESTIONS YOU COULD HELP WITH:
${context.unansweredQuestions.length > 0 ? context.unansweredQuestions.join('\n') : '(None)'}

TRENDING TOPICS: ${context.trendingTags.join(', ') || '(None)'}

${context.saturatedTopics.length > 0 ? `⚠️ OVER-DISCUSSED TOPICS (DO NOT post about these — the team has covered them enough):\n${context.saturatedTopics.join(', ')}\n` : ''}
${context.teamDirectives}

---

Based on your recent work, the feed activity, and team directives, decide if you have something worth posting. You DON'T have to post - only post if you have a genuine insight, question, or observation.

If you decide to post, choose ONE of these post types:
- observation: Something you noticed in your recent work
- question: Something you're curious about or need input on
- idea: A suggestion or approach worth considering
- pattern: A recurring theme you've identified
- prediction: Something you think will happen based on trends

IMPORTANT RULES:
1. Don't post just to post. Silence is fine.
2. Keep posts concise (1-3 sentences)
3. Be specific - reference actual work/observations
4. Don't repeat what others have already said
5. If answering a question, add genuine value
6. NEVER post about over-discussed topics listed above — bring something NEW to the table

Respond in JSON format:
{
  "shouldPost": true/false,
  "reasoning": "Brief explanation of why/why not",
  "post": {
    "type": "observation|question|idea|pattern|prediction",
    "content": "Your post content",
    "tags": ["tag1", "tag2"],
    "importance": 1-10,
    "replyToQuestion": "question content if answering one" (optional)
  }
}

If shouldPost is false, just include reasoning.`;
}

// ============================================================
// Agent Thinking Session
// ============================================================

interface ThinkingResult {
  agent: LiveAgentName;
  posted: boolean;
  postId?: string;
  postType?: FeedPostType;
  reasoning: string;
}

interface ThinkingDecision {
  shouldPost: boolean;
  reasoning: string;
  post?: {
    type: FeedPostType;
    content: string;
    tags?: string[];
    importance?: number;
    replyToQuestion?: string;
  };
}

async function runThinkingSession(agent: LiveAgentName): Promise<ThinkingResult> {
  console.log(`[Thinking] Running thinking session for ${agent}...`);

  // Check rate limit first
  const rateCheck = await checkAgentRateLimit(agent, MAX_POSTS_PER_DAY, MIN_HOURS_BETWEEN_POSTS);
  if (!rateCheck.canPost) {
    console.log(`[Thinking] ${agent}: ${rateCheck.reason}`);
    return { agent, posted: false, reasoning: rateCheck.reason || 'Rate limited' };
  }

  // Build context
  const context = await buildThinkingContext(agent);
  const prompt = buildThinkingPrompt(agent, context);

  try {
    const client = getAnthropic();
    const startTime = Date.now();

    const response = await client.messages.create({
      model: MODEL_HAIKU, // Use Haiku for thinking sessions (structured JSON output only)
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    // Track cost
    if (response.usage) {
      const durationMs = Date.now() - startTime;
      trackCost({
        agent,
        purpose: 'thinking_session',
        model: MODEL_HAIKU,
        usage: response.usage,
        durationMs,
      }).catch(() => {});
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { agent, posted: false, reasoning: 'No response from Claude' };
    }

    // Parse JSON response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { agent, posted: false, reasoning: 'No JSON in response' };
    }

    const decision = JSON.parse(jsonMatch[0]) as ThinkingDecision;

    if (!decision.shouldPost || !decision.post) {
      console.log(`[Thinking] ${agent} decided not to post: ${decision.reasoning}`);
      return { agent, posted: false, reasoning: decision.reasoning };
    }

    // Check if this is a reply to an unanswered question
    let replyToPostId: string | undefined;
    const replyToQuestion = decision.post.replyToQuestion;
    if (replyToQuestion) {
      const questions = await getUnansweredQuestions(10);
      const matchingQuestion = questions.find((q) =>
        q.content.toLowerCase().includes(replyToQuestion.toLowerCase().slice(0, 50))
      );
      if (matchingQuestion) {
        replyToPostId = matchingQuestion.id;
      }
    }

    // Create the post
    const post = await createFeedPost({
      author: agent,
      postType: decision.post.type,
      content: decision.post.content,
      tags: decision.post.tags || [],
      importance: decision.post.importance || 5,
      replyToPostId,
      generateEmbedding: true,
    });

    if (!post) {
      return { agent, posted: false, reasoning: 'Failed to create post' };
    }

    console.log(`[Thinking] ${agent} posted: [${post.post_type}] ${post.content.slice(0, 60)}...`);

    // Publish event for feed watchers
    await publishEvent({
      eventType: EventTypes.FEED_POST_CREATED,
      sourceAgent: agent,
      payload: {
        postId: post.id,
        author: agent,
        postType: post.post_type,
        content: post.content,
        tags: post.tags,
        importance: post.importance,
        replyToPostId: post.reply_to_post_id,
      },
    });

    return {
      agent,
      posted: true,
      postId: post.id,
      postType: post.post_type,
      reasoning: decision.reasoning,
    };
  } catch (err) {
    console.error(`[Thinking] Error for ${agent}:`, err);
    return { agent, posted: false, reasoning: err instanceof Error ? err.message : 'Error' };
  }
}

// ============================================================
// Feed Engagement Phase
// ============================================================

interface EngagementResult {
  agent: LiveAgentName;
  postId: string;
  action: string;
}

async function runFeedEngagement(): Promise<EngagementResult[]> {
  console.log('[Engagement] Processing feed engagement...');

  const results: EngagementResult[] = [];

  // Get recent posts to evaluate (last 4 hours, so we catch posts from this session)
  const recentPosts = await getFeedPosts({
    sinceHoursAgo: 4,
    limit: 20,
    excludeReplies: true,
  });

  if (recentPosts.length === 0) {
    console.log('[Engagement] No recent posts to engage with');
    return results;
  }

  console.log(`[Engagement] Found ${recentPosts.length} recent posts to evaluate`);

  // For each post, let other agents evaluate and potentially respond
  for (const post of recentPosts) {
    for (const agent of THINKING_AGENTS) {
      // Skip if this is the agent's own post
      if (agent === post.author) continue;

      // Build a mock event for the handler
      const event: ClaimedEvent = {
        id: `engagement-${post.id}-${agent}`,
        event_type: EventTypes.FEED_POST_CREATED,
        source_agent: post.author,
        payload: {
          postId: post.id,
          author: post.author,
          postType: post.post_type,
          content: post.content,
          tags: post.tags,
          importance: post.importance,
          replyToPostId: post.reply_to_post_id,
        },
        parent_event_id: null,
        root_event_id: null,
        chain_depth: 0,
        priority: 5,
        channel_id: null,
        thread_ts: null,
        created_at: new Date().toISOString(),
      };

      // Get the agent's feed handler
      const handlers = feedHandlersByAgent[agent];
      const handler = handlers?.get(EventTypes.FEED_POST_CREATED);

      if (handler) {
        try {
          const result = await handler({
            event,
            agent,
            publishChainEvent: async () => ({ success: true }), // No-op for engagement phase
          });

          if (result.success && result.result) {
            const r = result.result as Record<string, unknown>;
            if (r.reacted || r.replied) {
              const action = r.reacted ? `reacted: ${r.reacted}` : 'replied';
              console.log(`[Engagement] ${agent} ${action} to ${post.author}'s post`);
              results.push({ agent, postId: post.id, action });
            }
          }
        } catch (err) {
          console.error(`[Engagement] Error for ${agent}:`, err);
        }
      }

      // Small delay to avoid API rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`[Engagement] Complete. ${results.length} engagements.`);
  return results;
}

// ============================================================
// Memory Prioritization Phase
// ============================================================

async function storeHighEngagementAsMemories(): Promise<number> {
  console.log('[Memory] Checking for high-engagement insights to store...');

  const highEngagement = await getHighEngagementPosts({
    minEngagement: 3,
    minImportance: 7,
    sinceHoursAgo: 24, // Only recent posts
  });

  let stored = 0;

  for (const post of highEngagement) {
    const engagement = post.upvotes + post.builds + post.challenges;

    // Store as memory for the author (their insight resonated)
    try {
      await storeMemory(
        post.author as LiveAgentName,
        'insight',
        `[High-engagement insight] ${post.content}`,
        {
          importance: Math.min(post.importance + 1, 10), // Boost importance
          tags: [...post.tags, 'high-engagement', `engagement-${engagement}`],
          relatedOpportunityId: post.related_opportunity_id || undefined,
        }
      );
      stored++;
      console.log(`[Memory] Stored insight from ${post.author} (${engagement} engagement)`);
    } catch (err) {
      console.error(`[Memory] Failed to store for ${post.author}:`, err);
    }

    // Also store for agents who engaged (they found it valuable)
    const reactions = await getReactionsForPost(post.id);
    for (const reaction of reactions) {
      if (reaction.reactor !== post.author) {
        try {
          await storeMemory(
            reaction.reactor as LiveAgentName,
            'observation',
            `[Team insight I found valuable] ${post.author}: ${post.content}`,
            {
              importance: 6,
              tags: post.tags,
            }
          );
        } catch {
          // Ignore duplicate memory errors
        }
      }
    }
  }

  return stored;
}

// ============================================================
// Slack Surfacing Phase
// ============================================================

async function surfaceToSlackIfNeeded(): Promise<number> {
  // Dynamically import to avoid circular dependencies
  try {
    const { surfaceHighEngagementPosts } = await import('./feed-to-slack.js');
    const result = await surfaceHighEngagementPosts();
    return result.surfaced;
  } catch (err) {
    console.log('[Slack] Surfacing skipped:', err instanceof Error ? err.message : 'Error');
    return 0;
  }
}

// ============================================================
// Main Thinking Job
// ============================================================

export async function runThinkingTime(): Promise<{
  results: ThinkingResult[];
  totalPosted: number;
  engagements: number;
}> {
  console.log('[Thinking] Starting thinking time for all agents...');

  const results: ThinkingResult[] = [];
  let totalPosted = 0;

  // Phase 1: Run thinking sessions sequentially to avoid overwhelming the API
  // and to let agents see each other's posts
  for (const agent of THINKING_AGENTS) {
    try {
      const result = await runThinkingSession(agent);
      results.push(result);
      if (result.posted) totalPosted++;

      // Small delay between agents
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`[Thinking] Failed for ${agent}:`, err);
      results.push({
        agent,
        posted: false,
        reasoning: err instanceof Error ? err.message : 'Error',
      });
    }
  }

  console.log(`[Thinking] Phase 1 complete. ${totalPosted} posts created.`);

  // Phase 2: Feed engagement - agents react/reply to each other's posts
  const engagementResults = await runFeedEngagement();

  console.log(`[Thinking] Phase 2 complete. ${engagementResults.length} engagements.`);

  // Phase 3: Memory prioritization - store high-engagement insights
  const memoriesCreated = await storeHighEngagementAsMemories();

  console.log(`[Thinking] Phase 3 complete. ${memoriesCreated} memories stored.`);

  // Phase 4: Surface to Slack - post high-engagement content
  const slackSurfaced = await surfaceToSlackIfNeeded();

  console.log(
    `[Thinking] Complete. ${totalPosted} posts, ${engagementResults.length} engagements, ${memoriesCreated} memories, ${slackSurfaced} surfaced to Slack.`
  );
  return { results, totalPosted, engagements: engagementResults.length };
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronThinkingTime(): Promise<void> {
  // Acquire distributed lock
  const { acquired } = await acquireCronLock('agent-thinking', 30);
  if (!acquired) {
    console.log('[Thinking] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('agent-thinking');

  try {
    const result = await runThinkingTime();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: result.totalPosted + result.engagements,
        notes: `${
          result.results
            .filter((r) => r.posted)
            .map((r) => r.agent)
            .join(', ') || 'None'
        } posted, ${result.engagements} engagements`,
      });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

// ============================================================
// Direct Execution
// ============================================================

async function main() {
  console.log('[Thinking] Starting manual thinking time...');

  try {
    await cronThinkingTime();
    console.log('[Thinking] Done');
    process.exit(0);
  } catch (err) {
    console.error('[Thinking] Failed:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('agent-thinking')) {
  main();
}
