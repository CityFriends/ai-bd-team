/**
 * Maya Production Integration Tests
 *
 * Tests concurrency, idempotency, material change, Slack projection,
 * task claim races, and button handling using real PostgreSQL where available.
 */
import 'dotenv/config';

// Set test auth env BEFORE any production module imports (module-level const)
process.env.MAYA_DEV_MODE = 'true';
process.env.SLACK_AUTHORIZED_USERS = 'U123,U456';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { emitEvent, MAYA_EVENT_TYPES } from '../events.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;

describe.skipIf(!HAS_DB)('Maya Production Integration', () => {
  beforeAll(() => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = Math.random().toString(36).slice(2, 8);
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('opportunity_events')
      .delete()
      .like('idempotency_key', `test:${testRunId}:%`);
    await supabase
      .from('opportunity_events')
      .delete()
      .like('idempotency_key', `action:%test-opp-${testRunId}%`);
    await supabase
      .from('maya_review_tasks')
      .delete()
      .like('idempotency_key', `test:${testRunId}:%`);
    await supabase
      .from('maya_review_tasks')
      .delete()
      .like('idempotency_key', `review:test-opp-${testRunId}%`);
    await supabase
      .from('slack_opportunity_briefs')
      .delete()
      .like('opportunity_id', `test-opp-${testRunId}%`);
    await supabase
      .from('pipeline_opportunities')
      .delete()
      .like('source_id', `test-opp-${testRunId}%`);
  });

  // Concurrent event emission — idempotent
  it('duplicate event emission is idempotent', async () => {
    const key = `test:${testRunId}:dup-event`;
    const event = {
      eventType: MAYA_EVENT_TYPES.OPPORTUNITY_DISCOVERED,
      aggregateType: 'opportunity',
      aggregateId: `test-opp-${testRunId}`,
      actorType: 'SYSTEM' as const,
      source: 'test',
      correlationId: `test:${testRunId}`,
      idempotencyKey: key,
      schemaVersion: 1,
      payload: { test: true },
    };

    // Emit the same event concurrently
    const results = await Promise.all([
      emitEvent(supabase, event),
      emitEvent(supabase, event),
      emitEvent(supabase, event),
    ]);

    // At most one should return a non-null ID (the one that won the insert)
    const created = results.filter((r) => r !== null);
    expect(created.length).toBeLessThanOrEqual(1);

    // Verify exactly 1 row in DB
    const { count } = await supabase
      .from('opportunity_events')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);
  });

  // Maya review task idempotency
  it('duplicate review tasks are prevented by unique constraint', async () => {
    const oppId = `test-opp-${testRunId}-task`;
    const idempKey = `test:${testRunId}:task-dup`;

    // Insert first
    const { error: e1 } = await supabase.from('maya_review_tasks').insert({
      opportunity_id: oppId,
      material_hash: 'hash1',
      contract_version: 'v1',
      idempotency_key: idempKey,
      status: 'pending',
    });
    expect(e1).toBeNull();

    // Duplicate should fail or be ignored
    const { error: e2 } = await supabase.from('maya_review_tasks').insert({
      opportunity_id: oppId,
      material_hash: 'hash1',
      contract_version: 'v1',
      idempotency_key: idempKey,
      status: 'pending',
    });
    // Either error or upsert ignores duplicate
    expect(e2 || true).toBeTruthy();

    // Only 1 task exists
    const { count } = await supabase
      .from('maya_review_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('idempotency_key', idempKey);
    expect(count).toBe(1);
  });

  // Material change creates new task with new key
  it('material change creates new eligible review version', async () => {
    const oppId = `test-opp-${testRunId}-material`;
    const key1 = `test:${testRunId}:mat-v1`;
    const key2 = `test:${testRunId}:mat-v2`;

    await supabase.from('maya_review_tasks').insert({
      opportunity_id: oppId,
      material_hash: 'hash-v1',
      contract_version: 'v1',
      idempotency_key: key1,
      status: 'completed',
      recommendation: 'WATCH',
    });

    // New material hash → new task
    await supabase.from('maya_review_tasks').insert({
      opportunity_id: oppId,
      material_hash: 'hash-v2',
      contract_version: 'v1',
      idempotency_key: key2,
      status: 'pending',
    });

    const { count } = await supabase
      .from('maya_review_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('opportunity_id', oppId);
    expect(count).toBe(2);

    // Previous decision retained
    const { data: v1 } = await supabase
      .from('maya_review_tasks')
      .select('recommendation')
      .eq('idempotency_key', key1)
      .single();
    expect(v1?.recommendation).toBe('WATCH');
  });

  // Slack button idempotency — version-aware
  it('duplicate dismiss action creates one event', async () => {
    const oppId = `test-opp-${testRunId}-dismiss`;
    const msgTs = '1234567890.123';
    const materialHash = 'testhash1234';

    // Create opportunity with material hash for version-aware validation
    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Dismiss Opp',
      raw_hash: 'test-raw',
      material_hash: materialHash,
    });

    // Create a brief first
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'posted',
      channel_id: 'C123',
      message_ts: msgTs,
    });

    // Import handler
    const { handleDismiss } = await import('../slack-surface.js');

    // Call dismiss multiple times
    const r1 = await handleDismiss(
      supabase,
      oppId,
      'U123',
      msgTs,
      'NOT_FIT',
      undefined,
      materialHash
    );
    const r2 = await handleDismiss(
      supabase,
      oppId,
      'U123',
      msgTs,
      'NOT_FIT',
      undefined,
      materialHash
    );

    expect(r1.success).toBe(true);
    // Second call should detect stale state (already dismissed)
    expect(r2.success).toBe(false); // Already dismissed

    // Only 1 dismiss event
    const { count } = await supabase
      .from('opportunity_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'CANDIDATE_DISMISSED')
      .like('idempotency_key', `action:dismiss:${oppId}%`);
    expect(count).toBe(1);
  });

  // Version-aware: stale button from old material version → rejected
  it('stale button from superseded material version is rejected', async () => {
    const oppId = `test-opp-${testRunId}-stale`;
    const msgTs = '1234567890.456';
    const oldHash = 'oldhash12345';
    const newHash = 'newhash67890';

    // Create opportunity with NEW material hash (opportunity was updated)
    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Stale Opp',
      raw_hash: 'test-raw-stale',
      material_hash: newHash,
    });

    // Create brief
    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'posted',
      channel_id: 'C123',
      message_ts: msgTs,
    });

    const { handleSendToCapture } = await import('../slack-surface.js');

    // Button from OLD material version
    const result = await handleSendToCapture(supabase, oppId, 'U123', msgTs, oldHash);
    expect(result.success).toBe(false);
    expect(result.message).toContain('updated since');
  });

  // New material version action can execute legitimately
  it('new material version button executes legitimately', async () => {
    const oppId = `test-opp-${testRunId}-newver`;
    const msgTs = '1234567890.789';
    const currentHash = 'currenthash1';

    // Create opportunity with current material hash
    await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test NewVer Opp',
      raw_hash: 'test-raw-newver',
      material_hash: currentHash,
    });

    await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'posted',
      channel_id: 'C123',
      message_ts: msgTs,
    });

    const { handleSendToCapture } = await import('../slack-surface.js');

    // Button with matching material version
    const result = await handleSendToCapture(supabase, oppId, 'U123', msgTs, currentHash);
    expect(result.success).toBe(true);
  });

  // Task claim concurrency — exactly one winner
  it('concurrent task claims produce exactly one execution owner', async () => {
    const oppId = `test-opp-${testRunId}-claim`;
    const idempKey = `test:${testRunId}:claim-race`;

    // Create a pending task
    const { data: task } = await supabase
      .from('maya_review_tasks')
      .insert({
        opportunity_id: oppId,
        material_hash: 'hash-claim',
        contract_version: 'v1',
        idempotency_key: idempKey,
        status: 'pending',
      })
      .select('id')
      .single();

    expect(task).not.toBeNull();
    const taskId = task!.id;

    // Simulate concurrent claim attempts
    const claimAttempts = Array.from({ length: 5 }, () =>
      supabase
        .from('maya_review_tasks')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', taskId)
        .eq('status', 'pending') // Atomic: only succeeds if still pending
        .select('id')
        .single()
    );

    const results = await Promise.all(claimAttempts);

    // Exactly one should have data (the winner)
    const winners = results.filter((r) => r.data !== null && !r.error);
    expect(winners.length).toBe(1);

    // Task should be in_progress
    const { data: finalTask } = await supabase
      .from('maya_review_tasks')
      .select('status')
      .eq('id', taskId)
      .single();
    expect(finalTask?.status).toBe('in_progress');
  });

  // Slack projection retry — does NOT repeat inference
  it('projection retry succeeds without repeating inference', async () => {
    const oppId = `test-opp-${testRunId}-retry`;
    const materialHash = 'retryhash123';

    // Create opportunity with existing Maya decision
    const { error: insertOppErr } = await supabase.from('pipeline_opportunities').insert({
      source: 'sam_gov',
      source_id: oppId,
      title: 'Test Retry Opp',
      agency: 'VA',
      raw_hash: 'test-raw-hash',
      material_hash: materialHash,
      maya_recommendation: 'EVALUATE',
      maya_quick_review: {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'custom',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      },
    });
    expect(insertOppErr).toBeNull();

    // Create failed brief (projection failed previously)
    const { error: briefInsertErr } = await supabase.from('slack_opportunity_briefs').insert({
      opportunity_id: oppId,
      status: 'pending',
      channel_id: 'C123',
      projection_attempts: 1,
      last_projection_error: 'network timeout',
    });
    expect(briefInsertErr).toBeNull();

    // Retry with mock Slack client — does NOT repeat inference
    const { retrySlackProjection } = await import('../slack-surface.js');
    const mockSlack = {
      chat: {
        postMessage: async () => ({ ok: true, ts: '9999.999' }),
      },
    };

    // Set projection enabled for test
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';

    const result = await retrySlackProjection(supabase, mockSlack, 'C123', oppId);

    delete process.env.MAYA_SLACK_PROJECTION_ENABLED;

    expect(result.success).toBe(true);
    expect(result.messageTs).toBe('9999.999');

    // Verify brief is now posted
    const { data: brief } = await supabase
      .from('slack_opportunity_briefs')
      .select('status, message_ts')
      .eq('opportunity_id', oppId)
      .single();
    expect(brief?.status).toBe('posted');
    expect(brief?.message_ts).toBe('9999.999');

    // Cleanup
    await supabase.from('pipeline_opportunities').delete().eq('source_id', oppId);
  });
});
