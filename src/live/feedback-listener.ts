// Feedback Learning Loop
// Tracks reactions and follow-up patterns to understand response quality

import { App } from '@slack/bolt';
import { recordAgentFeedback, getAgentFeedbackStats } from '../integrations/supabase.js';
import { embed, cosineSimilarity } from '../integrations/embeddings.js';

// Positive reactions
const POSITIVE_REACTIONS = ['+1', 'thumbsup', 'heart', 'fire', '100', 'raised_hands', 'clap', 'tada', 'white_check_mark', 'heavy_check_mark'];

// Negative reactions
const NEGATIVE_REACTIONS = ['-1', 'thumbsdown', 'confused', 'thinking_face', 'x', 'no_entry', 'warning'];

// Map of agent Slack user IDs to agent names
const AGENT_USER_IDS: Record<string, string> = {
  'U0AC3RA4JVB': 'maya',
  'U0AC0SVD3MH': 'david',
  'U0ACASZ36BW': 'rosa',
  'U0AC582GXBQ': 'james',
  'U0AC79NTDAN': 'patricia',
  'U0ACP8LKFB3': 'jodie',
};

// Track recent agent responses for correlation
interface RecentResponse {
  messageTs: string;
  threadTs?: string;
  agent: string;
  responseText: string;
  originalQuestion?: string;
  timestamp: number;
}

const recentResponses: Map<string, RecentResponse> = new Map();
const RESPONSE_TRACKING_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Register a recent agent response for feedback tracking
 */
export function trackAgentResponse(
  messageTs: string,
  agent: string,
  responseText: string,
  originalQuestion?: string,
  threadTs?: string
): void {
  recentResponses.set(messageTs, {
    messageTs,
    threadTs,
    agent,
    responseText,
    originalQuestion,
    timestamp: Date.now(),
  });

  // Clean up old entries
  const cutoff = Date.now() - RESPONSE_TRACKING_TTL_MS;
  for (const [ts, response] of recentResponses.entries()) {
    if (response.timestamp < cutoff) {
      recentResponses.delete(ts);
    }
  }
}

/**
 * Set up feedback listeners on a Slack app
 */
export function setupFeedbackListeners(app: App): void {
  // Listen for reactions being added to messages
  app.event('reaction_added', async ({ event }) => {
    try {
      const reaction = event.reaction;
      const messageTs = event.item.ts;
      const threadTs = (event.item as any).thread_ts;

      // Find the agent response this reaction is on
      const trackedResponse = recentResponses.get(messageTs);
      if (!trackedResponse) {
        // Not an agent response we're tracking
        return;
      }

      // Determine feedback type
      let feedbackType: 'reaction_positive' | 'reaction_negative';
      if (POSITIVE_REACTIONS.includes(reaction)) {
        feedbackType = 'reaction_positive';
        console.log(`Positive reaction (:${reaction}:) on ${trackedResponse.agent}'s response`);
      } else if (NEGATIVE_REACTIONS.includes(reaction)) {
        feedbackType = 'reaction_negative';
        console.log(`Negative reaction (:${reaction}:) on ${trackedResponse.agent}'s response`);
      } else {
        // Neutral reaction, ignore
        return;
      }

      // Record the feedback
      await recordAgentFeedback({
        agent: trackedResponse.agent,
        message_ts: messageTs,
        thread_ts: threadTs,
        feedback_type: feedbackType,
        reaction_emoji: reaction,
        original_response: trackedResponse.responseText.slice(0, 500), // Truncate for storage
      });
    } catch (err) {
      console.warn('Error processing reaction feedback:', err);
    }
  });

  // Listen for reactions being removed (could indicate changed mind)
  app.event('reaction_removed', async ({ event }) => {
    // For now, we just log this but don't undo the feedback
    // Could be enhanced to track sentiment changes
    console.log(`Reaction removed: :${event.reaction}: from message ${event.item.ts}`);
  });
}

/**
 * Detect if a follow-up message is a rephrased question (frustration signal)
 * Returns similarity score if it looks like a rephrase, null otherwise
 */
export async function detectRephrasedQuestion(
  newMessage: string,
  threadTs: string
): Promise<{ isRephrase: boolean; similarity: number; originalQuestion?: string } | null> {
  try {
    // Find recent agent responses in this thread
    const threadResponses = Array.from(recentResponses.values())
      .filter(r => r.threadTs === threadTs)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (threadResponses.length === 0 || !threadResponses[0].originalQuestion) {
      return null;
    }

    const lastResponse = threadResponses[0];
    const originalQuestion = lastResponse.originalQuestion as string; // Already checked above

    // Skip if the new message is very short (like "yes" or "ok")
    if (newMessage.length < 20) {
      return null;
    }

    // Compute semantic similarity between original question and new message
    const [newEmbedding, originalEmbedding] = await Promise.all([
      embed(newMessage),
      embed(originalQuestion),
    ]);

    const similarity = cosineSimilarity(newEmbedding, originalEmbedding);

    // High similarity (0.85+) suggests the user is rephrasing their question
    // This could indicate the agent's response wasn't helpful
    const isRephrase = similarity > 0.85;

    if (isRephrase) {
      console.log(`Detected rephrased question (similarity: ${similarity.toFixed(3)})`);
      console.log(`  Original: "${originalQuestion.slice(0, 50)}..."`);
      console.log(`  New: "${newMessage.slice(0, 50)}..."`);

      // Record this as frustration feedback
      await recordAgentFeedback({
        agent: lastResponse.agent,
        message_ts: lastResponse.messageTs,
        thread_ts: threadTs,
        feedback_type: 'rephrased_question',
        original_response: lastResponse.responseText.slice(0, 500),
        user_follow_up: newMessage.slice(0, 500),
        similarity_score: similarity,
      });
    }

    return {
      isRephrase,
      similarity,
      originalQuestion,
    };
  } catch (err) {
    console.warn('Error detecting rephrased question:', err);
    return null;
  }
}

/**
 * Get feedback summary for an agent
 */
export async function getAgentFeedbackSummary(
  agentName: string,
  daysBack: number = 7
): Promise<{
  positiveReactions: number;
  negativeReactions: number;
  rephrasedQuestions: number;
  feedbackScore: number; // 0-100 score based on positive/negative ratio
}> {
  const stats = await getAgentFeedbackStats(agentName, daysBack);

  // Calculate a simple feedback score
  const totalReactions = stats.positiveReactions + stats.negativeReactions;
  let feedbackScore = 50; // Default neutral score

  if (totalReactions > 0) {
    feedbackScore = Math.round((stats.positiveReactions / totalReactions) * 100);
  }

  // Penalize for rephrased questions (indicates unhelpful responses)
  if (stats.rephrasedQuestions > 0) {
    feedbackScore = Math.max(0, feedbackScore - (stats.rephrasedQuestions * 5));
  }

  return {
    ...stats,
    feedbackScore,
  };
}

/**
 * Format feedback summary for display
 */
export function formatFeedbackSummary(
  summary: Awaited<ReturnType<typeof getAgentFeedbackSummary>>
): string {
  const emoji = summary.feedbackScore >= 70 ? '🟢' :
                summary.feedbackScore >= 40 ? '🟡' : '🔴';

  return `${emoji} Feedback Score: ${summary.feedbackScore}/100
  👍 Positive: ${summary.positiveReactions}
  👎 Negative: ${summary.negativeReactions}
  🔄 Rephrased questions: ${summary.rephrasedQuestions}`;
}
