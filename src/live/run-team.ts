#!/usr/bin/env npx tsx
import 'dotenv/config';
import { maya } from './maya.js';
import { david } from './david.js';
import { rosa } from './rosa.js';
import { james } from './james.js';
import { patricia } from './patricia.js';
import { jodie } from './jodie.js';

const agents = [
  { agent: maya, name: 'Maya (Scout)', tokenEnv: 'MAYA_BOT_TOKEN' },
  { agent: david, name: 'David (Analyst)', tokenEnv: 'DAVID_BOT_TOKEN' },
  { agent: rosa, name: 'Rosa (Connector)', tokenEnv: 'ROSA_BOT_TOKEN' },
  { agent: james, name: 'James (Strategist)', tokenEnv: 'JAMES_BOT_TOKEN' },
  { agent: patricia, name: 'Patricia (PM)', tokenEnv: 'PATRICIA_BOT_TOKEN' },
  { agent: jodie, name: 'Jodie (Writer)', tokenEnv: 'JODIE_BOT_TOKEN' },
];

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AI BD Team - Live Mode');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Check which agents have tokens configured
  const configuredAgents = agents.filter(a => process.env[a.tokenEnv]);
  const missingAgents = agents.filter(a => !process.env[a.tokenEnv]);

  if (configuredAgents.length === 0) {
    console.error('ERROR: No agent tokens configured in .env');
    console.error('');
    console.error('Create Slack apps for each agent and add their tokens:');
    for (const a of agents) {
      console.error(`  ${a.tokenEnv}=xoxb-...`);
      console.error(`  ${a.tokenEnv.replace('BOT', 'APP')}=xapp-...`);
    }
    process.exit(1);
  }

  if (missingAgents.length > 0) {
    console.log('Agents not configured (skipping):');
    for (const a of missingAgents) {
      console.log(`  - ${a.name} (missing ${a.tokenEnv})`);
    }
    console.log('');
  }

  console.log('Starting agents:');
  for (const a of configuredAgents) {
    console.log(`  - ${a.name}`);
  }
  console.log('');

  // Connect all configured agents
  try {
    await Promise.all(configuredAgents.map(a => a.agent.connect()));

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Team is live! Listening for messages...');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('Try @mentioning an agent in #ai-bd-team:');
    console.log('  "@Maya is this opportunity worth looking at?"');
    console.log('  "@David what are the risks here?"');
    console.log('');
    console.log('Press Ctrl+C to disconnect all agents.');
    console.log('');

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down team...');
      await Promise.all(configuredAgents.map(a => a.agent.disconnect()));
      console.log('All agents disconnected.');
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start team:', error);
    process.exit(1);
  }
}

main();
