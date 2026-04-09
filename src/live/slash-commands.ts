/**
 * Slack Slash Command Handlers
 *
 * Handles slash commands like /pipeline and /cost for quick access to team features.
 */

import type { App } from '@slack/bolt';
import { getSupabase } from '../integrations/supabase.js';
import { buildPipelineBlocks } from '../utils/slack-blocks.js';
import { getCostSummary, type CostSummary, type CallPurpose } from '../lib/cost-tracker.js';

/**
 * Register all slash command handlers with a Slack app
 */
export function registerSlashCommands(app: App): void {
  app.command('/pipeline', handlePipelineCommand);
  app.command('/cost', handleCostCommand);

  console.log('[SlashCommands] Registered /pipeline, /cost commands');
}

/**
 * Handle /pipeline command - shows current opportunity pipeline
 */
async function handlePipelineCommand({
  ack,
  respond,
  command,
}: {
  ack: () => Promise<void>;
  respond: (message: any) => Promise<void>;
  command: { user_id: string; text: string };
}): Promise<void> {
  await ack();

  console.log(`[Command] /pipeline invoked by ${command.user_id}`);

  try {
    const pipeline = await getPipelineData();

    const blocks = buildPipelineBlocks({
      hot: pipeline.hot.map((o) => ({
        title: o.title,
        agency: o.agency,
        daysLeft: o.daysLeft,
      })),
      active: pipeline.active.map((o) => ({
        title: o.title,
        stage: formatStage(o.stage),
        owner: o.owner,
      })),
      watching: pipeline.watchingCount,
    });

    // Add summary stats at the top
    const summaryText = `📊 *Pipeline Summary*\n• ${pipeline.hot.length} hot (due this week)\n• ${pipeline.active.length} in active pursuit\n• ${pipeline.watchingCount} watching\n• ${pipeline.passedCount} passed (last 30 days)`;

    await respond({
      response_type: 'ephemeral', // Only visible to the user who ran the command
      text: summaryText,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: summaryText },
        },
        { type: 'divider' },
        ...blocks,
      ],
    });
  } catch (err) {
    console.error('[Command] Error handling /pipeline:', err);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Error fetching pipeline data. Please try again.',
    });
  }
}

interface PipelineOpportunity {
  id: string;
  noticeId: string;
  title: string;
  agency?: string;
  stage: string;
  score: number;
  dueDate?: string;
  daysLeft?: number;
  owner?: string;
  jamesRecommendation?: string;
}

interface PipelineData {
  hot: PipelineOpportunity[];
  active: PipelineOpportunity[];
  watching: PipelineOpportunity[];
  watchingCount: number;
  passedCount: number;
}

/**
 * Get pipeline data from the database
 */
async function getPipelineData(): Promise<PipelineData> {
  const supabase = getSupabase();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result: PipelineData = {
    hot: [],
    active: [],
    watching: [],
    watchingCount: 0,
    passedCount: 0,
  };

  try {
    // Get all active workflows (not passed/won/lost)
    const { data: workflows, error } = await supabase
      .from('opportunity_workflow')
      .select('*')
      .not('stage', 'in', '("passed","won","lost")')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[Pipeline] Error fetching workflows:', error);
      return result;
    }

    if (!workflows) return result;

    for (const opp of workflows) {
      const dueDate = opp.due_date ? new Date(opp.due_date) : null;
      const daysLeft = dueDate
        ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      const opportunity: PipelineOpportunity = {
        id: opp.id,
        noticeId: opp.notice_id,
        title: opp.title || 'Untitled',
        agency: opp.agency,
        stage: opp.stage,
        score: opp.score || 0,
        dueDate: opp.due_date,
        daysLeft,
        owner: opp.agent_responsible,
        jamesRecommendation: opp.james_recommendation,
      };

      // Categorize by urgency and stage
      if (daysLeft !== undefined && daysLeft <= 7 && daysLeft > 0) {
        result.hot.push(opportunity);
      } else if (['pursuing', 'strategy', 'partner_search', 'researching'].includes(opp.stage)) {
        result.active.push(opportunity);
      } else if (['found', 'watching'].includes(opp.stage)) {
        result.watching.push(opportunity);
      }
    }

    result.watchingCount = result.watching.length;

    // Get passed count from last 30 days
    const { count: passedCount } = await supabase
      .from('opportunity_workflow')
      .select('*', { count: 'exact', head: true })
      .eq('stage', 'passed')
      .gte('updated_at', thirtyDaysAgo.toISOString());

    result.passedCount = passedCount || 0;

    // Sort hot by days left (most urgent first)
    result.hot.sort((a, b) => (a.daysLeft || 999) - (b.daysLeft || 999));

    // Sort active by score (highest first)
    result.active.sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error('[Pipeline] Error:', err);
  }

  return result;
}

/**
 * Format stage name for display
 */
function formatStage(stage: string): string {
  const stageLabels: Record<string, string> = {
    found: '🔍 Found',
    watching: '👀 Watching',
    researching: '📚 Researching',
    partner_search: '🤝 Partner Search',
    strategy: '📋 Strategy',
    pursuing: '🚀 Pursuing',
    passed: '⏭️ Passed',
    won: '🏆 Won',
    lost: '❌ Lost',
  };

  return stageLabels[stage] || stage;
}

// ============================================================
// /cost Command
// ============================================================

/**
 * Handle /cost command - shows API cost breakdown
 *
 * Modes:
 * - /cost         - Last 24 hours
 * - /cost weekly  - Last 7 days
 * - /cost monthly - Last 30 days with projection
 */
async function handleCostCommand({
  ack,
  respond,
  command,
}: {
  ack: () => Promise<void>;
  respond: (message: any) => Promise<void>;
  command: { user_id: string; text: string };
}): Promise<void> {
  await ack();

  console.log(`[Command] /cost invoked by ${command.user_id} with args: "${command.text}"`);

  try {
    const arg = command.text.trim().toLowerCase();
    let hoursAgo: number;
    let periodLabel: string;
    let showProjection = false;

    if (arg === 'weekly' || arg === 'week') {
      hoursAgo = 24 * 7;
      periodLabel = 'Last 7 Days';
    } else if (arg === 'monthly' || arg === 'month') {
      hoursAgo = 24 * 30;
      periodLabel = 'Last 30 Days';
      showProjection = true;
    } else {
      hoursAgo = 24;
      periodLabel = 'Last 24 Hours';
    }

    const summary = await getCostSummary({ sinceHoursAgo: hoursAgo });
    const message = formatCostSummary(summary, periodLabel, showProjection);

    await respond({
      response_type: 'ephemeral',
      text: message,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: message },
        },
      ],
    });
  } catch (err) {
    console.error('[Command] Error handling /cost:', err);
    await respond({
      response_type: 'ephemeral',
      text: '❌ Error fetching cost data. Please try again.',
    });
  }
}

/**
 * Format cost summary for Slack display
 */
function formatCostSummary(
  summary: CostSummary,
  periodLabel: string,
  showProjection: boolean
): string {
  const lines: string[] = [];

  // Header
  lines.push(`💰 *API Cost Report: ${periodLabel}*`);
  lines.push('');

  // Total cost
  lines.push(`*Total Cost:* $${summary.total_cost_usd.toFixed(4)}`);
  lines.push(`*Total Calls:* ${summary.total_calls.toLocaleString()}`);
  lines.push(
    `*Tokens:* ${summary.total_input_tokens.toLocaleString()} in / ${summary.total_output_tokens.toLocaleString()} out`
  );

  // Monthly projection
  if (showProjection) {
    // Already showing 30 days, so cost is roughly the monthly cost
    lines.push(`*Monthly Projection:* ~$${summary.total_cost_usd.toFixed(2)}/month`);
  } else {
    // Calculate daily average and project
    const days = periodLabel.includes('7') ? 7 : 1;
    const dailyAvg = summary.total_cost_usd / days;
    const monthlyProjection = dailyAvg * 30;
    lines.push(`*Monthly Projection:* ~$${monthlyProjection.toFixed(2)}/month`);
  }

  lines.push('');

  // By Purpose breakdown
  const purposes = Object.entries(summary.by_purpose)
    .filter(([_, data]) => data.calls > 0)
    .sort((a, b) => b[1].cost - a[1].cost);

  if (purposes.length > 0) {
    lines.push('*By Purpose:*');
    for (const [purpose, data] of purposes.slice(0, 6)) {
      const label = formatPurposeLabel(purpose as CallPurpose);
      lines.push(`  • ${label}: $${data.cost.toFixed(4)} (${data.calls} calls)`);
    }
    lines.push('');
  }

  // By Agent breakdown
  const agents = Object.entries(summary.by_agent)
    .filter(([_, data]) => data.calls > 0)
    .sort((a, b) => b[1].cost - a[1].cost);

  if (agents.length > 0) {
    lines.push('*By Agent:*');
    for (const [agent, data] of agents.slice(0, 6)) {
      const name = agent.charAt(0).toUpperCase() + agent.slice(1);
      lines.push(`  • ${name}: $${data.cost.toFixed(4)} (${data.calls} calls)`);
    }
    lines.push('');
  }

  // By Model breakdown
  const models = Object.entries(summary.by_model)
    .filter(([_, data]) => data.calls > 0)
    .sort((a, b) => b[1].cost - a[1].cost);

  if (models.length > 0) {
    lines.push('*By Model:*');
    for (const [model, data] of models) {
      const shortModel = model.includes('haiku')
        ? 'Haiku'
        : model.includes('sonnet')
          ? 'Sonnet'
          : model;
      lines.push(`  • ${shortModel}: $${data.cost.toFixed(4)} (${data.calls} calls)`);
    }
  }

  return lines.join('\n');
}

/**
 * Format purpose labels for display
 */
function formatPurposeLabel(purpose: CallPurpose): string {
  const labels: Record<CallPurpose, string> = {
    thinking_session: 'Thinking Time',
    engagement_decision: 'Feed Engagement',
    opportunity_analysis: 'Opportunity Scoring',
    research: 'Research',
    outreach_draft: 'Outreach Drafts',
    conversation: 'Conversations',
    summarization: 'Summarization',
    discussion: 'Discussions',
    synthesis: 'Synthesis',
    other: 'Other',
  };
  return labels[purpose] || purpose;
}
