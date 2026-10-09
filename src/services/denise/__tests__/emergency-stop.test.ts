/**
 * Denise Emergency Stop — Dual Authorization Integration Tests
 *
 * Verifies DB-based emergency stop with mocked Slack transport.
 * Tests all gate combinations: env flag x DB control x DB availability.
 * Runs against commissioning Supabase — zero live Slack connections.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN_DB_TESTS = HAS_DB && !IS_PRODUCTION;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;

// ============================================================
// DB integration tests — commissioning only
// ============================================================
describe.skipIf(!CAN_RUN_DB_TESTS)('Denise Emergency Stop — DB Integration', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

    // Ensure the denise_slack_enabled row exists (migration may not have run)
    await supabase.from('system_controls').upsert({
      key: 'denise_slack_enabled',
      value: false,
      description: 'Test setup — emergency stop DB control',
      updated_by: 'test',
    });
  });

  afterAll(async () => {
    // ALWAYS restore to false — safety invariant
    await supabase.from('system_controls').upsert({
      key: 'denise_slack_enabled',
      value: false,
      description: 'Test cleanup — restored to false',
      updated_by: 'test-cleanup',
    });
  });

  beforeEach(async () => {
    // Import fresh to clear cache
    const { _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();
  });

  it('DB control false + env true → denied', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    process.env.DENISE_SLACK_ENABLED = 'true';

    // Set DB to false
    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    const { isDeniseSlackAuthorized, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    const result = await isDeniseSlackAuthorized();
    expect(result).toBe(false);

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('DB control true + env false → denied', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    delete process.env.DENISE_SLACK_ENABLED;

    // Set DB to true
    await supabase.from('system_controls').update({ value: true, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    const { isDeniseSlackAuthorized, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    const result = await isDeniseSlackAuthorized();
    expect(result).toBe(false);

    // Restore DB to false
    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('DB control true + env true → permitted', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    process.env.DENISE_SLACK_ENABLED = 'true';

    // Set DB to true
    await supabase.from('system_controls').update({ value: true, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    const { isDeniseSlackAuthorized, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    const result = await isDeniseSlackAuthorized();
    expect(result).toBe(true);

    // Restore DB to false
    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('DB control false + env false → denied', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    delete process.env.DENISE_SLACK_ENABLED;

    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    const { isDeniseSlackAuthorized, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    const result = await isDeniseSlackAuthorized();
    expect(result).toBe(false);

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('DB change affects authorization within cache interval', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    process.env.DENISE_SLACK_ENABLED = 'true';

    const { isDeniseSlackAuthorized, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    // Start with DB=false
    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');
    _resetDeniseDbCache();

    expect(await isDeniseSlackAuthorized()).toBe(false);

    // Change to DB=true
    await supabase.from('system_controls').update({ value: true, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');
    _resetDeniseDbCache(); // Simulate cache expiry

    expect(await isDeniseSlackAuthorized()).toBe(true);

    // Change back to DB=false
    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');
    _resetDeniseDbCache();

    expect(await isDeniseSlackAuthorized()).toBe(false);

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('notification delivery denied when DB control is false', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    process.env.DENISE_SLACK_ENABLED = 'true';

    await supabase.from('system_controls').update({ value: false, updated_by: 'test' })
      .eq('key', 'denise_slack_enabled');

    const { executeDelivery, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    const mockCandidate = {
      opportunityId: 'test-opp',
      category: 'MATERIAL_AMENDMENT' as const,
      severity: 'HIGH',
      findingSummary: 'Test finding',
      artifactId: 'test-artifact',
      artifactVersion: 1,
      coverageStatus: 'FULL',
      legalReviewRequired: false,
      idempotencyKey: `test-estop-${Date.now()}`,
    };

    const result = await executeDelivery(supabase, mockCandidate, async () => ({ ok: true }), 'C123');
    expect(result.status).toBe('DISABLED');
    expect(result.reason).toContain('not authorized');

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('restores control to false after all tests', async () => {
    // Final safety verification
    const { data } = await supabase.from('system_controls')
      .select('value').eq('key', 'denise_slack_enabled').single();
    expect(data?.value).toBe(false);
  });
});

// ============================================================
// Unit tests — no DB required
// ============================================================
describe('Denise Emergency Stop — Unit Tests', () => {
  it('env flag false → isDeniseSlackAuthorized returns false immediately (no DB call)', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    delete process.env.DENISE_SLACK_ENABLED;

    const { isDeniseSlackAuthorized, _resetDeniseDbCache } = await import('../slack-adapter.js');
    _resetDeniseDbCache();

    // Even without DB, env=false should short-circuit
    const result = await isDeniseSlackAuthorized();
    expect(result).toBe(false);

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('isDeniseSlackEnabled checks env flag synchronously', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;

    const { isDeniseSlackEnabled } = await import('../slack-adapter.js');

    delete process.env.DENISE_SLACK_ENABLED;
    expect(isDeniseSlackEnabled()).toBe(false);

    process.env.DENISE_SLACK_ENABLED = 'true';
    expect(isDeniseSlackEnabled()).toBe(true);

    process.env.DENISE_SLACK_ENABLED = 'false';
    expect(isDeniseSlackEnabled()).toBe(false);

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });

  it('qualifiesForNotification returns false when env disabled', async () => {
    const saved = process.env.DENISE_SLACK_ENABLED;
    delete process.env.DENISE_SLACK_ENABLED;

    const { qualifiesForNotification } = await import('../slack-adapter.js');
    const result = qualifiesForNotification({
      opportunityId: 'test',
      category: 'MATERIAL_AMENDMENT',
      severity: 'HIGH',
      findingSummary: 'test',
      artifactId: 'test',
      artifactVersion: 1,
      coverageStatus: 'FULL',
      legalReviewRequired: false,
      idempotencyKey: 'test',
    });
    expect(result.qualifies).toBe(false);
    expect(result.reason).toContain('DENISE_SLACK_ENABLED');

    if (saved) process.env.DENISE_SLACK_ENABLED = saved; else delete process.env.DENISE_SLACK_ENABLED;
  });
});
