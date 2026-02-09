/**
 * Workflow Processor - Semi-Autonomous Pipeline
 *
 * Flow (with notification-based decisions):
 *   Maya posts opportunity (70+) → workflow created at 'found' stage
 *   ↓ (30 min delay - gives humans time to engage)
 *   David auto-researches → stage moves to 'researching'
 *   ↓ (if teaming relevant)
 *   Rosa analyzes teaming → stage moves to 'partner_search'
 *   ↓
 *   James synthesizes → posts recommendation with override option
 *   ↓ (2 hour override window)
 *   Auto-executes recommendation unless human reacts with ❌
 *
 * Continuous Learning:
 *   - Tracks win/loss outcomes against recommendations
 *   - Adjusts confidence based on historical accuracy
 *   - Surfaces learning insights in James's recommendations
 *
 * Usage:
 *   npm run workflow:process     # Run once
 *   npm run workflow:schedule    # Run every 5 minutes
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import {
  getSupabase,
  getWorkflowsNeedingAction,
  updateOpportunityWorkflow,
  recordStageTransition,
  logTeamActivity,
  getTeamActivitySummary,
  getRecommendationAccuracy,
  recordDecisionOutcome,
  type OpportunityWorkflow,
  type WorkflowStage,
} from '../integrations/supabase.js';
import { autoResearchOpportunity } from '../scripts/david-scanner.js';
import { getAnthropic } from '../integrations/claude.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Auto-action delays (in minutes)
const STAGE_DELAYS = {
  found: 30,           // Wait 30 min before David researches
  researching: 15,     // Wait 15 min before Rosa checks teaming
  partner_search: 15,  // Wait 15 min before James synthesizes
  strategy: 120,       // 2 hour override window before auto-execute
};

// Confidence thresholds for auto-execution
const AUTO_EXECUTE_THRESHOLDS = {
  GO_SCORE_MIN: 85,      // Must be 85+ to auto-execute GO
  GO_RED_FLAGS_MAX: 1,   // Max red flags for auto-GO
  PASS_SCORE_MAX: 55,    // Below 55 to auto-execute PASS
  PASS_RED_FLAGS_MIN: 2, // At least 2 red flags for auto-PASS
};

// Get agent Slack apps
async function getAgentApp(agent: 'rosa' | 'james' | 'patricia'): Promise<App | null> {
  const tokenMap = {
    rosa: { bot: 'ROSA_BOT_TOKEN', app: 'ROSA_APP_TOKEN' },
    james: { bot: 'JAMES_BOT_TOKEN', app: 'JAMES_APP_TOKEN' },
    patricia: { bot: 'PATRICIA_BOT_TOKEN', app: 'PATRICIA_APP_TOKEN' },
  };

  const tokens = tokenMap[agent];
  const botToken = process.env[tokens.bot];
  const appToken = process.env[tokens.app];

  if (!botToken || !appToken) {
    console.log(`${agent} Slack tokens not configured`);
    return null;
  }

  const app = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  });

  await app.start();
  return app;
}

// Get learning context for James
async function getLearningContext(): Promise<string> {
  const stats = await getRecommendationAccuracy();

  if (stats.goRecommendations.total === 0 && stats.passRecommendations.total === 0) {
    return ''; // No historical data yet
  }

  const lines: string[] = ['\n=== LEARNING FROM PAST DECISIONS ==='];

  if (stats.goRecommendations.total > 0) {
    const winRate = Math.round((stats.goRecommendations.won / stats.goRecommendations.total) * 100);
    lines.push(`GO recommendations: ${stats.goRecommendations.total} total, ${stats.goRecommendations.won} won (${winRate}% win rate)`);

    if (winRate < 40) {
      lines.push('⚠️ Win rate is below 40% - consider being more selective with GO recommendations');
    } else if (winRate > 60) {
      lines.push('✓ Strong win rate - current GO threshold is well-calibrated');
    }
  }

  if (stats.passRecommendations.total > 0) {
    lines.push(`PASS recommendations: ${stats.passRecommendations.total} total, ${stats.passRecommendations.correct} aligned with human decision`);
  }

  lines.push('Use this data to calibrate your confidence level.\n');

  return lines.join('\n');
}

// Process a single workflow based on its current stage
async function processWorkflow(workflow: OpportunityWorkflow): Promise<void> {
  console.log(`\nProcessing workflow: ${workflow.title?.slice(0, 50)}...`);
  console.log(`  Current stage: ${workflow.stage}`);
  console.log(`  Notice ID: ${workflow.notice_id}`);

  switch (workflow.stage) {
    case 'found':
      await triggerDavidResearch(workflow);
      break;

    case 'researching':
      await checkTeamingNeed(workflow);
      break;

    case 'partner_search':
      await triggerJamesSynthesis(workflow);
      break;

    case 'strategy':
      // Check if override window has passed
      await checkOverrideWindow(workflow);
      break;

    case 'decision':
    case 'pursuing':
    case 'passed':
      // Terminal states - no action needed
      console.log('  → Terminal state, no action needed');
      break;

    default:
      console.log(`  → Unknown stage: ${workflow.stage}`);
  }
}

// Trigger David's auto-research
async function triggerDavidResearch(workflow: OpportunityWorkflow): Promise<void> {
  console.log('  → Triggering David research...');

  try {
    await autoResearchOpportunity(
      workflow.notice_id,
      workflow.title,
      workflow.agency || 'Unknown',
      workflow.thread_ts || ''
    );

    await updateOpportunityWorkflow(workflow.notice_id, {
      stage: 'researching',
      agent_responsible: 'david',
      auto_action_at: new Date(Date.now() + STAGE_DELAYS.researching * 60 * 1000).toISOString(),
    });

    if (workflow.id) {
      await recordStageTransition(workflow.id, 'found', 'researching', 'auto', 'Auto-triggered after 30 min delay');
    }

    await logTeamActivity({
      thread_ts: workflow.thread_ts || '',
      notice_id: workflow.notice_id,
      agent: 'david',
      action_type: 'research',
      summary: `Researched incumbent and red flags for ${workflow.title?.slice(0, 50)}`,
      key_facts: workflow.red_flags || [],
    });

    console.log('  → David research complete, moved to researching stage');
  } catch (err) {
    console.error('  → Error in David research:', err);
  }
}

// Check if teaming is needed and trigger Rosa
async function checkTeamingNeed(workflow: OpportunityWorkflow): Promise<void> {
  console.log('  → Checking if teaming is needed...');

  const needsTeaming = shouldRecommendTeaming(workflow);

  if (needsTeaming) {
    console.log('  → Teaming recommended, triggering Rosa...');
    await triggerRosaPartnerSearch(workflow);
  } else {
    console.log('  → Teaming not needed, skipping to James synthesis...');
    await updateOpportunityWorkflow(workflow.notice_id, {
      stage: 'partner_search', // Still go through partner_search stage for James trigger
      teaming_recommended: false,
      auto_action_at: new Date(Date.now() + STAGE_DELAYS.partner_search * 60 * 1000).toISOString(),
    });

    if (workflow.id) {
      await recordStageTransition(workflow.id, 'researching', 'partner_search', 'auto', 'Teaming not needed, proceeding to synthesis');
    }
  }
}

function shouldRecommendTeaming(workflow: OpportunityWorkflow): boolean {
  const title = (workflow.title || '').toLowerCase();
  const score = workflow.score || 0;
  const redFlags = workflow.red_flags || [];

  const largeContractKeywords = ['enterprise', 'agencywide', 'department-wide', 'idiq', 'bpa', 'gwac'];
  const isLarge = largeContractKeywords.some(kw => title.includes(kw));
  const incumbentStrong = redFlags.some(f =>
    f.toLowerCase().includes('incumbent') || f.toLowerCase().includes('wired')
  );
  const isHighScore = score >= 80;

  return isLarge || (incumbentStrong && isHighScore) || (isHighScore && !workflow.incumbent);
}

// Trigger Rosa's partner search
async function triggerRosaPartnerSearch(workflow: OpportunityWorkflow): Promise<void> {
  console.log('  → Triggering Rosa partner search...');

  const app = await getAgentApp('rosa');
  const client = getAnthropic();

  try {
    const companyData = await loadCompanyContext();
    const companyContext = formatCompanyContextForPrompt(companyData, 'Rosa');
    const teamContext = await getTeamActivitySummary(workflow.thread_ts || '');

    const prompt = `You are Rosa, the connector for Friends From The City's BD team.

YOUR VOICE:
- 44, Mexican American from San Antonio
- Former Navy, direct and efficient
- Warm but professional, relationship-focused
- Uses "y'all" occasionally, some Spanglish

${companyContext}

${teamContext ? teamContext + '\n\n' : ''}

OPPORTUNITY: ${workflow.title}
AGENCY: ${workflow.agency || 'Unknown'}
INCUMBENT: ${workflow.incumbent || 'Unknown'}
RED FLAGS: ${(workflow.red_flags || []).join(', ') || 'None identified'}

THINK THROUGH THIS:
1. What type of partner would strengthen this bid?
2. Do we need agency relationships we don't have?
3. Is there a certification gap (8a, WOSB, etc.) a partner could fill?
4. What past performance would complement ours?

Write a brief Slack post suggesting teaming considerations. Be practical - suggest the TYPE of partner we need, not specific names unless you actually know them from the company context.

End with: "Let me know if you want me to identify specific companies to consider."`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const message = textBlock?.type === 'text' ? textBlock.text : '';

    if (app && workflow.thread_ts) {
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: message,
        thread_ts: workflow.thread_ts,
      });
    } else {
      console.log('  → Would post Rosa teaming analysis:', message.slice(0, 100));
    }

    await updateOpportunityWorkflow(workflow.notice_id, {
      stage: 'partner_search',
      agent_responsible: 'rosa',
      teaming_recommended: true,
      auto_action_at: new Date(Date.now() + STAGE_DELAYS.partner_search * 60 * 1000).toISOString(),
    });

    if (workflow.id) {
      await recordStageTransition(workflow.id, 'researching', 'partner_search', 'auto', 'Teaming recommended');
    }

    await logTeamActivity({
      thread_ts: workflow.thread_ts || '',
      notice_id: workflow.notice_id,
      agent: 'rosa',
      action_type: 'partner_search',
      summary: `Analyzed teaming options for ${workflow.title?.slice(0, 50)}`,
    });

    if (app) await app.stop();
  } catch (err) {
    console.error('  → Error in Rosa partner search:', err);
  }
}

// Trigger James's strategy synthesis with learning context
async function triggerJamesSynthesis(workflow: OpportunityWorkflow): Promise<void> {
  console.log('  → Triggering James synthesis with learning context...');

  const app = await getAgentApp('james');
  const client = getAnthropic();

  try {
    const teamContext = await getTeamActivitySummary(workflow.thread_ts || '');
    const companyData = await loadCompanyContext();
    const companyContext = formatCompanyContextForPrompt(companyData, 'James');
    const learningContext = await getLearningContext();

    const prompt = `You are James, the strategist for Friends From The City's BD team.

YOUR VOICE:
- 52, Black, Chicago South Side, Northwestern MBA
- 15 years at a big integrator, now helping small businesses
- Calm, measured, strategic thinker
- "Alright, let me tell you...", "Bottom line...", "Here's my assessment"

${companyContext}

${teamContext ? teamContext + '\n\n' : ''}

${learningContext}

OPPORTUNITY: ${workflow.title}
AGENCY: ${workflow.agency || 'Unknown'}
SCORE: ${workflow.score || 'Unknown'}/100

DAVID'S RESEARCH:
- Incumbent: ${workflow.incumbent || 'Not identified'}
- Contract Value: ${workflow.incumbent_contract_value || 'Unknown'}
- Red Flags: ${(workflow.red_flags || []).join(', ') || 'None'}

ROSA'S TEAMING ANALYSIS:
- Teaming Recommended: ${workflow.teaming_recommended ? 'Yes' : 'No'}
- Potential Partners: ${(workflow.teaming_partners || []).join(', ') || 'None identified'}

THINK THROUGH THIS:
1. Given the incumbent and red flags, what's our realistic win probability?
2. What would we need to do differently than the incumbent?
3. Is this worth the bid cost given our pipeline?
4. What's the worst case scenario if we pursue?

Provide your strategic recommendation:

*Strategic Assessment*
[2-3 sentences on fit and competitive position]

*Recommendation*
[GO / PASS / NEEDS DISCUSSION]
[1-sentence rationale]

*Confidence Level*
[HIGH / MEDIUM / LOW - based on data quality and learning history]

${workflow.score && workflow.score >= 85 ? `
*If GO, Key Success Factors*
[2-3 bullet points]
` : ''}

*Override Window*
This recommendation will auto-execute in 2 hours unless someone reacts with ❌

Keep it under 250 words. Be decisive.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const message = textBlock?.type === 'text' ? textBlock.text : '';

    // Determine recommendation from response
    let recommendation: 'GO' | 'PASS' | 'NEEDS_DISCUSSION' = 'NEEDS_DISCUSSION';
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('**go**') || lowerMessage.includes('*go*') ||
        (lowerMessage.includes('recommendation') && lowerMessage.includes('\ngo'))) {
      recommendation = 'GO';
    } else if (lowerMessage.includes('**pass**') || lowerMessage.includes('*pass*') ||
               (lowerMessage.includes('recommendation') && lowerMessage.includes('\npass'))) {
      recommendation = 'PASS';
    }

    let messageTs: string | undefined;
    if (app && workflow.thread_ts) {
      const result = await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: message,
        thread_ts: workflow.thread_ts,
      });
      messageTs = result.ts;

      // Add reaction options for override
      if (messageTs) {
        await app.client.reactions.add({
          channel: CHANNEL_ID,
          timestamp: messageTs,
          name: 'white_check_mark', // ✅ to confirm
        });
        await app.client.reactions.add({
          channel: CHANNEL_ID,
          timestamp: messageTs,
          name: 'x', // ❌ to override/stop
        });
      }
    } else {
      console.log('  → Would post James synthesis:', message.slice(0, 100));
    }

    // Update workflow - set override window
    const overrideWindowEnd = new Date(Date.now() + STAGE_DELAYS.strategy * 60 * 1000);

    await updateOpportunityWorkflow(workflow.notice_id, {
      stage: 'strategy',
      agent_responsible: 'james',
      james_recommendation: recommendation,
      awaiting_input_from: null, // Not blocking - notify mode
      auto_action_at: overrideWindowEnd.toISOString(),
    });

    if (workflow.id) {
      await recordStageTransition(workflow.id, workflow.stage, 'strategy', 'auto', `James recommends: ${recommendation}`);
    }

    // Record for learning
    await recordDecisionOutcome({
      notice_id: workflow.notice_id,
      opportunity_title: workflow.title,
      workflow_id: workflow.id,
      james_recommendation: recommendation,
      david_red_flags: workflow.red_flags,
      rosa_teaming_suggested: workflow.teaming_recommended,
      recommended_at: new Date().toISOString(),
    });

    await logTeamActivity({
      thread_ts: workflow.thread_ts || '',
      notice_id: workflow.notice_id,
      agent: 'james',
      action_type: 'strategy',
      summary: `Strategic assessment: ${recommendation} for ${workflow.title?.slice(0, 50)}`,
      key_facts: [`Recommendation: ${recommendation}`, `Override window: 2 hours`],
      recommendations: [recommendation],
    });

    console.log(`  → James recommends ${recommendation}, override window ends at ${overrideWindowEnd.toLocaleTimeString()}`);

    if (app) await app.stop();
  } catch (err) {
    console.error('  → Error in James synthesis:', err);
  }
}

// Check if override window has passed and auto-execute
async function checkOverrideWindow(workflow: OpportunityWorkflow): Promise<void> {
  console.log('  → Checking override window...');

  const recommendation = workflow.james_recommendation;
  const score = workflow.score || 0;
  const redFlags = workflow.red_flags || [];

  // Determine if we should auto-execute
  let shouldAutoExecute = false;
  let decision: 'go' | 'pass' | undefined;

  if (recommendation === 'GO') {
    // Auto-execute GO only if high confidence
    if (score >= AUTO_EXECUTE_THRESHOLDS.GO_SCORE_MIN &&
        redFlags.length <= AUTO_EXECUTE_THRESHOLDS.GO_RED_FLAGS_MAX) {
      shouldAutoExecute = true;
      decision = 'go';
    }
  } else if (recommendation === 'PASS') {
    // Auto-execute PASS if clearly not a fit
    if (score <= AUTO_EXECUTE_THRESHOLDS.PASS_SCORE_MAX ||
        redFlags.length >= AUTO_EXECUTE_THRESHOLDS.PASS_RED_FLAGS_MIN) {
      shouldAutoExecute = true;
      decision = 'pass';
    }
  }

  if (shouldAutoExecute && decision) {
    console.log(`  → Auto-executing ${decision.toUpperCase()} (no override received)`);

    await updateOpportunityWorkflow(workflow.notice_id, {
      stage: decision === 'go' ? 'pursuing' : 'passed',
      decision,
      decision_by: 'auto',
      decision_at: new Date().toISOString(),
      decision_notes: `Auto-executed after 2-hour override window. Recommendation: ${recommendation}`,
      awaiting_input_from: null,
      auto_action_at: undefined,
    });

    if (workflow.id) {
      await recordStageTransition(
        workflow.id,
        'strategy',
        decision === 'go' ? 'pursuing' : 'passed',
        'auto',
        `Auto-executed: ${decision.toUpperCase()}`
      );
    }

    // Post notification
    const app = await getAgentApp('patricia');
    if (app && workflow.thread_ts) {
      const emoji = decision === 'go' ? '🚀' : '⏭️';
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `${emoji} *Auto-executed: ${decision.toUpperCase()}*\n\nNo override was received within the 2-hour window. This opportunity is now marked as "${decision === 'go' ? 'pursuing' : 'passed'}".\n\nTo change this decision, let me know.`,
        thread_ts: workflow.thread_ts,
      });
      await app.stop();
    }
  } else if (recommendation === 'NEEDS_DISCUSSION') {
    // Needs discussion - remind and extend window
    console.log('  → Needs discussion, extending override window...');

    await updateOpportunityWorkflow(workflow.notice_id, {
      awaiting_input_from: 'lapedra',
      auto_action_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4 more hours
    });

    const app = await getAgentApp('patricia');
    if (app && workflow.thread_ts) {
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `👋 Reminder: James flagged this as "Needs Discussion". No auto-action will be taken - waiting for @Lapedra's input.`,
        thread_ts: workflow.thread_ts,
      });
      await app.stop();
    }
  } else {
    // Edge case - not confident enough to auto-execute
    console.log('  → Not confident enough to auto-execute, awaiting human decision...');

    await updateOpportunityWorkflow(workflow.notice_id, {
      awaiting_input_from: 'lapedra',
      auto_action_at: undefined, // Stop auto-actions
      decision_notes: `Auto-execution skipped: score ${score}, ${redFlags.length} red flags. Human decision required.`,
    });
  }
}

// Main processor function
export async function processWorkflows(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  Workflow Processor - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60));

  const workflows = await getWorkflowsNeedingAction();

  if (workflows.length === 0) {
    console.log('\nNo workflows need action right now.');
    return;
  }

  console.log(`\nFound ${workflows.length} workflow(s) needing action:`);

  for (const workflow of workflows) {
    await processWorkflow(workflow);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\nWorkflow processing complete');
}

// Get workflow status summary
export async function getWorkflowSummary(): Promise<string> {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase
      .from('opportunity_workflow')
      .select('stage, title, awaiting_input_from, james_recommendation, auto_action_at')
      .not('stage', 'in', '("pursuing","passed")')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      return 'No active workflows.';
    }

    const lines = ['*Active Opportunity Workflows*\n'];

    for (const w of data) {
      let status: string;
      if (w.awaiting_input_from) {
        status = `⏳ Awaiting ${w.awaiting_input_from}`;
      } else if (w.auto_action_at) {
        const until = new Date(w.auto_action_at);
        status = `🕐 Override window until ${until.toLocaleTimeString()}`;
      } else {
        status = `🔄 ${w.stage}`;
      }

      const rec = w.james_recommendation ? ` [${w.james_recommendation}]` : '';
      lines.push(`• ${w.title?.slice(0, 35)}...${rec} - ${status}`);
    }

    // Add learning stats
    const stats = await getRecommendationAccuracy();
    if (stats.goRecommendations.total > 0) {
      const winRate = Math.round((stats.goRecommendations.won / stats.goRecommendations.total) * 100);
      lines.push(`\n📊 Historical: ${stats.goRecommendations.total} GO recommendations, ${winRate}% win rate`);
    }

    return lines.join('\n');
  } catch {
    return 'Could not fetch workflow summary.';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const summaryMode = args.includes('--summary');
  const learningMode = args.includes('--learning');

  if (learningMode) {
    const stats = await getRecommendationAccuracy();
    console.log('\n=== Recommendation Accuracy ===');
    console.log(`GO recommendations: ${stats.goRecommendations.total}`);
    console.log(`  Won: ${stats.goRecommendations.won}`);
    console.log(`  Lost: ${stats.goRecommendations.lost}`);
    if (stats.goRecommendations.total > 0) {
      const winRate = Math.round((stats.goRecommendations.won / stats.goRecommendations.total) * 100);
      console.log(`  Win rate: ${winRate}%`);
    }
    console.log(`\nPASS recommendations: ${stats.passRecommendations.total}`);
    console.log(`  Aligned with human: ${stats.passRecommendations.correct}`);
    return;
  }

  if (summaryMode) {
    const summary = await getWorkflowSummary();
    console.log(summary);
    return;
  }

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Workflow Processor - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nRunning every 5 minutes...');
    console.log('Press Ctrl+C to stop\n');

    await processWorkflows();

    cron.schedule('*/5 * * * *', async () => {
      await processWorkflows();
    });

    console.log('Scheduler running...');

  } else {
    await processWorkflows();
  }
}

main().catch(console.error);
