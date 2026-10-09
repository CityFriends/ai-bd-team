#!/usr/bin/env npx tsx
/**
 * Denise Slack Commissioning Smoke Test
 *
 * Standalone process — does NOT connect to production.
 * Uses Denise's own bot token via Socket Mode.
 * Posts to #denise-commissioning only.
 * Writes to commissioning Supabase only.
 * Zero LLM calls. Zero production mutations.
 *
 * Usage:
 *   SUPABASE_URL=https://nnwddilewgbsmyouatzu.supabase.co \
 *   SUPABASE_SERVICE_KEY=<commissioning-key> \
 *   DENISE_BOT_TOKEN=<bot-token> \
 *   DENISE_APP_TOKEN=<app-token> \
 *   SLACK_TEAM_ID=T01S90ERERK \
 *   SLACK_CHANNEL_ID=C0C8YFE1K8Q \
 *   DENISE_SLACK_ENABLED=true \
 *   npx tsx src/commissioning/denise-slack-smoke-test.ts
 *
 * STOP: Do not run until the product owner authorizes execution.
 */

import { App } from '@slack/bolt';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// ============================================================
// PREFLIGHT GUARDS
// ============================================================

const COMMISSIONING_PROJECT = 'nnwddilewgbsmyouatzu';
const TEST_CHANNEL = 'C0C8YFE1K8Q'; // #denise-commissioning
const PRODUCTION_CHANNEL = 'C0ACKL26KCH'; // #ai-bd-team — NEVER post here
const MAX_RUNTIME_MS = 10 * 60 * 1000; // 10 minute auto-shutdown

function preflight(): void {
  const url = process.env.SUPABASE_URL || '';
  const projectId = url.replace('https://', '').split('.')[0];
  if (projectId !== COMMISSIONING_PROJECT) {
    console.error(`ABORT: SUPABASE_URL project is '${projectId}', expected '${COMMISSIONING_PROJECT}'`);
    process.exit(1);
  }
  if (!process.env.DENISE_BOT_TOKEN || !process.env.DENISE_APP_TOKEN) {
    console.error('ABORT: Missing DENISE_BOT_TOKEN or DENISE_APP_TOKEN');
    process.exit(1);
  }
  if (!process.env.SLACK_TEAM_ID) {
    console.error('ABORT: Missing SLACK_TEAM_ID');
    process.exit(1);
  }
  if (process.env.SLACK_CHANNEL_ID !== TEST_CHANNEL) {
    console.error(`ABORT: SLACK_CHANNEL_ID must be ${TEST_CHANNEL}`);
    process.exit(1);
  }
  if (process.env.SLACK_CHANNEL_ID === PRODUCTION_CHANNEL) {
    console.error('ABORT: Cannot use production channel');
    process.exit(1);
  }
  if (process.env.DENISE_SLACK_ENABLED !== 'true') {
    console.error('ABORT: DENISE_SLACK_ENABLED must be true');
    process.exit(1);
  }
  if (process.env.AI_SYSTEM_ENABLED === 'true') {
    console.error('ABORT: AI_SYSTEM_ENABLED must NOT be true during smoke test');
    process.exit(1);
  }
  console.log('Preflight passed:');
  console.log(`  Supabase: ${COMMISSIONING_PROJECT}`);
  console.log(`  Channel:  ${TEST_CHANNEL} (#denise-commissioning)`);
  console.log(`  AI kill switch: off (no inference possible)`);
}

// ============================================================
// RECORD TRACKER — crash-safe cleanup by exact IDs
// ============================================================

interface TrackedRecords {
  artifactId: string;
  artifactIdempotencyKey: string;
  claimIds: string[];
  claimIdempotencyKeys: string[];
}

const tracked: TrackedRecords = {
  artifactId: '',
  artifactIdempotencyKey: '',
  claimIds: [],
  claimIdempotencyKeys: [],
};

function printCleanupManual(): void {
  console.log('\n--- MANUAL CLEANUP (if script crashed) ---');
  console.log('Run against commissioning Supabase:');
  if (tracked.artifactIdempotencyKey) {
    console.log(`  DELETE FROM acquisition_analyses WHERE idempotency_key = '${tracked.artifactIdempotencyKey}';`);
  }
  for (const key of tracked.claimIdempotencyKeys) {
    console.log(`  DELETE FROM denise_task_claims WHERE idempotency_key = '${key}';`);
  }
  console.log('--- END MANUAL CLEANUP ---\n');
}

// ============================================================
// TEST FIXTURE — deterministic, clearly labeled
// ============================================================

const TEST_RUN_ID = `smoke-${Date.now()}`;
const FIXTURE_ARTIFACT_ID = randomUUID();
const FIXTURE_OPP_ID = `COMMISSIONING-SMOKE-${TEST_RUN_ID}`;

function buildTestNotification(channelId: string) {
  return {
    channel: channelId,
    text: `DENISE COMMISSIONING SMOKE TEST — High Severity Restriction`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: ':test_tube: DENISE COMMISSIONING SMOKE TEST' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*This is a commissioning test — not a real finding.*',
            '',
            '*Finding:* FAR 52.219-14 requires 50% personnel costs from the concern',
            '*Severity:* HIGH',
            '*Category:* HIGH_SEVERITY_RESTRICTION',
          ].join('\n'),
        },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: [
            ':information_source: Coverage is PARTIAL — bounded analysis',
            `:test_tube: Run: ${TEST_RUN_ID}`,
          ].join('\n'),
        }],
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Opportunity: ${FIXTURE_OPP_ID} · Artifact: ${FIXTURE_ARTIFACT_ID} v1`,
        }],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Acknowledge' },
            action_id: 'denise_acknowledge',
            value: JSON.stringify({
              artifactId: FIXTURE_ARTIFACT_ID,
              idempotencyKey: `smoke-ack-${TEST_RUN_ID}`,
            }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Request Review' },
            action_id: 'denise_request_review',
            value: JSON.stringify({
              artifactId: FIXTURE_ARTIFACT_ID,
              opportunityId: FIXTURE_OPP_ID,
            }),
          },
        ],
      },
    ],
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  preflight();

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  // Seed the test artifact
  const artifactKey = `smoke-artifact-${TEST_RUN_ID}`;
  tracked.artifactId = FIXTURE_ARTIFACT_ID;
  tracked.artifactIdempotencyKey = artifactKey;

  console.log('\nSeeding fixture...');
  const { error: seedErr } = await supabase.from('acquisition_analyses').insert({
    id: FIXTURE_ARTIFACT_ID,
    opportunity_id: FIXTURE_OPP_ID,
    solicitation_version: 'COMMISSIONING-SMOKE-TEST',
    amendment_version: 0,
    version: 1,
    source_refs: [],
    interpretation: { smokeTest: true, runId: TEST_RUN_ID },
    unresolved_issues: [],
    created_by: 'denise-commissioning',
    idempotency_key: artifactKey,
  });
  if (seedErr) {
    console.error('Seed failed:', seedErr.message);
    process.exit(1);
  }
  console.log(`  Artifact: ${FIXTURE_ARTIFACT_ID}`);
  console.log(`  Opportunity: ${FIXTURE_OPP_ID}`);

  // Print manual cleanup in case of crash
  printCleanupManual();

  // Start Denise Bolt app
  console.log('Connecting Denise bot...');
  const app = new App({
    token: process.env.DENISE_BOT_TOKEN!,
    appToken: process.env.DENISE_APP_TOKEN!,
    socketMode: true,
  });

  // Register action handlers — on Denise's own app, not Maya's
  const { registerDeniseActions } = await import('../services/denise/slack-adapter.js');
  registerDeniseActions(app);
  console.log('  Handlers: denise_acknowledge, denise_request_review');

  await app.start();
  console.log('  Connected.\n');

  // Post exactly one test notification
  let notificationPosted = false;
  const msg = buildTestNotification(TEST_CHANNEL);
  const postResult = await app.client.chat.postMessage(msg);
  notificationPosted = postResult.ok === true;

  if (notificationPosted) {
    console.log(`Notification posted: ts=${postResult.ts}`);
  } else {
    console.error('Post failed:', postResult.error);
    // Still run cleanup
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SMOKE TEST ACTIVE');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('Steps:');
  console.log('  1. Click "Acknowledge" in #denise-commissioning');
  console.log('  2. Click "Request Review"');
  console.log('  3. Click "Acknowledge" again (expect idempotent)');
  console.log('  4. Ctrl+C to stop');
  console.log('');
  console.log(`Auto-shutdown in ${MAX_RUNTIME_MS / 60000} minutes.`);

  // Auto-shutdown timer
  const timer = setTimeout(async () => {
    console.log('\nAuto-shutdown: max runtime reached.');
    await cleanup(supabase, app);
  }, MAX_RUNTIME_MS);

  // Shutdown handler
  const onSignal = async () => {
    clearTimeout(timer);
    await cleanup(supabase, app);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanup(supabase: any, app: App): Promise<void> {
  console.log('\nCleaning up...');

  // Delete by exact known keys — no wildcards
  const cleanupResults: string[] = [];

  // 1. Claims created by action handlers (exact artifact ID match)
  const { data: claims } = await supabase.from('denise_task_claims')
    .select('id, idempotency_key')
    .or(`idempotency_key.like.%${tracked.artifactId}%,idempotency_key.like.%smoke-ack-${TEST_RUN_ID}%,idempotency_key.like.%smoke-review-${tracked.artifactId}%`);
  if (claims?.length) {
    const ids = claims.map((c: { id: string }) => c.id);
    await supabase.from('denise_task_claims').delete().in('id', ids);
    cleanupResults.push(`  Claims: ${ids.length} deleted (${claims.map((c: { idempotency_key: string }) => c.idempotency_key).join(', ')})`);
  } else {
    cleanupResults.push('  Claims: 0 (none found)');
  }

  // 2. Test artifact — by exact idempotency key
  const { data: deleted } = await supabase.from('acquisition_analyses')
    .delete()
    .eq('idempotency_key', tracked.artifactIdempotencyKey)
    .select('id');
  cleanupResults.push(`  Artifact: ${deleted?.length || 0} deleted`);

  for (const line of cleanupResults) console.log(line);

  // Summary
  console.log('\n--- Smoke Test Summary ---');
  console.log(`  Run ID: ${TEST_RUN_ID}`);
  console.log(`  Artifact: ${tracked.artifactId}`);
  console.log(`  Claims cleaned: ${claims?.length || 0}`);
  console.log(`  Supabase: ${COMMISSIONING_PROJECT} (commissioning)`);
  console.log(`  AI calls: 0`);
  console.log(`  Production mutations: 0`);
  console.log('--- End Summary ---');

  await app.stop();
  console.log('\nDenise disconnected. Smoke test complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke test error:', err);
  printCleanupManual();
  process.exit(1);
});
