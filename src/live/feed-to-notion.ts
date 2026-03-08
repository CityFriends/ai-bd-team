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
  getFeedPost,
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

// Post type emojis
const POST_TYPE_EMOJI: Record<string, string> = {
  observation: '👁️',
  question: '❓',
  idea: '💡',
  build: '🏗️',
  challenge: '🤔',
  pattern: '🔄',
  prediction: '🔮',
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
// Create Agent Feed Database
// ============================================================

interface CreateDatabaseResult {
  id: string;
}

export async function createAgentFeedDatabase(parentPageId: string): Promise<string | null> {
  console.log('[FeedToNotion] Creating Agent Feed database...');

  const body = {
    parent: { page_id: parentPageId },
    title: [{ text: { content: 'Agent Feed' } }],
    icon: { type: 'emoji', emoji: '🤖' },
    properties: {
      // Title/Content preview
      Title: { title: {} },

      // Agent who posted
      Agent: {
        select: {
          options: Object.entries(AGENT_INFO).map(([name, info]) => ({
            name: `${info.emoji} ${name.charAt(0).toUpperCase() + name.slice(1)}`,
            color: 'default',
          })),
        },
      },

      // Post type
      Type: {
        select: {
          options: Object.entries(POST_TYPE_EMOJI).map(([type, emoji]) => ({
            name: `${emoji} ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            color: 'default',
          })),
        },
      },

      // Tags
      Tags: { multi_select: { options: [] } },

      // Engagement metrics
      Engagement: { number: { format: 'number' } },

      // Replies count
      Replies: { number: { format: 'number' } },

      // Importance (1-10)
      Importance: { number: { format: 'number' } },

      // Is this a reply to another post?
      'Reply To': { url: {} },

      // Timestamp
      Posted: { date: {} },

      // Database post ID (for linking)
      'Post ID': { rich_text: {} },
    },
  };

  const result = (await notionRequest('/databases', 'POST', body)) as CreateDatabaseResult | null;

  if (result?.id) {
    console.log(`[FeedToNotion] Created database: ${result.id}`);
    FEED_DATABASE_ID = result.id;
    return result.id;
  }

  return null;
}

// ============================================================
// Post to Notion
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
  const typeEmoji = POST_TYPE_EMOJI[post.post_type] || '💬';
  const engagement = post.upvotes + post.builds + post.challenges;

  // Create a title from the first 50 chars of content
  const titlePreview = post.content.slice(0, 50) + (post.content.length > 50 ? '...' : '');

  const body = {
    parent: { database_id: FEED_DATABASE_ID },
    icon: { type: 'emoji', emoji: agentInfo.emoji },
    properties: {
      Title: {
        title: [{ text: { content: titlePreview } }],
      },
      Agent: {
        select: {
          name: `${agentInfo.emoji} ${post.author.charAt(0).toUpperCase() + post.author.slice(1)}`,
        },
      },
      Type: {
        select: {
          name: `${typeEmoji} ${post.post_type.charAt(0).toUpperCase() + post.post_type.slice(1)}`,
        },
      },
      Tags: {
        multi_select: post.tags.slice(0, 10).map((tag) => ({ name: tag })),
      },
      Engagement: { number: engagement },
      Replies: { number: post.reply_count },
      Importance: { number: post.importance },
      Posted: { date: { start: post.created_at } },
      'Post ID': { rich_text: [{ text: { content: post.id } }] },
    },
    children: [
      // Full content as a paragraph block
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: post.content } }],
        },
      },
      // Divider
      { object: 'block', type: 'divider', divider: {} },
      // Metadata callout
      {
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: '📊' },
          rich_text: [
            {
              type: 'text',
              text: {
                content: `${engagement} engagement | ${post.reply_count} replies | Importance: ${post.importance}/10`,
              },
            },
          ],
        },
      },
    ],
  };

  // Add reply link if this is a reply
  if (post.reply_to_post_id) {
    const parentPost = await getFeedPost(post.reply_to_post_id);
    if (parentPost?.notion_page_id) {
      (body.properties as Record<string, unknown>)['Reply To'] = {
        url: `https://notion.so/${parentPost.notion_page_id.replace(/-/g, '')}`,
      };
    }
  }

  const result = (await notionRequest('/pages', 'POST', body)) as NotionPage | null;

  if (result?.id) {
    console.log(`[FeedToNotion] Created Notion page: ${result.id}`);

    // Update the database record with the Notion page ID
    await updatePostNotionId(post.id, result.id);

    return result.id;
  }

  return null;
}

// ============================================================
// Update Notion Page (for engagement updates)
// ============================================================

export async function updateNotionPost(post: FeedPost): Promise<boolean> {
  if (!post.notion_page_id) {
    return false;
  }

  const engagement = post.upvotes + post.builds + post.challenges;

  const body = {
    properties: {
      Engagement: { number: engagement },
      Replies: { number: post.reply_count },
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
