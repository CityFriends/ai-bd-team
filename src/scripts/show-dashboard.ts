/**
 * Show System Dashboard
 *
 * Displays the current system status including:
 * - Active workflows
 * - Memory stats
 * - Cache performance
 * - Recent escalations
 *
 * Usage:
 *   npm run dashboard         # Show in console
 *   npm run dashboard --json  # Output as JSON
 *   npm run dashboard --slack # Format for Slack
 */

import 'dotenv/config';
import {
  getDashboardData,
  formatDashboardForSlack,
  formatDashboardAsJSON,
} from '../dashboard/index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const slackMode = args.includes('--slack');

  console.log('Gathering dashboard data...\n');

  try {
    const data = await getDashboardData();

    if (jsonMode) {
      console.log(formatDashboardAsJSON(data));
    } else if (slackMode) {
      console.log(formatDashboardForSlack(data));
    } else {
      // Pretty console output
      const healthEmoji =
        data.health.status === 'healthy' ? '🟢' : data.health.status === 'degraded' ? '🟡' : '🔴';

      console.log('='.repeat(60));
      console.log(
        `  ${healthEmoji} System Dashboard - ${new Date(data.timestamp).toLocaleString()}`
      );
      console.log('='.repeat(60));

      if (data.health.issues.length > 0) {
        console.log(`\n⚠️  Issues: ${data.health.issues.join(', ')}`);
      }

      console.log('\n📋 WORKFLOWS');
      console.log(`   Active: ${data.workflows.active}`);
      console.log(`   Past SLA: ${data.workflows.breached}`);
      if (Object.keys(data.workflows.byState).length > 0) {
        console.log('   By state:');
        for (const [state, count] of Object.entries(data.workflows.byState)) {
          console.log(`     - ${state}: ${count}`);
        }
      }

      console.log('\n🧠 AGENT MEMORIES');
      console.log(`   Total: ${data.memory.totalMemories}`);
      console.log(`   Last 24h: ${data.memory.recentMemories}`);
      if (Object.keys(data.memory.byAgent).length > 0) {
        console.log('   By agent:');
        for (const [agent, count] of Object.entries(data.memory.byAgent)) {
          console.log(`     - ${agent}: ${count}`);
        }
      }

      console.log('\n💾 TOOL CACHE');
      console.log(`   Entries: ${data.cache.totalEntries}`);
      console.log(`   Total hits: ${data.cache.totalHits}`);
      console.log(`   Hit rate: ${data.cache.hitRate}`);
      if (Object.keys(data.cache.byTool).length > 0) {
        console.log('   By tool:');
        for (const [tool, stats] of Object.entries(data.cache.byTool).slice(0, 5)) {
          console.log(`     - ${tool}: ${stats.entries} entries, ${stats.hits} hits`);
        }
      }

      console.log('\n🚨 ESCALATIONS (24h)');
      console.log(`   Total: ${data.escalations.total24h}`);
      if (data.escalations.recent.length > 0) {
        console.log('   Recent:');
        for (const esc of data.escalations.recent) {
          const status = esc.successful ? '✓' : '✗';
          const time = new Date(esc.timestamp).toLocaleTimeString();
          console.log(`     ${status} [${time}] ${esc.reference.slice(0, 40)} - ${esc.action}`);
        }
      }

      if (data.workflows.recentTransitions.length > 0) {
        console.log('\n🔄 RECENT TRANSITIONS');
        for (const t of data.workflows.recentTransitions) {
          const time = new Date(t.timestamp).toLocaleTimeString();
          const agent = t.agent ? ` (${t.agent})` : '';
          console.log(`   [${time}] ${t.reference.slice(0, 35)} : ${t.from} → ${t.to}${agent}`);
        }
      }

      console.log('\n' + '='.repeat(60));
    }
  } catch (error) {
    console.error('Error gathering dashboard data:', error);
    process.exit(1);
  }
}

main();
