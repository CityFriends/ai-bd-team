/**
 * Database Table Scanner
 *
 * Scans all tables for row counts to identify empty tables.
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

const TABLES = [
  // Core Opportunity & Business
  'opportunities',
  'agencies',
  'companies',
  'outreach',
  'conversation_threads',
  'agent_queue',
  'agent_memory',
  'research_cache',
  'message_claims',

  // Memory & Context
  'user_context',
  'decision_patterns',
  'conversation_memory',
  'inside_jokes',
  'agent_availability',
  'user_profiles',

  // Semantic/Vector
  'semantic_cache',
  'agent_thread_participation',
  'agent_handoffs',
  'agent_feedback',
  'thread_summaries',
  'extracted_facts',

  // Workflow
  'opportunity_workflow',
  'team_activity_log',
  'decision_outcomes',
  'workflow_stage_history',
  'agent_actions',
  'agent_events',
  'agent_subscriptions',
  'agent_event_metrics',

  // Playbook
  'team_playbook',
  'playbook_applications',
  'retrospective_runs',

  // Cron
  'cron_job_runs',
  'cron_locks',

  // Memory & Cache
  'agent_memories',
  'tool_cache',

  // Workflows
  'workflow_instances',
  'workflow_state_history',
  'workflow_escalations',

  // Company Knowledge Base
  'company_profile',
  'past_performance',
  'contacts',
  'teaming_partners',
  'labor_rates',
  'case_studies',
  'key_personnel',
  'proposal_content',
  'lessons_learned',
  'documents',
  'proposal_snippets',

  // Other
  'agency_forecasts',
  'competitor_intel',
  'far_sections',
  'seen_awards',
  'seen_ebuy_opportunities',
  'seen_news',
  'sync_log',
  'system_feedback',
];

interface TableResult {
  name: string;
  count: number;
  error?: string;
}

async function scanTables(): Promise<void> {
  const supabase = getSupabase();

  console.log('DATABASE TABLE SCAN');
  console.log('='.repeat(60));
  console.log(`Scanning ${TABLES.length} tables...\n`);

  const results: TableResult[] = [];
  const empty: string[] = [];
  const populated: TableResult[] = [];
  const errors: TableResult[] = [];

  for (const table of TABLES) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        errors.push({ name: table, count: 0, error: error.message });
      } else if (count === 0 || count === null) {
        empty.push(table);
        results.push({ name: table, count: 0 });
      } else {
        populated.push({ name: table, count });
        results.push({ name: table, count });
      }
    } catch (e) {
      errors.push({ name: table, count: 0, error: String(e) });
    }
  }

  // Sort populated by count descending
  populated.sort((a, b) => b.count - a.count);

  // Print results
  console.log('📊 POPULATED TABLES:');
  console.log('-'.repeat(40));
  for (const t of populated) {
    const countStr = t.count.toLocaleString().padStart(8);
    console.log(`  ${countStr}  ${t.name}`);
  }

  console.log('\n⚠️  EMPTY TABLES (' + empty.length + '):');
  console.log('-'.repeat(40));
  for (const t of empty) {
    console.log(`  ${t}`);
  }

  if (errors.length > 0) {
    console.log('\n❌ ERRORS (' + errors.length + '):');
    console.log('-'.repeat(40));
    for (const e of errors) {
      console.log(`  ${e.name}: ${e.error}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY:');
  console.log(`  Populated: ${populated.length} tables`);
  console.log(`  Empty:     ${empty.length} tables`);
  console.log(`  Errors:    ${errors.length} tables`);
  console.log(`  Total rows: ${populated.reduce((sum, t) => sum + t.count, 0).toLocaleString()}`);

  // Flag tables that SHOULD have data
  const shouldHaveData = [
    'company_profile',
    'case_studies',
    'past_performance',
    'key_personnel',
    'proposal_snippets',
    'user_profiles',
    'user_context',
    'agent_subscriptions',
  ];

  const missingData = shouldHaveData.filter((t) => empty.includes(t));
  if (missingData.length > 0) {
    console.log('\n🚨 CRITICAL - These tables should have data but are empty:');
    for (const t of missingData) {
      console.log(`  - ${t}`);
    }
  }
}

scanTables().catch(console.error);
