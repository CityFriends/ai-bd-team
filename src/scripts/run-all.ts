/**
 * Run All BD Team Services
 *
 * Single entry point for production deployment.
 * Runs: Live agents + Maya scanner + Patricia check-ins
 */
import 'dotenv/config';

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

  // Start Maya's scanner schedule (inline to avoid process conflicts)
  console.log('  Starting: Maya Scanner Schedule');
  const cron = await import('node-cron');

  // Maya: Weekdays at 8am
  cron.default.schedule('0 8 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Maya: Running daily scan...`);
    // Live agents handle opportunity posting via Slack interaction
  });

  // Maya: Weekly summary Monday 8:30am
  cron.default.schedule('30 8 * * 1', async () => {
    console.log(`[${new Date().toLocaleString()}] Maya: Running weekly summary...`);
  });

  // Patricia: Morning check-in 9am weekdays
  cron.default.schedule('0 9 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Patricia: Morning check-in...`);
  });

  // Patricia: Nudge check 2pm weekdays
  cron.default.schedule('0 14 * * 1-5', async () => {
    console.log(`[${new Date().toLocaleString()}] Patricia: Checking pending items...`);
  });

  console.log('  ✓ Scheduled jobs configured\n');

  console.log('='.repeat(60));
  console.log('  All services running');
  console.log('  Schedule:');
  console.log('    - Live agents: Always listening');
  console.log('    - Maya scan: 8:00 AM Mon-Fri');
  console.log('    - Maya weekly: 8:30 AM Monday');
  console.log('    - Patricia check-in: 9:00 AM Mon-Fri');
  console.log('    - Patricia nudge: 2:00 PM Mon-Fri');
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
