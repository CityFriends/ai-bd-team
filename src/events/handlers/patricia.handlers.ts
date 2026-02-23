// Patricia Event Handlers
// Patricia listens for: GO_NO_GO_DECISION, DEADLINE_WARNING, PIPELINE_HEALTH_CHECK
// Patricia publishes: PURSUIT_SCHEDULED, DEADLINE_WARNING

import {
  EventType,
  EventTypes,
  GoNoGoDecisionPayload,
  DeadlineWarningPayload,
  PipelineHealthCheckPayload,
  PursuitScheduledPayload,
} from '../eventTypes.js';
import { EventHandler, EventHandlerContext, EventHandlerResult } from '../eventProcessor.js';
import { replyInThread } from '../../integrations/slack.js';
import { storeMemory } from '../../memory/index.js';

// ============================================================
// GO_NO_GO_DECISION Handler
// Schedule pursuit activities when decision is GO
// ============================================================
const handleGoNoGoDecision: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event, publishChainEvent } = context;
  const payload = event.payload as GoNoGoDecisionPayload;

  console.log(`[Patricia:Handler] Received decision for "${payload.title}"`);
  console.log(`  Decision: ${payload.decision}`);
  console.log(`  Win probability: ${payload.winProbability}%`);

  // Only act on GO or CONDITIONAL_GO
  if (payload.decision !== 'GO' && payload.decision !== 'CONDITIONAL_GO') {
    console.log(`[Patricia:Handler] Decision is ${payload.decision}, no pursuit scheduling needed`);
    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'skipped',
        reason: `Decision was ${payload.decision}`,
      },
    };
  }

  console.log(`[Patricia:Handler] Scheduling pursuit for "${payload.title}"`);

  try {
    // Create pursuit schedule
    const pursuitSchedule = createPursuitSchedule(payload);

    // Build the PURSUIT_SCHEDULED payload
    const pursuitPayload: PursuitScheduledPayload = pursuitSchedule;

    // Store pursuit as memory
    await storePursuitMemory(payload, pursuitSchedule, event.id);

    // POST TO SLACK - Make the schedule visible
    if (event.thread_ts) {
      try {
        const slackMessage = formatPursuitScheduleForSlack(pursuitSchedule);
        await replyInThread('pm', slackMessage, event.thread_ts);
        console.log(`[Patricia:Handler] Posted pursuit schedule to thread ${event.thread_ts}`);
      } catch (slackErr) {
        console.warn(`[Patricia:Handler] Failed to post to Slack:`, slackErr);
      }
    }

    // Publish chain event
    const chainResult = await publishChainEvent(
      EventTypes.PURSUIT_SCHEDULED,
      pursuitPayload as unknown as Record<string, unknown>
    );

    if (!chainResult.success) {
      console.error(`[Patricia:Handler] Failed to publish PURSUIT_SCHEDULED: ${chainResult.error}`);
    }

    // TODO: Create actual calendar events, Notion tasks, etc.
    console.log(
      `[Patricia:Handler] Created pursuit schedule with ${pursuitSchedule.milestones.length} milestones`
    );

    return {
      success: true,
      result: {
        noticeId: payload.noticeId,
        action: 'pursuit_scheduled',
        milestonesCount: pursuitSchedule.milestones.length,
        teamAssignmentsCount: pursuitSchedule.teamAssignments.length,
      },
    };
  } catch (err) {
    console.error(`[Patricia:Handler] Pursuit scheduling failed:`, err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Pursuit scheduling failed',
    };
  }
};

// ============================================================
// DEADLINE_WARNING Handler
// Handle urgent deadline notifications
// ============================================================
const handleDeadlineWarning: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as DeadlineWarningPayload;

  console.log(`[Patricia:Handler] ⚠️ DEADLINE WARNING for "${payload.title}"`);
  console.log(`  Hours remaining: ${payload.hoursRemaining}`);
  console.log(`  Current stage: ${payload.currentStage}`);
  console.log(`  Blockers: ${payload.blockers.length}`);

  // Log urgent actions
  if (payload.urgentActions.length > 0) {
    console.log(`  Urgent actions:`);
    payload.urgentActions.forEach((action, i) => {
      console.log(`    ${i + 1}. ${action}`);
    });
  }

  // TODO: In production, this would:
  // 1. Send Slack notifications to team
  // 2. Update Notion status
  // 3. Maybe send email alerts for critical deadlines

  return {
    success: true,
    result: {
      noticeId: payload.noticeId,
      hoursRemaining: payload.hoursRemaining,
      blockersCount: payload.blockers.length,
      urgentActionsCount: payload.urgentActions.length,
    },
  };
};

// ============================================================
// PIPELINE_HEALTH_CHECK Handler
// Review and report on pipeline health
// ============================================================
const handlePipelineHealthCheck: EventHandler = async (
  context: EventHandlerContext
): Promise<EventHandlerResult> => {
  const { event } = context;
  const payload = event.payload as PipelineHealthCheckPayload;

  console.log(`[Patricia:Handler] 📊 Pipeline Health Check`);
  console.log(`  Total opportunities: ${payload.totalOpportunities}`);
  console.log(`  Health score: ${payload.healthScore}%`);

  // Log stage breakdown
  console.log(`  By stage:`);
  for (const [stage, count] of Object.entries(payload.byStage)) {
    console.log(`    - ${stage}: ${count}`);
  }

  // Log stuck opportunities
  if (payload.stuckOpportunities.length > 0) {
    console.log(`  ⚠️ Stuck opportunities (${payload.stuckOpportunities.length}):`);
    payload.stuckOpportunities.forEach((opp) => {
      console.log(`    - "${opp.title}" stuck in ${opp.stage} for ${opp.daysInStage} days`);
    });
  }

  // Log upcoming deadlines
  if (payload.upcomingDeadlines.length > 0) {
    console.log(`  📅 Upcoming deadlines (${payload.upcomingDeadlines.length}):`);
    payload.upcomingDeadlines.forEach((opp) => {
      console.log(`    - "${opp.title}" due in ${opp.daysRemaining} days`);
    });
  }

  // Log recommendations
  if (payload.recommendations.length > 0) {
    console.log(`  💡 Recommendations:`);
    payload.recommendations.forEach((rec, i) => {
      console.log(`    ${i + 1}. ${rec}`);
    });
  }

  // Publish deadline warnings for opportunities within 24 hours
  const criticalDeadlines = payload.upcomingDeadlines.filter((opp) => opp.daysRemaining <= 1);
  const chainEvents = criticalDeadlines.map((opp) => ({
    eventType: EventTypes.DEADLINE_WARNING as EventType,
    payload: {
      noticeId: opp.noticeId,
      title: opp.title,
      deadline: opp.deadline,
      hoursRemaining: opp.daysRemaining * 24,
      currentStage: 'unknown', // Would need to look this up
      blockers: [],
      urgentActions: ['Review and finalize submission'],
    },
    priority: 1, // High priority for deadline warnings
  }));

  return {
    success: true,
    result: {
      healthScore: payload.healthScore,
      totalOpportunities: payload.totalOpportunities,
      stuckCount: payload.stuckOpportunities.length,
      upcomingDeadlinesCount: payload.upcomingDeadlines.length,
      recommendationsCount: payload.recommendations.length,
    },
    chainEvents,
  };
};

// ============================================================
// Memory Storage
// ============================================================
async function storePursuitMemory(
  decision: GoNoGoDecisionPayload,
  schedule: PursuitScheduledPayload,
  eventId: string
): Promise<void> {
  try {
    const milestonesCount = schedule.milestones.length;
    const teamSize = schedule.teamAssignments.length;
    const deadline = new Date(schedule.deadline).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    const content = `Scheduled pursuit for "${decision.title}". Win probability: ${decision.winProbability}%. ${milestonesCount} milestones, ${teamSize} team members assigned. Deadline: ${deadline}.`;

    // Build tags
    const tags: string[] = ['pursuit-scheduled'];

    // Win probability buckets
    if (decision.winProbability >= 70) {
      tags.push('high-probability');
    } else if (decision.winProbability >= 40) {
      tags.push('medium-probability');
    } else {
      tags.push('low-probability');
    }

    // Decision type
    tags.push(`decision-${decision.decision.toLowerCase().replace('_', '-')}`);

    await storeMemory('patricia', 'observation', content, {
      relatedOpportunityId: decision.noticeId,
      relatedEventId: eventId,
      importance: 6,
      tags,
    });

    console.log(`[Patricia:Handler] Stored pursuit memory for ${decision.noticeId}`);
  } catch (err) {
    console.warn(`[Patricia:Handler] Failed to store pursuit memory:`, err);
  }
}

// ============================================================
// Helper Functions
// ============================================================
function createPursuitSchedule(decision: GoNoGoDecisionPayload): PursuitScheduledPayload {
  // For now, create a basic schedule
  // In production, this would be more sophisticated based on deadline analysis
  const now = new Date();

  // Default milestones for a pursuit
  const milestones = [
    {
      name: 'Kickoff Meeting',
      dueDate: addDays(now, 1).toISOString(),
      owner: 'patricia' as const,
    },
    {
      name: 'Solution Architecture Draft',
      dueDate: addDays(now, 3).toISOString(),
      owner: 'marcus' as const,
    },
    {
      name: 'Teaming Partners Confirmed',
      dueDate: addDays(now, 5).toISOString(),
      owner: 'rosa' as const,
    },
    {
      name: 'First Draft Complete',
      dueDate: addDays(now, 7).toISOString(),
      owner: 'jodie' as const,
    },
    {
      name: 'Internal Review',
      dueDate: addDays(now, 10).toISOString(),
      owner: 'james' as const,
    },
    {
      name: 'Final Submission',
      dueDate: addDays(now, 14).toISOString(),
      owner: 'patricia' as const,
    },
  ];

  // Team assignments
  const teamAssignments = [
    {
      agent: 'patricia' as const,
      role: 'Pursuit Manager',
      tasks: ['Coordinate team', 'Track deadlines', 'Manage submissions'],
    },
    {
      agent: 'marcus' as const,
      role: 'Technical Lead',
      tasks: ['Draft technical approach', 'Solution architecture', 'Compliance review'],
    },
    {
      agent: 'rosa' as const,
      role: 'Teaming Lead',
      tasks: ['Finalize partners', 'Negotiate agreements', 'Coordinate partner inputs'],
    },
    {
      agent: 'james' as const,
      role: 'Strategy Lead',
      tasks: ['Price-to-win analysis', 'Win theme development', 'Final review'],
    },
    {
      agent: 'david' as const,
      role: 'Research Support',
      tasks: ['Competitor analysis', 'Agency intelligence', 'Risk assessment'],
    },
  ];

  return {
    noticeId: decision.noticeId,
    title: decision.title,
    deadline: addDays(now, 14).toISOString(), // Default 2 weeks if no deadline provided
    milestones,
    teamAssignments,
    kickoffScheduled: true,
    kickoffDate: addDays(now, 1).toISOString(),
  };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ============================================================
// Slack Formatting
// ============================================================
function formatPursuitScheduleForSlack(schedule: PursuitScheduledPayload): string {
  let message = `📋 *Pursuit Scheduled*\n\n`;
  message += `I've set up the pursuit schedule. Here's the plan:\n\n`;

  // Kickoff
  if (schedule.kickoffScheduled && schedule.kickoffDate) {
    const kickoffDate = new Date(schedule.kickoffDate).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    message += `*🚀 Kickoff:* ${kickoffDate}\n\n`;
  }

  // Key milestones
  message += `*Key Milestones:*\n`;
  for (const milestone of schedule.milestones.slice(0, 4)) {
    const dueDate = new Date(milestone.dueDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const owner = milestone.owner ? ` (${milestone.owner})` : '';
    message += `• ${milestone.name}${owner} — ${dueDate}\n`;
  }
  if (schedule.milestones.length > 4) {
    message += `_...and ${schedule.milestones.length - 4} more milestones_\n`;
  }
  message += '\n';

  // Team assignments
  message += `*Team Assignments:*\n`;
  for (const assignment of schedule.teamAssignments.slice(0, 4)) {
    message += `• *${assignment.agent}* — ${assignment.role}\n`;
  }

  message += `\n_I'll send reminders as deadlines approach. Let's win this!_ 🎯`;

  return message;
}

// ============================================================
// Export Handler Map
// ============================================================
export const patriciaHandlers: Map<EventType, EventHandler> = new Map([
  [EventTypes.GO_NO_GO_DECISION, handleGoNoGoDecision],
  [EventTypes.DEADLINE_WARNING, handleDeadlineWarning],
  [EventTypes.PIPELINE_HEALTH_CHECK, handlePipelineHealthCheck],
]);
