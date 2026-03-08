import cron from 'node-cron';
import { scout } from '../agents/scout.js';
import { strategist } from '../agents/strategist.js';
import { runMemoryReflection } from '../cron/memory-reflection.js';
import { runThinkingTime } from '../cron/agent-thinking.js';

// Track scheduled jobs for cleanup
const scheduledJobs: cron.ScheduledTask[] = [];

// Schedule Scout's daily scan at 6am
export function scheduleScoutDailyScan(): void {
  const job = cron.schedule(
    '0 6 * * *',
    async () => {
      console.log('Running scheduled Scout daily scan...');
      try {
        await scout.handleAction('daily_scan', {});
      } catch (error) {
        console.error('Error in Scout daily scan:', error);
      }
    },
    {
      timezone: 'America/New_York', // Adjust to your timezone
    }
  );

  scheduledJobs.push(job);
  console.log('Scheduled Scout daily scan for 6:00 AM');
}

// Schedule Strategist's morning standup at 8am
export function scheduleStrategistStandup(): void {
  const job = cron.schedule(
    '0 8 * * 1-5',
    async () => {
      console.log('Running scheduled Strategist standup...');
      try {
        await strategist.handleAction('morning_standup', {});
      } catch (error) {
        console.error('Error in Strategist standup:', error);
      }
    },
    {
      timezone: 'America/New_York', // Adjust to your timezone
    }
  );

  scheduledJobs.push(job);
  console.log('Scheduled Strategist standup for 8:00 AM weekdays');
}

// Schedule Memory Reflection at 2am daily
export function scheduleMemoryReflection(): void {
  const job = cron.schedule(
    '0 2 * * *',
    async () => {
      console.log('Running scheduled memory reflection...');
      try {
        await runMemoryReflection();
      } catch (error) {
        console.error('Error in memory reflection:', error);
      }
    },
    {
      timezone: 'America/New_York',
    }
  );

  scheduledJobs.push(job);
  console.log('Scheduled memory reflection for 2:00 AM daily');
}

// Schedule Agent Thinking Time every 4 hours during business hours (9am, 1pm, 5pm ET)
export function scheduleAgentThinkingTime(): void {
  const job = cron.schedule(
    '0 9,13,17 * * 1-5',
    async () => {
      console.log('Running scheduled agent thinking time...');
      try {
        await runThinkingTime();
      } catch (error) {
        console.error('Error in agent thinking time:', error);
      }
    },
    {
      timezone: 'America/New_York',
    }
  );

  scheduledJobs.push(job);
  console.log('Scheduled agent thinking time for 9am, 1pm, 5pm ET weekdays');
}

// Start all scheduled jobs
export function startScheduler(): void {
  console.log('Starting scheduler...');
  scheduleScoutDailyScan();
  scheduleStrategistStandup();
  scheduleMemoryReflection();
  scheduleAgentThinkingTime();
  console.log('Scheduler started');
}

// Stop all scheduled jobs
export function stopScheduler(): void {
  console.log('Stopping scheduler...');
  for (const job of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.length = 0;
  console.log('Scheduler stopped');
}

// Run Scout scan immediately (for testing or manual trigger)
export async function runScoutScanNow(): Promise<void> {
  console.log('Running Scout scan immediately...');
  await scout.handleAction('daily_scan', {});
}

// Run standup immediately (for testing or manual trigger)
export async function runStandupNow(): Promise<void> {
  console.log('Running standup immediately...');
  await strategist.handleAction('morning_standup', {});
}

// Run memory reflection immediately (for testing or manual trigger)
export async function runMemoryReflectionNow(): Promise<void> {
  console.log('Running memory reflection immediately...');
  await runMemoryReflection();
}

// Run agent thinking time immediately (for testing or manual trigger)
export async function runThinkingTimeNow(): Promise<void> {
  console.log('Running agent thinking time immediately...');
  await runThinkingTime();
}
