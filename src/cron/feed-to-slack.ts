/**
 * Feed to Slack - Surface High-Engagement Posts
 *
 * Monitors the agent feed for posts that have gained significant traction
 * and surfaces them to Slack for human visibility.
 *
 * Criteria for surfacing:
 * - Importance >= 8 AND engagement >= 3
 * - OR 2+ agents built on the idea
 * - OR question with 3+ curious reactions
 */

import 'dotenv/config';
import { getFeedPosts, type FeedPost } from '../integrations/database/feed.js';
import { getReactionsForPost } from '../integrations/database/feed.js';
import { postAsAgent } from '../integrations/slack.js';
import { createClient } from '@supabase/supabase-js';
import type { AgentName } from '../types/index.js';

// ============================================================
// Configuration
// ============================================================

const SLACK_CHANNEL = process.env.SLACK_CHANNEL_ID || '';
const ENGAGEMENT_THRESHOLD = 3;
const IMPORTANCE_THRESHOLD = 8;
const BUILD_THRESHOLD = 2;
const CURIOUS_THRESHOLD = 3;

// Agent display info for formatting
const AGENT_INFO: Record<string, { emoji: string; title: string }> = {
  maya: { emoji: ':mag:', title: 'Scout' },
  david: { emoji: ':bar_chart:', title: 'Analyst' },
  rosa: { emoji: ':handshake:', title: 'Partnerships' },
  james: { emoji: ':dart:', title: 'Strategy' },
  marcus: { emoji: ':hammer_and_wrench:', title: 'Tech Lead' },
  jodie: { emoji: ':writing_hand:', title: 'Writer' },
  patricia: { emoji: ':clipboard:', title: 'PM' },
};

const POST_TYPE_EMOJI: Record<string, string> = {
  observation: ':eyes:',
  question: ':question:',
  idea: ':bulb:',
  build: ':building_construction:',
  challenge: ':thinking_face:',
  pattern: ':arrows_counterclockwise:',
  prediction: ':crystal_ball:',
};

// Map feed agent names to Slack agent roles
const AGENT_TO_SLACK_ROLE: Record<string, AgentName> = {
  maya: 'scout',
  david: 'analyst',
  rosa: 'connector',
  james: 'strategist',
  marcus: 'engineer',
  patricia: 'pm',
  jodie: 'writer',
};

// ============================================================
// Database Helpers
// ============================================================

function getSupabase() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
}

async function getHighEngagementPosts(sinceHoursAgo: number = 24): Promise<FeedPost[]> {
  const posts = await getFeedPosts({
    sinceHoursAgo,
    limit: 50,
    excludeReplies: true,
  });

  const eligiblePosts: FeedPost[] = [];

  for (const post of posts) {
    // Skip already posted to Slack
    if (post.visibility === 'posted_to_slack' || post.slack_thread_ts) {
      continue;
    }

    const engagement = post.upvotes + post.builds + post.challenges;

    // Check criteria
    const highImportanceAndEngagement =
      post.importance >= IMPORTANCE_THRESHOLD && engagement >= ENGAGEMENT_THRESHOLD;

    const multipleBuilds = post.builds >= BUILD_THRESHOLD;

    // For questions, check curious reactions
    let hasCuriousInterest = false;
    if (post.post_type === 'question') {
      const reactions = await getReactionsForPost(post.id);
      const curiousCount = reactions.filter((r) => r.reaction_type === 'curious').length;
      hasCuriousInterest = curiousCount >= CURIOUS_THRESHOLD;
    }

    if (highImportanceAndEngagement || multipleBuilds || hasCuriousInterest) {
      eligiblePosts.push(post);
    }
  }

  return eligiblePosts;
}

async function markAsPostedToSlack(postId: string, threadTs: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from('agent_feed_posts')
    .update({
      visibility: 'posted_to_slack',
      slack_thread_ts: threadTs,
    })
    .eq('id', postId);
}

// ============================================================
// Slack Formatting
// ============================================================

function formatPostForSlack(post: FeedPost): string {
  const agentInfo = AGENT_INFO[post.author] || { emoji: ':robot_face:', title: 'Agent' };
  const typeEmoji = POST_TYPE_EMOJI[post.post_type] || ':speech_balloon:';
  const engagement = post.upvotes + post.builds + post.challenges;

  const lines = [
    `${agentInfo.emoji} *${post.author.charAt(0).toUpperCase() + post.author.slice(1)}* (${agentInfo.title}) shared a ${typeEmoji} ${post.post_type}:`,
    '',
    `> ${post.content}`,
    '',
    `:chart_with_upwards_trend: ${engagement} engagement | :speech_balloon: ${post.reply_count} replies | :star: Importance: ${post.importance}/10`,
  ];

  if (post.tags.length > 0) {
    lines.push(`:label: ${post.tags.map((t) => `\`${t}\``).join(' ')}`);
  }

  return lines.join('\n');
}

// ============================================================
// Main Surface Function
// ============================================================

export async function surfaceHighEngagementPosts(): Promise<{
  surfaced: number;
  posts: Array<{ author: string; postType: string; engagement: number }>;
}> {
  if (!SLACK_CHANNEL) {
    console.log('[FeedToSlack] No Slack channel configured, skipping');
    return { surfaced: 0, posts: [] };
  }

  console.log('[FeedToSlack] Checking for high-engagement posts...');

  const eligiblePosts = await getHighEngagementPosts(24);

  if (eligiblePosts.length === 0) {
    console.log('[FeedToSlack] No posts meet surfacing criteria');
    return { surfaced: 0, posts: [] };
  }

  console.log(`[FeedToSlack] Found ${eligiblePosts.length} posts to surface`);

  const results: Array<{ author: string; postType: string; engagement: number }> = [];

  for (const post of eligiblePosts) {
    try {
      const message = formatPostForSlack(post);
      const engagement = post.upvotes + post.builds + post.challenges;

      // Post as the agent who wrote it (map to Slack role)
      const slackRole = AGENT_TO_SLACK_ROLE[post.author] || 'scout';
      const response = await postAsAgent(slackRole, message);

      if (response?.ts) {
        await markAsPostedToSlack(post.id, response.ts);
        console.log(`[FeedToSlack] Surfaced ${post.author}'s ${post.post_type} to Slack`);
        results.push({ author: post.author, postType: post.post_type, engagement });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      // Don't crash on Slack errors - just log and continue
      if (errorMsg.includes('account_inactive') || errorMsg.includes('invalid_auth')) {
        console.log(`[FeedToSlack] Slack not configured or inactive, skipping surface`);
        return { surfaced: 0, posts: [] };
      }
      console.error(`[FeedToSlack] Failed to surface post ${post.id}:`, errorMsg);
    }
  }

  console.log(`[FeedToSlack] Surfaced ${results.length} posts to Slack`);
  return { surfaced: results.length, posts: results };
}

// ============================================================
// Direct Execution
// ============================================================

if (process.argv[1]?.includes('feed-to-slack')) {
  console.log('[FeedToSlack] Running manually...');
  surfaceHighEngagementPosts()
    .then((result) => {
      console.log(`[FeedToSlack] Done. Surfaced ${result.surfaced} posts.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[FeedToSlack] Failed:', err);
      process.exit(1);
    });
}
