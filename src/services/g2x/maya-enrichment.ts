/**
 * Maya G2X Selective Enrichment
 *
 * Provides bounded, deterministic G2X solicitation evidence to Maya
 * BEFORE her reasoning call, without giving Maya arbitrary MCP access.
 *
 * Flow:
 *   eligible Maya review task
 *     → deterministic enrichment policy (score-based)
 *     → G2XResearchGateway
 *     → bounded evidence retrieval
 *     → normalized evidence package
 *     → ONE Maya reasoning call
 *
 * Maya does NOT directly call MCP tools.
 * Maya does NOT get a second inference call if G2X fails.
 * G2X failure does NOT stop SAM collection or Maya review.
 *
 * Tool boundary — Maya enrichment may ONLY use:
 *   g2x_get_record, g2x_search_supplementary,
 *   g2x_opportunity_documents, g2x_opportunity_attachment_text
 */

import { createHash } from 'crypto';
import { logger } from '../../lib/logger.js';
import { getFeatureFlag } from '../../config/ai-controls.js';
import { getSupabase } from '../../integrations/database/client.js';
// environment guards available but not imported directly — enrichment runs within Maya's guarded path
import { G2XAuthAdapter, getG2XAuth } from './auth.js';
import { callToolDirect } from './transport.js';
import type { G2XFailure, MCPToolCallResponse } from './types.js';

const log = logger.child({ service: 'MayaG2XEnrichment' });

// ============================================================
// Constants
// ============================================================

/** Maximum G2X tool calls per Maya review */
const MAX_CALLS_PER_REVIEW = 6;

/** Maximum extracted text bytes for Maya context (bounded for Haiku) */
const MAX_TEXT_BYTES_FOR_CONTEXT = 6000;

/** Maya-allowed G2X tools (spec section 4) */
const MAYA_ALLOWED_TOOLS = new Set([
  'g2x_get_record',
  'g2x_search_supplementary',
  'g2x_opportunity_documents',
  'g2x_opportunity_attachment_text',
]);

/** Relevance terms for deterministic chunk selection */
const RELEVANCE_TERMS = [
  'scope',
  'requirements',
  'objectives',
  'tasks',
  'deliverables',
  'period of performance',
  'place of performance',
  'security',
  'clearance',
  'staffing',
  'key personnel',
  'accessibility',
  'section 508',
  'evaluation',
  'naics',
  'set-aside',
  'contract type',
];

/** Document type priority for deterministic selection */
const DOC_TYPE_PRIORITY: Record<string, number> = {
  pws: 1,
  sow: 1,
  soo: 1,
  'performance work statement': 1,
  'statement of work': 1,
  'statement of objectives': 1,
  solicitation: 2,
  rfp: 2,
  rfq: 2,
  requirement: 3,
  specification: 3,
  amendment: 4,
  'q&a': 5,
  questions: 5,
};

// ============================================================
// Types
// ============================================================

export interface MayaEnrichmentEvidence {
  status: 'ENRICHED' | 'NOT_ELIGIBLE' | 'UNAVAILABLE' | 'NO_DOCUMENTS' | 'FAILED';
  g2xRecordId: string | null;
  sourceDocumentId: string | null;
  sourceDocumentVersionId: string | null;
  documentTitle: string | null;
  documentType: string | null;
  selectedDocumentReason: string | null;
  evidenceChunks: Array<{
    text: string;
    pageNumber: number | null;
    section: string | null;
    relevanceTermsMatched: string[];
    sourceRef: string;
  }>;
  amendmentStatus: 'CURRENT' | 'SUPERSEDED' | 'UNKNOWN' | null;
  completeness: 'FULL' | 'PARTIAL' | 'NONE';
  unavailableReason: string | null;
  usage: {
    g2xCallsMade: number;
    documentsRetrieved: number;
    textBytesRetrieved: number;
    latencyMs: number;
    cacheHit: boolean;
  };
}

export interface EnrichmentEligibility {
  eligible: boolean;
  reason: string;
  policyTier: 'HIGH_SCORE' | 'QUICK_LANE' | 'NOT_ELIGIBLE';
  incompletenessSignals: string[];
}

// ============================================================
// Feature Gate
// ============================================================

export function isMayaG2XEnrichmentEnabled(): boolean {
  return getFeatureFlag('MAYA_G2X_ENRICHMENT_ENABLED');
}

// ============================================================
// Enrichment Policy
// ============================================================

/**
 * Determine if an opportunity is eligible for G2X enrichment.
 *
 * Score 80-100: Automatic enrichment authorized.
 * Score 60-79:  Only if deterministic material gap detected.
 * Below 60:    No enrichment.
 */
export function evaluateEnrichmentEligibility(
  totalScore: number,
  description: string | null,
  attachments: Array<{ name?: string; url?: string; type?: string }> | null,
  noticeType: string | null
): EnrichmentEligibility {
  // Below 60: not eligible
  if (totalScore < 60) {
    return {
      eligible: false,
      reason: `Score ${totalScore} below enrichment threshold (60)`,
      policyTier: 'NOT_ELIGIBLE',
      incompletenessSignals: [],
    };
  }

  // 80+: automatic enrichment
  if (totalScore >= 80) {
    return {
      eligible: true,
      reason: `Score ${totalScore} qualifies for automatic G2X solicitation enrichment`,
      policyTier: 'HIGH_SCORE',
      incompletenessSignals: [],
    };
  }

  // 60-79: quick-lane incompleteness check
  const signals = detectIncompletenessSignals(description, attachments, noticeType);

  if (signals.length > 0) {
    return {
      eligible: true,
      reason: `Score ${totalScore} with material evidence gaps: ${signals.join('; ')}`,
      policyTier: 'QUICK_LANE',
      incompletenessSignals: signals,
    };
  }

  return {
    eligible: false,
    reason: `Score ${totalScore} in 60-79 range with sufficient existing evidence`,
    policyTier: 'NOT_ELIGIBLE',
    incompletenessSignals: [],
  };
}

/**
 * Detect deterministic evidence gaps that justify G2X enrichment
 * for 60-79 scored opportunities.
 *
 * Only material gaps — NOT "nice to have" information.
 */
function detectIncompletenessSignals(
  description: string | null,
  attachments: Array<{ name?: string; url?: string; type?: string }> | null,
  noticeType: string | null
): string[] {
  const signals: string[] = [];

  // 1. Description materially truncated or missing
  if (!description || description.length < 100) {
    signals.push('Description missing or materially truncated');
  }

  // 2. Solicitation type suggests documents should exist but none available
  const hasDocAttachments = attachments?.some(
    (a) =>
      a.type === 'file' ||
      a.name?.match(/\.(pdf|doc|docx|xlsx)$/i) ||
      a.name?.match(/sow|pws|rfp|rfq|solicitation/i)
  );

  if (
    !hasDocAttachments &&
    noticeType &&
    ['o', 'k', 'r', 'p'].includes(noticeType) // Solicitation, Combined, RFI, Presolicitation
  ) {
    signals.push('Solicitation/PWS/SOW expected but no document attachments in SAM evidence');
  }

  // 3. Description mentions attachments/SOW but we don't have them
  if (
    description &&
    /\b(see attached|attached sow|attached pws|refer to|statement of work|performance work statement)\b/i.test(
      description
    ) &&
    !hasDocAttachments
  ) {
    signals.push('Description references attachments/SOW not available in current evidence');
  }

  // 4. Amendment indication without updated document
  if (
    description &&
    /\b(amendment|modification|revised|updated solicitation)\b/i.test(description) &&
    !attachments?.some((a) => a.name?.match(/amend|mod|rev/i))
  ) {
    signals.push('Amendment indicated but updated document not in current evidence');
  }

  return signals;
}

// ============================================================
// Document Selection (Deterministic — No LLM)
// ============================================================

/**
 * Deterministically select the best solicitation document.
 * Uses metadata signals only — no semantic/LLM analysis.
 */
export function selectBestDocument(
  documents: Array<{
    id: string;
    title: string;
    facts: Record<string, unknown>;
  }>
): { documentId: string; reason: string } | null {
  if (documents.length === 0) return null;

  const scored = documents
    .filter((doc) => {
      const readiness = doc.facts?.readiness;
      const textAvailable = doc.facts?.text_available;
      return readiness === 'completed' && textAvailable === 'yes';
    })
    .map((doc) => {
      const title = (doc.title || '').toLowerCase();
      let priority = 99;
      let matchedType = 'unknown';

      // Match document type from title
      for (const [pattern, p] of Object.entries(DOC_TYPE_PRIORITY)) {
        if (title.includes(pattern)) {
          if (p < priority) {
            priority = p;
            matchedType = pattern;
          }
        }
      }

      // Bonus for latest version
      const isLatest = doc.facts?.is_latest_version !== false;
      const versionBonus = isLatest ? 0 : 10;

      return {
        doc,
        score: priority + versionBonus,
        matchedType,
        isLatest,
      };
    })
    .sort((a, b) => a.score - b.score);

  if (scored.length === 0) return null;

  const best = scored[0];
  const reason =
    best.matchedType !== 'unknown'
      ? `Selected '${best.doc.title}': matches document type '${best.matchedType}'${best.isLatest ? ', latest version' : ', superseded version'}`
      : `Selected '${best.doc.title}': first readable document (no type match)`;

  return { documentId: best.doc.id, reason };
}

// ============================================================
// Chunk Selection (Deterministic — No LLM)
// ============================================================

/**
 * Select relevant chunks from extracted text using deterministic
 * keyword matching. Stays within context budget.
 */
export function selectRelevantChunks(
  fullText: string,
  maxBytes: number = MAX_TEXT_BYTES_FOR_CONTEXT
): MayaEnrichmentEvidence['evidenceChunks'] {
  // Split into paragraphs/sections
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 30);

  // Score each paragraph by relevance term hits
  const scored = paragraphs.map((text, index) => {
    const lower = text.toLowerCase();
    const matched = RELEVANCE_TERMS.filter((term) => lower.includes(term));
    return {
      text,
      index,
      relevanceTermsMatched: matched,
      score: matched.length,
      bytes: Buffer.byteLength(text, 'utf-8'),
    };
  });

  // Sort by relevance score descending, then by position
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  // Fill up to budget
  const selected: MayaEnrichmentEvidence['evidenceChunks'] = [];
  let totalBytes = 0;

  for (const chunk of scored) {
    if (totalBytes + chunk.bytes > maxBytes) {
      if (selected.length === 0) {
        // At least include a truncated version of the best chunk
        const truncated = chunk.text.substring(0, maxBytes);
        selected.push({
          text: truncated,
          pageNumber: null,
          section: null,
          relevanceTermsMatched: chunk.relevanceTermsMatched,
          sourceRef: `Paragraph ${chunk.index + 1} (truncated)`,
        });
      }
      break;
    }

    selected.push({
      text: chunk.text,
      pageNumber: null,
      section: null,
      relevanceTermsMatched: chunk.relevanceTermsMatched,
      sourceRef: `Paragraph ${chunk.index + 1}`,
    });
    totalBytes += chunk.bytes;
  }

  return selected;
}

// ============================================================
// Enrichment Executor
// ============================================================

/**
 * Execute bounded G2X enrichment for a Maya review task.
 *
 * This is the main entry point called from Maya's task processor.
 * Returns evidence package to be included in Maya's prompt.
 *
 * Guarantees:
 * - Max 6 G2X calls per review
 * - Max 2 documents retrieved
 * - Max ~6KB text for context
 * - No LLM calls
 * - G2X failure → returns UNAVAILABLE, Maya continues
 * - Uses only Maya-allowed tools
 */
export async function executeMayaEnrichment(
  opportunityId: string,
  solicitationNumber: string | null,
  totalScore: number,
  description: string | null,
  attachments: Array<{ name?: string; url?: string; type?: string }> | null,
  noticeType: string | null,
  taskId: string
): Promise<MayaEnrichmentEvidence> {
  const startTime = Date.now();
  let callsMade = 0;

  // 1. Check feature gate
  if (!isMayaG2XEnrichmentEnabled()) {
    return notEligible('MAYA_G2X_ENRICHMENT_ENABLED is not set', startTime);
  }

  // 2. Check G2X auth
  const auth = getG2XAuth();
  if (!auth.isAvailable()) {
    return unavailable('G2X authentication unavailable', startTime);
  }

  // 3. Evaluate enrichment eligibility
  const eligibility = evaluateEnrichmentEligibility(
    totalScore,
    description,
    attachments,
    noticeType
  );

  if (!eligibility.eligible) {
    return notEligible(eligibility.reason, startTime);
  }

  // 4. Check G2X enrichment observation window
  const windowCheck = await checkEnrichmentWindow(taskId);
  if (!windowCheck.allowed) {
    return unavailable(`G2X enrichment window: ${windowCheck.reason}`, startTime);
  }

  log.info(
    {
      opportunityId,
      score: totalScore,
      tier: eligibility.policyTier,
      signals: eligibility.incompletenessSignals,
    },
    'Maya G2X enrichment starting'
  );

  try {
    // 5. Get G2X opportunity record
    let g2xRecordId: string | null = null;

    if (solicitationNumber) {
      const searchResult = await callMayaTool(auth, 'g2x_search_supplementary', {
        query: solicitationNumber,
        page_size: 1,
      });
      callsMade++;

      if (searchResult && !isFailure(searchResult)) {
        const rows = extractRows(searchResult);
        if (rows.length > 0) {
          g2xRecordId = rows[0].id as string;
        }
      }
    }

    // If no match by solicitation number, can't proceed with documents
    if (!g2xRecordId) {
      return {
        status: 'NO_DOCUMENTS',
        g2xRecordId: null,
        sourceDocumentId: null,
        sourceDocumentVersionId: null,
        documentTitle: null,
        documentType: null,
        selectedDocumentReason: null,
        evidenceChunks: [],
        amendmentStatus: null,
        completeness: 'NONE',
        unavailableReason: 'G2X opportunity not found by solicitation number',
        usage: {
          g2xCallsMade: callsMade,
          documentsRetrieved: 0,
          textBytesRetrieved: 0,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
        },
      };
    }

    // 6. Get document inventory
    if (callsMade >= MAX_CALLS_PER_REVIEW) {
      return partial(
        'Call limit reached before document inventory',
        g2xRecordId,
        callsMade,
        startTime
      );
    }

    const docsResult = await callMayaTool(auth, 'g2x_opportunity_documents', {
      opportunity_id: g2xRecordId,
    });
    callsMade++;

    if (!docsResult || isFailure(docsResult)) {
      return unavailableWithRecord(
        'Document inventory retrieval failed',
        g2xRecordId,
        callsMade,
        startTime
      );
    }

    const docs = extractRows(docsResult);
    if (docs.length === 0) {
      return {
        status: 'NO_DOCUMENTS',
        g2xRecordId,
        sourceDocumentId: null,
        sourceDocumentVersionId: null,
        documentTitle: null,
        documentType: null,
        selectedDocumentReason: null,
        evidenceChunks: [],
        amendmentStatus: null,
        completeness: 'NONE',
        unavailableReason: 'No documents on file in G2X',
        usage: {
          g2xCallsMade: callsMade,
          documentsRetrieved: 0,
          textBytesRetrieved: 0,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
        },
      };
    }

    // 7. Select best document (deterministic)
    const selection = selectBestDocument(
      docs.map((d) => ({
        id: d.id as string,
        title: d.title as string,
        facts: (d.facts || {}) as Record<string, unknown>,
      }))
    );

    if (!selection) {
      return {
        status: 'NO_DOCUMENTS',
        g2xRecordId,
        sourceDocumentId: null,
        sourceDocumentVersionId: null,
        documentTitle: null,
        documentType: null,
        selectedDocumentReason: 'No readable documents with completed readiness',
        evidenceChunks: [],
        amendmentStatus: null,
        completeness: 'NONE',
        unavailableReason: 'No readable documents available',
        usage: {
          g2xCallsMade: callsMade,
          documentsRetrieved: 0,
          textBytesRetrieved: 0,
          latencyMs: Date.now() - startTime,
          cacheHit: false,
        },
      };
    }

    // 8. Retrieve attachment text
    if (callsMade >= MAX_CALLS_PER_REVIEW) {
      return partial('Call limit reached before text retrieval', g2xRecordId, callsMade, startTime);
    }

    const textResult = await callMayaTool(auth, 'g2x_opportunity_attachment_text', {
      opportunity_id: g2xRecordId,
      attachment_id: selection.documentId,
      format: 'markdown',
    });
    callsMade++;

    if (!textResult || isFailure(textResult)) {
      return unavailableWithRecord(
        'Document text retrieval failed',
        g2xRecordId,
        callsMade,
        startTime
      );
    }

    // Extract text from response
    const textContent = (textResult as MCPToolCallResponse).content?.find((c) => c.type === 'text');
    const fullText = textContent?.text || '';
    const textBytes = Buffer.byteLength(fullText, 'utf-8');

    // Get structured metadata
    const structured = (textResult as unknown as Record<string, unknown>).structuredContent as
      | Record<string, unknown>
      | undefined;
    const docTitle = (structured?.title || selection.documentId) as string;
    const sha256 = structured?.sha256 as string | undefined;
    const version = structured?.version as Record<string, unknown> | undefined;
    const isLatest = version?.is_latest_version !== false;

    // 9. Select relevant chunks (deterministic)
    const chunks = selectRelevantChunks(fullText);

    // 10. Record usage
    await recordEnrichmentUsage(
      opportunityId,
      taskId,
      g2xRecordId,
      callsMade,
      1,
      textBytes,
      Date.now() - startTime
    );

    log.info(
      {
        opportunityId,
        g2xRecordId,
        document: docTitle,
        chunks: chunks.length,
        textBytes,
        callsMade,
        latencyMs: Date.now() - startTime,
      },
      'Maya G2X enrichment complete'
    );

    return {
      status: 'ENRICHED',
      g2xRecordId,
      sourceDocumentId: selection.documentId,
      sourceDocumentVersionId: sha256 || null,
      documentTitle: docTitle,
      documentType: null,
      selectedDocumentReason: selection.reason,
      evidenceChunks: chunks,
      amendmentStatus: isLatest ? 'CURRENT' : 'SUPERSEDED',
      completeness: chunks.length > 0 ? 'FULL' : 'PARTIAL',
      unavailableReason: null,
      usage: {
        g2xCallsMade: callsMade,
        documentsRetrieved: 1,
        textBytesRetrieved: textBytes,
        latencyMs: Date.now() - startTime,
        cacheHit: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message, opportunityId }, 'Maya G2X enrichment failed');
    return unavailable(`Error: ${message}`, startTime, callsMade);
  }
}

/**
 * Format G2X evidence for Maya's prompt.
 * Evidence references solicitation document, NOT "G2X says".
 */
export function formatEvidenceForPrompt(evidence: MayaEnrichmentEvidence): string {
  if (evidence.status !== 'ENRICHED' || evidence.evidenceChunks.length === 0) {
    if (evidence.status === 'UNAVAILABLE') {
      return '\n[G2X solicitation enrichment unavailable — review with existing evidence only]';
    }
    return '';
  }

  const parts: string[] = [
    `\nSOLICITATION EVIDENCE (${evidence.documentTitle || 'document'}${evidence.amendmentStatus === 'CURRENT' ? ', current version' : ''}):`,
    `Selection: ${evidence.selectedDocumentReason || 'best available'}`,
    '',
  ];

  for (const chunk of evidence.evidenceChunks) {
    parts.push(chunk.text);
    if (chunk.relevanceTermsMatched.length > 0) {
      parts.push(`[${chunk.sourceRef}, terms: ${chunk.relevanceTermsMatched.join(', ')}]`);
    }
    parts.push('');
  }

  if (evidence.completeness === 'PARTIAL') {
    parts.push('[Additional sections not shown — review full solicitation for completeness]');
  }

  return parts.join('\n');
}

// ============================================================
// G2X Observation Window
// ============================================================

/**
 * Check and claim a slot in the G2X enrichment observation window.
 */
async function checkEnrichmentWindow(
  _taskId: string
): Promise<{ allowed: boolean; reason: string }> {
  try {
    const supabase = getSupabase();

    // Check if we have a g2x enrichment observation window
    const { data: window } = await supabase
      .from('g2x_enrichment_observation')
      .select('*')
      .eq('status', 'ACTIVE')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!window) {
      // No window = no limits (same pattern as Maya observation)
      return { allowed: true, reason: 'No active observation window' };
    }

    if (window.enrichments_completed >= window.max_enrichments) {
      return { allowed: false, reason: `Max enrichments reached (${window.max_enrichments})` };
    }
    if (window.total_g2x_calls >= window.max_total_calls) {
      return { allowed: false, reason: `Max G2X calls reached (${window.max_total_calls})` };
    }
    if (window.total_records >= window.max_total_records) {
      return { allowed: false, reason: `Max records reached (${window.max_total_records})` };
    }

    // Claim slot
    await supabase
      .from('g2x_enrichment_observation')
      .update({
        enrichments_completed: window.enrichments_completed + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', window.id);

    return { allowed: true, reason: 'Observation slot claimed' };
  } catch {
    // Error checking window = allow (same pattern as Maya observation)
    return { allowed: true, reason: 'Window check failed — allowing' };
  }
}

/**
 * Record enrichment usage in the observation window.
 */
async function recordEnrichmentUsage(
  opportunityId: string,
  taskId: string,
  g2xRecordId: string,
  callsMade: number,
  documentsRetrieved: number,
  textBytes: number,
  latencyMs: number
): Promise<void> {
  try {
    const supabase = getSupabase();

    // Update observation window totals
    const { data: window } = await supabase
      .from('g2x_enrichment_observation')
      .select('id, total_g2x_calls, total_records')
      .eq('status', 'ACTIVE')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (window) {
      await supabase
        .from('g2x_enrichment_observation')
        .update({
          total_g2x_calls: (window.total_g2x_calls || 0) + callsMade,
          total_records: (window.total_records || 0) + documentsRetrieved,
          updated_at: new Date().toISOString(),
        })
        .eq('id', window.id);
    }

    // Record in external usage ledger
    await supabase.from('external_usage_ledger').insert({
      request_id: `maya-enrichment-${taskId}`,
      timestamp: new Date().toISOString(),
      workflow_id: `maya-review-${opportunityId}`,
      agent_capability: 'maya',
      tool: 'maya_enrichment',
      query_hash: createHash('sha256')
        .update(`${opportunityId}:${g2xRecordId}`)
        .digest('hex')
        .slice(0, 16),
      records_returned: documentsRetrieved,
      records_billable_known: null,
      pages: 0,
      http_status: 200,
      latency_ms: latencyMs,
      retry_count: 0,
      source_record_ids: [g2xRecordId],
      document_bytes: textBytes,
      metered_ai_classification: 'NONE',
      estimated_monthly_consumption: null,
      success: true,
    });
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to record enrichment usage — non-blocking'
    );
  }
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Call a G2X tool through Maya's restricted allowlist.
 * Enforces tool boundary: only Maya-allowed tools permitted.
 */
async function callMayaTool(
  auth: G2XAuthAdapter,
  toolName: string,
  args: Record<string, unknown>
): Promise<MCPToolCallResponse | G2XFailure | null> {
  if (!MAYA_ALLOWED_TOOLS.has(toolName)) {
    log.error({ toolName }, 'Maya attempted to use non-allowed G2X tool — DENIED');
    return null;
  }

  try {
    return await callToolDirect(auth, { name: toolName, arguments: args });
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), toolName },
      'Maya G2X tool call failed'
    );
    return null;
  }
}

function isFailure(result: unknown): result is G2XFailure {
  return (
    result !== null &&
    typeof result === 'object' &&
    'type' in result &&
    'message' in result &&
    !('content' in result)
  );
}

function extractRows(response: MCPToolCallResponse): Array<Record<string, unknown>> {
  try {
    const structured = (response as unknown as Record<string, unknown>).structuredContent as
      | Record<string, unknown>
      | undefined;
    if (structured?.rows && Array.isArray(structured.rows)) {
      return structured.rows;
    }
    const textContent = response.content?.find((c) => c.type === 'text');
    if (textContent?.text) {
      const parsed = JSON.parse(textContent.text);
      return parsed.rows || parsed.results || parsed.data || (Array.isArray(parsed) ? parsed : []);
    }
  } catch {
    /* ignore parse errors */
  }
  return [];
}

function notEligible(reason: string, startTime: number): MayaEnrichmentEvidence {
  return {
    status: 'NOT_ELIGIBLE',
    g2xRecordId: null,
    sourceDocumentId: null,
    sourceDocumentVersionId: null,
    documentTitle: null,
    documentType: null,
    selectedDocumentReason: null,
    evidenceChunks: [],
    amendmentStatus: null,
    completeness: 'NONE',
    unavailableReason: reason,
    usage: {
      g2xCallsMade: 0,
      documentsRetrieved: 0,
      textBytesRetrieved: 0,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
    },
  };
}

function unavailable(
  reason: string,
  startTime: number,
  callsMade: number = 0
): MayaEnrichmentEvidence {
  return {
    status: 'UNAVAILABLE',
    g2xRecordId: null,
    sourceDocumentId: null,
    sourceDocumentVersionId: null,
    documentTitle: null,
    documentType: null,
    selectedDocumentReason: null,
    evidenceChunks: [],
    amendmentStatus: null,
    completeness: 'NONE',
    unavailableReason: reason,
    usage: {
      g2xCallsMade: callsMade,
      documentsRetrieved: 0,
      textBytesRetrieved: 0,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
    },
  };
}

function unavailableWithRecord(
  reason: string,
  g2xRecordId: string,
  callsMade: number,
  startTime: number
): MayaEnrichmentEvidence {
  return {
    status: 'UNAVAILABLE',
    g2xRecordId,
    sourceDocumentId: null,
    sourceDocumentVersionId: null,
    documentTitle: null,
    documentType: null,
    selectedDocumentReason: null,
    evidenceChunks: [],
    amendmentStatus: null,
    completeness: 'NONE',
    unavailableReason: reason,
    usage: {
      g2xCallsMade: callsMade,
      documentsRetrieved: 0,
      textBytesRetrieved: 0,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
    },
  };
}

function partial(
  reason: string,
  g2xRecordId: string,
  callsMade: number,
  startTime: number
): MayaEnrichmentEvidence {
  return {
    status: 'UNAVAILABLE',
    g2xRecordId,
    sourceDocumentId: null,
    sourceDocumentVersionId: null,
    documentTitle: null,
    documentType: null,
    selectedDocumentReason: null,
    evidenceChunks: [],
    amendmentStatus: null,
    completeness: 'PARTIAL',
    unavailableReason: reason,
    usage: {
      g2xCallsMade: callsMade,
      documentsRetrieved: 0,
      textBytesRetrieved: 0,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
    },
  };
}
