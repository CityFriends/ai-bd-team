/**
 * OpportunityCollector — Deterministic Production Source Collector
 *
 * Core operating rule: Schedules wake collectors. Events wake workflows.
 *
 * This collector MUST NOT:
 * - invoke any LLM
 * - post Slack messages
 * - wake Maya or any agent
 * - extract memory or create embeddings
 *
 * It produces durable events that downstream task processors consume.
 */

import { SAMSource } from '../../pipeline/maya/source-sam.js';
import { applyHardFilters } from '../../pipeline/maya/hard-filters.js';
import { calculateFitScore, type ScoringContext } from '../../pipeline/maya/fit-score.js';
import { checkStrategicOverrides } from '../../pipeline/maya/strategic.js';
import { matchPastPerformance } from '../../pipeline/maya/company-profile.js';
import { metadataPreScreen } from '../../pipeline/maya/evidence.js';
import { classifyAcquisitionNature } from '../../pipeline/maya/acquisition-classifier.js';
import {
  acquireOpportunityEvidence,
  DEFAULT_ACQUISITION_CONFIG,
} from '../../services/evidence/document-acquisition.js';
import { computeRawHash, computeMaterialHash } from '../../pipeline/maya/change-detect.js';
import { DEFAULT_THRESHOLDS } from '../../pipeline/maya/types.js';
import type { NormalizedOpportunity } from '../../pipeline/maya/types.js';
import { SupabaseCompanyProfileRepository } from '../../pipeline/maya/company-repository.js';
import { emitEvent, MAYA_EVENT_TYPES } from './events.js';
import { createHash } from 'crypto';

export interface CollectorResult {
  fetched: number;
  deduplicated: number;
  hardExcluded: number;
  preScreenPass: number;
  preScreenWatch: number;
  needsEvidence: number;
  evidenceEnriched: number;
  reviewEventsCreated: number;
  materialChanges: number;
  errors: string[];
  providerCalls: number; // Must always be 0
}

export interface CollectorConfig {
  maxReviewsPerCycle: number;
  enrichmentConfig: typeof DEFAULT_ACQUISITION_CONFIG;
  dryRun: boolean;
}

const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  maxReviewsPerCycle: 5,
  enrichmentConfig: {
    ...DEFAULT_ACQUISITION_CONFIG,
    maxDocumentsPerOpportunity: 3,
    requestTimeoutMs: 15_000,
    opportunityTimeoutMs: 45_000,
  },
  dryRun: false,
};

/**
 * Run one collection cycle. ZERO LLM calls.
 */
export async function runCollectorCycle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  config: CollectorConfig = DEFAULT_COLLECTOR_CONFIG
): Promise<CollectorResult> {
  const result: CollectorResult = {
    fetched: 0,
    deduplicated: 0,
    hardExcluded: 0,
    preScreenPass: 0,
    preScreenWatch: 0,
    needsEvidence: 0,
    evidenceEnriched: 0,
    reviewEventsCreated: 0,
    materialChanges: 0,
    errors: [],
    providerCalls: 0,
  };

  try {
    // 1. Load org data
    const repo = new SupabaseCompanyProfileRepository(supabase);
    const [profile, pp, prefs] = await Promise.all([
      repo.getCompanyProfile(),
      repo.getPastPerformance(),
      repo.getPursuitPreferences(),
    ]);
    const ctx: ScoringContext = { profile, pastPerformance: pp, preferences: prefs };

    // 2. Get sync state
    const { data: syncState } = await supabase
      .from('source_sync_state')
      .select('*')
      .eq('source', 'sam_gov')
      .single();

    const since = syncState?.last_sync_cursor
      ? new Date(syncState.last_sync_cursor)
      : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3-day overlap for safety

    // 3. Fetch from SAM
    const source = new SAMSource();
    const raw = await source.fetchChanges({ since, limit: 200 });
    result.fetched = raw.length;

    // 4. Normalize + deduplicate against existing
    const normalized: NormalizedOpportunity[] = [];
    for (const r of raw) {
      const opp = source.normalize(r);
      if (!opp.sourceId || !opp.title) continue;

      // Check if already in pipeline
      const { data: existing } = await supabase
        .from('pipeline_opportunities')
        .select('raw_hash, material_hash, maya_recommendation')
        .eq('source', opp.source)
        .eq('source_id', opp.sourceId)
        .single();

      if (existing) {
        // Check for material change
        const newMaterialHash = computeMaterialHash(opp);
        if (existing.material_hash === newMaterialHash) {
          continue; // No material change — skip
        }
        result.materialChanges++;

        // Emit material change event
        const correlationId = `opp:${opp.sourceId}`;
        await emitEvent(supabase, {
          eventType: MAYA_EVENT_TYPES.OPPORTUNITY_MATERIAL_CHANGE,
          aggregateType: 'opportunity',
          aggregateId: opp.sourceId,
          opportunityId: opp.sourceId,
          actorType: 'SOURCE',
          source: 'collector',
          correlationId,
          idempotencyKey: `material:${opp.sourceId}:${newMaterialHash}`,
          schemaVersion: 1,
          payload: { previousHash: existing.material_hash, newHash: newMaterialHash },
        });
      }

      normalized.push(opp);
    }
    result.deduplicated = normalized.length;

    // 5. Hard filter
    const active = normalized.filter((opp) => {
      if (applyHardFilters(opp).excluded) {
        result.hardExcluded++;
        return false;
      }
      return true;
    });

    // 6. Pre-screen + enrich + score
    let reviewsThisCycle = 0;

    // Load cost guardrails
    const { data: guardrails } = await supabase
      .from('maya_cost_guardrails')
      .select('*')
      .eq('config_name', 'default')
      .single();

    const maxPerCycle = guardrails?.max_reviews_per_cycle || config.maxReviewsPerCycle;
    const maxPerDay = guardrails?.max_reviews_per_day || 20;

    // Check daily cap
    const today = new Date();
    const resetAt = guardrails?.reviews_today_reset_at
      ? new Date(guardrails.reviews_today_reset_at)
      : today;
    let reviewsToday =
      today.toDateString() === resetAt.toDateString() ? guardrails?.reviews_today || 0 : 0;

    for (const opp of active) {
      const screen = metadataPreScreen(
        opp,
        prefs.agencyExperience,
        profile.naicsCodes,
        undefined,
        pp
      );

      if (screen.decision === 'PASS') {
        result.preScreenPass++;
        continue;
      }
      if (screen.decision === 'WATCH') {
        result.preScreenWatch++;
        continue;
      }

      result.needsEvidence++;

      // Evidence enrichment
      let enrichedOpp = opp;
      if (opp.attachments.length > 0) {
        const ev = await acquireOpportunityEvidence(
          opp.sourceId,
          opp.attachments,
          config.enrichmentConfig
        );
        if (ev.extractionCharacterCount > 0) {
          enrichedOpp = {
            ...opp,
            description: `${opp.description || ''}\n\n${ev.extractedScopeText}`.trim(),
          };
          result.evidenceEnriched++;
        }
      }

      // Score
      const fitScore = calculateFitScore(enrichedOpp, ctx);
      const acq = classifyAcquisitionNature(opp.title, enrichedOpp.description || '');
      const override = checkStrategicOverrides(enrichedOpp, fitScore as any, prefs, profile);
      const ppMatches = matchPastPerformance(
        {
          agency: opp.agency,
          title: opp.title,
          description: enrichedOpp.description,
          naics: opp.naics,
        },
        pp
      );
      const materialHash = computeMaterialHash(enrichedOpp);
      const evidenceHash = createHash('sha256')
        .update(enrichedOpp.description || '')
        .digest('hex')
        .slice(0, 16);

      // Determine if Maya review is warranted
      const score = fitScore.totalScore;
      const t = DEFAULT_THRESHOLDS;
      let needsReview = false;
      if (override.triggered && score >= 30) needsReview = true;
      else if (score > t.storeWatch) needsReview = true; // 60+

      // Persist opportunity
      await supabase.from('pipeline_opportunities').upsert(
        {
          source: opp.source,
          source_id: opp.sourceId,
          solicitation_number: opp.solicitationNumber,
          title: opp.title,
          description: enrichedOpp.description,
          agency: opp.agency,
          sub_agency: opp.subAgency,
          office: opp.office,
          notice_type: opp.noticeType,
          naics: opp.naics,
          psc: opp.psc,
          set_aside: opp.setAside,
          set_aside_description: opp.setAsideDescription,
          posted_date: opp.postedDate,
          response_deadline: opp.responseDeadline,
          place_of_performance: opp.placeOfPerformance,
          source_url: opp.sourceUrl,
          attachments: opp.attachments,
          active: opp.active,
          archived: opp.archived,
          cancelled: opp.cancelled,
          raw_hash: computeRawHash(opp),
          material_hash: materialHash,
          pipeline_decision: needsReview
            ? 'MAYA_QUICK_REVIEW'
            : score > t.passArchive
              ? 'WATCH'
              : 'PASS',
          fit_score: score,
          fit_score_breakdown: fitScore.breakdown,
          strategic_override_rules: override.rules,
          past_performance_matches: ppMatches.slice(0, 3),
          scorer_version: 'v1',
          evidence_hash: evidenceHash,
          last_seen_at: new Date().toISOString(),
          last_scored_at: new Date().toISOString(),
        },
        { onConflict: 'source,source_id' }
      );

      // Create review event if warranted and within caps
      if (needsReview && reviewsThisCycle < maxPerCycle && reviewsToday < maxPerDay) {
        const correlationId = `opp:${opp.sourceId}`;
        const idempKey = `review:${opp.sourceId}:${materialHash}:v1`;

        // Check if review task already exists for this version
        const { data: existingTask } = await supabase
          .from('maya_review_tasks')
          .select('id')
          .eq('idempotency_key', idempKey)
          .single();

        if (!existingTask) {
          await emitEvent(supabase, {
            eventType: MAYA_EVENT_TYPES.MAYA_REVIEW_REQUIRED,
            aggregateType: 'opportunity',
            aggregateId: opp.sourceId,
            opportunityId: opp.sourceId,
            actorType: 'SYSTEM',
            source: 'collector',
            correlationId,
            idempotencyKey: `evt:${idempKey}`,
            schemaVersion: 1,
            payload: {
              fitScore: score,
              materialHash,
              evidenceHash,
              acquisition: acq.nature,
              override: override.triggered,
              overrideRules: override.rules,
            },
          });

          // Create the review task
          await supabase.from('maya_review_tasks').upsert(
            {
              opportunity_id: opp.sourceId,
              material_hash: materialHash,
              contract_version: 'v1',
              idempotency_key: idempKey,
              status: 'pending',
              scorer_version: 'v1',
              evidence_hash: evidenceHash,
            },
            { onConflict: 'idempotency_key', ignoreDuplicates: true }
          );

          result.reviewEventsCreated++;
          reviewsThisCycle++;
          reviewsToday++;

          // Deterministic ops notification — ZERO LLM
          await notifyPendingReviewTask(opp, score, override.triggered, idempKey).catch(() => {});
        }
      }
    }

    // 6b. Create review tasks for cap-deferred opportunities from prior cycles
    //     These are opportunities persisted with MAYA_QUICK_REVIEW but no review task yet.
    if (reviewsThisCycle < maxPerCycle && reviewsToday < maxPerDay) {
      const { data: deferred } = await supabase
        .from('pipeline_opportunities')
        .select('source_id, material_hash, evidence_hash')
        .eq('pipeline_decision', 'MAYA_QUICK_REVIEW')
        .is('maya_task_id', null)
        .order('last_scored_at', { ascending: true })
        .limit(maxPerCycle - reviewsThisCycle);

      for (const d of deferred || []) {
        if (reviewsThisCycle >= maxPerCycle || reviewsToday >= maxPerDay) break;
        const idempKey = `review:${d.source_id}:${d.material_hash}:v1`;

        const { data: existingTask } = await supabase
          .from('maya_review_tasks')
          .select('id')
          .eq('idempotency_key', idempKey)
          .single();

        if (!existingTask) {
          await supabase.from('maya_review_tasks').upsert(
            {
              opportunity_id: d.source_id,
              material_hash: d.material_hash,
              contract_version: 'v1',
              idempotency_key: idempKey,
              status: 'pending',
              scorer_version: 'v1',
              evidence_hash: d.evidence_hash,
            },
            { onConflict: 'idempotency_key', ignoreDuplicates: true }
          );

          result.reviewEventsCreated++;
          reviewsThisCycle++;
          reviewsToday++;
        }
      }
    }

    // 7. Update sync state — only advance cursor if source was completely consumed
    const sourceComplete = !source.fetchStats.some((s) => s.truncated || s.failed);
    const incompleteQueries = source.fetchStats
      .filter((s) => s.truncated || s.failed)
      .map(
        (s) =>
          `${s.lane}/${s.query}${s.failed ? ' (FAILED: ' + s.failureReason + ')' : ' (truncated)'}`
      )
      .join(', ');
    const newCursor = sourceComplete
      ? new Date().toISOString()
      : syncState?.last_sync_cursor || new Date().toISOString();

    if (!sourceComplete) {
      console.warn(
        `[Collector] Source retrieval incomplete — cursor NOT advanced. ${incompleteQueries}`
      );
    }

    await supabase
      .from('source_sync_state')
      .update({
        last_successful_sync: sourceComplete
          ? new Date().toISOString()
          : syncState?.last_successful_sync,
        last_sync_cursor: newCursor,
        last_attempted_sync: new Date().toISOString(),
        last_error: sourceComplete ? null : 'Source retrieval incomplete — cursor preserved',
        consecutive_failures: sourceComplete ? 0 : syncState?.consecutive_failures || 0,
        records_fetched: result.fetched,
        records_new: result.deduplicated,
        material_changes: result.materialChanges,
        updated_at: new Date().toISOString(),
      })
      .eq('source', 'sam_gov');

    // Update daily review counter
    await supabase
      .from('maya_cost_guardrails')
      .update({
        reviews_today: reviewsToday,
        reviews_today_reset_at:
          today.toDateString() !== resetAt.toDateString() ? today.toISOString() : resetAt,
        updated_at: new Date().toISOString(),
      })
      .eq('config_name', 'default');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);

    // Record failure in sync state
    await supabase
      .from('source_sync_state')
      .update({
        last_attempted_sync: new Date().toISOString(),
        last_error: msg,
        consecutive_failures:
          (
            await supabase
              .from('source_sync_state')
              .select('consecutive_failures')
              .eq('source', 'sam_gov')
              .single()
          ).data?.consecutive_failures + 1 || 1,
        updated_at: new Date().toISOString(),
      })
      .eq('source', 'sam_gov')
      .catch(() => {});
  }

  // Invariant: collector NEVER makes provider calls
  if (result.providerCalls !== 0) {
    throw new Error(`SAFETY VIOLATION: Collector made ${result.providerCalls} provider calls`);
  }

  return result;
}

/**
 * Send a deterministic ops notification when a new review task is created.
 * ZERO LLM calls. Uses the ops/admin channel, NOT Maya's opportunity channel.
 */
async function notifyPendingReviewTask(
  opp: NormalizedOpportunity,
  fitScore: number,
  strategicOverride: boolean,
  taskIdempKey: string
): Promise<void> {
  const opsChannel = process.env.SLACK_OPS_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;
  const token = process.env.MAYA_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!opsChannel || !token) return;

  try {
    const { WebClient } = await import('@slack/web-api');
    const client = new WebClient(token);
    await client.chat.postMessage({
      channel: opsChannel,
      text: [
        `[Maya Ops] New pending review task created`,
        `Title: ${opp.title}`,
        `Agency: ${opp.agency || 'Unknown'}`,
        `Solicitation: ${opp.solicitationNumber || 'N/A'}`,
        `Score: ${fitScore}/100${strategicOverride ? ' (strategic override)' : ''}`,
        `Task key: ${taskIdempKey}`,
        `Status: PENDING — awaiting Maya review authorization`,
      ].join('\n'),
      unfurl_links: false,
    });
  } catch {
    // Notification failure is non-critical
  }
}
