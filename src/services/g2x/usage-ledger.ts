/**
 * G2X External Usage Ledger
 *
 * Tracks G2X usage SEPARATELY from LLM budget accounting.
 * Records ALL attempts including failures (429, 503, auth failures,
 * schema mismatches, etc.). Does not account only successful requests.
 *
 * Distinguishes records_returned from records_billable_known —
 * does not guess billing consumption when unknown.
 */

import { createHash } from 'crypto';
import { logger } from '../../lib/logger.js';
import { getSupabase } from '../../integrations/database/client.js';
import { assertCommissioningEnvironment } from '../../config/environment.js';
import type { ExternalUsageEntry } from './types.js';

const log = logger.child({ service: 'G2XUsageLedger' });

/**
 * Generate a stable hash of query parameters for dedup/cache.
 */
export function computeQueryHash(tool: string, params: Record<string, unknown>): string {
  const canonical = JSON.stringify({ tool, params: sortDeep(params) });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function sortDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortDeep);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortDeep((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Generate a unique request ID for usage tracking.
 */
export function generateRequestId(prefix: string = 'g2x'): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Record a G2X usage entry (successful or failed).
 * Enforces commissioning environment before writing.
 */
export async function recordUsage(entry: ExternalUsageEntry): Promise<void> {
  assertCommissioningEnvironment();

  const supabase = getSupabase();

  const { error } = await supabase.from('external_usage_ledger').insert({
    request_id: entry.requestId,
    timestamp: entry.timestamp,
    workflow_id: entry.workflowId || null,
    agent_capability: entry.agentCapability || null,
    tool: entry.tool,
    query_hash: entry.queryHash,
    records_returned: entry.recordsReturned,
    records_billable_known: entry.recordsBillableKnown,
    pages: entry.pages,
    http_status: entry.httpStatus,
    latency_ms: entry.latencyMs,
    retry_count: entry.retryCount,
    source_record_ids: entry.sourceRecordIds,
    document_bytes: entry.documentBytes,
    metered_ai_classification: entry.meteredAiClassification,
    estimated_monthly_consumption: entry.estimatedMonthlyConsumption,
    success: entry.success,
    error_message: entry.errorMessage || null,
  });

  if (error) {
    log.error(
      { error: error.message, requestId: entry.requestId, tool: entry.tool },
      'Failed to record G2X usage'
    );
    // Usage recording failure should not block research operations
    // but must be logged for audit
    return;
  }

  log.info(
    {
      requestId: entry.requestId,
      tool: entry.tool,
      success: entry.success,
      recordsReturned: entry.recordsReturned,
      latencyMs: entry.latencyMs,
    },
    'G2X usage recorded'
  );
}

/**
 * Get total records consumed this month for a provider.
 */
export async function getMonthlyConsumption(
  provider: string = 'g2x'
): Promise<{ totalRecords: number; totalCalls: number; failedCalls: number }> {
  const supabase = getSupabase();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('external_usage_ledger')
    .select('records_returned, success')
    .gte('timestamp', startOfMonth.toISOString());

  if (error) {
    log.error({ error: error.message, provider }, 'Failed to query monthly consumption');
    return { totalRecords: 0, totalCalls: 0, failedCalls: 0 };
  }

  const rows = data || [];
  return {
    totalRecords: rows.reduce(
      (sum: number, r: { records_returned: number }) => sum + r.records_returned,
      0
    ),
    totalCalls: rows.length,
    failedCalls: rows.filter((r: { success: boolean }) => !r.success).length,
  };
}

/**
 * Get recent usage entries for audit/reporting.
 */
export async function getRecentUsage(limit: number = 50): Promise<ExternalUsageEntry[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('external_usage_ledger')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) {
    log.error({ error: error.message }, 'Failed to query recent usage');
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    requestId: row.request_id as string,
    timestamp: row.timestamp as string,
    workflowId: row.workflow_id as string | undefined,
    agentCapability: row.agent_capability as string | undefined,
    tool: row.tool as string,
    queryHash: row.query_hash as string,
    recordsReturned: row.records_returned as number,
    recordsBillableKnown: row.records_billable_known as number | null,
    pages: row.pages as number,
    httpStatus: row.http_status as number,
    latencyMs: row.latency_ms as number,
    retryCount: row.retry_count as number,
    sourceRecordIds: row.source_record_ids as string[],
    documentBytes: row.document_bytes as number | null,
    meteredAiClassification:
      row.metered_ai_classification as ExternalUsageEntry['meteredAiClassification'],
    estimatedMonthlyConsumption: row.estimated_monthly_consumption as number | null,
    success: row.success as boolean,
    errorMessage: row.error_message as string | undefined,
  }));
}

/**
 * Build a usage entry for a failed/errored call.
 * Ensures all attempts are recorded, not just successes.
 */
export function buildFailureUsageEntry(
  requestId: string,
  tool: string,
  queryHash: string,
  httpStatus: number,
  latencyMs: number,
  errorMessage: string,
  retryCount: number = 0,
  workflowId?: string,
  agentCapability?: string
): ExternalUsageEntry {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    workflowId,
    agentCapability,
    tool,
    queryHash,
    recordsReturned: 0,
    recordsBillableKnown: null, // Unknown on failure
    pages: 0,
    httpStatus,
    latencyMs,
    retryCount,
    sourceRecordIds: [],
    documentBytes: null,
    meteredAiClassification: 'NONE',
    estimatedMonthlyConsumption: null,
    success: false,
    errorMessage,
  };
}
