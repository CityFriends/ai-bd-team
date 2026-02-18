import cron from 'node-cron';
import { scout } from '../agents/scout.js';
import { strategist } from '../agents/strategist.js';

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

// Start all scheduled jobs
export function startScheduler(): void {
  console.log('Starting scheduler...');
  scheduleScoutDailyScan();
  scheduleStrategistStandup();
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
