import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  // Check recent events by David
  console.log("\n=== David's Recent Activity ===\n");
  const { data: davidData } = await supabase
    .from('agent_events')
    .select('id, event_type, status, claimed_by, created_at, completed_at')
    .eq('claimed_by', 'david')
    .order('created_at', { ascending: false })
    .limit(10);

  for (const e of davidData || []) {
    const created = new Date(e.created_at).toLocaleTimeString();
    const completed = e.completed_at ? new Date(e.completed_at).toLocaleTimeString() : 'pending';
    console.log(`  ${created} | ${e.event_type} | ${e.status} | completed: ${completed}`);
  }

  // Check RESEARCH_COMPLETE events
  console.log('\n=== RESEARCH_COMPLETE Events (last 2 hours) ===\n');
  const { data: rcData } = await supabase
    .from('agent_events')
    .select('id, target_agent, status, claimed_by, created_at')
    .eq('event_type', 'RESEARCH_COMPLETE')
    .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  for (const e of rcData || []) {
    const time = new Date(e.created_at).toLocaleTimeString();
    console.log(
      `  ${time} | target: ${e.target_agent || 'broadcast'} | ${e.status} | claimed: ${e.claimed_by || 'none'}`
    );
  }

  // Check recent events overall
  console.log('\n=== Recent Events (last 30 min) ===\n');
  const { data: recentData } = await supabase
    .from('agent_events')
    .select('id, event_type, source_agent, target_agent, status, claimed_by, created_at')
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  for (const e of recentData || []) {
    const time = new Date(e.created_at).toLocaleTimeString();
    console.log(
      `  ${time} | ${e.event_type} | ${e.status} | claimed: ${e.claimed_by || 'none'} | target: ${e.target_agent || 'broadcast'}`
    );
  }

  const eventId = '45a8afc7-1da8-4cb6-9aac-d8d3e086bc79';

  const { data, error } = await supabase
    .from('agent_events')
    .select('id, event_type, source_agent, target_agent, status, claimed_by, chain_depth, result')
    .or(`id.eq.${eventId},parent_event_id.eq.${eventId}`)
    .order('chain_depth');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n=== Event Chain Results ===\n');
  for (const e of data) {
    console.log('---');
    console.log(`[${e.chain_depth}] ${e.event_type}`);
    console.log(`    Target: ${e.target_agent || 'broadcast'}`);
    console.log(`    Status: ${e.status} | Claimed: ${e.claimed_by || 'none'}`);
    if (e.result?.chainEventResults) {
      console.log('    Chain Results:', JSON.stringify(e.result.chainEventResults));
    }
  }

  // Check for downstream events (TECH_ASSESSMENT_COMPLETE, RELATIONSHIP_CHECK_COMPLETE)
  const { data: downstreamData } = await supabase
    .from('agent_events')
    .select('id, event_type, source_agent, status, claimed_by')
    .in('event_type', [
      'TECH_ASSESSMENT_COMPLETE',
      'RELATIONSHIP_CHECK_COMPLETE',
      'GO_NO_GO_DECISION',
    ])
    .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });

  if (downstreamData && downstreamData.length > 0) {
    console.log('\n=== Downstream Events (last 5 min) ===\n');
    for (const e of downstreamData) {
      console.log(
        `  ${e.event_type} from ${e.source_agent} | status: ${e.status} | claimed: ${e.claimed_by || 'none'}`
      );
    }
  }
}

check();
