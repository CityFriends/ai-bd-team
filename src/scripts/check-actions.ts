import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

async function checkActions() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('agent_actions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error(error);
    return;
  }

  console.log('Recent actions:\n');
  for (const a of data) {
    console.log(`Agent: ${a.agent_name}`);
    console.log(`Type: ${a.action_type}`);
    console.log(`Status: ${a.status}`);
    console.log(`Scheduled: ${a.scheduled_for}`);
    console.log(`Description: ${a.description}`);
    console.log('---');
  }
}

checkActions();
