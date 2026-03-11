// Sync feed posts to Notion
import 'dotenv/config';
import { syncRecentPostsToNotion, setFeedDatabaseId } from '../src/live/feed-to-notion.js';

async function main() {
  const dbId = process.env.NOTION_AGENT_FEED_DB_ID;

  if (!dbId) {
    console.error('NOTION_AGENT_FEED_DB_ID not set');
    process.exit(1);
  }

  console.log('Using Feed database:', dbId);
  setFeedDatabaseId(dbId);

  const hoursBack = parseInt(process.argv[2] || '72', 10);
  console.log(`Syncing posts from last ${hoursBack} hours...`);

  const result = await syncRecentPostsToNotion(hoursBack);
  console.log('Sync complete:', result);

  process.exit(0);
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
