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

// Import scanner functions
async function runMayaDailyScan() {
  const { runDailyScan } = await import('./maya-scanner.js');
  await runDailyScan();
}

async function runMayaWeeklySummary() {
  const { runWeeklySummary } = await import('./maya-scanner.js');
  await runWeeklySummary();
}

async function runPatriciaMorningCheckin() {
  const { runMorningCheckin } = await import('./patricia-checkin.js');
  await runMorningCheckin();
}

async function runPatriciaNudgeCheck() {
  const { runNudgeCheck } = await import('./patricia-checkin.js');
  await runNudgeCheck();
}

async function runDavidNewsDigest() {
  const { runNewsDigest } = await import('./david-news-digest.js');
  await runNewsDigest();
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

  // Start Maya's scanner schedule
  console.log('  Starting: Maya Scanner Schedule');

  // Maya: Weekdays at 8am CST (14:00 UTC)
  cron.schedule('0 14 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Maya: Running daily scan...`);
    try {
      await runWithLogging('maya-daily-scan', runMayaDailyScan);
      console.log(`[${new Date().toLocaleString()}] Maya: Daily scan complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Maya: Daily scan failed:`, err);
    }
  });

  // Maya: Weekly summary Monday 8:30am CST (14:30 UTC)
  cron.schedule('30 14 * * 1', async () => {
    console.log(`[${new Date().toLocaleString()}] Maya: Running weekly summary...`);
    try {
      await runWithLogging('maya-weekly-summary', runMayaWeeklySummary);
      console.log(`[${new Date().toLocaleString()}] Maya: Weekly summary complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Maya: Weekly summary failed:`, err);
    }
  });

  // Patricia: Morning standup 11am CST (17:00 UTC)
  cron.schedule('0 17 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Patricia: Running morning standup...`);
    try {
      await runWithLogging('patricia-standup', runPatriciaMorningCheckin);
      console.log(`[${new Date().toLocaleString()}] Patricia: Morning standup complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Patricia: Morning standup failed:`, err);
    }
  });

  // Patricia: Nudge check 2pm CST (20:00 UTC)
  cron.schedule('0 20 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Patricia: Checking pending items...`);
    try {
      await runWithLogging('patricia-nudge', runPatriciaNudgeCheck);
      console.log(`[${new Date().toLocaleString()}] Patricia: Nudge check complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] Patricia: Nudge check failed:`, err);
    }
  });

  // David: News digest MWF 10am CST (16:00 UTC)
  cron.schedule('0 16 * * 1,3,5', async () => {
    console.log(`[${new Date().toLocaleString()}] David: Running news digest...`);
    try {
      await runWithLogging('david-news-digest', runDavidNewsDigest);
      console.log(`[${new Date().toLocaleString()}] David: News digest complete`);
    } catch (err) {
      console.error(`[${new Date().toLocaleString()}] David: News digest failed:`, err);
    }
  });

  console.log('  ✓ Scheduled jobs configured\n');

  console.log('='.repeat(60));
  console.log('  All services running');
  console.log('  Schedule (CST):');
  console.log('    - Live agents: Always listening');
  console.log('    - Maya scan: 8:00 AM CST Mon-Fri');
  console.log('    - Maya weekly: 8:30 AM CST Monday');
  console.log('    - David news: 10:00 AM CST Mon/Wed/Fri');
  console.log('    - Patricia standup: 11:00 AM CST Mon-Fri');
  console.log('    - Patricia nudge: 2:00 PM CST Mon-Fri');
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

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
