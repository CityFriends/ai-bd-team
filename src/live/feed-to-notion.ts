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

export async function updateNotionPost(post: FeedPost): Promise<boolean> {
  if (!post.notion_page_id) return false;

  const body = {
    properties: {
      Engagement: {
        number: post.upvotes + post.builds + post.challenges,
      },
      Replies: {
        number: post.reply_count,
      },
    },
  };

  const result = await notionRequest(`/pages/${post.notion_page_id}`, 'PATCH', body);
  return result !== null;
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
