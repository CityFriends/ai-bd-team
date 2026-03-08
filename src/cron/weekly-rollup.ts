/**
 * Weekly Rollup Generator
 *
 * Generates an executive summary every Monday with:
 * - Pipeline changes (new, moved, closed)
 * - Key decisions made/pending
 * - Deliverables produced
 * - High-engagement insights from the feed
 * - Upcoming deadlines
 * - Active directives
 *
 * Schedule: Monday 8am ET
 */

import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/database/cron.js';
import {
  getPipelineSummary,
  getUpcomingDeadlines,
  getActiveOpportunities,
} from '../integrations/database/opportunities.js';
import { getHighEngagementPosts, getFeedStats } from '../integrations/database/feed.js';
import {
  getDeliverablesSummary,
  createDeliverable,
} from '../integrations/database/deliverables.js';
import {
  getActiveDirectives,
  formatDirectivesForContext,
} from '../integrations/database/directives.js';
import { postAsAgent } from '../integrations/slack.js';
import type { Opportunity } from '../types/index.js';

// ============================================================
// Data Collection
// ============================================================

interface WeeklyData {
  pipeline: {
    byStatus: Record<string, number>;
    total: number;
    newThisWeek: number;
  };
  deadlines: Opportunity[];
  insights: Array<{
    author: string;
    content: string;
    engagement: number;
  }>;
  deliverables: {
    total: number;
    byType: Record<string, number>;
  };
  feedActivity: {
    posts: number;
    avgEngagement: number;
    unansweredQuestions: number;
  };
  directives: string;
  pendingDecisions: Opportunity[];
}

async function collectWeeklyData(): Promise<WeeklyData> {
  // Pipeline summary
  const pipelineSummary = await getPipelineSummary();

  // Get opportunities created this week
  const activeOpps = await getActiveOpportunities();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const newThisWeek = activeOpps.filter((o) => new Date(o.created_at) >= weekAgo).length;

  // Upcoming deadlines (next 14 days)
  const deadlines = await getUpcomingDeadlines(14);

  // High-engagement insights
  const highEngagement = await getHighEngagementPosts({
    minEngagement: 3,
    sinceHoursAgo: 168, // 7 days
  });
  const insights = highEngagement.slice(0, 5).map((p) => ({
    author: p.author,
    content: p.content.slice(0, 150) + (p.content.length > 150 ? '...' : ''),
    engagement: p.upvotes + p.builds + p.challenges,
  }));

  // Deliverables this week
  const deliverablesSummary = await getDeliverablesSummary(7);

  // Feed activity
  const feedStats = await getFeedStats(168); // 7 days

  // Active directives
  const directives = await getActiveDirectives();
  const directivesFormatted = formatDirectivesForContext(directives);

  // Pending decisions (researching status)
  const pendingDecisions = activeOpps.filter(
    (o) => o.status === 'researching' || o.status === 'new'
  );

  return {
    pipeline: {
      byStatus: pipelineSummary.byStatus,
      total: pipelineSummary.total,
      newThisWeek,
    },
    deadlines,
    insights,
    deliverables: {
      total: deliverablesSummary.total,
      byType: deliverablesSummary.byType,
    },
    feedActivity: {
      posts: feedStats.totalPosts,
      avgEngagement: feedStats.avgEngagement,
      unansweredQuestions: feedStats.unansweredQuestions,
    },
    directives: directivesFormatted,
    pendingDecisions: pendingDecisions.slice(0, 5),
  };
}

// ============================================================
// Rollup Formatting
// ============================================================

function formatWeeklyRollup(data: WeeklyData): string {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const lines: string[] = [
    `:clipboard: *Weekly Rollup: ${dateRange}*`,
    '',
    '*Pipeline Summary*',
    `• Total opportunities: ${data.pipeline.total}`,
    `• New this week: ${data.pipeline.newThisWeek}`,
  ];

  // Status breakdown
  const statusEmoji: Record<string, string> = {
    new: ':new:',
    researching: ':mag:',
    pursuing: ':dart:',
    submitted: ':outbox_tray:',
    won: ':trophy:',
    lost: ':x:',
    passed: ':no_entry_sign:',
  };

  for (const [status, count] of Object.entries(data.pipeline.byStatus)) {
    if (count > 0) {
      lines.push(`  ${statusEmoji[status] || '•'} ${status}: ${count}`);
    }
  }

  // Decisions needed
  if (data.pendingDecisions.length > 0) {
    lines.push('', '*:thinking_face: Decisions Needed*');
    for (const opp of data.pendingDecisions) {
      const deadline = opp.due_date
        ? ` (due ${new Date(opp.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        : '';
      lines.push(`• ${opp.title}${deadline}`);
    }
  }

  // Upcoming deadlines
  const urgentDeadlines = data.deadlines.filter((d) => {
    const daysUntil = Math.ceil(
      (new Date(d.due_date!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysUntil <= 7;
  });

  if (urgentDeadlines.length > 0) {
    lines.push('', '*:calendar: Deadlines This Week*');
    for (const opp of urgentDeadlines) {
      const dueDate = new Date(opp.due_date!).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      lines.push(`• ${dueDate}: ${opp.title}`);
    }
  }

  // Deliverables
  if (data.deliverables.total > 0) {
    lines.push('', '*:package: Deliverables Produced*');
    const typeLabels: Record<string, string> = {
      go_no_go_memo: 'Go/No-Go Memos',
      research_brief: 'Research Briefs',
      partner_shortlist: 'Partner Shortlists',
      tech_assessment: 'Tech Assessments',
      executive_insight: 'Executive Insights',
    };
    for (const [type, count] of Object.entries(data.deliverables.byType)) {
      if (count > 0) {
        lines.push(`• ${typeLabels[type] || type}: ${count}`);
      }
    }
  }

  // Key insights
  if (data.insights.length > 0) {
    lines.push('', '*:bulb: Key Insights This Week*');
    for (const insight of data.insights.slice(0, 3)) {
      lines.push(`• "${insight.content}" — ${insight.author} (${insight.engagement} engagement)`);
    }
  }

  // Team activity
  lines.push('', '*:bar_chart: Team Activity*');
  lines.push(
    `• ${data.feedActivity.posts} posts, avg ${data.feedActivity.avgEngagement.toFixed(1)} engagement, ${data.feedActivity.unansweredQuestions} unanswered questions`
  );

  // Active directives
  if (data.directives !== 'No active directives.') {
    lines.push('', '*:dart: Active Focus*');
    lines.push(data.directives);
  }

  lines.push('', '---', '_Generated by Patricia | AI BD Team_');

  return lines.join('\n');
}

function formatRollupAsMarkdown(data: WeeklyData): string {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const lines: string[] = [
    `# Weekly Rollup`,
    `**Period:** ${weekStart.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
    '',
    '## Pipeline Summary',
    '',
    `| Status | Count |`,
    `|--------|-------|`,
  ];

  for (const [status, count] of Object.entries(data.pipeline.byStatus)) {
    lines.push(`| ${status} | ${count} |`);
  }

  lines.push(
    '',
    `**Total:** ${data.pipeline.total} | **New this week:** ${data.pipeline.newThisWeek}`
  );

  if (data.pendingDecisions.length > 0) {
    lines.push('', '## Decisions Needed', '');
    for (const opp of data.pendingDecisions) {
      const deadline = opp.due_date ? ` (due ${opp.due_date})` : '';
      lines.push(`- [ ] ${opp.title}${deadline}`);
    }
  }

  if (data.deadlines.length > 0) {
    lines.push('', '## Upcoming Deadlines', '');
    for (const opp of data.deadlines.slice(0, 10)) {
      lines.push(`- **${opp.due_date}**: ${opp.title}`);
    }
  }

  if (data.insights.length > 0) {
    lines.push('', '## Key Insights', '');
    for (const insight of data.insights) {
      lines.push(`> "${insight.content}" — ${insight.author} (${insight.engagement} engagement)`);
      lines.push('');
    }
  }

  lines.push('', '## Team Activity', '');
  lines.push(`- Posts: ${data.feedActivity.posts}`);
  lines.push(`- Avg Engagement: ${data.feedActivity.avgEngagement.toFixed(1)}`);
  lines.push(`- Unanswered Questions: ${data.feedActivity.unansweredQuestions}`);

  if (data.deliverables.total > 0) {
    lines.push('', '## Deliverables', '');
    for (const [type, count] of Object.entries(data.deliverables.byType)) {
      if (count > 0) {
        lines.push(`- ${type}: ${count}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================
// Main Rollup Function
// ============================================================

export async function generateWeeklyRollup(): Promise<{
  posted: boolean;
  deliverableId: string | null;
}> {
  console.log('[WeeklyRollup] Generating weekly rollup...');

  const data = await collectWeeklyData();
  const slackMessage = formatWeeklyRollup(data);
  const markdownContent = formatRollupAsMarkdown(data);

  // Create deliverable record
  const deliverable = await createDeliverable({
    deliverable_type: 'weekly_rollup',
    title: `Weekly Rollup - ${new Date().toISOString().split('T')[0]}`,
    owner_agent: 'patricia',
    content: markdownContent,
    metadata: {
      pipelineTotal: data.pipeline.total,
      newThisWeek: data.pipeline.newThisWeek,
      deadlineCount: data.deadlines.length,
      insightCount: data.insights.length,
    },
  });

  // Post to Slack
  let posted = false;
  try {
    await postAsAgent('pm', slackMessage);
    posted = true;
    console.log('[WeeklyRollup] Posted to Slack');
  } catch (err) {
    console.log('[WeeklyRollup] Slack post skipped:', err instanceof Error ? err.message : 'Error');
  }

  console.log('[WeeklyRollup] Complete');
  return {
    posted,
    deliverableId: deliverable?.id || null,
  };
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronWeeklyRollup(): Promise<void> {
  const { acquired } = await acquireCronLock('weekly-rollup', 30);
  if (!acquired) {
    console.log('[WeeklyRollup] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('weekly-rollup');

  try {
    const result = await generateWeeklyRollup();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: 1,
        notes: result.posted ? 'Posted to Slack' : 'Slack unavailable',
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

if (process.argv[1]?.includes('weekly-rollup')) {
  console.log('[WeeklyRollup] Running manually...');
  cronWeeklyRollup()
    .then(() => {
      console.log('[WeeklyRollup] Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[WeeklyRollup] Failed:', err);
      process.exit(1);
    });
}
