/**
 * Discussion Processor Cron
 *
 * Advances opportunity discussions by:
 * 1. Finding discussions that need the next agent contribution
 * 2. Generating agent turns using Claude
 * 3. Syncing discussions to Notion
 * 4. Triggering deliverable synthesis when discussions converge
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
  getPendingDiscussions,
  generateAgentTurn,
  addTurn,
  checkForConvergence,
  markSynthesized,
  type OpportunityDiscussion,
  type OpportunityContext,
} from '../discussions/orchestrator.js';
import { appendDiscussionToPage } from '../discussions/notion-sync.js';
import { createDeliverable } from '../integrations/database/deliverables.js';
import { buildDeliverablePrompt, DELIVERABLE_TEMPLATES } from '../deliverables/templates.js';
import { getAnthropic, MODEL_SONNET } from '../integrations/claude.js';
import { trackCost } from '../lib/cost-tracker.js';
import { postAsAgent } from '../integrations/slack.js';

// ============================================================
// Types
// ============================================================

interface ProcessingResult {
  discussionId: string;
  opportunityName: string;
  turnsAdded: number;
  converged: boolean;
  deliverableCreated: boolean;
  notionSynced: boolean;
  error?: string;
}

// ============================================================
// Context Building
// ============================================================

/**
 * Build opportunity context from discussion
 * In a full implementation, this would fetch from database
 */
function buildOpportunityContext(discussion: OpportunityDiscussion): OpportunityContext {
  // Extract what we can from the discussion
  // A full implementation would fetch from the opportunities table
  return {
    title: discussion.opportunity_name,
    // These would come from the opportunity record
    agency: undefined,
    setAside: undefined,
    naicsCodes: undefined,
    dueDate: undefined,
    description: undefined,
  };
}

// ============================================================
// Discussion Processing
// ============================================================

/**
 * Process a single discussion - add next agent turn
 */
async function processDiscussion(discussion: OpportunityDiscussion): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    discussionId: discussion.id,
    opportunityName: discussion.opportunity_name,
    turnsAdded: 0,
    converged: false,
    deliverableCreated: false,
    notionSynced: false,
  };

  try {
    // Check if discussion has converged
    const convergence = checkForConvergence(discussion);

    if (convergence.converged && convergence.ready_for_synthesis) {
      result.converged = true;

      // Generate deliverable if not already done
      if (discussion.state !== 'synthesized') {
        const deliverableId = await synthesizeDiscussion(discussion, convergence);
        if (deliverableId) {
          result.deliverableCreated = true;
          await markSynthesized(discussion.id, deliverableId);
        }
      }

      return result;
    }

    // Generate next agent turn
    const context = buildOpportunityContext(discussion);
    const turn = await generateAgentTurn(discussion, context);

    if (turn) {
      // Add the turn
      const turnType =
        turn.agent === 'james' && discussion.agents_contributed.length >= 4
          ? 'synthesis'
          : 'initial';

      const updated = await addTurn({
        discussionId: discussion.id,
        agent: turn.agent,
        role: turn.role,
        content: turn.content,
        turnType,
      });

      result.turnsAdded = 1;

      // Sync to Notion if page ID exists
      if (updated?.notion_page_id) {
        try {
          await appendDiscussionToPage(updated.notion_page_id, updated);
          result.notionSynced = true;
        } catch (err) {
          console.log(`[DiscussionProcessor] Notion sync failed: ${err}`);
        }
      }

      // Check convergence after this turn
      if (updated) {
        const postTurnConvergence = checkForConvergence(updated);
        if (postTurnConvergence.converged) {
          result.converged = true;

          // Notify Slack
          try {
            const recommendation = postTurnConvergence.recommendation?.toUpperCase() || 'UNKNOWN';
            const confidence = Math.round(postTurnConvergence.confidence * 100);
            const message =
              `:clipboard: *Discussion Complete: ${discussion.opportunity_name}*\n` +
              `Recommendation: *${recommendation}* (${confidence}% confidence)\n` +
              `Contributors: ${updated.agents_contributed.join(', ')}`;

            await postAsAgent('pm', message);
          } catch {
            // Slack notification is optional
          }
        }
      }
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[DiscussionProcessor] Failed to process ${discussion.id}:`, err);
    return result;
  }
}

/**
 * Synthesize a completed discussion into a deliverable
 */
async function synthesizeDiscussion(
  discussion: OpportunityDiscussion,
  convergence: { recommendation?: 'go' | 'no_go' | 'hold'; confidence: number }
): Promise<string | null> {
  const template = DELIVERABLE_TEMPLATES.go_no_go_memo;
  const prompt = buildDeliverablePrompt(template, discussion);

  try {
    const client = getAnthropic();
    const startTime = Date.now();

    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    // Track cost
    if (response.usage) {
      trackCost({
        agent: 'james',
        purpose: 'synthesis',
        model: MODEL_SONNET,
        usage: response.usage,
        durationMs: Date.now() - startTime,
        metadata: { discussionId: discussion.id },
      }).catch(() => {});
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return null;
    }

    // Create deliverable
    const recommendation = convergence.recommendation || 'hold';
    const title = `${recommendation.toUpperCase()}: ${discussion.opportunity_name}`;

    const deliverable = await createDeliverable({
      deliverable_type: 'go_no_go_memo',
      title,
      owner_agent: 'james',
      opportunity_id: discussion.opportunity_id,
      opportunity_title: discussion.opportunity_name,
      content: textBlock.text,
      source_post_ids: [],
      metadata: {
        recommendation,
        confidence: convergence.confidence,
        discussionId: discussion.id,
        agentsContributed: discussion.agents_contributed,
      },
    });

    if (deliverable) {
      console.log(`[DiscussionProcessor] Created deliverable: ${deliverable.id}`);

      // Notify Slack
      try {
        const emoji =
          recommendation === 'go'
            ? ':green_circle:'
            : recommendation === 'no_go'
              ? ':red_circle:'
              : ':yellow_circle:';
        const message =
          `${emoji} *New Go/No-Go Memo*\n` +
          `*${title}*\n` +
          `Confidence: ${Math.round(convergence.confidence * 100)}%\n` +
          `Team: ${discussion.agents_contributed.join(', ')}`;

        await postAsAgent('strategist', message);
      } catch {
        // Slack is optional
      }

      return deliverable.id;
    }

    return null;
  } catch (err) {
    console.error('[DiscussionProcessor] Synthesis failed:', err);
    return null;
  }
}

// ============================================================
// Main Processing Function
// ============================================================

/**
 * Process all pending discussions
 */
export async function runDiscussionProcessor(): Promise<{
  processed: number;
  turnsAdded: number;
  converged: number;
  deliverables: number;
  errors: number;
}> {
  console.log('[DiscussionProcessor] Starting...');

  const discussions = await getPendingDiscussions();
  console.log(`[DiscussionProcessor] Found ${discussions.length} pending discussions`);

  const stats = {
    processed: 0,
    turnsAdded: 0,
    converged: 0,
    deliverables: 0,
    errors: 0,
  };

  for (const discussion of discussions) {
    const result = await processDiscussion(discussion);

    stats.processed++;
    stats.turnsAdded += result.turnsAdded;
    if (result.converged) stats.converged++;
    if (result.deliverableCreated) stats.deliverables++;
    if (result.error) stats.errors++;

    // Small delay between discussions
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(
    `[DiscussionProcessor] Complete. Processed ${stats.processed}, ` +
      `added ${stats.turnsAdded} turns, ${stats.converged} converged, ` +
      `${stats.deliverables} deliverables, ${stats.errors} errors`
  );

  return stats;
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronDiscussionProcessor(): Promise<void> {
  const { acquired } = await acquireCronLock('discussion-processor', 30);
  if (!acquired) {
    console.log('[DiscussionProcessor] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('discussion-processor');

  try {
    const stats = await runDiscussionProcessor();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: stats.processed,
        notes: `${stats.turnsAdded} turns, ${stats.converged} converged, ${stats.deliverables} deliverables`,
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

if (process.argv[1]?.includes('discussion-processor')) {
  console.log('[DiscussionProcessor] Running manually...');
  cronDiscussionProcessor()
    .then(() => {
      console.log('[DiscussionProcessor] Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[DiscussionProcessor] Failed:', err);
      process.exit(1);
    });
}
