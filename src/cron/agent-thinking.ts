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
import { getAnthropic } from '../integrations/claude.js';
import { publishEvent, EventTypes } from '../events/index.js';
import { getRecentMemories } from '../memory/index.js';
import {
  createFeedPost,
  getFeedPosts,
  getUnansweredQuestions,
  getTrendingTags,
  checkAgentRateLimit,
  type FeedPostType,
} from '../integrations/database/feed.js';
import type { LiveAgentName } from '../live/types.js';

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
  unansweredQuestions: string[];
  trendingTags: string[];
}

async function buildThinkingContext(agent: LiveAgentName): Promise<ThinkingContext> {
  const [memories, feedPosts, unanswered, trending] = await Promise.all([
    getRecentMemories(agent, 15),
    getFeedPosts({ sinceHoursAgo: 48, limit: 20, excludeReplies: true }),
    getUnansweredQuestions(5),
    getTrendingTags(48),
  ]);

  return {
    recentMemories: memories.map((m) => `[${m.memory_type}] ${m.content}`),
    recentFeedPosts: feedPosts
      .filter((p) => p.author !== agent) // Exclude own posts
      .map((p) => `[${p.author}/${p.post_type}] ${p.content.slice(0, 200)}...`),
    unansweredQuestions: unanswered
      .filter((q) => q.author !== agent) // Can't answer own questions
      .map((q) => `[${q.author}] ${q.content}`),
    trendingTags: trending,
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

RECENT FEED ACTIVITY FROM TEAMMATES:
${context.recentFeedPosts.length > 0 ? context.recentFeedPosts.join('\n') : '(No recent posts)'}

UNANSWERED QUESTIONS YOU COULD HELP WITH:
${context.unansweredQuestions.length > 0 ? context.unansweredQuestions.join('\n') : '(None)'}

TRENDING TOPICS: ${context.trendingTags.join(', ') || '(None)'}

---

Based on your recent work and the feed activity, decide if you have something worth posting. You DON'T have to post - only post if you have a genuine insight, question, or observation.

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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

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
// Main Thinking Job
// ============================================================

export async function runThinkingTime(): Promise<{
  results: ThinkingResult[];
  totalPosted: number;
}> {
  console.log('[Thinking] Starting thinking time for all agents...');

  const results: ThinkingResult[] = [];
  let totalPosted = 0;

  // Run thinking sessions sequentially to avoid overwhelming the API
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

  console.log(`[Thinking] Complete. ${totalPosted} posts created.`);
  return { results, totalPosted };
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
        itemsProcessed: result.totalPosted,
        notes: `${
          result.results
            .filter((r) => r.posted)
            .map((r) => r.agent)
            .join(', ') || 'None'
        } posted`,
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
