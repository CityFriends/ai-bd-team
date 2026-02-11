import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

async function triggerActionsNow() {
  const supabase = getSupabase();

  // Update all pending actions to be due now
  const { data, error } = await supabase
    .from('agent_actions')
    .update({ scheduled_for: new Date().toISOString() })
    .eq('status', 'pending')
    .select();

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Updated ${data.length} action(s) to execute now`);
}

triggerActionsNow();
