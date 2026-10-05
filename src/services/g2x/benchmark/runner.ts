/**
 * G2X Benchmark Runner
 *
 * Executes benchmark cases with deliberate real limits:
 * - Max 5 cases
 * - Max 100 G2X tool calls total
 * - Max 1,000 records retrieved total
 * - No Lumen/metered-AI calls
 * - No production writes
 * - No LLM provider calls
 *
 * Stops BEFORE exceeding any limit.
 * Reports actual totals.
 *
 * During transport benchmark, facts contain ANALYSIS_NOT_RUN.
 * Semantic extraction requires separate LLM commissioning.
 */

import { logger } from '../../../lib/logger.js';
import { assertCommissioningEnvironment } from '../../../config/environment.js';
import { G2XResearchGateway, verifyProductionSafety } from '../gateway.js';
import type {
  BenchmarkCase,
  BenchmarkLimits,
  BenchmarkMetrics,
  CapabilityMapping,
  GovConResearchResult,
  PayloadSizeObservation,
  ToolInventoryEntry,
} from '../types.js';
import { DEFAULT_BENCHMARK_LIMITS } from '../types.js';
import { BENCHMARK_CASES } from './cases.js';

const log = logger.child({ service: 'G2XBenchmarkRunner' });

export interface BenchmarkRunResult {
  /** Whether the benchmark completed successfully */
  success: boolean;
  /** Connection details */
  connection: {
    endpoint: string;
    authenticated: boolean;
    interactiveAuthRequired: boolean;
    toolCount: number;
    allowedCount: number;
    deniedCount: number;
  };
  /** Tool inventory from real discovery */
  toolInventory: ToolInventoryEntry[];
  /** Capability mapping */
  capabilityMap: CapabilityMapping[];
  /** Per-case results */
  caseResults: Array<{
    case: BenchmarkCase;
    result: GovConResearchResult | null;
    metrics: BenchmarkMetrics;
    samComparison: string;
  }>;
  /** Aggregate metrics */
  totals: {
    totalCalls: number;
    totalRecords: number;
    totalLatencyMs: number;
    failedCalls: number;
    casesRun: number;
    casesSkipped: number;
  };
  /** Payload size observations */
  sizeObservations: PayloadSizeObservation[];
  /** Event intelligence availability */
  eventIntelligenceAvailable: boolean;
  /** Community plan limitations observed */
  communityLimitations: string[];
  /** Production safety verification */
  productionSafety: { safe: boolean; checks: Array<{ control: string; status: string }> };
  /** Recommended cache TTLs by data type */
  cacheTTLRecommendations: Record<string, string>;
  /** Errors encountered */
  errors: string[];
}

/**
 * Run the full G2X commissioning benchmark.
 *
 * Sequence:
 * 1. Verify production safety (before)
 * 2. Connect to G2X (real OAuth, real tools/list)
 * 3. Classify tool inventory
 * 4. Execute bounded benchmark cases
 * 5. Verify production safety (after)
 * 6. Report results
 */
export async function runBenchmark(
  endpoint?: string,
  limits: BenchmarkLimits = DEFAULT_BENCHMARK_LIMITS
): Promise<BenchmarkRunResult> {
  assertCommissioningEnvironment();

  const errors: string[] = [];
  const communityLimitations: string[] = [];

  // 1. Pre-benchmark production safety check
  const preSafety = await verifyProductionSafety();
  if (!preSafety.safe) {
    log.error({ checks: preSafety.checks }, 'Pre-benchmark safety check FAILED');
    return {
      success: false,
      connection: emptyConnection(),
      toolInventory: [],
      capabilityMap: [],
      caseResults: [],
      totals: emptyTotals(),
      sizeObservations: [],
      eventIntelligenceAvailable: false,
      communityLimitations: ['BENCHMARK BLOCKED: Production safety check failed'],
      productionSafety: preSafety,
      cacheTTLRecommendations: {},
      errors: ['Production safety check failed before benchmark'],
    };
  }

  // 2. Connect
  const gateway = new G2XResearchGateway(endpoint);
  const connectResult = await gateway.connect();

  if (!connectResult.success) {
    return {
      success: false,
      connection: {
        endpoint: endpoint || 'https://mcp.g2x.com/mcp/research',
        authenticated: false,
        interactiveAuthRequired: connectResult.interactiveAuthRequired,
        toolCount: 0,
        allowedCount: 0,
        deniedCount: 0,
      },
      toolInventory: [],
      capabilityMap: [],
      caseResults: [],
      totals: emptyTotals(),
      sizeObservations: [],
      eventIntelligenceAvailable: false,
      communityLimitations: connectResult.failure
        ? [connectResult.failure.message]
        : ['Connection failed'],
      productionSafety: preSafety,
      cacheTTLRecommendations: {},
      errors: [connectResult.failure?.message || 'Connection failed'],
    };
  }

  const toolInventory = gateway.getInventory();
  const capabilityMap = gateway.getCapabilityMap();

  // Check event intelligence availability
  const eventCapability = capabilityMap.find((c) => c.internalCapability === 'EVENT_INTELLIGENCE');
  const eventIntelligenceAvailable = eventCapability?.authorizedForCommissioning === true;

  if (!eventIntelligenceAvailable) {
    communityLimitations.push('Event Intelligence: NOT CURRENTLY SUPPORTED on discovered tools');
  }

  // Track unavailable capabilities
  for (const cap of capabilityMap) {
    if (!cap.authorizedForCommissioning) {
      communityLimitations.push(`${cap.internalCapability}: ${cap.notes}`);
    }
  }

  // 3. Execute benchmark cases
  const caseResults: BenchmarkRunResult['caseResults'] = [];
  let totalCalls = 0;
  let totalRecords = 0;
  let totalLatencyMs = 0;
  let failedCalls = 0;
  let casesRun = 0;
  let casesSkipped = 0;

  const casesToRun = BENCHMARK_CASES.slice(0, limits.maxCases);

  for (const benchCase of casesToRun) {
    // Check limits before each case
    const gatewayTotals = gateway.getBenchmarkTotals();
    if (gatewayTotals.calls >= limits.maxTotalCalls) {
      casesSkipped += casesToRun.length - casesRun;
      errors.push(`Stopped: call limit reached (${limits.maxTotalCalls})`);
      break;
    }
    if (gatewayTotals.records >= limits.maxTotalRecords) {
      casesSkipped += casesToRun.length - casesRun;
      errors.push(`Stopped: record limit reached (${limits.maxTotalRecords})`);
      break;
    }

    const caseStart = Date.now();
    let result: GovConResearchResult | null = null;

    try {
      if (benchCase.testDocumentRetrieval) {
        // Document chain benchmark
        const oppId = benchCase.knownOpportunityId || 'test-opportunity';
        result = await gateway.executeDocumentChain(oppId);
      } else {
        // Standard research request
        result = await gateway.executeResearch({
          requestType: mapCaseToRequestType(benchCase.type),
          subject: benchCase.searchTerms[0] || benchCase.description,
          evidenceNeeded: benchCase.expectedEvidence,
          maxRecords: 10,
          maxPages: 3,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Case ${benchCase.id}: ${msg}`);
    }

    const caseLatency = Date.now() - caseStart;
    casesRun++;

    if (result) {
      totalCalls += result.usage.toolCallsMade;
      totalRecords += result.usage.recordsReturned;
      totalLatencyMs += result.usage.totalLatencyMs;
      failedCalls += result.usage.failedCalls;
    }

    const metrics = buildMetrics(result, caseLatency);
    const samComparison = compareSAM(benchCase, result);

    caseResults.push({
      case: benchCase,
      result,
      metrics,
      samComparison,
    });

    log.info(
      {
        caseId: benchCase.id,
        status: result?.status || 'ERROR',
        latencyMs: caseLatency,
        records: result?.usage.recordsReturned || 0,
      },
      `Benchmark case complete: ${benchCase.id}`
    );
  }

  // 4. Post-benchmark production safety check
  const postSafety = await verifyProductionSafety();
  if (!postSafety.safe) {
    errors.push('CRITICAL: Post-benchmark safety check FAILED');
  }

  // 5. Disconnect
  gateway.disconnect();

  // 6. Cache TTL recommendations
  const cacheTTLRecommendations: Record<string, string> = {
    OPPORTUNITY: '30 minutes — amendments may arrive; short TTL avoids hiding updates',
    DOCUMENT: '15 minutes — solicitation documents may be amended',
    COMPANY: '24 hours — company data changes infrequently',
    AWARD: '24 hours — historical awards are stable',
    FORECAST: '1 hour — forecasts may be updated before release',
  };

  return {
    success: errors.length === 0 && postSafety.safe,
    connection: {
      endpoint: endpoint || 'https://mcp.g2x.com/mcp/research',
      authenticated: true,
      interactiveAuthRequired: false,
      toolCount: connectResult.toolCount,
      allowedCount: connectResult.allowedCount,
      deniedCount: connectResult.deniedCount,
    },
    toolInventory,
    capabilityMap,
    caseResults,
    totals: {
      totalCalls,
      totalRecords,
      totalLatencyMs,
      failedCalls,
      casesRun,
      casesSkipped,
    },
    sizeObservations: gateway.getSizeObservations(),
    eventIntelligenceAvailable,
    communityLimitations,
    productionSafety: postSafety,
    cacheTTLRecommendations,
    errors,
  };
}

// ============================================================
// Helpers
// ============================================================

function mapCaseToRequestType(
  caseType: string
): 'OPPORTUNITY_SEARCH' | 'COMPANY_SEARCH' | 'AWARD_HISTORY' | 'FORECAST' | 'TEAMING' {
  switch (caseType) {
    case 'SOFTWARE_MODERNIZATION':
    case 'SOLICITATION_ATTACHMENTS':
      return 'OPPORTUNITY_SEARCH';
    case 'INCUMBENT_RESEARCH':
      return 'AWARD_HISTORY';
    case 'TEAMING_COMPANY':
      return 'COMPANY_SEARCH';
    case 'FORECAST_PRESOLICITATION':
      return 'FORECAST';
    default:
      return 'OPPORTUNITY_SEARCH';
  }
}

function buildMetrics(result: GovConResearchResult | null, latencyMs: number): BenchmarkMetrics {
  if (!result) {
    return {
      recordFound: false,
      latencyMs,
      completeness: 'NONE',
      documentAvailable: false,
      amendmentVisible: false,
      sourceRefsPresent: false,
      companyInfoAvailable: false,
      awardHistoryAvailable: false,
      teamingEvidenceAvailable: false,
      provenanceQuality: 'NONE',
      recordsConsumed: 0,
      callsRequired: 0,
      duplicateRate: 0,
      retryCount: 0,
      errors: ['No result returned'],
    };
  }

  return {
    recordFound: result.status === 'COMPLETE' || result.status === 'PARTIAL',
    latencyMs,
    completeness:
      result.status === 'COMPLETE'
        ? 'FULL'
        : result.status === 'PARTIAL'
          ? 'PARTIAL'
          : result.status === 'CAPABILITY_UNAVAILABLE'
            ? 'NONE'
            : 'MINIMAL',
    documentAvailable: result.evidenceRefs.some((r) => r.includes('document')),
    amendmentVisible: result.evidenceRefs.some((r) => r.includes('version')),
    sourceRefsPresent: result.evidenceRefs.length > 0,
    companyInfoAvailable: result.evidenceRefs.some(
      (r) => r.includes('company') || r.includes('COMPANY')
    ),
    awardHistoryAvailable: result.evidenceRefs.some(
      (r) => r.includes('award') || r.includes('AWARD')
    ),
    teamingEvidenceAvailable: result.evidenceRefs.some(
      (r) => r.includes('teaming') || r.includes('TEAMING')
    ),
    provenanceQuality:
      result.evidenceRefs.length > 0
        ? result.evidenceRefs.some((r) => r.includes('Solicitation document'))
          ? 'FULL'
          : 'PARTIAL'
        : 'NONE',
    recordsConsumed: result.usage.recordsReturned,
    callsRequired: result.usage.toolCallsMade,
    duplicateRate: 0, // Tracked by pagination layer
    retryCount: result.usage.retryCount,
    errors: result.incompleteReasons,
  };
}

function compareSAM(_benchCase: BenchmarkCase, result: GovConResearchResult | null): string {
  if (!result || result.status === 'CAPABILITY_UNAVAILABLE') {
    return 'Cannot compare — G2X capability unavailable for this request type';
  }
  if (result.status === 'FAILED') {
    return 'Cannot compare — G2X retrieval failed';
  }

  // SAM comparison is qualitative during transport benchmark
  return (
    `G2X returned ${result.usage.recordsReturned} records in ${result.usage.totalLatencyMs}ms. ` +
    `SAM comparison requires matching opportunity IDs — deferred to integration phase. ` +
    `Evidence refs: ${result.evidenceRefs.length}, ` +
    `source records persisted: ${result.sourceRecords.length}`
  );
}

function emptyConnection(): BenchmarkRunResult['connection'] {
  return {
    endpoint: '',
    authenticated: false,
    interactiveAuthRequired: false,
    toolCount: 0,
    allowedCount: 0,
    deniedCount: 0,
  };
}

function emptyTotals(): BenchmarkRunResult['totals'] {
  return {
    totalCalls: 0,
    totalRecords: 0,
    totalLatencyMs: 0,
    failedCalls: 0,
    casesRun: 0,
    casesSkipped: 0,
  };
}
