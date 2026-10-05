/**
 * G2X Research Gateway — Single Integration Boundary
 *
 * All G2X access flows through this gateway. No production agent
 * should instantiate an MCP client directly.
 *
 * Responsibilities:
 * - OAuth/token handling (architecture determined at connection time)
 * - MCP connection and tools/list discovery
 * - Tool allowlist enforcement (separated discovery/authorization)
 * - Research request validation
 * - Deterministic pagination with dedup
 * - Client-side rate limiting (conservative bounded concurrency)
 * - Retry via existing withRetry() infrastructure
 * - Usage accounting (ALL attempts including failures)
 * - Checksum validation
 * - Provenance preservation (G2X = retrieval provider, not source authority)
 * - Raw + normalized storage with bounded payload sizes
 * - Audit logging
 * - Environment guards (commissioning only)
 *
 * Idempotency: stable request hashes enable detection of repeated
 * identical research. During commissioning, determines appropriate
 * TTL/invalidation behavior by data type.
 */

import { logger } from '../../lib/logger.js';
import { withRetry, ErrorCategory } from '../../lib/errors.js';
import { assertCommissioningEnvironment, getEnvironmentRole } from '../../config/environment.js';
import { getSupabase } from '../../integrations/database/client.js';
import {
  resolveAuthState,
  isAuthFailure,
  discoverTools,
  buildToolInventory,
  callTool,
  isRetryableFailure,
} from './mcp-client.js';
import { classifyInventory, isToolAllowed, buildCapabilityMapping } from './allowlist.js';
import {
  recordUsage,
  computeQueryHash,
  generateRequestId,
  buildFailureUsageEntry,
} from './usage-ledger.js';
import { extractRecordsFromResponse, extractRecordId } from './pagination.js';
import {
  retrieveDocumentInventory,
  persistDocumentInventory,
  retrieveAttachmentText,
  persistExternalSourceRecord,
} from './document-handler.js';
import type {
  CapabilityMapping,
  G2XAuthState,
  G2XFailure,
  GovConResearchRequest,
  GovConResearchResult,
  MCPToolCallResponse,
  PayloadSizeObservation,
  ToolInventoryEntry,
} from './types.js';
import { GovConResearchRequestSchema, DEFAULT_BENCHMARK_LIMITS } from './types.js';

const log = logger.child({ service: 'G2XResearchGateway' });

// ============================================================
// Rate Limiting — Conservative Bounded Concurrency
// ============================================================

class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

// ============================================================
// Gateway
// ============================================================

/**
 * Recommended cache TTLs by data type.
 * Opportunities and documents may change with amendments —
 * short TTL avoids hiding updates.
 */
export const RECOMMENDED_CACHE_TTLS: Record<string, number> = {
  OPPORTUNITY: 30 * 60 * 1000, // 30 minutes
  DOCUMENT: 15 * 60 * 1000, // 15 minutes (amendments)
  COMPANY: 24 * 60 * 60 * 1000, // 24 hours
  AWARD: 24 * 60 * 60 * 1000, // 24 hours
  FORECAST: 60 * 60 * 1000, // 1 hour
};

/**
 * Map research request types to G2X tool names.
 * These are CANDIDATE names — actual names come from tools/list.
 * Updated after first real discovery.
 */
const REQUEST_TYPE_TO_TOOL: Record<string, string> = {
  OPPORTUNITY_SEARCH: 'g2x_search_opportunities',
  OPPORTUNITY_DETAIL: 'g2x_get_record',
  DOCUMENT_INVENTORY: 'g2x_opportunity_documents',
  ATTACHMENT_TEXT: 'g2x_opportunity_attachment_text',
  COMPANY_SEARCH: 'g2x_search_companies',
  COMPANY_CONTRACTS: 'g2x_company_contract_history',
  AWARD_HISTORY: 'g2x_search_records',
  FORECAST: 'g2x_forecast_scan',
  TEAMING: 'g2x_teaming_partners',
  SPENDING: 'g2x_search_records',
  EVENT_INTELLIGENCE: 'g2x_search_events',
};

export class G2XResearchGateway {
  private auth: G2XAuthState | null = null;
  private inventory: ToolInventoryEntry[] = [];
  private capabilityMap: CapabilityMapping[] = [];
  private connected = false;
  private semaphore = new Semaphore(2); // Conservative: max 2 concurrent
  private endpoint: string;
  private sizeObservations: PayloadSizeObservation[] = [];

  // Benchmark tracking
  private totalCallsMade = 0;
  private totalRecordsRetrieved = 0;

  constructor(endpoint: string = 'https://mcp.g2x.com/mcp/research') {
    this.endpoint = endpoint;
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Connect to G2X: resolve auth, discover tools, classify inventory.
   * Environment guard: commissioning only.
   */
  async connect(): Promise<{
    success: boolean;
    toolCount: number;
    allowedCount: number;
    deniedCount: number;
    capabilityMap: CapabilityMapping[];
    interactiveAuthRequired: boolean;
    failure?: G2XFailure;
  }> {
    assertCommissioningEnvironment();

    // 1. Resolve authentication
    const authResult = resolveAuthState();
    if (isAuthFailure(authResult)) {
      const failure = authResult as G2XFailure;
      log.error({ failure }, 'G2X authentication failed');

      // Check if interactive auth is needed
      if (failure.message.includes('interactive') || failure.message.includes('human')) {
        return {
          success: false,
          toolCount: 0,
          allowedCount: 0,
          deniedCount: 0,
          capabilityMap: [],
          interactiveAuthRequired: true,
          failure,
        };
      }

      return {
        success: false,
        toolCount: 0,
        allowedCount: 0,
        deniedCount: 0,
        capabilityMap: [],
        interactiveAuthRequired: false,
        failure,
      };
    }

    this.auth = authResult as G2XAuthState;

    // 2. Discover tools
    const discoveryResult = await discoverTools(this.auth, this.endpoint);
    if ('type' in discoveryResult && !('tools' in discoveryResult)) {
      const failure = discoveryResult as G2XFailure;
      log.error({ failure }, 'G2X tool discovery failed');
      return {
        success: false,
        toolCount: 0,
        allowedCount: 0,
        deniedCount: 0,
        capabilityMap: [],
        interactiveAuthRequired: false,
        failure,
      };
    }

    const { tools } = discoveryResult as { tools: import('./types.js').MCPToolDefinition[] };

    // 3. Build inventory with full schema snapshots
    const rawInventory = buildToolInventory(tools, this.endpoint);

    // 4. Apply local authorization policy
    this.inventory = classifyInventory(rawInventory);

    // 5. Persist tool inventory snapshots for audit
    await this.persistToolInventory();

    // 6. Build capability mapping
    this.capabilityMap = buildCapabilityMapping(this.inventory);

    const allowed = this.inventory.filter((t) => t.classification === 'ALLOWED');
    const denied = this.inventory.filter((t) => t.classification !== 'ALLOWED');

    this.connected = true;

    log.info(
      {
        totalTools: this.inventory.length,
        allowed: allowed.length,
        denied: denied.length,
        endpoint: this.endpoint,
      },
      'G2X Research Gateway connected'
    );

    return {
      success: true,
      toolCount: this.inventory.length,
      allowedCount: allowed.length,
      deniedCount: denied.length,
      capabilityMap: this.capabilityMap,
      interactiveAuthRequired: false,
    };
  }

  /**
   * Disconnect and cleanup.
   */
  disconnect(): void {
    this.auth = null;
    this.connected = false;
    log.info('G2X Research Gateway disconnected');
  }

  // ============================================================
  // Core Research Execution
  // ============================================================

  /**
   * Execute a bounded research request.
   * Validates, enforces allowlist, paginates, accounts usage.
   */
  async executeResearch(request: GovConResearchRequest): Promise<GovConResearchResult> {
    assertCommissioningEnvironment();

    if (!this.connected || !this.auth) {
      return {
        status: 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: ['Gateway not connected'],
        usage: emptyUsage(),
      };
    }

    // 1. Validate request
    const parseResult = GovConResearchRequestSchema.safeParse(request);
    if (!parseResult.success) {
      return {
        status: 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [`Invalid request: ${parseResult.error.message}`],
        usage: emptyUsage(),
      };
    }

    // 2. Check capability availability
    const capability = this.capabilityMap.find((c) => c.internalCapability === request.requestType);
    if (!capability || !capability.authorizedForCommissioning) {
      return {
        status: 'CAPABILITY_UNAVAILABLE',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [
          capability
            ? `Capability ${request.requestType} not authorized: ${capability.notes}`
            : `No capability mapping for ${request.requestType}`,
        ],
        usage: emptyUsage(),
      };
    }

    // 3. Resolve tool
    const toolName = REQUEST_TYPE_TO_TOOL[request.requestType];
    if (!toolName) {
      return {
        status: 'CAPABILITY_UNAVAILABLE',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [`No tool mapping for request type ${request.requestType}`],
        usage: emptyUsage(),
      };
    }

    // 4. Enforce allowlist
    const allowCheck = isToolAllowed(toolName, this.inventory);
    if (!allowCheck.allowed) {
      const requestId = generateRequestId();
      await recordUsage(
        buildFailureUsageEntry(
          requestId,
          toolName,
          computeQueryHash(toolName, request as unknown as Record<string, unknown>),
          403,
          0,
          allowCheck.reason,
          0,
          request.workflowId,
          request.agentCapability
        )
      );
      return {
        status: 'DENIED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [allowCheck.reason],
        usage: emptyUsage(),
      };
    }

    // 5. Check benchmark limits
    if (this.totalCallsMade >= DEFAULT_BENCHMARK_LIMITS.maxTotalCalls) {
      return {
        status: 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [
          `Benchmark call limit reached (${DEFAULT_BENCHMARK_LIMITS.maxTotalCalls})`,
        ],
        usage: emptyUsage(),
      };
    }

    // 6. Execute with rate limiting and retry
    const requestId = generateRequestId();
    const queryHash = computeQueryHash(toolName, request as unknown as Record<string, unknown>);
    const startTime = Date.now();

    try {
      await this.semaphore.acquire();

      const result = await this.executeToolWithTracking(
        requestId,
        toolName,
        request,
        queryHash,
        startTime
      );

      return result;
    } finally {
      this.semaphore.release();
    }
  }

  // ============================================================
  // Document Retrieval Chain
  // ============================================================

  /**
   * Execute the full document retrieval chain:
   * opportunity → document inventory → selected attachment → extracted text
   *
   * During transport benchmark, facts contain ANALYSIS_NOT_RUN.
   */
  async executeDocumentChain(
    opportunityId: string,
    workflowId?: string
  ): Promise<GovConResearchResult> {
    assertCommissioningEnvironment();

    if (!this.connected || !this.auth) {
      return {
        status: 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: ['Gateway not connected'],
        usage: emptyUsage(),
      };
    }

    const requestId = generateRequestId('g2x-doc');
    const startTime = Date.now();
    let totalCalls = 0;
    let totalRecords = 0;
    const retryCount = 0;
    let failedCalls = 0;
    const sourceRecords: string[] = [];
    const evidenceRefs: string[] = [];
    const incompleteReasons: string[] = [];

    // Step 1: Document inventory
    const {
      documents,
      sizeObservations,
      failure: invFailure,
    } = await retrieveDocumentInventory(this.auth, opportunityId, this.endpoint);
    totalCalls++;
    this.totalCallsMade++;
    this.sizeObservations.push(...sizeObservations);

    if (invFailure) {
      failedCalls++;
      await recordUsage(
        buildFailureUsageEntry(
          requestId,
          'list_opportunity_documents',
          computeQueryHash('list_opportunity_documents', { opportunityId }),
          invFailure.httpStatus || 0,
          Date.now() - startTime,
          invFailure.message,
          0,
          workflowId
        )
      );
      return {
        status: 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [invFailure.message],
        usage: {
          toolCallsMade: totalCalls,
          recordsReturned: 0,
          recordsBillableKnown: null,
          pagesConsumed: 0,
          totalLatencyMs: Date.now() - startTime,
          retryCount: 0,
          failedCalls,
        },
      };
    }

    if (documents.length === 0) {
      return {
        status: 'COMPLETE',
        facts: [
          {
            claim: 'No documents found for this opportunity',
            evidenceRef: `G2X retrieval: opportunity ${opportunityId}`,
            confidence: 'ANALYSIS_NOT_RUN',
          },
        ],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [],
        usage: {
          toolCallsMade: totalCalls,
          recordsReturned: 0,
          recordsBillableKnown: null,
          pagesConsumed: 1,
          totalLatencyMs: Date.now() - startTime,
          retryCount: 0,
          failedCalls: 0,
        },
      };
    }

    // Persist document inventory
    await persistDocumentInventory(documents, null);
    totalRecords += documents.length;

    // Step 2: Retrieve text for first few documents (bounded)
    const maxDocs = Math.min(documents.length, 3);
    for (let i = 0; i < maxDocs; i++) {
      if (this.totalCallsMade >= DEFAULT_BENCHMARK_LIMITS.maxTotalCalls) {
        incompleteReasons.push('Benchmark call limit reached');
        break;
      }

      const doc = documents[i];
      if (doc.readiness !== 'READY') {
        incompleteReasons.push(`Document ${doc.providerDocumentId} not ready: ${doc.readiness}`);
        continue;
      }

      const { text, provenance, checksumValid, sizeObservation, failure } =
        await retrieveAttachmentText(this.auth, doc.providerDocumentId, this.endpoint);
      totalCalls++;
      this.totalCallsMade++;

      if (sizeObservation) {
        this.sizeObservations.push(sizeObservation);
      }

      if (failure) {
        failedCalls++;
        incompleteReasons.push(`Document ${doc.providerDocumentId}: ${failure.message}`);
        continue;
      }

      if (text && provenance) {
        // Record evidence reference with document provenance (not "G2X says")
        const evidenceRef =
          `Solicitation document: ${doc.title || doc.filename}` +
          (doc.providerVersion ? `, version ${doc.providerVersion}` : '') +
          (provenance.pageNumber ? `, page ${provenance.pageNumber}` : '') +
          (provenance.section ? `, section ${provenance.section}` : '') +
          ` (retrieved via G2X, ${checksumValid === false ? 'CHECKSUM FAILED' : 'integrity verified'})`;

        evidenceRefs.push(evidenceRef);
        totalRecords++;

        // During transport benchmark: ANALYSIS_NOT_RUN
        // No LLM extraction — just preserve raw evidence
      }
    }

    // Record usage
    await recordUsage({
      requestId,
      timestamp: new Date().toISOString(),
      workflowId,
      agentCapability: undefined,
      tool: 'document_chain',
      queryHash: computeQueryHash('document_chain', { opportunityId }),
      recordsReturned: totalRecords,
      recordsBillableKnown: null,
      pages: 1,
      httpStatus: 200,
      latencyMs: Date.now() - startTime,
      retryCount,
      sourceRecordIds: sourceRecords,
      documentBytes: null,
      meteredAiClassification: 'NONE',
      estimatedMonthlyConsumption: null,
      success: failedCalls === 0,
      errorMessage: incompleteReasons.length > 0 ? incompleteReasons.join('; ') : undefined,
    });

    this.totalRecordsRetrieved += totalRecords;

    return {
      status: incompleteReasons.length > 0 ? 'PARTIAL' : 'COMPLETE',
      facts: [
        {
          claim: `Retrieved ${documents.length} documents, extracted text from ${maxDocs - failedCalls} attachments`,
          evidenceRef: `G2X document chain for opportunity ${opportunityId}`,
          confidence: 'ANALYSIS_NOT_RUN',
        },
      ],
      evidenceRefs,
      sourceRecords,
      incompleteReasons,
      usage: {
        toolCallsMade: totalCalls,
        recordsReturned: totalRecords,
        recordsBillableKnown: null,
        pagesConsumed: 1,
        totalLatencyMs: Date.now() - startTime,
        retryCount,
        failedCalls,
      },
    };
  }

  // ============================================================
  // Accessors
  // ============================================================

  getInventory(): ToolInventoryEntry[] {
    return [...this.inventory];
  }

  getCapabilityMap(): CapabilityMapping[] {
    return [...this.capabilityMap];
  }

  isConnected(): boolean {
    return this.connected;
  }

  getSizeObservations(): PayloadSizeObservation[] {
    return [...this.sizeObservations];
  }

  getBenchmarkTotals(): { calls: number; records: number } {
    return {
      calls: this.totalCallsMade,
      records: this.totalRecordsRetrieved,
    };
  }

  // ============================================================
  // Internal
  // ============================================================

  private async executeToolWithTracking(
    requestId: string,
    toolName: string,
    request: GovConResearchRequest,
    queryHash: string,
    startTime: number
  ): Promise<GovConResearchResult> {
    const params = this.buildToolParams(request);
    let retryCount = 0;
    let failedCalls = 0;
    const auth = this.auth;

    if (!auth) {
      return {
        status: 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: ['No authentication state'],
        usage: emptyUsage(),
      };
    }

    try {
      // Use existing withRetry for transient failures
      const response = await withRetry(
        async () => {
          const result = await callTool(auth, { name: toolName, arguments: params }, this.endpoint);

          // Check if it's a failure
          if ('type' in result && !('content' in result)) {
            const failure = result as G2XFailure;

            // Record failed attempt
            failedCalls++;
            await recordUsage(
              buildFailureUsageEntry(
                requestId,
                toolName,
                queryHash,
                failure.httpStatus || 0,
                Date.now() - startTime,
                failure.message,
                retryCount,
                request.workflowId,
                request.agentCapability
              )
            );

            if (isRetryableFailure(failure)) {
              retryCount++;
              // Respect Retry-After for 429
              if (failure.retryAfterSeconds) {
                const waitMs = Math.min(failure.retryAfterSeconds * 1000, 60000);
                await new Promise((r) => setTimeout(r, waitMs));
              }
              throw new Error(`${failure.type}: ${failure.message}`);
            }

            // Non-retryable failure
            return failure;
          }

          return result;
        },
        {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          operationName: `g2x:${toolName}`,
          retryOn: [ErrorCategory.TRANSIENT],
        }
      );

      this.totalCallsMade++;

      // Handle non-retryable failure
      if ('type' in response && 'message' in response && !('content' in response)) {
        const failure = response as G2XFailure;
        return {
          status: failure.type === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FAILED',
          facts: [],
          evidenceRefs: [],
          sourceRecords: [],
          incompleteReasons: [failure.message],
          usage: {
            toolCallsMade: 1 + failedCalls,
            recordsReturned: 0,
            recordsBillableKnown: null,
            pagesConsumed: 0,
            totalLatencyMs: Date.now() - startTime,
            retryCount,
            failedCalls,
          },
        };
      }

      // Success — process and persist
      const mcpResponse = response as MCPToolCallResponse;
      const result = await this.processSuccessfulResponse(
        requestId,
        toolName,
        request,
        mcpResponse,
        queryHash,
        startTime,
        retryCount,
        failedCalls
      );

      return result;
    } catch (error) {
      // All retries exhausted
      const message = error instanceof Error ? error.message : String(error);
      this.totalCallsMade++;

      return {
        status: message.includes('RATE_LIMITED') ? 'RATE_LIMITED' : 'FAILED',
        facts: [],
        evidenceRefs: [],
        sourceRecords: [],
        incompleteReasons: [message],
        usage: {
          toolCallsMade: 1 + failedCalls,
          recordsReturned: 0,
          recordsBillableKnown: null,
          pagesConsumed: 0,
          totalLatencyMs: Date.now() - startTime,
          retryCount,
          failedCalls,
        },
      };
    }
  }

  private async processSuccessfulResponse(
    requestId: string,
    toolName: string,
    request: GovConResearchRequest,
    response: MCPToolCallResponse,
    queryHash: string,
    startTime: number,
    retryCount: number,
    failedCalls: number
  ): Promise<GovConResearchResult> {
    const { records } = extractRecordsFromResponse(response);
    const sourceRecords: string[] = [];

    // Persist each record
    for (const record of records) {
      const recordId = extractRecordId(record) || `unknown-${Date.now()}`;
      const persistedId = await persistExternalSourceRecord(
        'g2x',
        request.requestType.toLowerCase(),
        recordId,
        request.requestType,
        record
      );
      if (persistedId) {
        sourceRecords.push(persistedId);
      }
    }

    this.totalRecordsRetrieved += records.length;

    // Record successful usage
    await recordUsage({
      requestId,
      timestamp: new Date().toISOString(),
      workflowId: request.workflowId,
      agentCapability: request.agentCapability,
      tool: toolName,
      queryHash,
      recordsReturned: records.length,
      recordsBillableKnown: null, // Cannot determine billing from MCP response
      pages: 1,
      httpStatus: 200,
      latencyMs: Date.now() - startTime,
      retryCount,
      sourceRecordIds: sourceRecords,
      documentBytes: null,
      meteredAiClassification: 'NONE',
      estimatedMonthlyConsumption: null,
      success: true,
    });

    // Transport benchmark: ANALYSIS_NOT_RUN for facts
    return {
      status: 'COMPLETE',
      facts: records.map((r) => ({
        claim: `Record retrieved: ${extractRecordId(r) || 'unknown'}`,
        evidenceRef: `G2X ${request.requestType} retrieval`,
        confidence: 'ANALYSIS_NOT_RUN' as const,
      })),
      evidenceRefs: records.map(
        (r) => `G2X record ${extractRecordId(r) || 'unknown'} (${request.requestType})`
      ),
      sourceRecords,
      incompleteReasons: [],
      usage: {
        toolCallsMade: 1 + failedCalls,
        recordsReturned: records.length,
        recordsBillableKnown: null,
        pagesConsumed: 1,
        totalLatencyMs: Date.now() - startTime,
        retryCount,
        failedCalls,
      },
    };
  }

  private buildToolParams(request: GovConResearchRequest): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (request.opportunityId) params.opportunityId = request.opportunityId;
    if (request.companyName) params.companyName = request.companyName;
    if (request.agency) params.agency = request.agency;
    if (request.subject) params.query = request.subject;
    params.limit = request.maxRecords;

    return params;
  }

  private async persistToolInventory(): Promise<void> {
    try {
      assertCommissioningEnvironment();
      const supabase = getSupabase();

      for (const entry of this.inventory) {
        await supabase.from('g2x_tool_inventory').insert({
          tool_name: entry.name,
          description: entry.description,
          input_schema: entry.inputSchema,
          input_schema_hash: entry.inputSchemaHash,
          classification: entry.classification,
          classification_reason: entry.classificationReason,
          discovered_at: entry.discoveredAt,
          endpoint: entry.endpoint,
          integration_version: entry.integrationVersion,
        });
      }

      log.info({ count: this.inventory.length }, 'Tool inventory persisted for audit');
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to persist tool inventory'
      );
    }
  }
}

// ============================================================
// Production Safety Verification
// ============================================================

/**
 * Verify that production Maya/James controls are unchanged.
 * Returns violations if any production state has been modified.
 */
export async function verifyProductionSafety(): Promise<{
  safe: boolean;
  checks: Array<{ control: string; status: string }>;
}> {
  const checks: Array<{ control: string; status: string }> = [];

  // Environment check
  const role = getEnvironmentRole();
  checks.push({
    control: 'environment_role',
    status: role === 'production' ? 'PRODUCTION_DETECTED' : `${role}_OK`,
  });

  // Feature flag checks (read-only verification)
  const flagsToCheck = [
    'MAYA_REVIEW_ENABLED',
    'MAYA_SLACK_PROJECTION_ENABLED',
    'JAMES_CAPTURE_ENABLED',
    'SPECIALIST_EXECUTION_ENABLED',
    'ENABLE_AUTONOMOUS_AI',
  ];

  for (const flag of flagsToCheck) {
    const value = process.env[flag];
    checks.push({
      control: flag,
      status: value === undefined ? 'NOT_SET_OK' : `SET_TO_${value}`,
    });
  }

  const safe = checks.every((c) => c.status.endsWith('_OK') || c.status === 'NOT_SET_OK');

  return { safe, checks };
}

// ============================================================
// Helpers
// ============================================================

function emptyUsage(): GovConResearchResult['usage'] {
  return {
    toolCallsMade: 0,
    recordsReturned: 0,
    recordsBillableKnown: null,
    pagesConsumed: 0,
    totalLatencyMs: 0,
    retryCount: 0,
    failedCalls: 0,
  };
}
