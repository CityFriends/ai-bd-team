/**
 * Run All BD Team Services
 *
 * Single entry point for production deployment.
 * Runs: Live agents + Maya scanner + Patricia check-ins
 *
 * Note: Cron jobs also have dedicated entry points in src/cron/
 * for Railway cron triggers which are more reliable than in-process cron.
 */
import 'dotenv/config';
import cron from 'node-cron';
import { logJobStart, logJobComplete, logJobFailed } from '../integrations/supabase.js';

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

// Note: Maya daily/weekly scan and David news digest are handled by Railway cron
// See: src/cron/maya-daily.ts, src/cron/maya-weekly.ts, src/cron/david-news.ts
// Patricia standup is also handled by Railway cron (src/cron/patricia-standup.ts)

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
  // SCHEDULED AGENTS - Handled by Railway external cron
  // ============================================================
  // Maya daily/weekly: src/cron/maya-daily.ts, src/cron/maya-weekly.ts
  // David news digest: src/cron/david-news.ts
  // Patricia standup: src/cron/patricia-standup.ts
  //
  // Railway cron is more reliable than in-process cron and prevents
  // duplicate posts when the process restarts or runs multiple instances.
  // ============================================================

  // Action Scheduler: Every 15 minutes check for agent commitments
  cron.schedule('*/15 * * * *', async () => {
    console.log(`[${new Date().toLocaleString()}] Actions: Checking for due actions...`);
    try {
      await runWithLogging('action-scheduler', runActionScheduler);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Actions: Scheduler failed:`, err);
    }
  });

  // ============================================================
  // Event System Triggers - Activate the emergent behavior layer
  // ============================================================

  // Pipeline health check: Every 2 hours during business hours (14-22 UTC = 9am-5pm CST)
  cron.schedule('0 14,16,18,20,22 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Events: Running pipeline health check...`);
    try {
      await runWithLogging('event-pipeline-health', runPipelineHealthCheck);
      console.log(`[${new Date().toLocaleString()}] Events: Pipeline health check complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Events: Pipeline health check failed:`, err);
    }
  });

  // Stale event cleanup: Every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await runStaleEventCleanup();
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Events: Stale cleanup failed:`, err);
    }
  });

  // Patricia's monthly retrospective: First Monday of each month at 9am CST (15:00 UTC)
  // Note: '1-7' ensures it's in the first 7 days, combined with day-of-week 1 (Monday)
  cron.schedule('0 15 1-7 * 1', async () => {
    console.log(`[${new Date().toLocaleString()}] Patricia: Running monthly retrospective...`);
    try {
      await runWithLogging('patricia-retrospective', runPatriciaRetrospective);
      console.log(`[${new Date().toLocaleString()}] Patricia: Monthly retrospective complete`);
    } catch (err) {
      console.error(
        `[${new Date().toLocaleString()}] Patricia: Monthly retrospective failed:`,
        err
      );
    }
  });

  console.log('  ✓ Scheduled jobs configured\n');

  console.log('='.repeat(60));
  console.log('  All services running');
  console.log('  In-Process Schedule (CST):');
  console.log('    - Live agents: Always listening');
  console.log('    - Action scheduler: Every 15 minutes');
  console.log('    - Stale event cleanup: Every 5 minutes');
  console.log('    - Pipeline health: Every 2 hours 9am-5pm CST Mon-Fri');
  console.log('    - Patricia retrospective: First Monday of month 9am CST');
  console.log('  Railway Cron (external - prevents duplicate posts):');
  console.log('    - Maya scan: 8:00 AM CST Mon-Fri');
  console.log('    - Maya weekly: 8:30 AM CST Monday');
  console.log('    - David news: 10:00 AM CST Mon/Wed/Fri');
  console.log('    - Patricia standup: 11:00 AM CST Mon-Fri');
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
