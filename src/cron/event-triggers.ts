/**
 * Event Triggers - Cron-triggered autonomous events
 *
 * This module publishes events on a schedule to trigger autonomous agent behaviors.
 * These are additive to existing cron jobs - they don't replace them.
 *
 * Schedules (all times UTC):
 * - Pipeline Health Check: Every 2 hours during business hours
 * - Deadline Check: Every hour
 * - System Health Check: Every 30 minutes
 * - Stale Event Cleanup: Every 5 minutes
 */
import 'dotenv/config';
import { logJobStart, logJobComplete, logJobFailed } from '../integrations/supabase.js';
import { publishEvent, expireStaleEvents, EventTypes } from '../events/index.js';
import type { PipelineHealthCheckPayload, SystemHealthCheckPayload } from '../events/eventTypes.js';
import { getWorkflowsByStage } from '../integrations/database/workflow.js';

// ============================================================
// Pipeline Health Check
// ============================================================
export async function triggerPipelineHealthCheck(): Promise<void> {
  console.log('[EventTrigger] Running pipeline health check...');

  try {
    // Gather pipeline data
    const [foundOpps, researchingOpps, strategyOpps, pursuingOpps] = await Promise.all([
      getWorkflowsByStage('found'),
      getWorkflowsByStage('researching'),
      getWorkflowsByStage('strategy'),
      getWorkflowsByStage('pursuing'),
    ]);

    const totalOpportunities =
      foundOpps.length + researchingOpps.length + strategyOpps.length + pursuingOpps.length;

    // Build stuck opportunities list
    const stuckOpportunities: PipelineHealthCheckPayload['stuckOpportunities'] = [];
    const now = new Date();

    for (const workflow of [...foundOpps, ...researchingOpps, ...strategyOpps]) {
      const stageEnteredAt = new Date(
        workflow.stage_entered_at || workflow.created_at || now.toISOString()
      );
      const daysInStage = Math.floor(
        (now.getTime() - stageEnteredAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Consider stuck if in stage for more than 3 days
      if (daysInStage > 3) {
        stuckOpportunities.push({
          noticeId: workflow.notice_id,
          title: workflow.title || 'Unknown',
          stage: workflow.stage,
          daysInStage,
          lastActivity: workflow.updated_at || workflow.created_at || now.toISOString(),
        });
      }
    }

    // Build upcoming deadlines
    // Note: Currently OpportunityWorkflow doesn't have response_deadline
    // This would need to be added to the workflow table or fetched from opportunities
    const upcomingDeadlines: PipelineHealthCheckPayload['upcomingDeadlines'] = [];
    // TODO: Fetch deadlines from opportunity data when available

    // Calculate health score
    let healthScore = 100;
    healthScore -= stuckOpportunities.length * 10; // -10 per stuck opp
    healthScore -= upcomingDeadlines.filter((d) => d.daysRemaining <= 3).length * 15; // -15 per critical deadline
    healthScore = Math.max(0, Math.min(100, healthScore));

    // Generate recommendations
    const recommendations: string[] = [];
    if (stuckOpportunities.length > 0) {
      recommendations.push(
        `Review ${stuckOpportunities.length} stuck opportunities that need attention`
      );
    }
    if (upcomingDeadlines.some((d) => d.daysRemaining <= 1)) {
      recommendations.push('Critical: Some deadlines are within 24 hours');
    }
    if (foundOpps.length > 5) {
      recommendations.push('Consider prioritizing research on found opportunities');
    }
    if (totalOpportunities === 0) {
      recommendations.push('Pipeline is empty - check opportunity sources');
    }

    const payload: PipelineHealthCheckPayload = {
      totalOpportunities,
      byStage: {
        found: foundOpps.length,
        researching: researchingOpps.length,
        strategy: strategyOpps.length,
        pursuing: pursuingOpps.length,
      },
      stuckOpportunities,
      upcomingDeadlines,
      healthScore,
      recommendations,
    };

    // Publish the event
    const result = await publishEvent({
      eventType: EventTypes.PIPELINE_HEALTH_CHECK,
      sourceAgent: 'system',
      payload: payload as unknown as Record<string, unknown>,
      priority: 5,
    });

    if (result.success) {
      console.log(
        `[EventTrigger] Pipeline health check published (health: ${healthScore}%, event: ${result.eventId})`
      );
    } else {
      console.error(`[EventTrigger] Failed to publish pipeline health check: ${result.error}`);
    }
  } catch (err) {
    console.error('[EventTrigger] Pipeline health check failed:', err);
    throw err;
  }
}

// ============================================================
// Deadline Check
// ============================================================
export async function triggerDeadlineCheck(): Promise<void> {
  console.log('[EventTrigger] Running deadline check...');

  try {
    // Note: Currently OpportunityWorkflow doesn't have response_deadline field
    // This function is a placeholder until deadline tracking is added to workflows
    // For now, just log that no deadline checking is available
    console.log('[EventTrigger] Deadline check: No deadline field available in workflow schema');
    console.log('[EventTrigger] Deadline check complete (0 warnings published)');
  } catch (err) {
    console.error('[EventTrigger] Deadline check failed:', err);
    throw err;
  }
}

// ============================================================
// System Health Check
// ============================================================
export async function triggerSystemHealthCheck(): Promise<void> {
  console.log('[EventTrigger] Running system health check...');

  try {
    const now = new Date().toISOString();

    // Check API status (simplified - in production would actually check)
    const apiStatus: SystemHealthCheckPayload['apiStatus'] = {
      'sam.gov': { status: 'healthy', lastCheck: now },
      supabase: { status: 'healthy', lastCheck: now },
      anthropic: { status: 'healthy', lastCheck: now },
      slack: { status: 'healthy', lastCheck: now },
    };

    // Check agent status (simplified)
    const agentStatus: SystemHealthCheckPayload['agentStatus'] = {
      maya: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
      david: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
      rosa: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
      james: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
      patricia: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
      jodie: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
      marcus: { status: 'idle', lastActivity: now, eventsProcessed24h: 0 },
    };

    // Calculate overall health
    const hasUnhealthyApi = Object.values(apiStatus).some((s) => s.status !== 'healthy');
    const hasErrorAgent = Object.values(agentStatus).some((s) => s.status === 'error');
    const overallHealth: 'healthy' | 'degraded' | 'critical' = hasErrorAgent
      ? 'critical'
      : hasUnhealthyApi
        ? 'degraded'
        : 'healthy';

    const alerts: SystemHealthCheckPayload['alerts'] = [];
    if (hasUnhealthyApi) {
      alerts.push({ severity: 'warning', message: 'Some APIs are degraded', source: 'system' });
    }
    if (hasErrorAgent) {
      alerts.push({ severity: 'critical', message: 'Some agents have errors', source: 'system' });
    }

    const payload: SystemHealthCheckPayload = {
      apiStatus,
      agentStatus,
      alerts,
      overallHealth,
    };

    const result = await publishEvent({
      eventType: EventTypes.SYSTEM_HEALTH_CHECK,
      sourceAgent: 'system',
      payload: payload as unknown as Record<string, unknown>,
      priority: overallHealth === 'critical' ? 1 : overallHealth === 'degraded' ? 3 : 7,
    });

    if (result.success) {
      console.log(`[EventTrigger] System health check published (status: ${overallHealth})`);
    }
  } catch (err) {
    console.error('[EventTrigger] System health check failed:', err);
    throw err;
  }
}

// ============================================================
// Stale Event Cleanup
// ============================================================
export async function triggerStaleEventCleanup(): Promise<void> {
  console.log('[EventTrigger] Running stale event cleanup...');

  try {
    const expiredCount = await expireStaleEvents();
    console.log(`[EventTrigger] Stale event cleanup complete (${expiredCount} expired)`);
  } catch (err) {
    console.error('[EventTrigger] Stale event cleanup failed:', err);
    throw err;
  }
}

// ============================================================
// Cron Entry Points
// ============================================================

/**
 * Entry point for pipeline health check cron
 * Schedule: Every 2 hours during business hours (9am-6pm EST, Mon-Fri)
 */
export async function cronPipelineHealthCheck(): Promise<void> {
  const runId = await logJobStart('event-pipeline-health');

  try {
    await triggerPipelineHealthCheck();

    if (runId) {
      await logJobComplete(runId, { notes: 'Pipeline health check triggered' });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

/**
 * Entry point for deadline check cron
 * Schedule: Every hour
 */
export async function cronDeadlineCheck(): Promise<void> {
  const runId = await logJobStart('event-deadline-check');

  try {
    await triggerDeadlineCheck();

    if (runId) {
      await logJobComplete(runId, { notes: 'Deadline check triggered' });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

/**
 * Entry point for system health check cron
 * Schedule: Every 30 minutes
 */
export async function cronSystemHealthCheck(): Promise<void> {
  const runId = await logJobStart('event-system-health');

  try {
    await triggerSystemHealthCheck();

    if (runId) {
      await logJobComplete(runId, { notes: 'System health check triggered' });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

/**
 * Entry point for stale event cleanup cron
 * Schedule: Every 5 minutes
 */
export async function cronStaleEventCleanup(): Promise<void> {
  const runId = await logJobStart('event-cleanup');

  try {
    await triggerStaleEventCleanup();

    if (runId) {
      await logJobComplete(runId, { notes: 'Stale event cleanup complete' });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

// ============================================================
// Direct execution entry point
// ============================================================
async function main() {
  const trigger = process.argv[2] || 'all';

  console.log(`[EventTrigger] Starting with trigger: ${trigger}`);

  try {
    switch (trigger) {
      case 'pipeline':
        await cronPipelineHealthCheck();
        break;
      case 'deadline':
        await cronDeadlineCheck();
        break;
      case 'system':
        await cronSystemHealthCheck();
        break;
      case 'cleanup':
        await cronStaleEventCleanup();
        break;
      case 'all':
        await Promise.all([
          cronPipelineHealthCheck(),
          cronDeadlineCheck(),
          cronSystemHealthCheck(),
          cronStaleEventCleanup(),
        ]);
        break;
      default:
        console.error(`Unknown trigger: ${trigger}`);
        console.log(
          'Usage: npx tsx src/cron/event-triggers.ts [pipeline|deadline|system|cleanup|all]'
        );
        process.exit(1);
    }

    console.log('[EventTrigger] Complete');
    process.exit(0);
  } catch (err) {
    console.error('[EventTrigger] Failed:', err);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('event-triggers')) {
  main();
}
