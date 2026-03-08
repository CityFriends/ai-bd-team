/**
 * Deadline Monitor Cron
 *
 * Runs daily to check for upcoming RFP deadlines and generate alerts.
 * Ensures the team doesn't miss critical submission dates.
 *
 * Schedule: Daily at 9am ET
 */

import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/database/cron.js';
import {
  getUpcomingDeadlines,
  getStaleOpportunities,
} from '../integrations/database/opportunities.js';
import { createFeedPost } from '../integrations/database/feed.js';
import { postAsAgent } from '../integrations/slack.js';
import type { Opportunity } from '../types/index.js';

// ============================================================
// Alert Rules
// ============================================================

interface DeadlineAlert {
  opportunity: Opportunity;
  daysUntilDue: number;
  alertLevel: 'info' | 'warning' | 'urgent' | 'critical';
  message: string;
}

function calculateDaysUntilDue(dueDate: string): number {
  const due = new Date(dueDate);
  const now = new Date();
  const diffTime = due.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function generateAlerts(opportunities: Opportunity[]): DeadlineAlert[] {
  const alerts: DeadlineAlert[] = [];

  for (const opp of opportunities) {
    if (!opp.due_date) continue;

    const daysUntilDue = calculateDaysUntilDue(opp.due_date);

    // Skip if already past due
    if (daysUntilDue < 0) continue;

    let alertLevel: DeadlineAlert['alertLevel'] = 'info';
    let message = '';

    if (daysUntilDue === 0) {
      alertLevel = 'critical';
      message = `DUE TODAY: ${opp.title}`;
    } else if (daysUntilDue === 1) {
      alertLevel = 'critical';
      message = `DUE TOMORROW: ${opp.title}`;
    } else if (daysUntilDue <= 3) {
      alertLevel = 'urgent';
      message = `${daysUntilDue} days until deadline: ${opp.title}`;
    } else if (daysUntilDue <= 7) {
      alertLevel = 'warning';
      message = `${daysUntilDue} days until deadline: ${opp.title}`;
    } else if (daysUntilDue <= 14) {
      alertLevel = 'info';
      message = `Upcoming deadline (${daysUntilDue} days): ${opp.title}`;
    }

    // Add status-specific context
    if (opp.status === 'new' && daysUntilDue <= 7) {
      message += ` - Still in "new" status, needs decision`;
      if (alertLevel === 'info') alertLevel = 'warning';
    } else if (opp.status === 'researching' && daysUntilDue <= 5) {
      message += ` - Still researching, needs go/no-go`;
      if (alertLevel === 'info' || alertLevel === 'warning') alertLevel = 'urgent';
    }

    if (message) {
      alerts.push({
        opportunity: opp,
        daysUntilDue,
        alertLevel,
        message,
      });
    }
  }

  // Sort by urgency (critical first, then by days)
  const levelOrder = { critical: 0, urgent: 1, warning: 2, info: 3 };
  alerts.sort((a, b) => {
    const levelDiff = levelOrder[a.alertLevel] - levelOrder[b.alertLevel];
    if (levelDiff !== 0) return levelDiff;
    return a.daysUntilDue - b.daysUntilDue;
  });

  return alerts;
}

// ============================================================
// Slack Formatting
// ============================================================

const ALERT_EMOJI: Record<DeadlineAlert['alertLevel'], string> = {
  critical: ':rotating_light:',
  urgent: ':warning:',
  warning: ':eyes:',
  info: ':calendar:',
};

function formatAlertsForSlack(alerts: DeadlineAlert[]): string {
  if (alerts.length === 0) {
    return ':white_check_mark: No urgent deadlines. Pipeline is healthy.';
  }

  const lines: string[] = ['*:clock1: Deadline Report*', ''];

  const critical = alerts.filter((a) => a.alertLevel === 'critical');
  const urgent = alerts.filter((a) => a.alertLevel === 'urgent');
  const warning = alerts.filter((a) => a.alertLevel === 'warning');
  const info = alerts.filter((a) => a.alertLevel === 'info');

  if (critical.length > 0) {
    lines.push(':rotating_light: *CRITICAL*');
    for (const alert of critical) {
      lines.push(`  ${alert.message}`);
      lines.push(
        `  └ Agency: ${alert.opportunity.agency || 'Unknown'} | Status: ${alert.opportunity.status}`
      );
    }
    lines.push('');
  }

  if (urgent.length > 0) {
    lines.push(':warning: *Urgent*');
    for (const alert of urgent) {
      lines.push(`  ${alert.message}`);
    }
    lines.push('');
  }

  if (warning.length > 0) {
    lines.push(':eyes: *Needs Attention*');
    for (const alert of warning) {
      lines.push(`  ${alert.message}`);
    }
    lines.push('');
  }

  if (info.length > 0) {
    lines.push(':calendar: *Coming Up*');
    for (const alert of info) {
      lines.push(`  ${alert.message}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Stale Opportunity Check
// ============================================================

async function checkStaleOpportunities(): Promise<string[]> {
  const stale = await getStaleOpportunities(7);
  const messages: string[] = [];

  if (stale.length > 0) {
    messages.push(`:spider_web: *${stale.length} stale opportunities* (no activity in 7+ days):`);
    for (const opp of stale.slice(0, 5)) {
      const daysStale = Math.floor(
        (Date.now() - new Date(opp.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      messages.push(`  • ${opp.title} (${daysStale} days inactive)`);
    }
    if (stale.length > 5) {
      messages.push(`  _...and ${stale.length - 5} more_`);
    }
  }

  return messages;
}

// ============================================================
// Main Monitor Function
// ============================================================

export async function runDeadlineMonitor(): Promise<{
  alertCount: number;
  criticalCount: number;
  staleCount: number;
}> {
  console.log('[DeadlineMonitor] Checking for upcoming deadlines...');

  // Get opportunities with deadlines in next 14 days
  const upcoming = await getUpcomingDeadlines(14);
  const alerts = generateAlerts(upcoming);

  const criticalCount = alerts.filter(
    (a) => a.alertLevel === 'critical' || a.alertLevel === 'urgent'
  ).length;

  // Check for stale opportunities
  const stale = await getStaleOpportunities(7);

  // Only post to Slack if there are alerts or it's Monday (weekly summary)
  const isMonday = new Date().getDay() === 1;
  const shouldPost = alerts.length > 0 || stale.length > 0 || isMonday;

  if (shouldPost) {
    try {
      const slackMessage = formatAlertsForSlack(alerts);
      const staleMessages = await checkStaleOpportunities();
      const fullMessage =
        staleMessages.length > 0 ? `${slackMessage}\n\n${staleMessages.join('\n')}` : slackMessage;

      await postAsAgent('pm', fullMessage);
      console.log('[DeadlineMonitor] Posted to Slack');
    } catch (err) {
      console.log(
        '[DeadlineMonitor] Slack post skipped:',
        err instanceof Error ? err.message : 'Error'
      );
    }
  }

  // Create feed post for critical/urgent alerts
  if (criticalCount > 0) {
    const criticalAlerts = alerts.filter(
      (a) => a.alertLevel === 'critical' || a.alertLevel === 'urgent'
    );
    const content = criticalAlerts
      .map((a) => `${ALERT_EMOJI[a.alertLevel]} ${a.message}`)
      .join('\n');

    await createFeedPost({
      author: 'patricia',
      postType: 'observation',
      content: `Deadline Alert: ${criticalCount} opportunities need immediate attention.\n\n${content}`,
      tags: ['deadline', 'urgent', 'pipeline'],
      importance: 9,
    });
  }

  console.log(
    `[DeadlineMonitor] Complete. ${alerts.length} alerts (${criticalCount} critical/urgent), ${stale.length} stale`
  );

  return {
    alertCount: alerts.length,
    criticalCount,
    staleCount: stale.length,
  };
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronDeadlineMonitor(): Promise<void> {
  const { acquired } = await acquireCronLock('deadline-monitor', 30);
  if (!acquired) {
    console.log('[DeadlineMonitor] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('deadline-monitor');

  try {
    const result = await runDeadlineMonitor();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: result.alertCount,
        notes: `${result.criticalCount} critical, ${result.staleCount} stale`,
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

if (process.argv[1]?.includes('deadline-monitor')) {
  console.log('[DeadlineMonitor] Running manually...');
  cronDeadlineMonitor()
    .then(() => {
      console.log('[DeadlineMonitor] Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[DeadlineMonitor] Failed:', err);
      process.exit(1);
    });
}
