import 'dotenv/config';
import { setFeedDatabaseId, syncRecentPostsToNotion } from '../src/live/feed-to-notion.js';

async function main() {
  const dbId = process.env.NOTION_AGENT_FEED_DB_ID;
  if (!dbId) {
    console.error('NOTION_AGENT_FEED_DB_ID not set');
    process.exit(1);
  }

  setFeedDatabaseId(dbId);
  console.log('Syncing feed posts to Notion...');

  const result = await syncRecentPostsToNotion(48); // Last 48 hours
  console.log(`Synced: ${result.synced}, Failed: ${result.failed}`);
}

main().catch(console.error);
