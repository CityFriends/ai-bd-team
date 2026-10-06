/**
 * Run All BD Team Services
 *
 * Single entry point for production deployment (Railway).
 * Runs: Live agents + scheduled cron jobs for Maya, David, and Patricia
 *
 * All agent scans use distributed locks (acquireCronLock) to prevent
 * duplicate runs across replicas.
 *
 * MILESTONE 1A: All AUTONOMOUS_EXTERNAL_ACTIVITY jobs are guarded by
 * isAutonomousAIEnabled() && isAIEnabled(). When either is false,
 * jobs log a skip and return without side effects.
 */
import 'dotenv/config';
import cron from 'node-cron';
import { logJobStart, logJobComplete, logJobFailed } from '../integrations/supabase.js';
import { isAutonomousAIEnabled, isAIEnabled } from '../config/ai-controls.js';

/**
 * Check whether autonomous external activity is permitted.
 * Both autonomous AI AND global AI must be explicitly enabled.
 * Checked at EXECUTION TIME (not registration time) so runtime
 * control changes take effect without redeployment.
 */
async function isAutonomousActivityPermitted(jobName: string): Promise<boolean> {
  const autonomousEnabled = isAutonomousAIEnabled();
  if (!autonomousEnabled) {
    console.log(
      `[autonomous_job_skipped] job=${jobName} reason=ENABLE_AUTONOMOUS_AI=false ts=${new Date().toISOString()}`
    );
    return false;
  }

  const aiEnabled = await isAIEnabled();
  if (!aiEnabled) {
    console.log(
      `[autonomous_job_skipped] job=${jobName} reason=AI_SYSTEM_ENABLED=false ts=${new Date().toISOString()}`
    );
    return false;
  }

  return true;
}

// Wrapper to run a job with logging
async function runWithLogging(jobName: string, fn: () => Promise<void>): Promise<void> {
  const runId = await logJobStart(jobName);

  try {
    await fn();
    if (runId) {
      await logJobComplete(runId);
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

// LEGACY — Maya scanner functions disabled in Milestone 3A
// Superseded by production/maya/collector.ts + task-processor.ts
// Remove after production Maya is validated.
// async function runMayaDailyScan() { ... }
// async function runMayaWeeklySummary() { ... }

async function runDavidNewsDigest() {
  const { acquireCronLock } = await import('../integrations/supabase.js');
  const { acquired } = await acquireCronLock('david-news-digest', 10);
  if (!acquired) {
    console.log('[CRON] David news digest: Another instance already running, skipping');
    return;
  }
  const { runNewsDigest } = await import('./david-news-digest.js');
  await runNewsDigest();
}

async function runPatriciaStandup() {
  const { acquireCronLock } = await import('../integrations/supabase.js');
  const { acquired } = await acquireCronLock('patricia-standup', 10);
  if (!acquired) {
    console.log('[CRON] Patricia standup: Another instance already running, skipping');
    return;
  }
  const { runMorningCheckin } = await import('./patricia-checkin.js');
  await runMorningCheckin();
}

async function runActionScheduler() {
  const { checkAndExecuteActions } = await import('./action-scheduler.js');
  await checkAndExecuteActions();
}

// Event system triggers
async function runPipelineHealthCheck() {
  const { cronPipelineHealthCheck } = await import('../cron/event-triggers.js');
  await cronPipelineHealthCheck();
}

async function runStaleEventCleanup() {
  const { cronStaleEventCleanup } = await import('../cron/event-triggers.js');
  await cronStaleEventCleanup();
}

async function runWorkflowTimeouts() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('workflow-timeouts', 5, 2);
  if (!lock.acquired) {
    console.log('[CRON] Workflow timeouts: Another instance already running, skipping');
    return;
  }
  try {
    const { processTimeouts } = await import('../workflows/index.js');
    await processTimeouts();
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// Patricia's monthly retrospective
async function runPatriciaRetrospective() {
  const { runMonthlyRetrospective, formatRetrospectiveForSlack } =
    await import('../playbook/retrospective.js');
  const { postAsAgent } = await import('../integrations/slack.js');

  const results = await runMonthlyRetrospective();
  if (results) {
    const message = formatRetrospectiveForSlack(results);
    await postAsAgent('pm', message);
    console.log(`[RETROSPECTIVE] Proposed ${results.rulesProposed.length} new rules`);
  }
}

// Patricia's daily health summary
async function runPatriciaHealthSummary() {
  const { cronHealthSummary } = await import('./patricia-health-summary.js');
  await cronHealthSummary();
}

// Memory reflection job (weekly synthesis of agent observations)
async function runMemoryReflection() {
  const { cronMemoryReflection } = await import('../cron/memory-reflection.js');
  await cronMemoryReflection();
}

// Agent thinking time - proactive insights and observations
async function runAgentThinkingTime() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('agent-thinking-time', 10);
  if (!lock.acquired) {
    console.log('[CRON] Agent thinking time: Another instance already running, skipping');
    return;
  }
  try {
    const { runThinkingTime } = await import('../cron/agent-thinking.js');
    await runThinkingTime();
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// Feed synthesis - aggregate agent observations into feed
async function runFeedSynthesis() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('feed-synthesis', 10);
  if (!lock.acquired) {
    console.log('[CRON] Feed synthesis: Another instance already running, skipping');
    return;
  }
  try {
    const { cronFeedSynthesis } = await import('../cron/feed-synthesis.js');
    await cronFeedSynthesis();
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// Deadline monitor - check for upcoming deadlines and alert
async function runDeadlineMonitor() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('deadline-monitor', 10);
  if (!lock.acquired) {
    console.log('[CRON] Deadline monitor: Another instance already running, skipping');
    return;
  }
  try {
    const { cronDeadlineMonitor } = await import('../cron/deadline-monitor.js');
    await cronDeadlineMonitor();
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// Weekly rollup - summarize the week's activity
async function runWeeklyRollup() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('weekly-rollup', 15);
  if (!lock.acquired) {
    console.log('[CRON] Weekly rollup: Another instance already running, skipping');
    return;
  }
  try {
    const { cronWeeklyRollup } = await import('../cron/weekly-rollup.js');
    await cronWeeklyRollup();
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// Feed to Notion sync - sync agent feed posts to Notion database
async function runFeedToNotionSync() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('feed-notion-sync', 5);
  if (!lock.acquired) {
    return; // Another instance is syncing
  }
  try {
    const { syncRecentPostsToNotion } = await import('../live/feed-to-notion.js');
    // Sync posts from last 4 hours (covers period between runs)
    const result = await syncRecentPostsToNotion(4);
    if (result.synced > 0) {
      console.log(`[FeedSync] Synced ${result.synced} posts to Notion`);
    }
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// Discussion processor - process opportunity discussions from Notion
async function runDiscussionProcessor() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('discussion-processor', 10);
  if (!lock.acquired) {
    console.log('[CRON] Discussion processor: Another instance already running, skipping');
    return;
  }
  try {
    const { cronDiscussionProcessor } = await import('../cron/discussion-processor.js');
    await cronDiscussionProcessor();
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

// System event processor for workflow auto-creation
async function runSystemEventProcessor() {
  const { acquireCronLock, releaseCronLock } = await import('../integrations/database/cron.js');
  const lock = await acquireCronLock('system-event-processor', 2);
  if (!lock.acquired) {
    return; // Another instance is processing
  }

  try {
    const { claimEvents, completeEvent, publishChainEvent, EventTypes } =
      await import('../events/index.js');
    const { getSystemHandlers } = await import('../events/handlers/index.js');

    const handlers = getSystemHandlers();
    const handledTypes = Array.from(handlers.keys());

    // Claim events that have system handlers
    // Using 'maya' as the claimer since system is processing opportunity events
    const allEvents = await claimEvents('maya', 5);
    const events = allEvents.filter((e) =>
      handledTypes.includes(e.event_type as typeof EventTypes.NEW_OPPORTUNITY)
    );

    for (const event of events) {
      const handler = handlers.get(event.event_type as typeof EventTypes.NEW_OPPORTUNITY);
      if (handler) {
        try {
          // Build context for the handler
          const context = {
            event,
            agent: 'maya' as const,
            publishChainEvent: async (
              eventType: any,
              payload: Record<string, unknown>,
              priority?: number,
              targetAgent?: any
            ) => publishChainEvent(eventType, 'maya', payload, event, priority, targetAgent),
          };

          const result = await handler(context);

          await completeEvent({
            eventId: event.id,
            success: result.success,
            result: result.result,
            error: result.error,
          });
        } catch (err) {
          console.error(`[SYSTEM] Event handler failed:`, err);
          await completeEvent({
            eventId: event.id,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  } finally {
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('  AI BD Team - Starting All Services');
  console.log('='.repeat(60));
  console.log(`  Started: ${new Date().toLocaleString()}`);
  console.log('='.repeat(60));

  // Import and start all services
  const services = [
    { name: 'Live Agents (Maya, David, Rosa, James, Patricia)', path: '../live/run-team.js' },
  ];

  console.log('\nStarting services...\n');

  for (const service of services) {
    console.log(`  Starting: ${service.name}`);
    try {
      await import(service.path);
      console.log(`  ✓ ${service.name} started`);
    } catch (err) {
      console.error(`  ✗ Failed to start ${service.name}:`, err);
    }
  }

  // ============================================================
  // SCHEDULED JOBS - AUTONOMOUS_EXTERNAL_ACTIVITY
  // These post to Slack, query external APIs, create events/workflows,
  // or invoke LLMs. Guarded by isAutonomousActivityPermitted().
  // ============================================================

  // LEGACY DISABLED — Maya Daily Scan superseded by production/maya/collector.ts + task-processor.ts
  // Original schedule: '0 14 * * 1-5' (8 AM CST Mon-Fri)
  // Disabled in Milestone 3A. Remove after production Maya is validated.

  // LEGACY DISABLED — Maya Weekly Summary superseded by production/maya/collector.ts
  // Original schedule: '30 14 * * 5' (8:30 AM CST Friday)
  // Disabled in Milestone 3A. Remove after production Maya is validated.

  // David News Digest: 10:00 AM CST Mon/Wed/Fri (16:00 UTC) [AUTONOMOUS: Slack post, LLM, news APIs]
  cron.schedule('0 16 * * 1,3,5', async () => {
    if (!(await isAutonomousActivityPermitted('david-news-digest'))) return;
    try {
      await runWithLogging('david-news-digest', runDavidNewsDigest);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] David: News digest failed:`, err);
    }
  });

  // Patricia Morning Standup: 11:00 AM CST Mon-Fri (17:00 UTC) [AUTONOMOUS: Slack post, LLM]
  cron.schedule('0 17 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('patricia-standup'))) return;
    try {
      await runWithLogging('patricia-standup', runPatriciaStandup);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Patricia: Standup failed:`, err);
    }
  });

  // Action Scheduler: Every 15 minutes [AUTONOMOUS: LLM, Slack posts via action executor]
  cron.schedule('*/15 * * * *', async () => {
    if (!(await isAutonomousActivityPermitted('action-scheduler'))) return;
    try {
      await runWithLogging('action-scheduler', runActionScheduler);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Actions: Scheduler failed:`, err);
    }
  });

  // Pipeline health check: Every 2 hours 9am-5pm CST [AUTONOMOUS: creates agent events]
  cron.schedule('0 14,16,18,20,22 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('event-pipeline-health'))) return;
    try {
      await runWithLogging('event-pipeline-health', runPipelineHealthCheck);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Events: Pipeline health failed:`, err);
    }
  });

  // Patricia monthly retrospective: First Monday 9am CST [AUTONOMOUS: Slack post, playbook]
  cron.schedule('0 15 1-7 * 1', async () => {
    if (!(await isAutonomousActivityPermitted('patricia-retrospective'))) return;
    try {
      await runWithLogging('patricia-retrospective', runPatriciaRetrospective);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Patricia: Retrospective failed:`, err);
    }
  });

  // Patricia daily health summary: 9:00 AM CST Mon-Fri [AUTONOMOUS: LLM, Slack post]
  cron.schedule('0 15 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('patricia-health-summary'))) return;
    try {
      await runWithLogging('patricia-health-summary', runPatriciaHealthSummary);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Patricia: Health summary failed:`, err);
    }
  });

  // Memory reflection: Sundays 2am CST [AUTONOMOUS: LLM]
  cron.schedule('0 8 * * 0', async () => {
    if (!(await isAutonomousActivityPermitted('memory-reflection'))) return;
    try {
      await runWithLogging('memory-reflection', runMemoryReflection);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Memory: Reflection failed:`, err);
    }
  });

  // Agent thinking time: 8am, 12pm, 4pm CST Mon-Fri [AUTONOMOUS: LLM, feed posts]
  cron.schedule('0 14,18,22 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('agent-thinking-time'))) return;
    try {
      await runWithLogging('agent-thinking-time', runAgentThinkingTime);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Thinking: Failed:`, err);
    }
  });

  // Feed synthesis: 9am, 11am, 1pm, 3pm CST Mon-Fri [AUTONOMOUS: LLM, feed posts]
  cron.schedule('0 15,17,19,21 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('feed-synthesis'))) return;
    try {
      await runWithLogging('feed-synthesis', runFeedSynthesis);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Feed: Synthesis failed:`, err);
    }
  });

  // Feed to Notion sync: Every 2 hours 9am-5pm CST [AUTONOMOUS: writes to Notion]
  cron.schedule('30 14,16,18,20,22 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('feed-notion-sync'))) return;
    try {
      await runFeedToNotionSync();
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Feed: Notion sync failed:`, err);
    }
  });

  // Deadline monitor: 8:30am CST daily [AUTONOMOUS: Slack post, feed posts]
  cron.schedule('30 14 * * *', async () => {
    if (!(await isAutonomousActivityPermitted('deadline-monitor'))) return;
    try {
      await runWithLogging('deadline-monitor', runDeadlineMonitor);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Deadlines: Monitor failed:`, err);
    }
  });

  // Weekly rollup: 7am CST Monday [AUTONOMOUS: Slack post, deliverables]
  cron.schedule('0 13 * * 1', async () => {
    if (!(await isAutonomousActivityPermitted('weekly-rollup'))) return;
    try {
      await runWithLogging('weekly-rollup', runWeeklyRollup);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Rollup: Failed:`, err);
    }
  });

  // Discussion processor: 10am, 12pm, 2pm, 4pm CST Mon-Fri [AUTONOMOUS: LLM, Notion]
  cron.schedule('0 16,18,20,22 * * 1-5', async () => {
    if (!(await isAutonomousActivityPermitted('discussion-processor'))) return;
    try {
      await runWithLogging('discussion-processor', runDiscussionProcessor);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Discussions: Failed:`, err);
    }
  });

  // System event processor: Every minute [AUTONOMOUS: creates workflows from events]
  cron.schedule('* * * * *', async () => {
    if (!(await isAutonomousActivityPermitted('system-event-processor'))) return;
    try {
      await runSystemEventProcessor();
    } catch (err) {
      // Silent fail - this runs frequently
    }
  });

  // ============================================================
  // MAYA PRODUCTION — DETERMINISTIC SOURCE COLLECTION
  // ZERO LLM calls. Runs independently of AI controls.
  // Controlled by ENABLE_SOURCE_COLLECTION flag.
  // ============================================================

  // Maya Opportunity Collector: Every 2 hours [DETERMINISTIC: SAM fetch, score, create events. Zero LLM.]
  cron.schedule('0 */2 * * *', async () => {
    const { isSourceCollectionEnabled } = await import('../config/ai-controls.js');
    if (!isSourceCollectionEnabled()) {
      console.log(
        `[autonomous_job_skipped] job=maya-collector reason=ENABLE_SOURCE_COLLECTION=false ts=${new Date().toISOString()}`
      );
      return;
    }
    try {
      const { runCollectorCycle } = await import('../production/maya/collector.js');
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const result = await runCollectorCycle(supabase);
      console.log(
        `[${new Date().toLocaleString()}] Maya Collector: fetched=${result.fetched} new=${result.deduplicated} reviews=${result.reviewEventsCreated} errors=${result.errors.length}`
      );
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Maya Collector failed:`, err);
    }
  });

  // Maya Review Task Processor: Every 5 minutes [CAPABILITY-SCOPED: collector-created review tasks only]
  cron.schedule('*/5 * * * *', async () => {
    const { getFeatureFlag, FEATURE_FLAGS, isAIEnabled } = await import('../config/ai-controls.js');
    if (!getFeatureFlag(FEATURE_FLAGS.MAYA_REVIEW_ENABLED)) return;
    if (!(await isAIEnabled())) {
      console.log(
        `[autonomous_job_skipped] job=maya-review-processor reason=AI_DISABLED ts=${new Date().toISOString()}`
      );
      return;
    }
    try {
      const { processPendingReviews } = await import('../production/maya/task-processor.js');
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const result = await processPendingReviews(supabase);
      if (result.processed > 0) {
        console.log(
          `[${new Date().toLocaleString()}] Maya Reviews: processed=${result.processed} evaluate=${result.evaluate} watch=${result.watch} pass=${result.pass} failed=${result.failed}`
        );
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Maya Review Processor failed:`, err);
    }
  });

  // ============================================================
  // JAMES CAPTURE ORCHESTRATION
  // Capability-scoped: requires JAMES_CAPTURE_ENABLED + isAIEnabled().
  // Does NOT require ENABLE_AUTONOMOUS_AI (legacy autonomous switch).
  // James only processes captures created by explicit human Send to Capture.
  // ============================================================

  // James Capture Orchestrator: Every 5 minutes [CAPABILITY-SCOPED: human-triggered captures only]
  cron.schedule('*/5 * * * *', async () => {
    const { getFeatureFlag, FEATURE_FLAGS, isAIEnabled } = await import('../config/ai-controls.js');
    if (!getFeatureFlag(FEATURE_FLAGS.JAMES_CAPTURE_ENABLED)) return;
    if (!(await isAIEnabled())) {
      console.log(
        `[autonomous_job_skipped] job=james-capture-orchestrator reason=AI_DISABLED ts=${new Date().toISOString()}`
      );
      return;
    }
    try {
      const { processPendingCaptures } = await import('../production/james/orchestrator.js');
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const result = await processPendingCaptures(supabase);
      if (result.processed > 0) {
        console.log(
          `[${new Date().toLocaleString()}] James Orchestrator: processed=${result.processed} assessments=${result.initialAssessments} resynth=${result.resyntheses} ready=${result.recommendationsReady}`
        );
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] James Orchestrator failed:`, err);
    }
  });

  // James Specialist Executor: Requires SPECIALIST_EXECUTION_ENABLED (default false).
  // Uncommissioned specialists remain PENDING — no fixture execution in production.
  cron.schedule('*/5 * * * *', async () => {
    const { getFeatureFlag, FEATURE_FLAGS, isAIEnabled } = await import('../config/ai-controls.js');
    if (!getFeatureFlag(FEATURE_FLAGS.SPECIALIST_EXECUTION_ENABLED)) return;
    if (!getFeatureFlag(FEATURE_FLAGS.JAMES_CAPTURE_ENABLED)) return;
    if (!(await isAIEnabled())) return;
    try {
      const { processPendingSpecialistTasks } =
        await import('../production/james/specialist-executor.js');
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const result = await processPendingSpecialistTasks(supabase);
      if (result.processed > 0) {
        console.log(
          `[${new Date().toLocaleString()}] Specialist Executor: processed=${result.processed} completed=${result.completed} failed=${result.failed}`
        );
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Specialist Executor failed:`, err);
    }
  });

  // ============================================================
  // MARCUS PURSUIT STEWARDSHIP — DETERMINISTIC DOCUMENT-VERSION PROCESSING
  // ZERO LLM calls from the scheduler itself.
  // Processes durable document version work. Does NOT call G2X.
  // Creates pending Marcus tasks only for material technical changes.
  // Time passing alone never creates Marcus inference.
  // ============================================================

  // Marcus Document Version Processor: Every 15 minutes [DETERMINISTIC: checkpoint-based, max 20 per cycle]
  cron.schedule('*/15 * * * *', async () => {
    const { getFeatureFlag } = await import('../config/ai-controls.js');
    if (!getFeatureFlag('MARCUS_PURSUIT_STEWARDSHIP_ENABLED')) return;
    try {
      const { processUnprocessedDocumentVersions } =
        await import('../services/marcus/document-version-driver.js');
      const result = await processUnprocessedDocumentVersions();
      if (result.processed > 0 || result.materialChanges > 0) {
        console.log(
          `[${new Date().toLocaleString()}] Marcus DocVersion: processed=${result.processed} material=${result.materialChanges} skipped=${result.skipped} errors=${result.errors}`
        );
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Marcus DocVersion Processor failed:`, err);
    }
  });

  // ============================================================
  // SCHEDULED JOBS - SAFE_INTERNAL_MAINTENANCE
  // No Slack posts, no LLM, no external APIs, no event/workflow creation.
  // These run regardless of AI control state.
  // ============================================================

  // Stale event cleanup: Every 5 minutes [SAFE: DB cleanup only]
  cron.schedule('*/5 * * * *', async () => {
    try {
      await runStaleEventCleanup();
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Events: Stale cleanup failed:`, err);
    }
  });

  // Workflow timeout processor: Every 5 minutes [SAFE: DB state updates only]
  cron.schedule('*/5 * * * *', async () => {
    try {
      await runWithLogging('workflow-timeouts', runWorkflowTimeouts);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Workflows: Timeout check failed:`, err);
    }
  });

  // LLM Gateway: Stale reservation reconciliation: Every 5 minutes [SAFE: DB cleanup only]
  // reserved (pre-network) → released; in_progress (post-network) → ambiguous
  // No LLM calls, no Slack posts, no external APIs. Idempotent. Safe under multiple replicas.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_KEY || ''
      );
      const { error, data } = await supabase.rpc('reconcile_stale_reservations', {
        p_stale_minutes: 15,
      });
      if (!error && data && data > 0) {
        console.log(
          `[${new Date().toLocaleString()}] Gateway: Reconciled ${data} stale reservation(s)`
        );
      }
    } catch {
      // Silent — this is a best-effort cleanup
    }
  });

  console.log('  ✓ Scheduled jobs configured\n');

  console.log('='.repeat(60));
  console.log('  All services running');
  console.log('  Schedule (CST):');
  console.log('    - Live agents: Always listening');
  console.log('  Agent Scans (with distributed locks):');
  console.log('    - Maya daily scan: 8:00 AM Mon-Fri');
  console.log('    - Maya weekly summary: 8:30 AM Friday');
  console.log('    - David news digest: 10:00 AM Mon/Wed/Fri');
  console.log('    - Patricia standup: 11:00 AM Mon-Fri');
  console.log('    - Patricia health summary: 9:00 AM Mon-Fri');
  console.log('  Agent Intelligence Layer:');
  console.log('    - Agent thinking time: 8am, 12pm, 4pm Mon-Fri');
  console.log('    - Feed synthesis: 9am, 11am, 1pm, 3pm Mon-Fri');
  console.log('    - Deadline monitor: 8:30 AM daily');
  console.log('    - Weekly rollup: 7:00 AM Monday');
  console.log('    - Discussion processor: 10am, 12pm, 2pm, 4pm Mon-Fri');
  console.log('  System Jobs:');
  console.log('    - Action scheduler: Every 15 minutes');
  console.log('    - Workflow timeouts: Every 5 minutes');
  console.log('    - Workflow auto-create: Every minute');
  console.log('    - Stale event cleanup: Every 5 minutes');
  console.log('    - Pipeline health: Every 2 hours 9am-5pm Mon-Fri');
  console.log('    - Memory reflection: Sundays 2am');
  console.log('    - Patricia retrospective: First Monday of month 9am');
  console.log('='.repeat(60));

  // Keep process alive
  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
