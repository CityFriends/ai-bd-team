/**
 * Slack Slash Command Handlers
 *
 * Handles slash commands like /pipeline for quick access to team features.
 */

import type { App } from '@slack/bolt';
import { getSupabase } from '../integrations/supabase.js';
import { buildPipelineBlocks } from '../utils/slack-blocks.js';

/**
 * Register all slash command handlers with a Slack app
 */
export function registerSlashCommands(app: App): void {
  app.command('/pipeline', handlePipelineCommand);

  console.log('[SlashCommands] Registered /pipeline command');
}

/**
 * Handle /pipeline command - shows current opportunity pipeline
 */
async function handlePipelineCommand({ ack, respond, command }: {
  ack: () => Promise<void>;
  respond: (message: any) => Promise<void>;
  command: { user_id: string; text: string };
}): Promise<void> {
  await ack();

  console.log(`[Command] /pipeline invoked by ${command.user_id}`);

  try {
    const pipeline = await getPipelineData();

    const blocks = buildPipelineBlocks({
      hot: pipeline.hot.map(o => ({
        title: o.title,
        agency: o.agency,
        daysLeft: o.daysLeft,
      })),
      active: pipeline.active.map(o => ({
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
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
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
