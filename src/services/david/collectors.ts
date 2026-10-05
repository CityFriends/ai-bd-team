/**
 * David Intelligence Collectors — Deterministic G2X Signal Collection
 *
 * Two collectors run every 6 hours: forecasts and events.
 * ZERO LLM calls. All processing is deterministic normalization,
 * deduplication, and relevance scoring.
 *
 * Core operating rule: Collectors wake David via task creation.
 * David wakes ONLY when deterministic relevance >= 60.
 *
 * Invariants:
 *   - ZERO LLM/provider calls (enforced at return)
 *   - Only DAVID_G2X_ALLOWED_TOOLS may be called
 *   - Bounded retries (max 2) via withRetry
 *   - Idempotent via content hash + source ID
 *   - Preserves last successful checkpoint on failure
 *   - Never creates "removed" evidence from absence
 *   - Never creates tasks from partial/ambiguous data
 */

import { logger } from '../../lib/logger.js';
import { withRetry } from '../../lib/errors.js';
import { getFeatureFlag } from '../../config/ai-controls.js';
import { getSupabase } from '../../integrations/database/client.js';
import { getG2XAuth } from '../g2x/auth.js';
import { callToolDirect } from '../g2x/transport.js';
import {
  DAVID_G2X_ALLOWED_TOOLS,
  DavidTriggerType,
  type DavidG2XAllowedTool,
} from '../david/types.js';
import {
  calculateProactiveRelevance,
  computeSignalHash,
  detectSourceChange,
  WAKE_THRESHOLD,
  type RelevanceSignal,
  type RelevanceContext,
} from './relevance.js';
import {
  classifyForecastChange,
  classifyEventChange,
} from './material-change.js';
import {
  loadPreviousEvidence,
  normalizeForecastFields,
  normalizeEventFields,
} from './evidence-loader.js';
import type { G2XFailure } from '../g2x/types.js';

const log = logger.child({ service: 'DavidCollectors' });

// ============================================================
// Feature Gate Names
// ============================================================

const FEATURE_GATE_FORECAST = 'DAVID_FORECAST_COLLECTION_ENABLED';
const FEATURE_GATE_EVENT = 'DAVID_EVENT_COLLECTION_ENABLED';

// ============================================================
// Collection Stats
// ============================================================

export interface CollectionStats {
  fetched: number;
  newRecords: number;
  changedRecords: number;
  tasksCreated: number;
  errors: string[];
  g2xCallsMade: number;
  providerCalls: number; // Must always be 0 — LLM calls
}

function emptyStats(): CollectionStats {
  return {
    fetched: 0,
    newRecords: 0,
    changedRecords: 0,
    tasksCreated: 0,
    errors: [],
    g2xCallsMade: 0,
    providerCalls: 0,
  };
}

// ============================================================
// G2X Tool Boundary Enforcement
// ============================================================

/**
 * Call a G2X tool with boundary enforcement.
 * Only tools in DAVID_G2X_ALLOWED_TOOLS may be called.
 * Throws if tool name is not in the allowlist.
 */
async function callDavidG2XTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown> | G2XFailure> {
  // Enforce tool boundary
  if (!DAVID_G2X_ALLOWED_TOOLS.includes(toolName as DavidG2XAllowedTool)) {
    throw new Error(
      `DAVID BOUNDARY VIOLATION: Tool "${toolName}" is not in DAVID_G2X_ALLOWED_TOOLS. ` +
      `Allowed: ${DAVID_G2X_ALLOWED_TOOLS.join(', ')}`
    );
  }

  const auth = getG2XAuth();
  const result = await callToolDirect(auth, { name: toolName, arguments: args });

  // Check for G2X failure
  if ('type' in result && 'message' in result && !('content' in result)) {
    return result as G2XFailure;
  }

  // Extract text content from MCP response
  const mcpResponse = result as { content?: Array<{ type: string; text?: string }> };
  if (mcpResponse.content && mcpResponse.content.length > 0) {
    const textContent = mcpResponse.content.find((c) => c.type === 'text');
    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text) as Record<string, unknown>;
      } catch {
        return { rawText: textContent.text };
      }
    }
  }

  return result as Record<string, unknown>;
}

/**
 * Check if a G2X result is a failure.
 */
function isG2XFailure(result: Record<string, unknown> | G2XFailure): result is G2XFailure {
  return 'type' in result && 'message' in result && typeof result.type === 'string' &&
    ['AUTHENTICATION_FAILURE', 'AUTHORIZATION_FAILURE', 'RATE_LIMITED',
     'MALFORMED_REQUEST', 'PROVIDER_UNAVAILABLE'].includes(result.type as string);
}

// ============================================================
// Checkpoint Management
// ============================================================

/**
 * Get the last successful collection checkpoint for a source.
 * Uses source_sync_state table (shared with Maya pipeline).
 */
export async function getCollectionCheckpoint(
  source: string
): Promise<{ lastSyncCursor: string | null; lastSuccessfulSync: string | null } | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('source_sync_state')
    .select('last_sync_cursor, last_successful_sync')
    .eq('source', source)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    lastSyncCursor: data.last_sync_cursor,
    lastSuccessfulSync: data.last_successful_sync,
  };
}

/**
 * Update the collection checkpoint after a successful run.
 * Only advances cursor if collection was complete (no partial failures).
 */
export async function updateCollectionCheckpoint(
  source: string,
  checkpoint: {
    cursor: string;
    complete: boolean;
    recordsFetched: number;
    recordsNew: number;
    error?: string;
  }
): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  await supabase
    .from('source_sync_state')
    .upsert(
      {
        source,
        last_sync_cursor: checkpoint.complete ? checkpoint.cursor : undefined,
        last_successful_sync: checkpoint.complete ? now : undefined,
        last_attempted_sync: now,
        last_error: checkpoint.error || null,
        consecutive_failures: checkpoint.complete ? 0 : undefined,
        records_fetched: checkpoint.recordsFetched,
        records_new: checkpoint.recordsNew,
        updated_at: now,
      },
      { onConflict: 'source' }
    );
}

// ============================================================
// Usage Ledger
// ============================================================

/**
 * Record a G2X call in the external usage ledger.
 */
async function recordUsage(
  source: string,
  toolName: string,
  success: boolean
): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('external_usage_ledger').insert({
      service: 'g2x',
      operation: toolName,
      source,
      success,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Usage ledger failure is non-critical
    log.warn(
      { error: err instanceof Error ? err.message : String(err), toolName },
      'Failed to record G2X usage — non-critical'
    );
  }
}

// ============================================================
// Org Context Loading
// ============================================================

/**
 * Load organizational context for relevance scoring.
 * Pulls from company profile, active pursuits, and watched markets.
 */
async function loadRelevanceContext(): Promise<RelevanceContext> {
  const supabase = getSupabase();

  // Load company profile
  const { data: profile } = await supabase
    .from('company_profile')
    .select('naics_codes, capabilities, certifications')
    .single();

  // Load active pursuits
  const { data: pursuits } = await supabase
    .from('pipeline_opportunities')
    .select('agency, source_id, naics')
    .in('pipeline_decision', ['MAYA_QUICK_REVIEW', 'PURSUING', 'WATCH'])
    .limit(100);

  // Load pursuit preferences for watched markets
  const { data: prefs } = await supabase
    .from('pursuit_preferences')
    .select('watched_markets, known_competitors')
    .single();

  // Load known customers from agency experience
  const { data: agencyExp } = await supabase
    .from('agency_experience')
    .select('agency_name')
    .limit(50);

  return {
    naicsCodes: profile?.naics_codes || [],
    capabilities: (profile?.capabilities || []).map((c: string) => c.toLowerCase()),
    certifications: profile?.certifications || [],
    activePursuitAgencies: (pursuits || [])
      .map((p: { agency?: string }) => p.agency?.toLowerCase())
      .filter(Boolean) as string[],
    activePursuitPrograms: [], // Programs not tracked in pipeline_opportunities
    activePursuitOpportunityIds: (pursuits || [])
      .map((p: { source_id?: string }) => p.source_id)
      .filter(Boolean) as string[],
    watchedMarkets: (prefs?.watched_markets || []).map((m: string) => m.toLowerCase()),
    knownCustomers: (agencyExp || [])
      .map((a: { agency_name?: string }) => a.agency_name?.toLowerCase())
      .filter(Boolean) as string[],
    knownCompetitors: (prefs?.known_competitors || []).map((c: string) => c.toLowerCase()),
  };
}

// ============================================================
// Record Persistence
// ============================================================

/**
 * Persist a signal to external_source_records and check for existing record.
 * Returns { isNew, existingHash } for dedup/change detection.
 */
async function persistSourceRecord(
  sourceType: string,
  sourceId: string,
  contentHash: string,
  normalizedData: Record<string, unknown>
): Promise<{ isNew: boolean; existingHash: string | null }> {
  const supabase = getSupabase();

  // Check existing
  const { data: existing } = await supabase
    .from('external_source_records')
    .select('content_hash')
    .eq('source', sourceType)
    .eq('source_id', sourceId)
    .single();

  const existingHash = existing?.content_hash || null;
  const isNew = !existing;

  // Upsert the record
  await supabase
    .from('external_source_records')
    .upsert(
      {
        source: sourceType,
        source_id: sourceId,
        content_hash: contentHash,
        normalized_data: normalizedData,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source,source_id' }
    );

  return { isNew, existingHash };
}

/**
 * Create a David intelligence task for a signal that passed relevance threshold.
 */
async function createDavidIntelligenceTask(
  trigger: string,
  signal: RelevanceSignal,
  contentHash: string,
  relevanceScore: number,
  currentRawPayload: Record<string, unknown> | null = null
): Promise<string | null> {
  const supabase = getSupabase();
  const idempotencyKey = `david:${signal.sourceType}:${signal.sourceId}:${contentHash}`;

  // Check for existing task with same idempotency key
  const { data: existing } = await supabase
    .from('david_intelligence_tasks')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .single();

  if (existing) {
    log.debug({ idempotencyKey }, 'David task already exists — skipping');
    return null;
  }

  // Check if signal is watched/dismissed with same hash
  const { data: watchedSignal } = await supabase
    .from('david_watched_signals')
    .select('status, content_hash')
    .eq('source', signal.sourceType)
    .eq('source_id', signal.sourceId)
    .single();

  if (watchedSignal) {
    // Step 1: Did the source change at all?
    const sourceChanged = detectSourceChange(contentHash, watchedSignal.content_hash);
    if (!sourceChanged) {
      log.debug(
        { sourceId: signal.sourceId, status: watchedSignal.status },
        'Signal unchanged — skipping'
      );
      return null;
    }

    // Step 2: Source changed — load ACTUAL previous persisted record
    const previous = await loadPreviousEvidence(
      'g2x',
      signal.sourceType,
      signal.sourceId
    );

    if (previous.found && !previous.rawPayload) {
      // Previous record exists but payload corrupt/unparseable
      // Fail closed: persist new evidence but do NOT wake David
      log.warn(
        { sourceId: signal.sourceId },
        'Previous evidence found but unparseable — fail closed for material change'
      );
      await supabase
        .from('david_watched_signals')
        .update({ material_hash: contentHash, last_checked_at: new Date().toISOString() })
        .eq('signal_type', signal.sourceType.toUpperCase())
        .eq('signal_source_id', signal.sourceId);
      return null;
    }

    // Step 3: Typed normalization of previous and current fields
    // Current raw payload is passed explicitly from the collector (not via RelevanceSignal)
    if (!currentRawPayload) {
      // Malformed current payload — fail closed for David wake
      log.warn(
        { sourceId: signal.sourceId },
        'Current raw payload missing — fail closed for material change'
      );
      await supabase
        .from('david_watched_signals')
        .update({ material_hash: contentHash, last_checked_at: new Date().toISOString() })
        .eq('signal_type', signal.sourceType.toUpperCase())
        .eq('signal_source_id', signal.sourceId);
      return null;
    }

    let materialResult;
    if (signal.sourceType === 'forecast') {
      const oldFields = normalizeForecastFields(previous.rawPayload);
      const newFields = normalizeForecastFields(currentRawPayload);
      materialResult = classifyForecastChange(oldFields, newFields);
    } else {
      const oldFields = normalizeEventFields(previous.rawPayload);
      const newFields = normalizeEventFields(currentRawPayload);
      materialResult = classifyEventChange(oldFields, newFields);
    }

    if (!materialResult.material) {
      log.info(
        { sourceId: signal.sourceId, changedFields: materialResult.changedFields },
        'Source changed but non-material — evidence updated, no David wake'
      );
      // Update the hash on the watched signal but do NOT create a task
      await supabase
        .from('david_watched_signals')
        .update({ material_hash: contentHash, last_checked_at: new Date().toISOString() })
        .eq('signal_type', signal.sourceType.toUpperCase())
        .eq('signal_source_id', signal.sourceId);
      return null;
    }

    // Material change on watched signal — proceed to create new task
    log.info(
      {
        sourceId: signal.sourceId,
        materialReasons: materialResult.reasons.map((r) => r.description),
        changedFields: materialResult.changedFields,
      },
      'Material change detected on watched signal — creating new David task'
    );
  }

  const taskId = globalThis.crypto.randomUUID();

  await supabase.from('david_intelligence_tasks').insert({
    id: taskId,
    trigger,
    source_type: signal.sourceType,
    source_id: signal.sourceId,
    title: signal.title,
    agency: signal.agency || null,
    content_hash: contentHash,
    relevance_score: relevanceScore,
    idempotency_key: idempotencyKey,
    status: 'pending',
    created_at: new Date().toISOString(),
  });

  log.info(
    { taskId, trigger, sourceId: signal.sourceId, relevanceScore },
    'Created David intelligence task'
  );

  return taskId;
}

// ============================================================
// Forecast Normalization
// ============================================================

/**
 * Normalize a G2X forecast record into a RelevanceSignal.
 */
function normalizeForecast(raw: Record<string, unknown>): RelevanceSignal | null {
  const title = (raw.title || raw.name || raw.forecastTitle) as string | undefined;
  const sourceId = (raw.id || raw.forecastId || raw.recordId) as string | undefined;

  if (!title || !sourceId) {
    return null;
  }

  return {
    sourceType: 'forecast',
    sourceId: String(sourceId),
    title: String(title),
    description: (raw.description || raw.scope || raw.expectedScope) as string | undefined,
    agency: (raw.agency || raw.customer || raw.organization) as string | undefined,
    subAgency: (raw.subAgency || raw.bureau) as string | undefined,
    programName: (raw.program || raw.programName) as string | undefined,
    naicsCodes: normalizeNaicsCodes(raw.naics || raw.naicsCodes),
    setAside: (raw.setAside || raw.setAsideType) as string | undefined,
    contractVehicle: (raw.vehicle || raw.contractVehicle) as string | undefined,
    expectedDate: (raw.estimatedDate || raw.expectedDate || raw.anticipatedDate) as string | undefined,
    estimatedValue: (raw.estimatedValue || raw.value) as string | undefined,
    solicitationNumber: (raw.solicitationNumber || raw.solicitation) as string | undefined,
    keywords: extractKeywords(raw),
  };
}

/**
 * Normalize NAICS codes from various G2X formats.
 */
function normalizeNaicsCodes(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Extract keywords from raw G2X data.
 */
function extractKeywords(raw: Record<string, unknown>): string[] {
  const keywords: string[] = [];
  if (raw.keywords && Array.isArray(raw.keywords)) {
    keywords.push(...raw.keywords.map(String));
  }
  if (raw.tags && Array.isArray(raw.tags)) {
    keywords.push(...raw.tags.map(String));
  }
  return keywords;
}

// ============================================================
// Event Normalization
// ============================================================

/**
 * Normalize a G2X event record into a RelevanceSignal.
 */
function normalizeEvent(raw: Record<string, unknown>): RelevanceSignal | null {
  const title = (raw.title || raw.name || raw.eventName) as string | undefined;
  const sourceId = (raw.id || raw.eventId || raw.recordId) as string | undefined;

  if (!title || !sourceId) {
    return null;
  }

  return {
    sourceType: 'event',
    sourceId: String(sourceId),
    title: String(title),
    description: (raw.description || raw.summary) as string | undefined,
    agency: (raw.agency || raw.organization || raw.organizer) as string | undefined,
    subAgency: (raw.subAgency || raw.bureau) as string | undefined,
    programName: (raw.program || raw.programName || raw.relatedProgram) as string | undefined,
    naicsCodes: normalizeNaicsCodes(raw.naics || raw.naicsCodes),
    expectedDate: (raw.date || raw.startDate || raw.eventDate) as string | undefined,
    keywords: extractKeywords(raw),
    competitorsMentioned: normalizeCompetitors(raw.speakers || raw.participants),
  };
}

/**
 * Extract competitor/company names from speaker/participant lists.
 */
function normalizeCompetitors(raw: unknown): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object' && entry !== null) {
        return (entry as Record<string, unknown>).organization ||
               (entry as Record<string, unknown>).company;
      }
      return undefined;
    })
    .filter(Boolean)
    .map(String);
}

// ============================================================
// Forecast Collector
// ============================================================

/**
 * Collect forecast signals from G2X.
 * Runs every 6 hours. ZERO LLM calls.
 *
 * 1. Check feature gate
 * 2. Check G2X auth available
 * 3. Call g2x_forecast_scan with FFTC-relevant parameters
 * 4. Normalize results
 * 5. Deduplicate against existing external_source_records
 * 6. For each new/changed forecast:
 *    a. Persist to external_source_records
 *    b. Calculate proactive relevance
 *    c. If relevance >= 60 AND not already watched/dismissed with same hash:
 *       create david_intelligence_task (trigger=FORECAST_SIGNAL)
 * 7. Return collection stats
 */
export async function collectForecasts(): Promise<CollectionStats> {
  const stats = emptyStats();

  // 1. Feature gate check
  if (!getFeatureFlag(FEATURE_GATE_FORECAST)) {
    log.info('David forecast collection disabled by feature gate');
    return stats;
  }

  // 2. G2X auth check
  const auth = getG2XAuth();
  if (!auth.isAvailable()) {
    log.warn('G2X auth not available — skipping forecast collection');
    stats.errors.push('G2X auth not available');
    return stats;
  }

  log.info('Starting David forecast collection cycle');

  try {
    // Load org context for relevance scoring
    const context = await loadRelevanceContext();

    // Get checkpoint
    const checkpoint = await getCollectionCheckpoint('david_forecast');

    // 3. Call G2X forecast scan
    const scanArgs: Record<string, unknown> = {
      naics_codes: context.naicsCodes,
      limit: 100,
    };

    if (checkpoint?.lastSyncCursor) {
      scanArgs.since = checkpoint.lastSyncCursor;
    }

    const scanResult = await withRetry(
      () => callDavidG2XTool('g2x_forecast_scan', scanArgs),
      { maxRetries: 2, operationName: 'g2x_forecast_scan' }
    );
    stats.g2xCallsMade++;
    await recordUsage('david_forecast', 'g2x_forecast_scan', !isG2XFailure(scanResult));

    if (isG2XFailure(scanResult)) {
      log.error({ failure: scanResult }, 'G2X forecast scan failed');
      stats.errors.push(`G2X forecast scan failed: ${scanResult.message}`);

      // Preserve checkpoint on failure
      await updateCollectionCheckpoint('david_forecast', {
        cursor: checkpoint?.lastSyncCursor || new Date().toISOString(),
        complete: false,
        recordsFetched: 0,
        recordsNew: 0,
        error: scanResult.message,
      });
      return stats;
    }

    // 4. Normalize results
    const records = Array.isArray(scanResult.results || scanResult.records || scanResult.data)
      ? (scanResult.results || scanResult.records || scanResult.data) as Record<string, unknown>[]
      : [];

    stats.fetched = records.length;

    // 5-6. Deduplicate, persist, score
    for (const raw of records) {
      try {
        const signal = normalizeForecast(raw);
        if (!signal) {
          log.debug({ raw: JSON.stringify(raw).slice(0, 200) }, 'Skipping unnormalizable forecast');
          continue;
        }

        const contentHash = computeSignalHash(signal);

        // 6a. Persist to external_source_records
        const { isNew, existingHash } = await persistSourceRecord(
          'david_forecast',
          signal.sourceId,
          contentHash,
          raw
        );

        if (isNew) {
          stats.newRecords++;
        } else if (existingHash !== contentHash) {
          stats.changedRecords++;
        } else {
          // No change — skip relevance scoring
          continue;
        }

        // 6b. Calculate proactive relevance
        const relevance = calculateProactiveRelevance(signal, context);

        // 6c. Create task if threshold met
        if (relevance.totalScore >= WAKE_THRESHOLD) {
          const taskId = await createDavidIntelligenceTask(
            DavidTriggerType.FORECAST_SIGNAL,
            signal,
            contentHash,
            relevance.totalScore,
            raw // Pass raw G2X payload for typed material change classification
          );
          if (taskId) {
            stats.tasksCreated++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, 'Error processing forecast record');
        stats.errors.push(`Forecast record error: ${msg}`);
      }
    }

    // 7. Update checkpoint
    await updateCollectionCheckpoint('david_forecast', {
      cursor: new Date().toISOString(),
      complete: stats.errors.length === 0,
      recordsFetched: stats.fetched,
      recordsNew: stats.newRecords,
    });

    log.info(
      {
        fetched: stats.fetched,
        new: stats.newRecords,
        changed: stats.changedRecords,
        tasks: stats.tasksCreated,
        errors: stats.errors.length,
      },
      'David forecast collection cycle complete'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, 'David forecast collection failed');
    stats.errors.push(msg);

    // Record failure in checkpoint
    await updateCollectionCheckpoint('david_forecast', {
      cursor: (await getCollectionCheckpoint('david_forecast'))?.lastSyncCursor || new Date().toISOString(),
      complete: false,
      recordsFetched: stats.fetched,
      recordsNew: stats.newRecords,
      error: msg,
    }).catch(() => {});
  }

  // Invariant: collector NEVER makes provider (LLM) calls
  if (stats.providerCalls !== 0) {
    throw new Error(`SAFETY VIOLATION: David forecast collector made ${stats.providerCalls} provider calls`);
  }

  return stats;
}

// ============================================================
// Event Collector
// ============================================================

/** Maximum detail calls per event collection cycle */
const MAX_EVENT_DETAIL_CALLS = 5;

/**
 * Collect event signals from G2X.
 * Runs every 6 hours. ZERO LLM calls.
 *
 * 1. Check feature gate
 * 2. Check G2X auth available
 * 3. Call g2x_search_events with 90-day forward window
 * 4. For interesting results, call g2x_get_event for detail (max 5)
 * 5. Normalize and deduplicate
 * 6. For each new/changed event:
 *    a. Persist to external_source_records
 *    b. Calculate proactive relevance
 *    c. If relevance >= 60: create david_intelligence_task (trigger=GOVCON_EVENT)
 * 7. Return collection stats
 */
export async function collectEvents(): Promise<CollectionStats> {
  const stats = emptyStats();

  // 1. Feature gate check
  if (!getFeatureFlag(FEATURE_GATE_EVENT)) {
    log.info('David event collection disabled by feature gate');
    return stats;
  }

  // 2. G2X auth check
  const auth = getG2XAuth();
  if (!auth.isAvailable()) {
    log.warn('G2X auth not available — skipping event collection');
    stats.errors.push('G2X auth not available');
    return stats;
  }

  log.info('Starting David event collection cycle');

  try {
    // Load org context for relevance scoring
    const context = await loadRelevanceContext();

    // 3. Call G2X event search with 90-day forward window
    const now = new Date();
    const ninetyDaysForward = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const searchArgs: Record<string, unknown> = {
      start_date: now.toISOString().split('T')[0],
      end_date: ninetyDaysForward.toISOString().split('T')[0],
      limit: 100,
    };

    const searchResult = await withRetry(
      () => callDavidG2XTool('g2x_search_events', searchArgs),
      { maxRetries: 2, operationName: 'g2x_search_events' }
    );
    stats.g2xCallsMade++;
    await recordUsage('david_event', 'g2x_search_events', !isG2XFailure(searchResult));

    if (isG2XFailure(searchResult)) {
      log.error({ failure: searchResult }, 'G2X event search failed');
      stats.errors.push(`G2X event search failed: ${searchResult.message}`);

      await updateCollectionCheckpoint('david_event', {
        cursor: new Date().toISOString(),
        complete: false,
        recordsFetched: 0,
        recordsNew: 0,
        error: searchResult.message,
      });
      return stats;
    }

    // 4. Normalize search results and fetch details for interesting ones
    const records = Array.isArray(searchResult.results || searchResult.events || searchResult.data)
      ? (searchResult.results || searchResult.events || searchResult.data) as Record<string, unknown>[]
      : [];

    stats.fetched = records.length;

    // First pass: normalize all events and identify ones needing detail
    const normalizedEvents: Array<{ signal: RelevanceSignal; raw: Record<string, unknown> }> = [];
    const needsDetail: Array<{ eventId: string; signal: RelevanceSignal }> = [];

    for (const raw of records) {
      const signal = normalizeEvent(raw);
      if (!signal) continue;

      normalizedEvents.push({ signal, raw });

      // Quick check: does this event have enough detail or does it need a detail call?
      const hasDetail = signal.description && signal.description.length > 50;
      if (!hasDetail && needsDetail.length < MAX_EVENT_DETAIL_CALLS) {
        needsDetail.push({ eventId: signal.sourceId, signal });
      }
    }

    // Fetch detail for events that need it (bounded: max 5)
    let detailCallsMade = 0;
    for (const { eventId, signal } of needsDetail) {
      if (detailCallsMade >= MAX_EVENT_DETAIL_CALLS) break;

      try {
        const detailResult = await withRetry(
          () => callDavidG2XTool('g2x_get_event', { event_id: eventId }),
          { maxRetries: 2, operationName: 'g2x_get_event' }
        );
        stats.g2xCallsMade++;
        detailCallsMade++;
        await recordUsage('david_event', 'g2x_get_event', !isG2XFailure(detailResult));

        if (!isG2XFailure(detailResult)) {
          // Merge detail into the signal
          const detailSignal = normalizeEvent(detailResult);
          if (detailSignal) {
            // Update the signal in normalizedEvents with richer data
            const entry = normalizedEvents.find((e) => e.signal.sourceId === signal.sourceId);
            if (entry) {
              entry.signal = {
                ...entry.signal,
                description: detailSignal.description || entry.signal.description,
                programName: detailSignal.programName || entry.signal.programName,
                naicsCodes: detailSignal.naicsCodes?.length
                  ? detailSignal.naicsCodes
                  : entry.signal.naicsCodes,
                competitorsMentioned: detailSignal.competitorsMentioned?.length
                  ? detailSignal.competitorsMentioned
                  : entry.signal.competitorsMentioned,
              };
              entry.raw = { ...entry.raw, ...detailResult };
            }
          }
        }
      } catch (err) {
        log.warn(
          { error: err instanceof Error ? err.message : String(err), eventId },
          'Failed to fetch event detail — proceeding with summary data'
        );
      }
    }

    // 5-6. Deduplicate, persist, score
    for (const { signal, raw } of normalizedEvents) {
      try {
        const contentHash = computeSignalHash(signal);

        // 6a. Persist to external_source_records
        const { isNew, existingHash } = await persistSourceRecord(
          'david_event',
          signal.sourceId,
          contentHash,
          raw
        );

        if (isNew) {
          stats.newRecords++;
        } else if (existingHash !== contentHash) {
          stats.changedRecords++;
        } else {
          // No change — skip
          continue;
        }

        // 6b. Calculate proactive relevance
        const relevance = calculateProactiveRelevance(signal, context);

        // 6c. Create task if threshold met
        if (relevance.totalScore >= WAKE_THRESHOLD) {
          const taskId = await createDavidIntelligenceTask(
            DavidTriggerType.GOVCON_EVENT,
            signal,
            contentHash,
            relevance.totalScore,
            raw // Pass raw G2X payload for typed material change classification
          );
          if (taskId) {
            stats.tasksCreated++;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ error: msg }, 'Error processing event record');
        stats.errors.push(`Event record error: ${msg}`);
      }
    }

    // 7. Update checkpoint
    await updateCollectionCheckpoint('david_event', {
      cursor: new Date().toISOString(),
      complete: stats.errors.length === 0,
      recordsFetched: stats.fetched,
      recordsNew: stats.newRecords,
    });

    log.info(
      {
        fetched: stats.fetched,
        new: stats.newRecords,
        changed: stats.changedRecords,
        tasks: stats.tasksCreated,
        detailCalls: detailCallsMade,
        errors: stats.errors.length,
      },
      'David event collection cycle complete'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, 'David event collection failed');
    stats.errors.push(msg);

    await updateCollectionCheckpoint('david_event', {
      cursor: new Date().toISOString(),
      complete: false,
      recordsFetched: stats.fetched,
      recordsNew: stats.newRecords,
      error: msg,
    }).catch(() => {});
  }

  // Invariant: collector NEVER makes provider (LLM) calls
  if (stats.providerCalls !== 0) {
    throw new Error(`SAFETY VIOLATION: David event collector made ${stats.providerCalls} provider calls`);
  }

  return stats;
}
