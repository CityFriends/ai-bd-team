import 'dotenv/config';
import { getSupabase } from '../integrations/database/client.js';

async function main() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('agent_events')
    .select('id, event_type, source_agent, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No events found in database yet.');
  } else {
    console.log('Recent events:');
    for (const e of data) {
      console.log(`  ${e.event_type} from ${e.source_agent} - ${e.status} (${e.created_at})`);
    }
  }
}

main();
