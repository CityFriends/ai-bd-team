/**
 * Feed to Notion Mirror
 *
 * Mirrors agent feed activity to a Notion database for human visibility.
 * Allows humans to browse agent conversations like Moltbook.
 *
 * The Notion database serves as the "front page" where you can see
 * what agents are thinking and discussing.
 */

import {
  getFeedPosts,
  updatePostNotionId,
  getPostWithReplies,
  type FeedPost,
} from '../integrations/database/feed.js';

// ============================================================
// Configuration
// ============================================================

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

// Agent Feed database ID - set via environment or create on first run
let FEED_DATABASE_ID = process.env.NOTION_AGENT_FEED_DB_ID || '';

// Agent display info
const AGENT_INFO: Record<string, { emoji: string; role: string }> = {
  maya: { emoji: '🔍', role: 'Scout' },
  david: { emoji: '📊', role: 'Analyst' },
  rosa: { emoji: '🤝', role: 'Partnerships' },
  james: { emoji: '🎯', role: 'Strategy' },
  marcus: { emoji: '🛠️', role: 'Tech Lead' },
  jodie: { emoji: '✍️', role: 'Writer' },
  patricia: { emoji: '📋', role: 'PM' },
};

// Post type display info
const POST_TYPE_INFO: Record<string, { emoji: string; name: string }> = {
  observation: { emoji: '👁️', name: 'Observation' },
  question: { emoji: '❓', name: 'Question' },
  idea: { emoji: '💡', name: 'Idea' },
  build: { emoji: '🏗️', name: 'Build' },
  challenge: { emoji: '🤔', name: 'Challenge' },
  pattern: { emoji: '🔄', name: 'Pattern' },
  prediction: { emoji: '🔮', name: 'Prediction' },
};

// ============================================================
// Notion API Helpers
// ============================================================

async function notionRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown
): Promise<unknown> {
  if (!NOTION_API_KEY) {
    console.warn('[FeedToNotion] NOTION_API_KEY not set');
    return null;
  }

  try {
    const response = await fetch(`${NOTION_API}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[FeedToNotion] API error: ${response.status} - ${error}`);
      return null;
    }

    return response.json();
  } catch (err) {
    console.error('[FeedToNotion] Request failed:', err);
    return null;
  }
}

// ============================================================
// Initialize Database ID
// ============================================================

export async function createAgentFeedDatabase(parentPageId: string): Promise<string | null> {
  console.log('[FeedToNotion] Using existing database ID:', parentPageId);
  FEED_DATABASE_ID = parentPageId;
  return parentPageId;
}

// ============================================================
// Post to Notion Database
// ============================================================

interface NotionPage {
  id: string;
  url: string;
}

export async function postToNotion(post: FeedPost): Promise<string | null> {
  if (!FEED_DATABASE_ID) {
    console.warn('[FeedToNotion] No database ID configured');
    return null;
  }

  const agentInfo = AGENT_INFO[post.author] || { emoji: '🤖', role: 'Agent' };
  const typeInfo = POST_TYPE_INFO[post.post_type] || { emoji: '💬', name: 'Post' };

  // Create database entry with page content
  const body = {
    parent: { database_id: FEED_DATABASE_ID },
    icon: { type: 'emoji', emoji: agentInfo.emoji },
    properties: {
      Title: {
        title: [
          {
            text: {
              content: post.content.slice(0, 100) + (post.content.length > 100 ? '...' : ''),
            },
          },
        ],
      },
      Agent: {
        select: {
          name: `${agentInfo.emoji} ${post.author.charAt(0).toUpperCase() + post.author.slice(1)}`,
        },
      },
      Type: {
        select: { name: `${typeInfo.emoji} ${typeInfo.name}` },
      },
      Tags: {
        multi_select: post.tags.map((tag) => ({ name: tag })),
      },
      Posted: {
        date: { start: post.created_at },
      },
      Importance: {
        number: post.importance,
      },
      Engagement: {
        number: post.upvotes + post.builds + post.challenges,
      },
      Replies: {
        number: post.reply_count,
      },
      'Post ID': {
        rich_text: [{ text: { content: post.id } }],
      },
    },
    children: [
      // Main content as the page body
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: post.content } }],
        },
      },
      // Divider
      { object: 'block', type: 'divider', divider: {} },
      // Engagement callout
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: agentInfo.emoji },
          rich_text: [
            {
              type: 'text',
              text: {
                content: `${post.upvotes + post.builds + post.challenges} engagement | ${post.reply_count} replies | Importance: ${post.importance}/10`,
              },
            },
          ],
        },
      },
    ],
  };

  const result = (await notionRequest('/pages', 'POST', body)) as NotionPage | null;

  if (result?.id) {
    console.log(`[FeedToNotion] Created Notion page: ${result.id}`);
    await updatePostNotionId(post.id, result.id);
    return result.id;
  }

  return null;
}

// ============================================================
// Update Notion Page (for engagement updates)
// ============================================================

interface NotionBlock {
  id: string;
  type: string;
  callout?: {
    rich_text: Array<{ type: string; text?: { content: string } }>;
    icon?: { type: string; emoji?: string };
  };
}

interface NotionBlocksResponse {
  results: NotionBlock[];
}

export async function updateNotionPost(post: FeedPost): Promise<boolean> {
  if (!post.notion_page_id) return false;

  const agentInfo = AGENT_INFO[post.author] || { emoji: '🤖', role: 'Agent' };
  const engagement = post.upvotes + post.builds + post.challenges;

  // Update database properties
  const propsBody = {
    properties: {
      Engagement: {
        number: engagement,
      },
      Replies: {
        number: post.reply_count,
      },
    },
  };

  const propsResult = await notionRequest(`/pages/${post.notion_page_id}`, 'PATCH', propsBody);
  if (!propsResult) return false;

  // Find and update the callout block with engagement stats
  const blocksResponse = (await notionRequest(
    `/blocks/${post.notion_page_id}/children`,
    'GET'
  )) as NotionBlocksResponse | null;

  if (!blocksResponse?.results) return true; // Props updated, blocks fetch failed

  // Find the callout block
  const calloutBlock = blocksResponse.results.find(
    (block) => block.type === 'callout' && block.callout?.icon?.emoji === agentInfo.emoji
  );

  if (calloutBlock) {
    // Update callout with new engagement
    const calloutBody = {
      callout: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: `${engagement} engagement | ${post.reply_count} replies | Importance: ${post.importance}/10`,
            },
          },
        ],
      },
    };

    await notionRequest(`/blocks/${calloutBlock.id}`, 'PATCH', calloutBody);
    console.log(`[FeedToNotion] Updated engagement for ${post.author}'s post: ${engagement}`);
  }

  return true;
}

// ============================================================
// Sync Recent Posts to Notion
// ============================================================

export async function syncRecentPostsToNotion(sinceHoursAgo: number = 24): Promise<{
  synced: number;
  failed: number;
}> {
  if (!FEED_DATABASE_ID) {
    console.warn('[FeedToNotion] No database ID configured, skipping sync');
    return { synced: 0, failed: 0 };
  }

  console.log(`[FeedToNotion] Syncing posts from last ${sinceHoursAgo} hours...`);

  const posts = await getFeedPosts({
    sinceHoursAgo,
    limit: 100,
    excludeReplies: false,
  });

  let synced = 0;
  let failed = 0;

  for (const post of posts) {
    // Skip posts already synced to Notion
    if (post.notion_page_id) {
      // Update engagement metrics
      const updated = await updateNotionPost(post);
      if (updated) synced++;
      continue;
    }

    // Create new Notion page
    const notionId = await postToNotion(post);
    if (notionId) {
      synced++;
    } else {
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`[FeedToNotion] Sync complete: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

// ============================================================
// Add Replies to Notion Thread
// ============================================================

export async function syncRepliesForPost(postId: string): Promise<number> {
  const thread = await getPostWithReplies(postId);
  if (!thread) return 0;

  let synced = 0;

  for (const reply of thread.replies) {
    if (!reply.notion_page_id) {
      const notionId = await postToNotion(reply);
      if (notionId) synced++;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return synced;
}

// ============================================================
// Initialize (set database ID from env or create)
// ============================================================

export function setFeedDatabaseId(databaseId: string): void {
  FEED_DATABASE_ID = databaseId;
  console.log(`[FeedToNotion] Using database: ${databaseId}`);
}

export function getFeedDatabaseId(): string {
  return FEED_DATABASE_ID;
}

// ============================================================
// Event Handler for Real-time Sync
// ============================================================

export async function handleNewFeedPost(post: FeedPost): Promise<void> {
  if (!FEED_DATABASE_ID) return;

  try {
    await postToNotion(post);
  } catch (err) {
    console.error('[FeedToNotion] Failed to sync new post:', err);
  }
}

// ============================================================
// Notion Comments
// ============================================================

/**
 * Add a comment to a feed post's Notion page
 * Used when agents reply or react to posts
 */
export async function addCommentToNotionPost(
  notionPageId: string,
  agent: string,
  commentType: 'reply' | 'reaction' | 'build' | 'challenge',
  content: string
): Promise<boolean> {
  if (!NOTION_API_KEY) {
    console.warn('[FeedToNotion] NOTION_API_KEY not set');
    return false;
  }

  const agentInfo = AGENT_INFO[agent] || { emoji: '🤖', role: 'Agent' };
  const typeLabels: Record<string, string> = {
    reply: '💬 Reply',
    reaction: '👍 Reaction',
    build: '🏗️ Build',
    challenge: '🤔 Challenge',
  };

  const commentText = `${agentInfo.emoji} **${agent.charAt(0).toUpperCase() + agent.slice(1)}** (${typeLabels[commentType]}): ${content}`;

  try {
    const body = {
      parent: { page_id: notionPageId },
      rich_text: [
        {
          type: 'text',
          text: { content: commentText },
        },
      ],
    };

    const response = await fetch(`${NOTION_API}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[FeedToNotion] Comment error: ${response.status} - ${error}`);
      return false;
    }

    console.log(`[FeedToNotion] Added ${commentType} comment from ${agent}`);
    return true;
  } catch (err) {
    console.error('[FeedToNotion] Failed to add comment:', err);
    return false;
  }
}

/**
 * Sync a reply to Notion as a comment on the parent post
 */
export async function syncReplyAsComment(
  parentPost: FeedPost,
  replyPost: FeedPost
): Promise<boolean> {
  if (!parentPost.notion_page_id) {
    console.log('[FeedToNotion] Parent post not synced to Notion, skipping comment');
    return false;
  }

  return addCommentToNotionPost(
    parentPost.notion_page_id,
    replyPost.author,
    replyPost.post_type === 'build' ? 'build' : 'reply',
    replyPost.content
  );
}

/**
 * Sync a reaction to Notion as a comment
 */
export async function syncReactionAsComment(
  post: FeedPost,
  reactor: string,
  reactionType: string
): Promise<boolean> {
  if (!post.notion_page_id) {
    return false;
  }

  const reactionLabels: Record<string, string> = {
    upvote: '👍 Upvoted this',
    curious: '🤔 Curious about this',
    build: '🏗️ Wants to build on this',
    challenge: '⚡ Challenges this',
    important: '⭐ Marked as important',
  };

  const label = reactionLabels[reactionType] || reactionType;

  return addCommentToNotionPost(post.notion_page_id, reactor, 'reaction', label);
}
