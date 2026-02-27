/**
 * Workflow Timeout Cron Job
 *
 * Monitors workflows for SLA breaches and executes escalations.
 * Run: npm run workflow:timeouts
 * Schedule: Every 5 minutes
 */

import 'dotenv/config';
import cron from 'node-cron';
import { runTimeoutProcessor } from '../workflows/index.js';
import { acquireCronLock, releaseCronLock } from '../integrations/database/cron.js';

const JOB_NAME = 'workflow-timeouts';

async function runWithLock(): Promise<void> {
  // Try to acquire lock (5-minute window, with retry)
  const lock = await acquireCronLock(JOB_NAME, 5, 2);

  if (!lock.acquired) {
    console.log(
      `[${JOB_NAME}] Could not acquire lock: ${lock.error || 'Another instance running'}`
    );
    return;
  }

  try {
    await runTimeoutProcessor();
  } finally {
    // Release lock
    if (lock.lockId) {
      await releaseCronLock(lock.lockId);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const onceMode = args.includes('--once') || args.includes('-1');

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Workflow Timeout Monitor - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nRunning every 5 minutes...');
    console.log('Press Ctrl+C to stop\n');

    // Run immediately on start
    await runWithLock();

    // Then schedule every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      await runWithLock();
    });

    console.log('Scheduler running...');
  } else if (onceMode) {
    // Run once and exit
    await runWithLock();
    process.exit(0);
  } else {
    // Default: run once
    await runWithLock();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
