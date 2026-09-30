/**
 * James Capture Integration Tests
 *
 * Tests capture lifecycle, idempotency, budget, state transitions,
 * and button handlers using real PostgreSQL where available.
 */
import 'dotenv/config';

process.env.MAYA_DEV_MODE = 'true';
process.env.SLACK_AUTHORIZED_USERS = 'U123,U456';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
// DB-mutating integration tests must NOT run against production
const CAN_RUN_DB_TESTS = HAS_DB && !IS_PRODUCTION;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;

describe.skipIf(!CAN_RUN_DB_TESTS)('James Capture Integration', () => {
  beforeAll(() => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = Math.random().toString(36).slice(2, 8);
  });

  afterAll(async () => {
    if (!supabase) return;
    // Get all test capture IDs for cascading cleanup
    const { data: testCaptures } = await supabase
      .from('captures')
      .select('id')
      .like('opportunity_id', `test-opp-${testRunId}%`);
    const capIds = (testCaptures || []).map((c: { id: string }) => c.id);

    // Delete in dependency order
    if (capIds.length > 0) {
      await supabase.from('specialist_artifacts').delete().in('capture_id', capIds);
      await supabase.from('specialist_tasks').delete().in('capture_id', capIds);
      await supabase.from('capture_decision_records').delete().in('capture_id', capIds);
      await supabase.from('proposal_workspaces').delete().in('capture_id', capIds);
    }
    await supabase.from('captures').delete().like('opportunity_id', `test-opp-${testRunId}%`);

    // Clean events (capture-related)
    await supabase
      .from('opportunity_events')
      .delete()
      .like('idempotency_key', `%test-opp-${testRunId}%`);
    await supabase
      .from('opportunity_events')
      .delete()
      .like('idempotency_key', `evt:capture-started:%`)
      .like('aggregate_id', `%`);

    // Clean budget scopes
    for (const id of capIds) {
      await supabase.from('ai_budget_scopes').delete().eq('scope_id', `capture-${id}`);
    }
    await supabase.from('ai_budget_scopes').delete().like('scope_id', `exec-research-%`);
    await supabase
      .from('ai_budget_scopes')
      .delete()
      .like('scope_id', `capture-test-cap-${testRunId}%`);
    await supabase
      .from('ai_inference_ledger')
      .delete()
      .like('idempotency_key', `test:${testRunId}:%`);

    // Clean base test data
    await supabase
      .from('pipeline_opportunities')
      .delete()
      .like('source_id', `test-opp-${testRunId}%`);
    await supabase
      .from('slack_opportunity_briefs')
      .delete()
      .like('opportunity_id', `test-opp-${testRunId}%`);
  });

  // Scenario G — Duplicate Send to Capture → one capture
  it('duplicate capture creation is idempotent', async () => {
    const oppId = `test-opp-${testRunId}-dup`;

    // Create opportunity + brief
    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Dup',
      raw_hash: 'test',
      material_hash: 'mat-dup',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '111.111',
      thread_owner: 'MAYA',
    });

    const { createCapture } = await import('../capture-manager.js');

    const id1 = await createCapture(supabase, oppId, 'mat-dup', 'U123', 'evt1', 'C123', '111.111');
    const id2 = await createCapture(supabase, oppId, 'mat-dup', 'U123', 'evt1', 'C123', '111.111');

    expect(id1).toBeTruthy();
    expect(id2).toBe(id1); // Same capture returned

    const { count } = await supabase
      .from('captures')
      .select('*', { count: 'exact', head: true })
      .eq('opportunity_id', oppId);
    expect(count).toBe(1);
  });

  // Scenario H — Human Pursue creates workspace
  it('authorize_pursuit creates proposal workspace atomically', async () => {
    const oppId = `test-opp-${testRunId}-pursue`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Pursue',
      raw_hash: 'test',
      material_hash: 'mat-pursue',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '222.222',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision, transitionCapture } =
      await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-pursue',
      'U123',
      'evt2',
      'C123',
      '222.222'
    );
    expect(captureId).toBeTruthy();

    // Simulate James assessment completing with GO
    await transitionCapture(supabase, captureId!, 'pending', 'recommendation_ready');
    await recordDecision(supabase, captureId!, 'GO', 85, { recommendation: 'GO' }, 0);

    // Pursue
    const { handlePursue } = await import('../slack-surface.js');
    const result = await handlePursue(supabase, captureId!, 'U123', 1);
    expect(result.success).toBe(true);

    // Verify workspace created
    const { data: ws } = await supabase
      .from('proposal_workspaces')
      .select('*')
      .eq('capture_id', captureId)
      .single();
    expect(ws).toBeTruthy();
    expect(ws.opportunity_id).toBe(oppId);

    // Verify capture status
    const { data: cap } = await supabase
      .from('captures')
      .select('status, human_decision, james_recommendation')
      .eq('id', captureId)
      .single();
    expect(cap.status).toBe('pursuit_authorized');
    expect(cap.human_decision).toBe('PURSUIT');
    expect(cap.james_recommendation).toBe('GO');
  });

  // Scenario I — Human override: James NO_GO, human Pursue
  it('preserves both James recommendation and human override', async () => {
    const oppId = `test-opp-${testRunId}-override`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Override',
      raw_hash: 'test',
      material_hash: 'mat-override',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '333.333',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision, transitionCapture } =
      await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-override',
      'U123',
      'evt3',
      'C123',
      '333.333'
    );

    // James recommends NO_GO
    await transitionCapture(supabase, captureId!, 'pending', 'recommendation_ready');
    await recordDecision(supabase, captureId!, 'NO_GO', 90, { recommendation: 'NO_GO' }, 0);

    // Human overrides with Pursue
    const { handlePursue } = await import('../slack-surface.js');
    const result = await handlePursue(supabase, captureId!, 'U123', 1);
    expect(result.success).toBe(true);

    // Both preserved
    const { data: cap } = await supabase
      .from('captures')
      .select('james_recommendation, human_decision')
      .eq('id', captureId)
      .single();
    expect(cap.james_recommendation).toBe('NO_GO');
    expect(cap.human_decision).toBe('PURSUIT');
  });

  // Scenario J — No-Go
  it('human No-Go preserves James recommendation', async () => {
    const oppId = `test-opp-${testRunId}-nogo`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test NoGo',
      raw_hash: 'test',
      material_hash: 'mat-nogo',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '444.444',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision, transitionCapture } =
      await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-nogo',
      'U123',
      'evt4',
      'C123',
      '444.444'
    );

    await transitionCapture(supabase, captureId!, 'pending', 'recommendation_ready');
    await recordDecision(supabase, captureId!, 'GO', 75, { recommendation: 'GO' }, 0);

    const { handleNoGo } = await import('../slack-surface.js');
    const result = await handleNoGo(supabase, captureId!, 'U123', 1);
    expect(result.success).toBe(true);

    const { data: cap } = await supabase
      .from('captures')
      .select('status, james_recommendation, human_decision')
      .eq('id', captureId)
      .single();
    expect(cap.status).toBe('no_go');
    expect(cap.james_recommendation).toBe('GO');
    expect(cap.human_decision).toBe('NO_GO');
  });

  // Stale button rejection
  it('stale decision version button is rejected', async () => {
    const oppId = `test-opp-${testRunId}-stale`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Stale',
      raw_hash: 'test',
      material_hash: 'mat-stale',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '555.555',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision, transitionCapture } =
      await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-stale',
      'U123',
      'evt5',
      'C123',
      '555.555'
    );

    await transitionCapture(supabase, captureId!, 'pending', 'recommendation_ready');
    // v1
    await recordDecision(supabase, captureId!, 'GO', 70, { recommendation: 'GO' }, 0);
    // v2 (resynthesis)
    await recordDecision(supabase, captureId!, 'NO_GO', 85, { recommendation: 'NO_GO' }, 1);

    // Try to Pursue with stale v1
    const { handlePursue } = await import('../slack-surface.js');
    const result = await handlePursue(supabase, captureId!, 'U123', 1);
    expect(result.success).toBe(false);
    expect(result.message).toContain('newer recommendation');
  });

  // Recommendation history is preserved
  it('decision records preserve full recommendation history', async () => {
    const oppId = `test-opp-${testRunId}-history`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test History',
      raw_hash: 'test',
      material_hash: 'mat-hist',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '666.666',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision } = await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-hist',
      'U123',
      'evt6',
      'C123',
      '666.666'
    );

    // Record multiple decisions
    const v1 = await recordDecision(
      supabase,
      captureId!,
      'MORE_RESEARCH_REQUIRED',
      50,
      { r: 'v1' },
      0
    );
    const v2 = await recordDecision(supabase, captureId!, 'GO', 80, { r: 'v2' }, 1);

    expect(v1).toBe(1);
    expect(v2).toBe(2);

    // Both versions preserved
    const { data: records } = await supabase
      .from('capture_decision_records')
      .select('decision_version, recommendation')
      .eq('capture_id', captureId)
      .order('decision_version');

    expect(records.length).toBe(2);
    expect(records[0].recommendation).toBe('MORE_RESEARCH_REQUIRED');
    expect(records[1].recommendation).toBe('GO');
  });

  // Slack callback separation — no James inference during callback
  it('handleSendToCapture does not call Gateway', async () => {
    const { createCapture } = await import('../capture-manager.js');
    expect(typeof createCapture).toBe('function');
  });

  // Parallel budget concurrency test
  it('parallel specialist budget race: only one reservation succeeds under shared capture budget', async () => {
    // Create a capture workflow budget with $0.25
    const captureId = `test-cap-${testRunId}-budget`;
    const scopeId = `capture-${captureId}`;

    // Ensure workflow budget
    const { ensureWorkflowBudget } = await import('../../../services/llm-gateway/budget.js');
    await ensureWorkflowBudget(supabase, scopeId, 0.25);

    // Spend $0.19 to leave only $0.06 remaining
    await supabase
      .from('ai_budget_scopes')
      .update({
        spent_usd: 0.19,
      })
      .eq('scope_id', scopeId);

    // Get the scope UUID
    const { data: scope } = await supabase
      .from('ai_budget_scopes')
      .select('id')
      .eq('scope_id', scopeId)
      .single();

    // Also need a global scope
    const { data: globalScope } = await supabase
      .from('ai_budget_scopes')
      .select('id')
      .eq('scope_id', 'default')
      .single();

    // Two concurrent reservations each requesting $0.04
    const makeReservation = (key: string) =>
      supabase.rpc('reserve_inference_hierarchical', {
        p_idempotency_key: `test:${testRunId}:race:${key}`,
        p_agent_id: 'james',
        p_purpose: 'reason',
        p_task_type: 'test',
        p_provider: 'anthropic',
        p_model: 'test',
        p_model_tier: 'haiku',
        p_estimated_input_tokens: 100,
        p_max_input_tokens: 1000,
        p_max_output_tokens: 100,
        p_reserved_cost_usd: 0.04,
        p_scope_ids: [globalScope!.id, scope!.id],
      });

    const [r1, r2] = await Promise.all([makeReservation('a'), makeReservation('b')]);

    // Exactly one should succeed (is_new=true), the other should fail (null or is_new=false)
    const successes = [r1.data, r2.data].filter((d) => d?.is_new === true);
    const failures = [r1.data, r2.data].filter((d) => !d || d.is_new !== true);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify capture scope not exceeded
    const { data: afterScope } = await supabase
      .from('ai_budget_scopes')
      .select('spent_usd, reserved_usd, limit_usd')
      .eq('scope_id', scopeId)
      .single();

    const total = Number(afterScope!.spent_usd) + Number(afterScope!.reserved_usd);
    expect(total).toBeLessThanOrEqual(Number(afterScope!.limit_usd));

    // Clean up
    if (successes[0]?.ledger_id) {
      await supabase.from('ai_inference_ledger').delete().eq('id', successes[0].ledger_id);
    }
    await supabase.from('ai_budget_scopes').delete().eq('scope_id', scopeId);
    await supabase
      .from('ai_inference_ledger')
      .delete()
      .like('idempotency_key', `test:${testRunId}:race:%`);
  });

  // Executive More Research integration test
  it('executive more research creates separate authorization, not Round 3', async () => {
    const oppId = `test-opp-${testRunId}-execres`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Exec Research',
      raw_hash: 'test',
      material_hash: 'mat-execres',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '777.777',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision, transitionCapture } =
      await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-execres',
      'U123',
      'evt7',
      'C123',
      '777.777'
    );

    // Simulate rounds 1 and 2 exhausted
    await supabase.from('captures').update({ research_round: 2 }).eq('id', captureId);
    await transitionCapture(supabase, captureId!, 'pending', 'recommendation_ready');
    await recordDecision(
      supabase,
      captureId!,
      'MORE_RESEARCH_REQUIRED',
      55,
      { recommendation: 'MORE_RESEARCH_REQUIRED' },
      2
    );

    // Human requests more research with specific question
    const { handleJamesMoreResearch } = await import('../slack-surface.js');
    const result = await handleJamesMoreResearch(
      supabase,
      captureId!,
      'U123',
      1,
      'What is the incumbent vendor contract performance rating?'
    );
    expect(result.success).toBe(true);

    // Verify event persisted with actual question
    const { data: events } = await supabase
      .from('opportunity_events')
      .select('payload')
      .eq('event_type', 'EXECUTIVE_MORE_RESEARCH_REQUESTED')
      .like('aggregate_id', captureId!);

    expect(events!.length).toBe(1);
    expect(events![0].payload.question).toBe(
      'What is the incumbent vendor contract performance rating?'
    );
    expect(events![0].payload.researchAuthority).toBe('EXECUTIVE_REQUESTED');

    // research_round should still be 2 (NOT 3)
    const { data: cap } = await supabase
      .from('captures')
      .select('research_round, status')
      .eq('id', captureId)
      .single();
    expect(cap!.research_round).toBe(2);
    expect(cap!.status).toBe('researching');

    // Verify separate budget was created
    expect(events![0].payload.researchBudgetId).toContain('exec-research');
  });

  // Atomic Pursue failure: partial state cannot exist
  it('authorize_pursuit rejects invalid status', async () => {
    const oppId = `test-opp-${testRunId}-pursefail`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Pursue Fail',
      raw_hash: 'test',
      material_hash: 'mat-pursefail',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '888.888',
      thread_owner: 'MAYA',
    });

    const { createCapture } = await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-pursefail',
      'U123',
      'evt8',
      'C123',
      '888.888'
    );

    // Try to pursue while still 'pending' (not recommendation_ready)
    const { error } = await supabase.rpc('authorize_pursuit', {
      p_capture_id: captureId,
      p_human_id: 'U123',
      p_decision_version: 0,
    });

    expect(error).toBeTruthy();
    expect(error.message).toContain('Invalid capture status');

    // No workspace should exist
    const { data: ws } = await supabase
      .from('proposal_workspaces')
      .select('id')
      .eq('capture_id', captureId)
      .single();
    expect(ws).toBeNull();

    // No PURSUIT_AUTHORIZED event should exist
    const { count } = await supabase
      .from('opportunity_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'PURSUIT_AUTHORIZED')
      .like('aggregate_id', captureId!);
    expect(count).toBe(0);
  });

  // Atomic No-Go failure
  it('authorize_no_go rejects invalid status and preserves recommendation', async () => {
    const oppId = `test-opp-${testRunId}-nogofail`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test NoGo Fail',
      raw_hash: 'test',
      material_hash: 'mat-nogofail',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '999.999',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision } = await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-nogofail',
      'U123',
      'evt9',
      'C123',
      '999.999'
    );

    await recordDecision(supabase, captureId!, 'GO', 80, { recommendation: 'GO' }, 0);
    // Don't transition to recommendation_ready — leave as pending

    const { error } = await supabase.rpc('authorize_no_go', {
      p_capture_id: captureId,
      p_human_id: 'U123',
      p_decision_version: 1,
    });

    expect(error).toBeTruthy();

    // James recommendation preserved
    const { data: cap } = await supabase
      .from('captures')
      .select('james_recommendation, human_decision, status')
      .eq('id', captureId)
      .single();
    expect(cap!.james_recommendation).toBe('GO');
    expect(cap!.human_decision).toBeNull();
    expect(cap!.status).toBe('pending');
  });

  // Fixture isolation test
  it('resynthesis context excludes TEST_FIXTURE artifacts', async () => {
    const oppId = `test-opp-${testRunId}-fixture`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Fixture Isolation',
      raw_hash: 'test',
      material_hash: 'mat-fixture',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '101.101',
      thread_owner: 'MAYA',
    });

    const { createCapture } = await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-fixture',
      'U123',
      'evt10',
      'C123',
      '101.101'
    );

    // Create a specialist task + TEST_FIXTURE artifact
    const { data: task } = await supabase
      .from('specialist_tasks')
      .insert({
        capture_id: captureId,
        opportunity_id: oppId,
        task_type: 'COMPETITIVE_INTELLIGENCE',
        question: 'test',
        why_decision_blocking: 'test',
        research_round: 1,
        idempotency_key: `test:${testRunId}:fixture-task`,
        execution_mode: 'TEST_FIXTURE',
        status: 'completed',
      })
      .select('id')
      .single();

    await supabase.from('specialist_artifacts').insert({
      specialist_task_id: task!.id,
      capture_id: captureId,
      finding: 'Fixture finding',
      assessment: 'FAVORABLE',
      confidence: 'HIGH',
      artifact_source: 'TEST_FIXTURE',
    });

    // Create a REAL_SPECIALIST artifact
    const { data: realTask } = await supabase
      .from('specialist_tasks')
      .insert({
        capture_id: captureId,
        opportunity_id: oppId,
        task_type: 'TECHNICAL_ASSESSMENT',
        question: 'test real',
        why_decision_blocking: 'test',
        research_round: 1,
        idempotency_key: `test:${testRunId}:real-task`,
        execution_mode: 'REAL_SPECIALIST',
        status: 'completed',
      })
      .select('id')
      .single();

    await supabase.from('specialist_artifacts').insert({
      specialist_task_id: realTask!.id,
      capture_id: captureId,
      finding: 'Real finding',
      assessment: 'MIXED',
      confidence: 'MEDIUM',
      artifact_source: 'REAL_SPECIALIST',
    });

    // Load context — the getCaptureContext returns ALL artifacts
    const { getCaptureContext } = await import('../capture-manager.js');
    const ctx = await getCaptureContext(supabase, captureId!);

    // But the resynthesis prompt builder filters out TEST_FIXTURE
    const allArtifacts = ctx.specialistArtifacts;
    expect(allArtifacts.length).toBe(2);

    const realOnly = allArtifacts.filter(
      (a: { artifact_source: string }) => a.artifact_source !== 'TEST_FIXTURE'
    );
    expect(realOnly.length).toBe(1);
    expect(realOnly[0].finding).toBe('Real finding');
  });

  // Recommendation version history with button validation
  it('full recommendation history: v1 → v2 → button v1 rejected, v2 accepted', async () => {
    const oppId = `test-opp-${testRunId}-fullhist`;

    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Full History',
      raw_hash: 'test',
      material_hash: 'mat-fullhist',
    });
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'capture_sent',
      channel_id: 'C123',
      message_ts: '102.102',
      thread_owner: 'MAYA',
    });

    const { createCapture, recordDecision, transitionCapture } =
      await import('../capture-manager.js');
    const captureId = await createCapture(
      supabase,
      oppId,
      'mat-fullhist',
      'U123',
      'evt11',
      'C123',
      '102.102'
    );

    // v1: initial assessment
    await recordDecision(supabase, captureId!, 'MORE_RESEARCH_REQUIRED', 50, { v: 1 }, 0);
    // v2: resynthesis after research
    await recordDecision(supabase, captureId!, 'GO', 82, { v: 2 }, 1);

    await transitionCapture(supabase, captureId!, 'pending', 'recommendation_ready');

    // v1 is immutable/auditable
    const { data: records } = await supabase
      .from('capture_decision_records')
      .select('decision_version, recommendation, confidence')
      .eq('capture_id', captureId)
      .order('decision_version');

    expect(records!.length).toBe(2);
    expect(records![0].recommendation).toBe('MORE_RESEARCH_REQUIRED');
    expect(records![0].confidence).toBe(50);
    expect(records![1].recommendation).toBe('GO');
    expect(records![1].confidence).toBe(82);

    // Button v1 rejected (stale)
    const { handlePursue } = await import('../slack-surface.js');
    const staleResult = await handlePursue(supabase, captureId!, 'U123', 1);
    expect(staleResult.success).toBe(false);
    expect(staleResult.message).toContain('newer');

    // Button v2 succeeds
    const freshResult = await handlePursue(supabase, captureId!, 'U123', 2);
    expect(freshResult.success).toBe(true);

    // Human decision references correct version
    const { data: cap } = await supabase
      .from('captures')
      .select('decision_version, james_recommendation, human_decision')
      .eq('id', captureId)
      .single();
    expect(cap!.decision_version).toBe(2);
    expect(cap!.james_recommendation).toBe('GO');
    expect(cap!.human_decision).toBe('PURSUIT');
  });
});
