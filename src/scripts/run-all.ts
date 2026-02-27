/**
 * Run All BD Team Services
 *
 * Single entry point for production deployment.
 * Runs: Live agents + scheduled cron jobs for Maya, David, and Patricia
 *
 * All agent scans use distributed locks (acquireCronLock) to prevent
 * duplicate runs across replicas.
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

// Agent scan functions
async function runMayaDailyScan() {
  const { acquireCronLock } = await import('../integrations/supabase.js');
  const { acquired } = await acquireCronLock('maya-daily-scan', 10);
  if (!acquired) {
    console.log('[CRON] Maya daily scan: Another instance already running, skipping');
    return;
  }
  const { runDailyScan } = await import('./maya-scanner.js');
  await runDailyScan();
}

async function runMayaWeeklySummary() {
  const { acquireCronLock } = await import('../integrations/supabase.js');
  const { acquired } = await acquireCronLock('maya-weekly-summary', 15);
  if (!acquired) {
    console.log('[CRON] Maya weekly summary: Another instance already running, skipping');
    return;
  }
  const { runWeeklySummary } = await import('./maya-scanner.js');
  await runWeeklySummary();
}

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
  // SCHEDULED JOBS - Agent Scans (with distributed locks)
  // ============================================================

  // Maya Daily Scan: 8:00 AM CST Mon-Fri (14:00 UTC)
  cron.schedule('0 14 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Maya: Running daily scan...`);
    try {
      await runWithLogging('maya-daily-scan', runMayaDailyScan);
      console.log(`[${new Date().toLocaleString()}] Maya: Daily scan complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Maya: Daily scan failed:`, err);
    }
  });

  // Maya Weekly Summary: 8:30 AM CST Friday (14:30 UTC)
  cron.schedule('30 14 * * 5', async () => {
    console.log(`[${new Date().toLocaleString()}] Maya: Running weekly summary...`);
    try {
      await runWithLogging('maya-weekly-summary', runMayaWeeklySummary);
      console.log(`[${new Date().toLocaleString()}] Maya: Weekly summary complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Maya: Weekly summary failed:`, err);
    }
  });

  // David News Digest: 10:00 AM CST Mon/Wed/Fri (16:00 UTC)
  cron.schedule('0 16 * * 1,3,5', async () => {
    console.log(`[${new Date().toLocaleString()}] David: Running news digest...`);
    try {
      await runWithLogging('david-news-digest', runDavidNewsDigest);
      console.log(`[${new Date().toLocaleString()}] David: News digest complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] David: News digest failed:`, err);
    }
  });

  // Patricia Morning Standup: 11:00 AM CST Mon-Fri (17:00 UTC)
  cron.schedule('0 17 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Patricia: Running morning standup...`);
    try {
      await runWithLogging('patricia-standup', runPatriciaStandup);
      console.log(`[${new Date().toLocaleString()}] Patricia: Morning standup complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Patricia: Morning standup failed:`, err);
    }
  });

  // ============================================================
  // SCHEDULED JOBS - Other Internal Jobs
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
  console.log('  Schedule (CST):');
  console.log('    - Live agents: Always listening');
  console.log('  Agent Scans (with distributed locks):');
  console.log('    - Maya daily scan: 8:00 AM Mon-Fri');
  console.log('    - Maya weekly summary: 8:30 AM Friday');
  console.log('    - David news digest: 10:00 AM Mon/Wed/Fri');
  console.log('    - Patricia standup: 11:00 AM Mon-Fri');
  console.log('  Other Jobs:');
  console.log('    - Action scheduler: Every 15 minutes');
  console.log('    - Stale event cleanup: Every 5 minutes');
  console.log('    - Pipeline health: Every 2 hours 9am-5pm Mon-Fri');
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
