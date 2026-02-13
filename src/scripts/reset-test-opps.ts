import 'dotenv/config';
import { getSupabase } from '../integrations/database/client.js';

// Reset test opportunities so we can re-run the scan
async function main() {
  const supabase = getSupabase();

  // Get the recent opportunities
  const noticeIds = [
    '801e448f6fb145ea8ea2822672ec4f0a', // HRD AI Tools
    'b9ef9d30c4a34e15aad5fb4258929680', // NATO ARTEMIS
  ];

  console.log('Clearing test opportunities to allow re-posting...');

  // Delete from seen_opportunities
  const { error: seenError } = await supabase
    .from('seen_opportunities')
    .delete()
    .in('notice_id', noticeIds);

  if (seenError) {
    console.error('Error clearing seen_opportunities:', seenError.message);
  } else {
    console.log('Cleared seen_opportunities');
  }

  // Delete from opportunity_workflow
  const { error: workflowError } = await supabase
    .from('opportunity_workflow')
    .delete()
    .in('notice_id', noticeIds);

  if (workflowError) {
    console.error('Error clearing opportunity_workflow:', workflowError.message);
  } else {
    console.log('Cleared opportunity_workflow');
  }

  console.log('Done! Run `npm run maya:scan` to re-post opportunities.');
}

main();
