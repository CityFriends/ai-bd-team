// Check recent cron job runs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function checkCronJobs() {
  // Get most recent cron job runs
  const { data, error } = await supabase
    .from('cron_job_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(15);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('=== Most Recent Cron Job Runs ===\n');
  for (const run of data || []) {
    const status = run.status === 'completed' ? '✓' : run.status === 'failed' ? '✗' : '⟳';
    console.log(`${status} ${run.job_name}`);
    console.log(`  Started: ${run.started_at}`);
    console.log(`  Status: ${run.status} | Duration: ${run.duration_ms}ms`);
    if (run.notes) console.log(`  Notes: ${run.notes}`);
    if (run.error_message) console.log(`  Error: ${run.error_message}`);
    console.log('');
  }

  // Check for maya-daily-scan specifically
  const { data: mayaRuns } = await supabase
    .from('cron_job_runs')
    .select('*')
    .eq('job_name', 'maya-daily-scan')
    .order('started_at', { ascending: false })
    .limit(5);

  console.log('\n=== Maya Daily Scan History ===\n');
  if (!mayaRuns?.length) {
    console.log('No maya-daily-scan runs found');
  } else {
    for (const run of mayaRuns) {
      const status = run.status === 'completed' ? '✓' : run.status === 'failed' ? '✗' : '⟳';
      console.log(`${status} ${run.started_at} - ${run.status}`);
      if (run.notes) console.log(`   Notes: ${run.notes}`);
    }
  }

  process.exit(0);
}

checkCronJobs().catch((err) => {
  console.error('Error checking cron jobs:', err);
  process.exit(1);
});
