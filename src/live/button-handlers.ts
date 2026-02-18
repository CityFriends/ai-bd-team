/**
 * Slack Button Action Handlers
 *
 * Handles interactive button clicks from opportunity posts and pipeline views.
 * Integrates with the workflow system to update opportunity status.
 */

import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import { getSupabase, isUsingServiceKey } from '../integrations/supabase.js';

/**
 * Register all button action handlers with a Slack app
 */
export function registerButtonHandlers(app: App): void {
  // Opportunity actions
  app.action('opp_pursue', async ({ ack, body, client, action }) => {
    await ack();
    await handlePursue(body as BlockAction, client, action as ButtonAction);
  });

  app.action('opp_pass', async ({ ack, body, client, action }) => {
    await ack();
    await handlePass(body as BlockAction, client, action as ButtonAction);
  });

  app.action('opp_research', async ({ ack, body, client, action }) => {
    await ack();
    await handleResearch(body as BlockAction, client, action as ButtonAction);
  });

  app.action('opp_pipeline', async ({ ack, body, client, action }) => {
    await ack();
    await handleAddToPipeline(body as BlockAction, client, action as ButtonAction);
  });

  // Decision actions
  app.action('decision_go', async ({ ack, body, client, action }) => {
    await ack();
    await handleDecisionGo(body as BlockAction, client, action as ButtonAction);
  });

  app.action('decision_pass', async ({ ack, body, client, action }) => {
    await ack();
    await handleDecisionPass(body as BlockAction, client, action as ButtonAction);
  });

  app.action('decision_info', async ({ ack, body, client, action }) => {
    await ack();
    await handleDecisionNeedInfo(body as BlockAction, client, action as ButtonAction);
  });

  // Pipeline actions
  app.action('pipeline_refresh', async ({ ack, body, client }) => {
    await ack();
    await handlePipelineRefresh(body as BlockAction, client);
  });

  app.action('pipeline_report', async ({ ack, body, client }) => {
    await ack();
    await handlePipelineReport(body as BlockAction, client);
  });

  console.log('[ButtonHandlers] Registered all action handlers');
}

/**
 * Handle "Pursue" button click
 */
async function handlePursue(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Pursue clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} clicked PURSUE on ${noticeId}`);

  try {
    const supabase = getSupabase();

    // Update workflow stage
    await supabase
      .from('opportunity_workflow')
      .update({
        stage: 'pursuing',
        human_decision: 'pursue',
        decided_by: userId,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('notice_id', noticeId);

    // Update the message with confirmation
    if (body.message?.ts && body.channel?.id) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `✅ <@${userId}> marked this for pursuit. Moving forward!`,
      });
    }

    // Log the decision
    await logDecision(noticeId, 'pursue', userId);
  } catch (err) {
    console.error('[Action] Error handling pursue:', err);
  }
}

/**
 * Handle "Pass" button click
 */
async function handlePass(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Pass clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} clicked PASS on ${noticeId}`);
  console.log(`[Action] Using service key: ${isUsingServiceKey()}`);

  try {
    const supabase = getSupabase();
    let workflowUpdated = false;
    let seenUpdated = false;

    // First verify the record exists
    const { data: existing, error: selectError } = await supabase
      .from('opportunity_workflow')
      .select('id, stage')
      .eq('notice_id', noticeId)
      .single();

    console.log(
      `[Action] Pre-update check for ${noticeId}: exists=${!!existing}, stage=${existing?.stage}, selectError=${selectError?.message || 'none'}`
    );

    // Update workflow stage
    const { error: workflowError, count: workflowCount } = await supabase
      .from('opportunity_workflow')
      .update({
        stage: 'passed',
        decision: 'pass',
        decision_by: userId,
        decision_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('notice_id', noticeId);

    if (workflowError) {
      console.error(
        `[Action] Failed to update opportunity_workflow for ${noticeId}:`,
        workflowError.message,
        workflowError.code,
        workflowError.details
      );
    } else {
      workflowUpdated = true;
      console.log(
        `[Action] Updated opportunity_workflow for ${noticeId} (rows: ${workflowCount ?? 'unknown'})`
      );
    }

    // Also update seen_opportunities so Maya won't repost it
    // This is CRITICAL for preventing duplicate posts
    const { error: seenError, count: seenCount } = await supabase
      .from('seen_opportunities')
      .update({
        decision: 'pass',
        decision_date: new Date().toISOString().split('T')[0],
      })
      .eq('notice_id', noticeId);

    if (seenError) {
      console.error(
        `[Action] Failed to update seen_opportunities for ${noticeId}:`,
        seenError.message,
        seenError.code,
        seenError.details
      );
    } else {
      seenUpdated = true;
      console.log(
        `[Action] Updated seen_opportunities for ${noticeId} (rows: ${seenCount ?? 'unknown'})`
      );
    }

    // Confirm in thread with appropriate message based on success/failure
    if (body.message?.ts && body.channel?.id) {
      if (workflowUpdated && seenUpdated) {
        await client.chat.postMessage({
          channel: body.channel.id,
          thread_ts: body.message.ts,
          text: `⏭️ <@${userId}> passed on this one. Removing from active pipeline.`,
        });
      } else if (!workflowUpdated && !seenUpdated) {
        // Both updates failed - notify user with helpful diagnostic info
        const usingServiceKey = isUsingServiceKey();
        const diagnosticMsg = !usingServiceKey
          ? ' (Database is using anon key - service key may not be configured)'
          : '';
        await client.chat.postMessage({
          channel: body.channel.id,
          thread_ts: body.message.ts,
          text: `⚠️ <@${userId}> tried to pass on this, but the database update failed${diagnosticMsg}. Please try again or contact support.`,
        });
      } else {
        // Partial success - still confirm but note the issue
        await client.chat.postMessage({
          channel: body.channel.id,
          thread_ts: body.message.ts,
          text: `⏭️ <@${userId}> passed on this one. (Note: partial database update - this may reappear if not fully recorded)`,
        });
      }
    }

    await logDecision(noticeId, 'pass', userId);
  } catch (err) {
    console.error('[Action] Error handling pass:', err);
    // Notify user of failure
    if (body.message?.ts && body.channel?.id) {
      try {
        await client.chat.postMessage({
          channel: body.channel.id,
          thread_ts: body.message.ts,
          text: `⚠️ Error processing pass action. Please try again.`,
        });
      } catch {
        // Ignore notification failure
      }
    }
  }
}

/**
 * Handle "Research" button click - triggers David to research
 */
async function handleResearch(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Research clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} requested RESEARCH on ${noticeId}`);

  try {
    const supabase = getSupabase();

    // Update workflow to trigger David
    await supabase
      .from('opportunity_workflow')
      .update({
        stage: 'researching',
        agent_responsible: 'david',
        auto_action_at: new Date().toISOString(), // Trigger immediately
        updated_at: new Date().toISOString(),
      })
      .eq('notice_id', noticeId);

    // Notify in thread and tag David
    if (body.message?.ts && body.channel?.id) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `🔍 <@${userId}> requested research. <@U0AC0SVD3MH> (David), can you dig into this one?`,
      });
    }
  } catch (err) {
    console.error('[Action] Error handling research request:', err);
  }
}

/**
 * Handle "Add to Pipeline" button click
 */
async function handleAddToPipeline(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Add to pipeline clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} added ${noticeId} to pipeline`);

  try {
    const supabase = getSupabase();

    // Ensure it's in the workflow table with 'watching' stage
    const { data: existing } = await supabase
      .from('opportunity_workflow')
      .select('id')
      .eq('notice_id', noticeId)
      .single();

    if (!existing) {
      // Get details from seen_opportunities
      const { data: opp } = await supabase
        .from('seen_opportunities')
        .select('*')
        .eq('notice_id', noticeId)
        .single();

      if (opp) {
        await supabase.from('opportunity_workflow').insert({
          notice_id: noticeId,
          title: opp.title,
          sam_url: opp.sam_url,
          agency: opp.agency,
          score: opp.score,
          stage: 'watching',
          added_by: userId,
          created_at: new Date().toISOString(),
        });
      }
    } else {
      // Update stage if already exists
      await supabase
        .from('opportunity_workflow')
        .update({
          stage: 'watching',
          updated_at: new Date().toISOString(),
        })
        .eq('notice_id', noticeId);
    }

    // Confirm in thread
    if (body.message?.ts && body.channel?.id) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `📋 Added to pipeline by <@${userId}>. I'll keep an eye on this one.`,
      });
    }
  } catch (err) {
    console.error('[Action] Error adding to pipeline:', err);
  }
}

/**
 * Handle decision approval (GO)
 */
async function handleDecisionGo(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Decision GO clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} approved GO on ${noticeId}`);

  try {
    const supabase = getSupabase();

    await supabase
      .from('opportunity_workflow')
      .update({
        stage: 'pursuing',
        human_decision: 'go',
        decided_by: userId,
        decided_at: new Date().toISOString(),
        awaiting_input_from: null,
        updated_at: new Date().toISOString(),
      })
      .eq('notice_id', noticeId);

    if (body.message?.ts && body.channel?.id) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `✅ Decision: *GO* - approved by <@${userId}>. Let's win this one!`,
      });
    }

    await logDecision(noticeId, 'go', userId);
  } catch (err) {
    console.error('[Action] Error handling GO decision:', err);
  }
}

/**
 * Handle decision decline (PASS)
 */
async function handleDecisionPass(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Decision PASS clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} declined (PASS) on ${noticeId}`);

  try {
    const supabase = getSupabase();

    await supabase
      .from('opportunity_workflow')
      .update({
        stage: 'passed',
        decision: 'pass',
        decision_by: userId,
        decision_at: new Date().toISOString(),
        awaiting_input_from: null,
        updated_at: new Date().toISOString(),
      })
      .eq('notice_id', noticeId);

    // Also update seen_opportunities so Maya won't repost it
    await supabase
      .from('seen_opportunities')
      .update({
        decision: 'pass',
        decision_date: new Date().toISOString().split('T')[0],
      })
      .eq('notice_id', noticeId);

    if (body.message?.ts && body.channel?.id) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `⛔ Decision: *PASS* - declined by <@${userId}>. Moving on.`,
      });
    }

    await logDecision(noticeId, 'pass', userId);
  } catch (err) {
    console.error('[Action] Error handling PASS decision:', err);
  }
}

/**
 * Handle "Need More Info" on decisions
 */
async function handleDecisionNeedInfo(
  body: BlockAction,
  client: App['client'],
  action: ButtonAction
): Promise<void> {
  const noticeId = action.value;
  const userId = body.user.id;

  if (!noticeId) {
    console.error('[Action] Need info clicked but no noticeId');
    return;
  }

  console.log(`[Action] User ${userId} needs more info on ${noticeId}`);

  try {
    const supabase = getSupabase();

    // Trigger more research
    await supabase
      .from('opportunity_workflow')
      .update({
        stage: 'researching',
        agent_responsible: 'david',
        auto_action_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('notice_id', noticeId);

    if (body.message?.ts && body.channel?.id) {
      await client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: body.message.ts,
        text: `🤔 <@${userId}> needs more info before deciding. <@U0AC0SVD3MH> (David), can you dig deeper?`,
      });
    }
  } catch (err) {
    console.error('[Action] Error handling need info:', err);
  }
}

/**
 * Handle pipeline refresh button
 */
async function handlePipelineRefresh(body: BlockAction, client: App['client']): Promise<void> {
  // For now, just acknowledge - full implementation would regenerate pipeline view
  if (body.message?.ts && body.channel?.id) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '🔄 Pipeline refreshed! (Use `/pipeline` for the latest view)',
    });
  }
}

/**
 * Handle pipeline report button
 */
async function handlePipelineReport(body: BlockAction, client: App['client']): Promise<void> {
  if (body.message?.ts && body.channel?.id) {
    await client.chat.postEphemeral({
      channel: body.channel.id,
      user: body.user.id,
      text: '📊 Full report coming soon! For now, ask James for a strategic briefing.',
    });
  }
}

/**
 * Log decision for learning
 */
async function logDecision(noticeId: string, decision: string, userId: string): Promise<void> {
  try {
    const supabase = getSupabase();

    // Get opportunity details
    const { data: opp } = await supabase
      .from('opportunity_workflow')
      .select('title, score, james_recommendation, red_flags')
      .eq('notice_id', noticeId)
      .single();

    if (opp) {
      await supabase.from('decision_outcomes').insert({
        notice_id: noticeId,
        title: opp.title,
        score_at_decision: opp.score,
        james_recommendation: opp.james_recommendation,
        human_decision: decision,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        red_flags_at_decision: opp.red_flags,
        // outcome will be filled in later when we learn if we won/lost
      });
    }
  } catch (err) {
    console.warn('[Action] Could not log decision:', err);
  }
}
