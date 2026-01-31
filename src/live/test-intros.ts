#!/usr/bin/env npx tsx
import 'dotenv/config';
import { WebClient } from '@slack/web-api';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

interface AgentIntro {
  name: string;
  botToken: string;
  message: string;
}

const intros: AgentIntro[] = [
  {
    name: 'Maya',
    botToken: process.env.MAYA_BOT_TOKEN || '',
    message: "Hey team, Maya here. Ready to find some opportunities 👀",
  },
  {
    name: 'David',
    botToken: process.env.DAVID_BOT_TOKEN || '',
    message: "David checking in. Ready to dig into the details.",
  },
  {
    name: 'Rosa',
    botToken: process.env.ROSA_BOT_TOKEN || '',
    message: "Rosa here! Excited to connect some dots.",
  },
  {
    name: 'James',
    botToken: process.env.JAMES_BOT_TOKEN || '',
    message: "James. Let's win some work.",
  },
  {
    name: 'Patricia',
    botToken: process.env.PATRICIA_BOT_TOKEN || '',
    message: "Patricia online. I'll keep us organized ✅",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Testing Agent Intros');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  for (const intro of intros) {
    if (!intro.botToken) {
      console.log(`⚠️  ${intro.name}: Missing bot token, skipping`);
      continue;
    }

    try {
      const client = new WebClient(intro.botToken);

      await client.chat.postMessage({
        channel: CHANNEL_ID,
        text: intro.message,
      });

      console.log(`✅ ${intro.name}: "${intro.message}"`);
    } catch (error: any) {
      console.log(`❌ ${intro.name}: ${error.message}`);
    }

    // Wait 10 seconds before next agent
    if (intro !== intros[intros.length - 1]) {
      console.log('   Waiting 10 seconds...');
      await sleep(10000);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Done! Check #ai-bd-team in Slack');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

main();
