/**
 * Feed Synthesis Cron
 *
 * Monitors the agent feed for discussions that have reached actionable
 * thresholds and synthesizes them into concrete deliverables.
 *
 * Trigger Points:
 * - 3+ agents engaged on opportunity discussion → Go/No-Go Memo
 * - Question answered with consensus → Research Brief
 * - Rosa identifies 2+ potential partners → Partner Shortlist
 * - Technical discussion reaches conclusion → Tech Assessment
 * - High-engagement insight (importance 8+) → Executive Insight
 *
 * Schedule: Every 2 hours during business hours
 */

import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/database/cron.js';
import {
  getFeedPosts,
  getReactionsForPost,
  getThreadChain,
  type FeedPost,
} from '../integrations/database/feed.js';
import {
  createDeliverable,
  isDiscussionSynthesized,
  markDiscussionSynthesized,
  formatDeliverableForSlack,
  type DeliverableType,
} from '../integrations/database/deliverables.js';
import { getAnthropic, MODEL_SONNET } from '../integrations/claude.js';
import { trackCost } from '../lib/cost-tracker.js';
import { postAsAgent } from '../integrations/slack.js';
import type { AgentName } from '../types/index.js';

// ============================================================
// Types
// ============================================================

interface SynthesisCandidate {
  rootPost: FeedPost;
  thread: FeedPost[];
  reactions: Array<{ reactor: string; reaction_type: string }>;
  engagedAgents: string[];
  deliverableType: DeliverableType;
  ownerAgent: string;
}

// ============================================================
// Candidate Detection
// ============================================================

async function findSynthesisCandidates(): Promise<SynthesisCandidate[]> {
  const candidates: SynthesisCandidate[] = [];

  // Get recent posts that haven't been synthesized
  const recentPosts = await getFeedPosts({
    sinceHoursAgo: 48,
    limit: 50,
    excludeReplies: true,
  });

  for (const post of recentPosts) {
    // Skip if already synthesized
    if (await isDiscussionSynthesized(post.id)) {
      continue;
    }

    // Get thread and reactions
    const thread = await getThreadChain(post.id);
    const reactions = await getReactionsForPost(post.id);

    // Calculate engaged agents (unique agents who reacted or replied)
    const engagedAgents = new Set<string>();
    engagedAgents.add(post.author);
    for (const reply of thread) {
      engagedAgents.add(reply.author);
    }
    for (const reaction of reactions) {
      engagedAgents.add(reaction.reactor);
    }

    const engagement = post.upvotes + post.builds + post.challenges;
    const replyCount = thread.length - 1; // Exclude root post

    // Check for synthesis triggers
    let deliverableType: DeliverableType | null = null;
    let ownerAgent = 'patricia';

    // Trigger 1: 3+ agents engaged on opportunity-related discussion
    if (
      engagedAgents.size >= 3 &&
      (post.tags.includes('opportunity') ||
        post.tags.includes('pipeline') ||
        post.related_opportunity_id)
    ) {
      deliverableType = 'go_no_go_memo';
      ownerAgent = 'james';
    }

    // Trigger 2: Question answered with multiple replies
    if (post.post_type === 'question' && replyCount >= 2) {
      deliverableType = 'research_brief';
      ownerAgent = 'david';
    }

    // Trigger 3: Partner-related discussion with builds
    if (
      (post.tags.includes('partner') || post.tags.includes('teaming') || post.author === 'rosa') &&
      post.builds >= 2
    ) {
      deliverableType = 'partner_shortlist';
      ownerAgent = 'rosa';
    }

    // Trigger 4: Technical discussion with consensus
    if (
      (post.tags.includes('technical') ||
        post.tags.includes('fedramp') ||
        post.tags.includes('architecture') ||
        post.author === 'marcus') &&
      engagement >= 3 &&
      replyCount >= 1
    ) {
      deliverableType = 'tech_assessment';
      ownerAgent = 'marcus';
    }

    // Trigger 5: High-engagement insight
    if (post.importance >= 8 && engagement >= 4 && !deliverableType) {
      deliverableType = 'executive_insight';
      ownerAgent = 'patricia';
    }

    if (deliverableType) {
      candidates.push({
        rootPost: post,
        thread,
        reactions,
        engagedAgents: Array.from(engagedAgents),
        deliverableType,
        ownerAgent,
      });
    }
  }

  return candidates;
}

// ============================================================
// Synthesis Prompts
// ============================================================

function buildSynthesisPrompt(candidate: SynthesisCandidate): string {
  const { rootPost, thread, reactions, engagedAgents, deliverableType } = candidate;

  // Format the discussion
  const discussionLines = [
    `[${rootPost.author}] (${rootPost.post_type}): ${rootPost.content}`,
    `Tags: ${rootPost.tags.join(', ') || 'none'}`,
    `Importance: ${rootPost.importance}/10`,
    '',
    'Reactions:',
    ...reactions.map((r) => `  - ${r.reactor}: ${r.reaction_type}`),
    '',
    'Thread:',
    ...thread.slice(1).map((p) => `  [${p.author}]: ${p.content}`),
  ];

  const discussion = discussionLines.join('\n');

  // Type-specific instructions
  const instructions: Record<DeliverableType, string> = {
    go_no_go_memo: `Create a Go/No-Go Memo for this opportunity discussion.

Include:
1. Opportunity Summary (what we're deciding on)
2. Team Input Synthesis (key points from each agent)
3. Recommendation: GO | NO-GO | HOLD with confidence level
4. Key Factors (3-5 bullets supporting the recommendation)
5. Next Actions if Approved
6. Risks to Consider`,

    research_brief: `Create a Research Brief synthesizing the answer to this question.

Include:
1. Question Summary (what was asked)
2. Answer Synthesis (consolidated response from team)
3. Supporting Evidence (data points, sources mentioned)
4. Confidence Level (high/medium/low)
5. Open Questions (what still needs investigation)`,

    partner_shortlist: `Create a Partner Shortlist based on this teaming discussion.

Include:
1. Opportunity Context (what we need partners for)
2. Partner Candidates (ranked list with capabilities)
3. Capability Match Analysis (how each fills gaps)
4. Recommended Approach (who to contact first, why)
5. Draft Outreach Template (2-3 sentence intro)`,

    tech_assessment: `Create a Technical Risk Assessment from this discussion.

Include:
1. Technical Requirements Summary
2. Risk Areas Identified (ranked by severity)
3. Mitigation Strategies (for top risks)
4. Compliance Considerations (FedRAMP, etc.)
5. Build vs Buy Recommendations
6. Resource Implications`,

    executive_insight: `Create an Executive Insight from this high-engagement discussion.

Include:
1. Insight Summary (1-2 sentences)
2. Why It Matters (business impact)
3. Recommended Action (what to do)
4. Timeline/Urgency (when to act)
5. Who Should Know (stakeholders)`,

    capture_plan: `Create a Capture Plan outline from this discussion.

Include:
1. Opportunity Overview
2. Win Strategy
3. Team Composition
4. Key Milestones
5. Risk Mitigation`,

    weekly_rollup: '', // Not used in synthesis
  };

  return `You are synthesizing an internal team discussion into a formal deliverable.

DISCUSSION:
${discussion}

PARTICIPATING AGENTS: ${engagedAgents.join(', ')}

TASK:
${instructions[deliverableType]}

Format the output as clean markdown. Be concise but thorough. Reference specific agent contributions where relevant.`;
}

// ============================================================
// Synthesis Execution
// ============================================================

async function synthesizeCandidate(
  candidate: SynthesisCandidate
): Promise<{ success: boolean; deliverableId?: string }> {
  const { rootPost, deliverableType, ownerAgent } = candidate;

  console.log(`[FeedSynthesis] Synthesizing ${deliverableType} from ${rootPost.author}'s post`);

  const prompt = buildSynthesisPrompt(candidate);
  const client = getAnthropic();
  const startTime = Date.now();

  try {
    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    // Track cost
    if (response.usage) {
      trackCost({
        agent: ownerAgent,
        purpose: 'other', // synthesis
        model: MODEL_SONNET,
        usage: response.usage,
        durationMs: Date.now() - startTime,
        metadata: { deliverableType },
      }).catch(() => {});
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { success: false };
    }

    const content = textBlock.text;

    // Generate title
    const titlePrefix: Record<DeliverableType, string> = {
      go_no_go_memo: 'Go/No-Go:',
      research_brief: 'Research:',
      partner_shortlist: 'Partners:',
      tech_assessment: 'Tech Assessment:',
      executive_insight: 'Insight:',
      capture_plan: 'Capture Plan:',
      weekly_rollup: 'Weekly Rollup:',
    };

    const title = `${titlePrefix[deliverableType]} ${rootPost.content.slice(0, 50)}${rootPost.content.length > 50 ? '...' : ''}`;

    // Create deliverable
    const deliverable = await createDeliverable({
      deliverable_type: deliverableType,
      title,
      owner_agent: ownerAgent,
      opportunity_id: rootPost.related_opportunity_id || undefined,
      content,
      source_post_ids: [rootPost.id, ...candidate.thread.map((p) => p.id)],
      metadata: {
        engagedAgents: candidate.engagedAgents,
        reactionCount: candidate.reactions.length,
        rootPostImportance: rootPost.importance,
      },
    });

    if (!deliverable) {
      return { success: false };
    }

    // Mark as synthesized
    await markDiscussionSynthesized(rootPost.id, deliverable.id);

    // Notify Slack
    try {
      const slackMessage = formatDeliverableForSlack(deliverable);
      const agentRole =
        ownerAgent === 'james'
          ? 'strategist'
          : ownerAgent === 'david'
            ? 'analyst'
            : ownerAgent === 'rosa'
              ? 'connector'
              : ownerAgent === 'marcus'
                ? 'engineer'
                : 'pm';
      await postAsAgent(agentRole as AgentName, slackMessage);
    } catch (err) {
      console.log('[FeedSynthesis] Slack notification skipped');
    }

    console.log(`[FeedSynthesis] Created ${deliverableType}: ${deliverable.id}`);
    return { success: true, deliverableId: deliverable.id };
  } catch (err) {
    console.error('[FeedSynthesis] Synthesis failed:', err);
    return { success: false };
  }
}

// ============================================================
// Main Synthesis Function
// ============================================================

export async function runFeedSynthesis(): Promise<{
  candidatesFound: number;
  synthesized: number;
  deliverableIds: string[];
}> {
  console.log('[FeedSynthesis] Scanning for synthesis candidates...');

  const candidates = await findSynthesisCandidates();
  console.log(`[FeedSynthesis] Found ${candidates.length} candidates`);

  // Early exit if no candidates - saves Claude API calls
  if (candidates.length === 0) {
    console.log('[FeedSynthesis] No candidates found, skipping synthesis');
    return {
      candidatesFound: 0,
      synthesized: 0,
      deliverableIds: [],
    };
  }

  const deliverableIds: string[] = [];
  let synthesized = 0;

  for (const candidate of candidates) {
    const result = await synthesizeCandidate(candidate);
    if (result.success && result.deliverableId) {
      synthesized++;
      deliverableIds.push(result.deliverableId);
    }

    // Small delay between syntheses
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`[FeedSynthesis] Complete. Synthesized ${synthesized}/${candidates.length}`);

  return {
    candidatesFound: candidates.length,
    synthesized,
    deliverableIds,
  };
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronFeedSynthesis(): Promise<void> {
  const { acquired } = await acquireCronLock('feed-synthesis', 30);
  if (!acquired) {
    console.log('[FeedSynthesis] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('feed-synthesis');

  try {
    const result = await runFeedSynthesis();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: result.synthesized,
        notes: `${result.candidatesFound} candidates, ${result.synthesized} synthesized`,
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

if (process.argv[1]?.includes('feed-synthesis')) {
  console.log('[FeedSynthesis] Running manually...');
  cronFeedSynthesis()
    .then(() => {
      console.log('[FeedSynthesis] Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[FeedSynthesis] Failed:', err);
      process.exit(1);
    });
}
