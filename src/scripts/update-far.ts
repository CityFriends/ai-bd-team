// Update FAR data from GSA repo
import 'dotenv/config';
import { execSync } from 'child_process';
import { parseFARFiles, uploadToSupabase } from './parse-far.js';

const FAR_DIR = 'data/far';

async function updateFAR() {
  console.log('=== FAR Update Check ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Get current commit hash before pull
  let currentCommit: string;
  try {
    currentCommit = execSync(`git -C ${FAR_DIR} rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    console.log(`Current commit: ${currentCommit.slice(0, 7)}`);
  } catch (error) {
    console.error('FAR repo not found. Run initial clone first.');
    process.exit(1);
  }

  // Get current FAC version from last commit message
  const currentMessage = execSync(`git -C ${FAR_DIR} log -1 --format=%s`, { encoding: 'utf-8' }).trim();
  console.log(`Current version: ${currentMessage}`);

  // Pull latest changes
  console.log('\nChecking for updates...');
  try {
    execSync(`git -C ${FAR_DIR} fetch origin`, { encoding: 'utf-8' });
  } catch (error) {
    console.error('Failed to fetch from remote:', error);
    process.exit(1);
  }

  // Check if there are new commits
  const remoteCommit = execSync(`git -C ${FAR_DIR} rev-parse origin/master`, { encoding: 'utf-8' }).trim();

  if (currentCommit === remoteCommit) {
    console.log('\n✓ FAR is up to date. No new changes.');
    return;
  }

  // There are updates - show what's new
  console.log('\n★ New FAR updates available!');
  console.log('\nNew commits:');
  const newCommits = execSync(
    `git -C ${FAR_DIR} log ${currentCommit}..${remoteCommit} --oneline`,
    { encoding: 'utf-8' }
  );
  console.log(newCommits);

  // Pull the changes
  console.log('Pulling updates...');
  execSync(`git -C ${FAR_DIR} pull origin master`, { encoding: 'utf-8' });

  // Get new version info
  const newMessage = execSync(`git -C ${FAR_DIR} log -1 --format=%s`, { encoding: 'utf-8' }).trim();
  console.log(`Updated to: ${newMessage}`);

  // Re-parse and upload
  console.log('\nRe-parsing FAR sections...');
  const sections = await parseFARFiles(`${FAR_DIR}/dita`);

  console.log('\nUploading to Supabase...');
  await uploadToSupabase(sections);

  console.log('\n✓ FAR update complete!');
  console.log(`  Previous: ${currentMessage}`);
  console.log(`  Current:  ${newMessage}`);
}

// Run
updateFAR().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
