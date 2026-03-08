import 'dotenv/config';
import { createAgentFeedDatabase } from '../src/live/feed-to-notion.js';

const parentPageId = process.argv[2] || '31d07a7951ff80eda7d8e89e29b49fcd';

async function main() {
  console.log('Creating Agent Feed database under page:', parentPageId);

  const dbId = await createAgentFeedDatabase(parentPageId);

  if (dbId) {
    console.log('\nSuccess! Database created:', dbId);
    console.log('\nAdd this to your .env file:');
    console.log('NOTION_AGENT_FEED_DB_ID=' + dbId);
  } else {
    console.log('Failed to create database');
  }
}

main().catch(console.error);
