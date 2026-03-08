// Agent Feed Database Operations
// Enables emergent agent-to-agent interaction via internal feed posts

import { getSupabase } from './client.js';
import { embed, formatForPgVector } from '../embeddings.js';
import type { LiveAgentName } from '../../live/types.js';

// ============================================================
// Types
// ============================================================

export type FeedPostType =
  | 'observation'
  | 'question'
  | 'idea'
  | 'build'
  | 'challenge'
  | 'pattern'
  | 'prediction';

export type FeedReactionType = 'upvote' | 'build' | 'challenge' | 'important' | 'curious';

export interface FeedPost {
  id: string;
  author: string;
  post_type: FeedPostType;
  content: string;
  tags: string[];
  related_opportunity_id: string | null;
  reply_to_post_id: string | null;
  build_on_post_id: string | null;
  upvotes: number;
  builds: number;
  challenges: number;
  reply_count: number;
  importance: number;
  visibility: 'internal' | 'slack_eligible' | 'posted_to_slack';
  notion_page_id: string | null;
  slack_thread_ts: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedReaction {
  id: string;
  post_id: string;
  reactor: string;
  reaction_type: FeedReactionType;
  created_at: string;
}

export interface CreateFeedPostOptions {
  author: LiveAgentName;
  postType: FeedPostType;
  content: string;
  tags?: string[];
  relatedOpportunityId?: string;
  replyToPostId?: string;
  buildOnPostId?: string;
  importance?: number;
  visibility?: 'internal' | 'slack_eligible';
  generateEmbedding?: boolean;
}

// ============================================================
// Create Post
// ============================================================

export async function createFeedPost(options: CreateFeedPostOptions): Promise<FeedPost | null> {
  const {
    author,
    postType,
    content,
    tags = [],
    relatedOpportunityId,
    replyToPostId,
    buildOnPostId,
    importance = 5,
    visibility = 'internal',
    generateEmbedding = true,
  } = options;

  try {
    const insertData: Record<string, unknown> = {
      author,
      post_type: postType,
      content,
      tags,
      related_opportunity_id: relatedOpportunityId || null,
      reply_to_post_id: replyToPostId || null,
      build_on_post_id: buildOnPostId || null,
      importance,
      visibility,
    };

    // Generate embedding for semantic search
    if (generateEmbedding) {
      try {
        const embeddingVector = await embed(content);
        insertData.embedding = formatForPgVector(embeddingVector);
      } catch (err) {
        console.warn('[Feed] Failed to generate embedding, continuing without:', err);
      }
    }

    const { data, error } = await getSupabase()
      .from('agent_feed_posts')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[Feed] Failed to create post:', error.message);
      return null;
    }

    console.log(`[Feed] Created post: [${postType}] by ${author}`);
    return data as FeedPost;
  } catch (err) {
    console.error('[Feed] Error creating post:', err);
    return null;
  }
}

// ============================================================
// Query Feed Posts
// ============================================================

export interface FeedQueryOptions {
  limit?: number;
  offset?: number;
  author?: LiveAgentName;
  postTypes?: FeedPostType[];
  tags?: string[];
  minImportance?: number;
  sinceHoursAgo?: number;
  excludeReplies?: boolean;
  excludeAuthor?: LiveAgentName;
}

export async function getFeedPosts(options: FeedQueryOptions = {}): Promise<FeedPost[]> {
  const {
    limit = 20,
    offset = 0,
    author,
    postTypes,
    tags,
    minImportance,
    sinceHoursAgo,
    excludeReplies = false,
    excludeAuthor,
  } = options;

  try {
    let query = getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (author) {
      query = query.eq('author', author);
    }

    if (excludeAuthor) {
      query = query.neq('author', excludeAuthor);
    }

    if (postTypes && postTypes.length > 0) {
      query = query.in('post_type', postTypes);
    }

    if (tags && tags.length > 0) {
      query = query.overlaps('tags', tags);
    }

    if (minImportance !== undefined) {
      query = query.gte('importance', minImportance);
    }

    if (sinceHoursAgo !== undefined) {
      const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', since);
    }

    if (excludeReplies) {
      query = query.is('reply_to_post_id', null);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Feed] Failed to get posts:', error.message);
      return [];
    }

    return (data || []) as FeedPost[];
  } catch (err) {
    console.error('[Feed] Error getting posts:', err);
    return [];
  }
}

// ============================================================
// Get Unanswered Questions
// ============================================================

export async function getUnansweredQuestions(limit: number = 10): Promise<FeedPost[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .eq('post_type', 'question')
      .eq('reply_count', 0)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Feed] Failed to get unanswered questions:', error.message);
      return [];
    }

    return (data || []) as FeedPost[];
  } catch (err) {
    console.error('[Feed] Error getting unanswered questions:', err);
    return [];
  }
}

// ============================================================
// Get Post with Replies
// ============================================================

export async function getPostWithReplies(
  postId: string
): Promise<{ post: FeedPost; replies: FeedPost[] } | null> {
  try {
    const [postResult, repliesResult] = await Promise.all([
      getSupabase().from('agent_feed_posts').select('*').eq('id', postId).single(),
      getSupabase()
        .from('agent_feed_posts')
        .select('*')
        .eq('reply_to_post_id', postId)
        .order('created_at', { ascending: true }),
    ]);

    if (postResult.error || !postResult.data) {
      return null;
    }

    return {
      post: postResult.data as FeedPost,
      replies: (repliesResult.data || []) as FeedPost[],
    };
  } catch (err) {
    console.error('[Feed] Error getting post with replies:', err);
    return null;
  }
}

// ============================================================
// Get Single Post
// ============================================================

export async function getFeedPost(postId: string): Promise<FeedPost | null> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .eq('id', postId)
      .single();

    if (error) {
      console.error('[Feed] Failed to get post:', error.message);
      return null;
    }

    return data as FeedPost;
  } catch (err) {
    console.error('[Feed] Error getting post:', err);
    return null;
  }
}

// ============================================================
// Add Reaction
// ============================================================

export async function addReaction(
  postId: string,
  reactor: LiveAgentName,
  reactionType: FeedReactionType
): Promise<boolean> {
  try {
    const { error } = await getSupabase().from('agent_feed_reactions').insert({
      post_id: postId,
      reactor,
      reaction_type: reactionType,
    });

    if (error) {
      // Unique constraint = already reacted
      if (error.code === '23505') {
        console.log(`[Feed] ${reactor} already reacted ${reactionType} to ${postId}`);
        return false;
      }
      console.error('[Feed] Failed to add reaction:', error.message);
      return false;
    }

    console.log(`[Feed] ${reactor} reacted ${reactionType} to post ${postId}`);
    return true;
  } catch (err) {
    console.error('[Feed] Error adding reaction:', err);
    return false;
  }
}

// ============================================================
// Get Reactions for Post
// ============================================================

export async function getReactionsForPost(postId: string): Promise<FeedReaction[]> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_feed_reactions')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Feed] Failed to get reactions:', error.message);
      return [];
    }

    return (data || []) as FeedReaction[];
  } catch (err) {
    console.error('[Feed] Error getting reactions:', err);
    return [];
  }
}

/**
 * Check if an agent has already reacted to a post
 * Used to skip redundant Claude calls
 */
export async function hasAgentReacted(postId: string, agent: string): Promise<boolean> {
  try {
    const { count, error } = await getSupabase()
      .from('agent_feed_reactions')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .eq('reactor', agent);

    if (error) {
      return false;
    }

    return (count || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if an agent has already replied to a post
 * Used to skip redundant Claude calls
 */
export async function hasAgentReplied(postId: string, agent: string): Promise<boolean> {
  try {
    const { count, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('*', { count: 'exact', head: true })
      .eq('reply_to_post_id', postId)
      .eq('author', agent);

    if (error) {
      return false;
    }

    return (count || 0) > 0;
  } catch {
    return false;
  }
}

// ============================================================
// Get Posts by Semantic Similarity
// ============================================================

export async function searchFeedByContent(
  query: string,
  options: { limit?: number; minSimilarity?: number } = {}
): Promise<Array<FeedPost & { similarity: number }>> {
  const { limit = 10, minSimilarity = 0.7 } = options;

  try {
    const queryEmbedding = await embed(query);
    const embeddingStr = formatForPgVector(queryEmbedding);

    // Use RPC for vector similarity search
    const { data, error } = await getSupabase().rpc('match_feed_posts', {
      query_embedding: embeddingStr,
      match_threshold: minSimilarity,
      match_count: limit,
    });

    if (error) {
      console.warn('[Feed] Semantic search failed:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[Feed] Error in semantic search:', err);
    return [];
  }
}

// ============================================================
// Get Trending Tags
// ============================================================

export async function getTrendingTags(sinceHoursAgo: number = 24): Promise<string[]> {
  const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('tags')
      .gte('created_at', since);

    if (error || !data) {
      return [];
    }

    // Count tag occurrences
    const tagCounts: Record<string, number> = {};
    for (const post of data) {
      for (const tag of post.tags || []) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    // Sort by count and return top tags
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);
  } catch (err) {
    console.error('[Feed] Error getting trending tags:', err);
    return [];
  }
}

// ============================================================
// Update Post Visibility
// ============================================================

export async function updatePostVisibility(
  postId: string,
  visibility: 'internal' | 'slack_eligible' | 'posted_to_slack'
): Promise<boolean> {
  try {
    const { error } = await getSupabase()
      .from('agent_feed_posts')
      .update({ visibility, updated_at: new Date().toISOString() })
      .eq('id', postId);

    if (error) {
      console.error('[Feed] Failed to update visibility:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Feed] Error updating visibility:', err);
    return false;
  }
}

// ============================================================
// Update Post Notion Page ID
// ============================================================

export async function updatePostNotionId(postId: string, notionPageId: string): Promise<boolean> {
  try {
    const { error } = await getSupabase()
      .from('agent_feed_posts')
      .update({ notion_page_id: notionPageId, updated_at: new Date().toISOString() })
      .eq('id', postId);

    if (error) {
      console.error('[Feed] Failed to update notion_page_id:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Feed] Error updating notion_page_id:', err);
    return false;
  }
}

// ============================================================
// Get Feed Stats
// ============================================================

export async function getFeedStats(sinceHoursAgo: number = 24): Promise<{
  totalPosts: number;
  byType: Record<FeedPostType, number>;
  byAgent: Record<string, number>;
  unansweredQuestions: number;
  avgEngagement: number;
}> {
  const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

  const emptyByType: Record<FeedPostType, number> = {
    observation: 0,
    question: 0,
    idea: 0,
    build: 0,
    challenge: 0,
    pattern: 0,
    prediction: 0,
  };

  try {
    const { data, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .gte('created_at', since);

    if (error || !data) {
      return {
        totalPosts: 0,
        byType: emptyByType,
        byAgent: {},
        unansweredQuestions: 0,
        avgEngagement: 0,
      };
    }

    const posts = data as FeedPost[];

    const byType = { ...emptyByType };
    const byAgent: Record<string, number> = {};
    let totalEngagement = 0;
    let unansweredQuestions = 0;

    for (const post of posts) {
      byType[post.post_type] = (byType[post.post_type] || 0) + 1;
      byAgent[post.author] = (byAgent[post.author] || 0) + 1;
      totalEngagement += post.upvotes + post.builds + post.challenges + post.reply_count;

      if (post.post_type === 'question' && post.reply_count === 0) {
        unansweredQuestions++;
      }
    }

    return {
      totalPosts: posts.length,
      byType,
      byAgent,
      unansweredQuestions,
      avgEngagement: posts.length > 0 ? totalEngagement / posts.length : 0,
    };
  } catch (err) {
    console.error('[Feed] Error getting stats:', err);
    return {
      totalPosts: 0,
      byType: emptyByType,
      byAgent: {},
      unansweredQuestions: 0,
      avgEngagement: 0,
    };
  }
}

// ============================================================
// Check Agent Rate Limit
// ============================================================

export async function checkAgentRateLimit(
  agent: LiveAgentName,
  maxPostsPerDay: number = 5,
  minHoursBetweenPosts: number = 2
): Promise<{ canPost: boolean; reason?: string }> {
  try {
    const recentPosts = await getFeedPosts({
      author: agent,
      sinceHoursAgo: 24,
      limit: maxPostsPerDay + 1,
    });

    if (recentPosts.length >= maxPostsPerDay) {
      return {
        canPost: false,
        reason: `Daily limit reached (${maxPostsPerDay} posts)`,
      };
    }

    // Check minimum time between posts
    if (recentPosts.length > 0) {
      const lastPost = new Date(recentPosts[0].created_at);
      const hoursSinceLast = (Date.now() - lastPost.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLast < minHoursBetweenPosts) {
        return {
          canPost: false,
          reason: `Posted ${hoursSinceLast.toFixed(1)}h ago, need ${minHoursBetweenPosts}h gap`,
        };
      }
    }

    return { canPost: true };
  } catch (err) {
    console.error('[Feed] Error checking rate limit:', err);
    // Allow posting if rate limit check fails
    return { canPost: true };
  }
}

// ============================================================
// Get High-Engagement Posts (for memory prioritization)
// ============================================================

export async function getHighEngagementPosts(
  options: {
    minEngagement?: number;
    minImportance?: number;
    sinceHoursAgo?: number;
    limit?: number;
  } = {}
): Promise<FeedPost[]> {
  const { minEngagement = 3, minImportance = 7, sinceHoursAgo = 48, limit = 20 } = options;

  try {
    const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .gte('created_at', since)
      .gte('importance', minImportance)
      .order('created_at', { ascending: false })
      .limit(limit * 2); // Get more, then filter

    if (error) {
      console.error('[Feed] Failed to get high-engagement posts:', error.message);
      return [];
    }

    // Filter by total engagement
    const filtered = (data || []).filter((post) => {
      const engagement = post.upvotes + post.builds + post.challenges;
      return engagement >= minEngagement;
    });

    return filtered.slice(0, limit) as FeedPost[];
  } catch (err) {
    console.error('[Feed] Error getting high-engagement posts:', err);
    return [];
  }
}

// ============================================================
// Get Questions with Curious Reactions (for routing)
// ============================================================

export async function getQuestionsWithCuriousReactions(
  options: {
    minCurious?: number;
    sinceHoursAgo?: number;
    limit?: number;
  } = {}
): Promise<Array<FeedPost & { curious_agents: string[] }>> {
  const { minCurious = 1, sinceHoursAgo = 48, limit = 10 } = options;

  try {
    const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

    // Get questions
    const { data: questions, error: qError } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .eq('post_type', 'question')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit * 2);

    if (qError || !questions) {
      console.error('[Feed] Failed to get questions:', qError?.message);
      return [];
    }

    // Get curious reactions for each question
    const results: Array<FeedPost & { curious_agents: string[] }> = [];

    for (const question of questions) {
      const { data: reactions } = await getSupabase()
        .from('agent_feed_reactions')
        .select('reactor')
        .eq('post_id', question.id)
        .eq('reaction_type', 'curious');

      const curiousAgents = (reactions || []).map((r) => r.reactor);

      if (curiousAgents.length >= minCurious) {
        results.push({ ...question, curious_agents: curiousAgents } as FeedPost & {
          curious_agents: string[];
        });
      }

      if (results.length >= limit) break;
    }

    return results;
  } catch (err) {
    console.error('[Feed] Error getting curious questions:', err);
    return [];
  }
}

// ============================================================
// Get Posts Agent Was Curious About (for context)
// ============================================================

export async function getPostsAgentWasCuriousAbout(
  agent: string,
  options: { sinceHoursAgo?: number; limit?: number } = {}
): Promise<FeedPost[]> {
  const { sinceHoursAgo = 48, limit = 10 } = options;

  try {
    const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

    // Get reactions by this agent
    const { data: reactions, error: rError } = await getSupabase()
      .from('agent_feed_reactions')
      .select('post_id')
      .eq('reactor', agent)
      .eq('reaction_type', 'curious')
      .gte('created_at', since);

    if (rError || !reactions || reactions.length === 0) {
      return [];
    }

    const postIds = reactions.map((r) => r.post_id);

    // Get the actual posts
    const { data: posts, error: pError } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .in('id', postIds)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (pError) {
      console.error('[Feed] Failed to get curious posts:', pError.message);
      return [];
    }

    return (posts || []) as FeedPost[];
  } catch (err) {
    console.error('[Feed] Error getting curious posts:', err);
    return [];
  }
}

// ============================================================
// Get Thread Chain (for build development)
// ============================================================

export async function getThreadChain(postId: string): Promise<FeedPost[]> {
  try {
    const chain: FeedPost[] = [];
    const visited = new Set<string>();

    // Get the initial post
    const { data: post, error } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .eq('id', postId)
      .single();

    if (error || !post) return [];

    // Walk up the chain (parents)
    let current = post as FeedPost;
    while (current.reply_to_post_id && !visited.has(current.reply_to_post_id)) {
      visited.add(current.id);

      const { data: parent } = await getSupabase()
        .from('agent_feed_posts')
        .select('*')
        .eq('id', current.reply_to_post_id)
        .single();

      if (parent) {
        chain.unshift(parent as FeedPost);
        current = parent as FeedPost;
      } else {
        break;
      }
    }

    // Add the original post
    chain.push(post as FeedPost);
    visited.add(post.id);

    // Get all replies (children)
    const { data: replies } = await getSupabase()
      .from('agent_feed_posts')
      .select('*')
      .eq('reply_to_post_id', postId)
      .order('created_at', { ascending: true });

    if (replies) {
      chain.push(...(replies as FeedPost[]));
    }

    return chain;
  } catch (err) {
    console.error('[Feed] Error getting thread chain:', err);
    return [];
  }
}
