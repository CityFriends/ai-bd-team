/**
 * G2X GovCon Research Integration — Type Definitions
 *
 * All types, Zod schemas, and contracts for the G2X read-only
 * research MCP integration. G2X is an evidence provider, not
 * a source authority — provenance must trace to underlying
 * solicitation documents, not to G2X itself.
 */

import { z } from 'zod';

// ============================================================
// MCP Transport Types
// ============================================================

/** Raw MCP tool definition returned by tools/list */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tools/list response */
export interface MCPToolsListResponse {
  tools: MCPToolDefinition[];
}

/** MCP tool call request */
export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/** MCP tool call response */
export interface MCPToolCallResponse {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

// ============================================================
// Tool Discovery & Authorization (Separated Concerns)
// ============================================================

/**
 * Classification of a discovered tool.
 *
 * Discovery (tools/list) is authoritative for WHAT EXISTS.
 * Authorization (local policy) determines WHAT MAY EXECUTE.
 * Remote appearance alone NEVER authorizes execution.
 */
export type ToolClassification =
  | 'ALLOWED'
  | 'DENIED_UNKNOWN'
  | 'DENIED_MUTATING'
  | 'DENIED_METERED_AI'
  | 'DENIED_METERED_OR_UNKNOWN';

/**
 * Full tool inventory entry — persists complete schema snapshot,
 * not just the hash. Required for audit of what was actually
 * authorized at discovery time.
 */
export interface ToolInventoryEntry {
  /** Exact tool name from tools/list */
  name: string;
  /** Full description from tools/list */
  description: string;
  /** Complete canonicalized input schema (not just hash) */
  inputSchema: Record<string, unknown>;
  /** SHA-256 hash of canonicalized input schema */
  inputSchemaHash: string;
  /** Local authorization classification */
  classification: ToolClassification;
  /** Reason for classification decision */
  classificationReason: string;
  /** ISO timestamp of discovery */
  discoveredAt: string;
  /** MCP endpoint URL */
  endpoint: string;
  /** Integration version identifier */
  integrationVersion: string;
}

/**
 * Local authorization policy entry.
 * Maps an internal research capability to a specific G2X tool
 * that has been reviewed and explicitly approved.
 */
export interface ToolAuthorizationPolicy {
  /** Internal capability this tool serves */
  capability: string;
  /** Exact G2X tool name that must match tools/list */
  toolName: string;
  /** Whether this tool is known to trigger metered AI */
  meteredAI: boolean;
  /** Whether this is a mutating operation */
  mutating: boolean;
  /** Human review note */
  reviewNote: string;
}

// ============================================================
// Research Request Contract
// ============================================================

/**
 * Internal research request types.
 * Not every type may be fulfillable by Community plan.
 * Unsupported types return CAPABILITY_UNAVAILABLE.
 */
export const ResearchRequestType = {
  OPPORTUNITY_SEARCH: 'OPPORTUNITY_SEARCH',
  OPPORTUNITY_DETAIL: 'OPPORTUNITY_DETAIL',
  DOCUMENT_INVENTORY: 'DOCUMENT_INVENTORY',
  ATTACHMENT_TEXT: 'ATTACHMENT_TEXT',
  COMPANY_SEARCH: 'COMPANY_SEARCH',
  COMPANY_CONTRACTS: 'COMPANY_CONTRACTS',
  AWARD_HISTORY: 'AWARD_HISTORY',
  FORECAST: 'FORECAST',
  TEAMING: 'TEAMING',
  SPENDING: 'SPENDING',
  EVENT_INTELLIGENCE: 'EVENT_INTELLIGENCE',
} as const;

export type ResearchRequestTypeValue =
  (typeof ResearchRequestType)[keyof typeof ResearchRequestType];

export const GovConResearchRequestSchema = z.object({
  requestType: z.enum([
    'OPPORTUNITY_SEARCH',
    'OPPORTUNITY_DETAIL',
    'DOCUMENT_INVENTORY',
    'ATTACHMENT_TEXT',
    'COMPANY_SEARCH',
    'COMPANY_CONTRACTS',
    'AWARD_HISTORY',
    'FORECAST',
    'TEAMING',
    'SPENDING',
    'EVENT_INTELLIGENCE',
  ]),
  /** Research subject description */
  subject: z.string().max(500),
  /** Specific research question */
  question: z.string().max(1000).optional(),
  /** G2X or SAM opportunity identifier */
  opportunityId: z.string().max(200).optional(),
  /** Company name for company-related research */
  companyName: z.string().max(200).optional(),
  /** Agency filter */
  agency: z.string().max(100).optional(),
  /** Types of evidence needed */
  evidenceNeeded: z.array(z.string().max(100)).max(10),
  /** Maximum records to retrieve */
  maxRecords: z.number().int().min(1).max(100).default(25),
  /** Maximum pages to paginate */
  maxPages: z.number().int().min(1).max(10).default(5),
  /** Workflow/task ID for correlation */
  workflowId: z.string().max(200).optional(),
  /** Agent capability requesting this research */
  agentCapability: z.string().max(100).optional(),
});

export type GovConResearchRequest = z.infer<typeof GovConResearchRequestSchema>;

// ============================================================
// Research Result Contract
// ============================================================

export const ResearchResultStatus = {
  COMPLETE: 'COMPLETE',
  PARTIAL: 'PARTIAL',
  RATE_LIMITED: 'RATE_LIMITED',
  FAILED: 'FAILED',
  DENIED: 'DENIED',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
} as const;

export type ResearchResultStatusValue =
  (typeof ResearchResultStatus)[keyof typeof ResearchResultStatus];

/**
 * Evidence fact — during transport benchmark, facts[] will contain
 * ANALYSIS_NOT_RUN markers. Semantic extraction requires separate
 * LLM commissioning.
 */
export const ResearchFactSchema = z.object({
  claim: z.string().max(1000),
  /** Source reference: document/version/page, not "G2X says" */
  evidenceRef: z.string().max(500),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'ANALYSIS_NOT_RUN']),
});

export type ResearchFact = z.infer<typeof ResearchFactSchema>;

export const GovConResearchResultSchema = z.object({
  status: z.enum([
    'COMPLETE',
    'PARTIAL',
    'RATE_LIMITED',
    'FAILED',
    'DENIED',
    'CAPABILITY_UNAVAILABLE',
  ]),
  facts: z.array(ResearchFactSchema).max(50),
  /** Source references preserving document provenance */
  evidenceRefs: z.array(z.string().max(500)).max(50),
  /** IDs of persisted external_source_records */
  sourceRecords: z.array(z.string()).max(100),
  /** Reasons for incomplete results */
  incompleteReasons: z.array(z.string().max(300)).max(10),
  /** Usage accounting for this request */
  usage: z.object({
    toolCallsMade: z.number().int().min(0),
    recordsReturned: z.number().int().min(0),
    /** Distinct from recordsReturned — actual billable if known */
    recordsBillableKnown: z.number().int().min(0).nullable(),
    pagesConsumed: z.number().int().min(0),
    totalLatencyMs: z.number().int().min(0),
    retryCount: z.number().int().min(0),
    failedCalls: z.number().int().min(0),
  }),
});

export type GovConResearchResult = z.infer<typeof GovConResearchResultSchema>;

// ============================================================
// Failure Types (Structured — Spec Section 24)
// ============================================================

export type G2XFailureType =
  | 'AUTHENTICATION_FAILURE'
  | 'AUTHORIZATION_FAILURE'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'MALFORMED_REQUEST'
  | 'SCHEMA_MISMATCH'
  | 'PARTIAL_PAGINATION'
  | 'MISSING_RECORD'
  | 'DOCUMENT_NOT_READY'
  | 'CHECKSUM_MISMATCH'
  | 'TOOL_DENIED'
  | 'CAPABILITY_UNAVAILABLE';

export interface G2XFailure {
  type: G2XFailureType;
  message: string;
  /** HTTP status if applicable */
  httpStatus?: number;
  /** Retry-After header value in seconds if applicable */
  retryAfterSeconds?: number;
  /** Tool name if applicable */
  toolName?: string;
}

// ============================================================
// Usage Accounting (Separate from LLM Budget)
// ============================================================

export const ExternalUsageEntrySchema = z.object({
  /** Unique request identifier */
  requestId: z.string().max(200),
  /** ISO timestamp */
  timestamp: z.string().datetime(),
  /** Workflow/task correlation ID */
  workflowId: z.string().max(200).optional(),
  /** Agent capability that requested research */
  agentCapability: z.string().max(100).optional(),
  /** MCP tool invoked */
  tool: z.string().max(200),
  /** Stable hash of query parameters */
  queryHash: z.string().max(64),
  /** Records returned (may differ from billable) */
  recordsReturned: z.number().int().min(0),
  /** Known billable records, null if unknown */
  recordsBillableKnown: z.number().int().min(0).nullable(),
  /** Pages consumed */
  pages: z.number().int().min(0),
  /** HTTP or MCP status */
  httpStatus: z.number().int(),
  /** Request latency in milliseconds */
  latencyMs: z.number().int().min(0),
  /** Number of retries attempted */
  retryCount: z.number().int().min(0),
  /** Source record IDs returned */
  sourceRecordIds: z.array(z.string().max(200)).max(100),
  /** Document bytes if applicable */
  documentBytes: z.number().int().min(0).nullable(),
  /** Metered AI classification */
  meteredAiClassification: z.enum(['NONE', 'CONFIRMED_METERED', 'SUSPECTED_METERED', 'UNKNOWN']),
  /** Estimated monthly record consumption */
  estimatedMonthlyConsumption: z.number().int().min(0).nullable(),
  /** Whether request succeeded */
  success: z.boolean(),
  /** Error message if failed */
  errorMessage: z.string().max(500).optional(),
});

export type ExternalUsageEntry = z.infer<typeof ExternalUsageEntrySchema>;

// ============================================================
// Document Provenance Model
// ============================================================

/**
 * Provenance chain: G2X is the retrieval provider, NOT the source authority.
 *
 * For solicitation requirements, provenance traces to:
 *   Solicitation Document Y → Version Z → Page/Section
 * with G2X recorded as the retrieval mechanism, not the author.
 */
export interface DocumentProvenance {
  /** G2X or provider opportunity ID */
  providerOpportunityId: string;
  /** Provider document ID */
  providerDocumentId: string;
  /** Document title */
  title: string;
  /** Original filename */
  filename: string;
  /** Document type (SOW, RFP, Amendment, etc.) */
  documentType: string | null;
  /** Version identifier from provider */
  providerVersion: string | null;
  /** Amendment relationship if supplied */
  amendmentOf: string | null;
  /** Checksum from provider */
  checksum: string | null;
  /** Readiness state */
  readiness: 'READY' | 'PROCESSING' | 'NOT_AVAILABLE' | 'UNKNOWN';
  /** Retrieval timestamp */
  retrievedAt: string;
}

export interface EvidenceProvenance {
  /** FK to source_document_versions */
  sourceDocumentVersionId: string;
  /** Evidence type */
  evidenceType: 'EXTRACTED_TEXT' | 'REQUIREMENT' | 'METADATA';
  /** Page number if supplied */
  pageNumber: number | null;
  /** Section reference if supplied */
  section: string | null;
  /** Bounding box if supplied */
  bbox: { x: number; y: number; width: number; height: number } | null;
  /** Content hash for integrity */
  contentHash: string;
  /** Extraction timestamp */
  extractedAt: string;
}

// ============================================================
// Capability Mapping (Post-Discovery)
// ============================================================

/**
 * Maps internal research capabilities to actual G2X tools
 * discovered via tools/list. Produced after real discovery.
 */
export interface CapabilityMapping {
  /** Our internal request type */
  internalCapability: ResearchRequestTypeValue;
  /** Actual G2X tool(s) that serve this capability */
  g2xTools: string[];
  /** Available on Community plan */
  availableOnCommunity: boolean | null;
  /** Known to trigger metered AI */
  meteredAI: boolean | null;
  /** Authorized for commissioning use */
  authorizedForCommissioning: boolean;
  /** Notes */
  notes: string;
}

// ============================================================
// Pagination Types
// ============================================================

export interface PaginationState {
  /** Current page/cursor position */
  currentPage: number;
  /** Total pages consumed */
  pagesConsumed: number;
  /** Cursor token if cursor-based */
  cursor: string | null;
  /** Record IDs seen for deduplication */
  seenIds: Set<string>;
  /** Total records retrieved */
  totalRetrieved: number;
  /** Maximum records allowed */
  maxRecords: number;
  /** Maximum pages allowed */
  maxPages: number;
}

export interface PaginationResult<T> {
  records: T[];
  hasMore: boolean;
  pagesConsumed: number;
  totalRetrieved: number;
  duplicatesSkipped: number;
  incomplete: boolean;
  incompleteReason: string | null;
}

// ============================================================
// Request Hashing / Idempotency
// ============================================================

export interface CachedResearchResult {
  /** Hash of the research request */
  requestHash: string;
  /** When the result was cached */
  cachedAt: string;
  /** The cached result */
  result: GovConResearchResult;
  /** Data type for TTL determination */
  dataType: 'OPPORTUNITY' | 'DOCUMENT' | 'COMPANY' | 'AWARD' | 'FORECAST';
}

// ============================================================
// Benchmark Types
// ============================================================

export const BenchmarkCaseType = {
  SOFTWARE_MODERNIZATION: 'SOFTWARE_MODERNIZATION',
  SOLICITATION_ATTACHMENTS: 'SOLICITATION_ATTACHMENTS',
  INCUMBENT_RESEARCH: 'INCUMBENT_RESEARCH',
  TEAMING_COMPANY: 'TEAMING_COMPANY',
  FORECAST_PRESOLICITATION: 'FORECAST_PRESOLICITATION',
} as const;

export type BenchmarkCaseTypeValue = (typeof BenchmarkCaseType)[keyof typeof BenchmarkCaseType];

export interface BenchmarkCase {
  id: string;
  type: BenchmarkCaseTypeValue;
  description: string;
  /** Known opportunity identifier if applicable */
  knownOpportunityId: string | null;
  /** Search terms for discovery */
  searchTerms: string[];
  /** Expected evidence types */
  expectedEvidence: string[];
  /** Whether to test document/attachment retrieval */
  testDocumentRetrieval: boolean;
}

export interface BenchmarkMetrics {
  /** Could we find the record? */
  recordFound: boolean;
  /** Retrieval latency in ms */
  latencyMs: number;
  /** Completeness assessment */
  completeness: 'FULL' | 'PARTIAL' | 'MINIMAL' | 'NONE';
  /** Document availability */
  documentAvailable: boolean;
  /** Amendment/version visibility */
  amendmentVisible: boolean;
  /** Source references present */
  sourceRefsPresent: boolean;
  /** Company/incumbent info available */
  companyInfoAvailable: boolean;
  /** Award history available */
  awardHistoryAvailable: boolean;
  /** Teaming evidence available */
  teamingEvidenceAvailable: boolean;
  /** Provenance quality */
  provenanceQuality: 'FULL' | 'PARTIAL' | 'NONE';
  /** Record consumption count */
  recordsConsumed: number;
  /** API calls required */
  callsRequired: number;
  /** Duplicate records encountered */
  duplicateRate: number;
  /** Failures/retries */
  retryCount: number;
  /** Error details if any */
  errors: string[];
}

export interface BenchmarkLimits {
  maxCases: number;
  maxTotalCalls: number;
  maxTotalRecords: number;
  allowMeteredAI: false;
  allowProductionWrites: false;
  allowLLMCalls: false;
}

export const DEFAULT_BENCHMARK_LIMITS: BenchmarkLimits = {
  maxCases: 5,
  maxTotalCalls: 100,
  maxTotalRecords: 1000,
  allowMeteredAI: false,
  allowProductionWrites: false,
  allowLLMCalls: false,
};

// ============================================================
// OAuth Types
// ============================================================

/**
 * OAuth state — determined during real connection,
 * not pre-assumed as static bearer token.
 */
export interface G2XAuthState {
  /** Access token (NEVER logged, committed, or persisted in evidence) */
  accessToken: string;
  /** Token type (Bearer, etc.) */
  tokenType: string;
  /** Expiry timestamp if known */
  expiresAt: string | null;
  /** Refresh token if applicable */
  refreshToken: string | null;
  /** Scopes granted */
  scopes: string[];
  /** Whether interactive human authorization was required */
  interactiveAuthRequired: boolean;
}

// ============================================================
// Raw Payload Size Control
// ============================================================

/** Maximum raw payload size to store in PostgreSQL JSONB (bytes) */
export const MAX_RAW_PAYLOAD_BYTES = 256 * 1024; // 256 KB

/** Maximum attachment text to store inline (bytes) */
export const MAX_ATTACHMENT_TEXT_BYTES = 512 * 1024; // 512 KB

/**
 * Size observation for benchmark reporting.
 * Determines whether Postgres remains appropriate or
 * future object storage is needed.
 */
export interface PayloadSizeObservation {
  recordType: string;
  sizeBytes: number;
  exceedsLimit: boolean;
  storageStrategy: 'JSONB_INLINE' | 'TRUNCATED_WITH_HASH' | 'REQUIRES_OBJECT_STORAGE';
}
