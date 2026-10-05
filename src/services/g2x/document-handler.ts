/**
 * G2X Document Handler
 *
 * Implements the document retrieval chain:
 *   opportunity → document inventory → selected attachment → extracted text
 *
 * Provenance model: G2X is the retrieval provider, NOT the source authority.
 * For solicitation requirements, provenance traces to:
 *   Solicitation Document Y → Version Z → Page/Section
 * NOT "G2X says requirement X".
 *
 * Version/amendment tracking: new versions do NOT overwrite prior evidence.
 * Superseded versions remain auditable.
 *
 * Checksum validation: where G2X provides document-part checksums,
 * they are validated. Failed checksum = incomplete/corrupt, not authoritative.
 *
 * Raw payload retention: bounded by MAX_RAW_PAYLOAD_BYTES and
 * MAX_ATTACHMENT_TEXT_BYTES. Reports size observations for benchmark.
 */

import { createHash } from 'crypto';
import { logger } from '../../lib/logger.js';
import { getSupabase } from '../../integrations/database/client.js';
import { assertCommissioningEnvironment } from '../../config/environment.js';
import type {
  DocumentProvenance,
  EvidenceProvenance,
  G2XAuthState,
  G2XFailure,
  MCPToolCallResponse,
  PayloadSizeObservation,
} from './types.js';
import { MAX_ATTACHMENT_TEXT_BYTES, MAX_RAW_PAYLOAD_BYTES } from './types.js';
import { callTool } from './mcp-client.js';

const log = logger.child({ service: 'G2XDocumentHandler' });

// ============================================================
// Document Inventory
// ============================================================

/**
 * Retrieve and persist document inventory for an opportunity.
 */
export async function retrieveDocumentInventory(
  auth: G2XAuthState,
  opportunityId: string,
  endpoint?: string
): Promise<{
  documents: DocumentProvenance[];
  sizeObservations: PayloadSizeObservation[];
  failure?: G2XFailure;
}> {
  const response = await callTool(
    auth,
    {
      name: 'list_opportunity_documents',
      arguments: { opportunityId },
    },
    endpoint
  );

  if ('type' in response && !('content' in response)) {
    return { documents: [], sizeObservations: [], failure: response as G2XFailure };
  }

  const mcpResponse = response as MCPToolCallResponse;
  const textContent = mcpResponse.content?.find((c) => c.type === 'text');
  if (!textContent?.text) {
    return { documents: [], sizeObservations: [] };
  }

  const sizeObservations: PayloadSizeObservation[] = [];
  const rawSize = Buffer.byteLength(textContent.text, 'utf-8');
  sizeObservations.push({
    recordType: 'document_inventory',
    sizeBytes: rawSize,
    exceedsLimit: rawSize > MAX_RAW_PAYLOAD_BYTES,
    storageStrategy: rawSize > MAX_RAW_PAYLOAD_BYTES ? 'TRUNCATED_WITH_HASH' : 'JSONB_INLINE',
  });

  try {
    const parsed = JSON.parse(textContent.text);
    const docs = Array.isArray(parsed) ? parsed : parsed.documents || parsed.data || [];

    const documents: DocumentProvenance[] = docs.map((doc: Record<string, unknown>) => ({
      providerOpportunityId: opportunityId,
      providerDocumentId: String(doc.id || doc.documentId || doc.document_id || ''),
      title: String(doc.title || doc.name || ''),
      filename: String(doc.filename || doc.file_name || doc.title || ''),
      documentType: (doc.type || doc.documentType || doc.document_type || null) as string | null,
      providerVersion: (doc.version || doc.versionId || null) as string | null,
      amendmentOf: (doc.amendmentOf || doc.amendment_of || null) as string | null,
      checksum: (doc.checksum || doc.hash || doc.md5 || null) as string | null,
      readiness: mapReadiness(doc.status || doc.readiness),
      retrievedAt: new Date().toISOString(),
    }));

    log.info({ opportunityId, documentCount: documents.length }, 'Document inventory retrieved');

    return { documents, sizeObservations };
  } catch (parseError) {
    log.error(
      { error: String(parseError), opportunityId },
      'Failed to parse document inventory response'
    );
    return { documents: [], sizeObservations };
  }
}

/**
 * Persist document inventory to Supabase.
 * New versions do NOT overwrite prior versions.
 */
export async function persistDocumentInventory(
  documents: DocumentProvenance[],
  opportunityId: string | null
): Promise<string[]> {
  assertCommissioningEnvironment();
  const supabase = getSupabase();
  const documentIds: string[] = [];

  for (const doc of documents) {
    // Upsert the document
    const { data: existingDoc } = await supabase
      .from('source_documents')
      .select('id, current_version_id')
      .eq('provider', 'g2x')
      .eq('provider_document_id', doc.providerDocumentId)
      .limit(1)
      .maybeSingle();

    let docId: string;

    if (existingDoc) {
      docId = existingDoc.id;
    } else {
      const { data: newDoc, error } = await supabase
        .from('source_documents')
        .insert({
          provider: 'g2x',
          provider_document_id: doc.providerDocumentId,
          opportunity_id: opportunityId,
          title: doc.title,
          filename: doc.filename,
          document_type: doc.documentType,
        })
        .select('id')
        .single();

      if (error || !newDoc) {
        log.error(
          { error: error?.message, documentId: doc.providerDocumentId },
          'Failed to insert source document'
        );
        continue;
      }
      docId = newDoc.id;
    }

    // Create version entry (never overwrites prior versions)
    const { data: version, error: versionError } = await supabase
      .from('source_document_versions')
      .insert({
        source_document_id: docId,
        provider_version: doc.providerVersion,
        checksum: doc.checksum,
        readiness: doc.readiness,
        amendment_of: null, // Resolved separately if amendment chain is known
        metadata: {
          filename: doc.filename,
          documentType: doc.documentType,
        },
      })
      .select('id')
      .single();

    if (versionError || !version) {
      log.error(
        { error: versionError?.message, documentId: doc.providerDocumentId },
        'Failed to insert document version'
      );
      continue;
    }

    // Supersede previous current version if exists
    if (existingDoc?.current_version_id && existingDoc.current_version_id !== version.id) {
      await supabase
        .from('source_document_versions')
        .update({ superseded_at: new Date().toISOString() })
        .eq('id', existingDoc.current_version_id);
    }

    // Update current version pointer
    await supabase
      .from('source_documents')
      .update({ current_version_id: version.id, updated_at: new Date().toISOString() })
      .eq('id', docId);

    documentIds.push(docId);
  }

  log.info(
    { persisted: documentIds.length, total: documents.length },
    'Document inventory persisted'
  );

  return documentIds;
}

// ============================================================
// Attachment Text Retrieval
// ============================================================

/**
 * Retrieve extracted text for a specific document attachment.
 * Validates checksums where provider supplies them.
 */
export async function retrieveAttachmentText(
  auth: G2XAuthState,
  documentId: string,
  endpoint?: string
): Promise<{
  text: string | null;
  provenance: Partial<EvidenceProvenance> | null;
  checksumValid: boolean | null;
  sizeObservation: PayloadSizeObservation | null;
  failure?: G2XFailure;
}> {
  const response = await callTool(
    auth,
    {
      name: 'get_document_text',
      arguments: { documentId },
    },
    endpoint
  );

  if ('type' in response && !('content' in response)) {
    return {
      text: null,
      provenance: null,
      checksumValid: null,
      sizeObservation: null,
      failure: response as G2XFailure,
    };
  }

  const mcpResponse = response as MCPToolCallResponse;
  const textContent = mcpResponse.content?.find((c) => c.type === 'text');
  if (!textContent?.text) {
    return {
      text: null,
      provenance: null,
      checksumValid: null,
      sizeObservation: null,
      failure: {
        type: 'DOCUMENT_NOT_READY',
        message: `No text content returned for document ${documentId}`,
        toolName: 'get_document_text',
      },
    };
  }

  // Parse response
  let text: string;
  let pageNumber: number | null = null;
  let section: string | null = null;
  let bbox: EvidenceProvenance['bbox'] = null;
  let providerChecksum: string | null = null;

  try {
    const parsed = JSON.parse(textContent.text);
    text = typeof parsed === 'string' ? parsed : parsed.text || parsed.content || '';
    pageNumber = parsed.page || parsed.pageNumber || null;
    section = parsed.section || null;
    bbox = parsed.bbox || null;
    providerChecksum = parsed.checksum || parsed.hash || null;
  } catch {
    // Raw text response
    text = textContent.text;
  }

  // Size observation
  const textBytes = Buffer.byteLength(text, 'utf-8');
  const sizeObservation: PayloadSizeObservation = {
    recordType: 'attachment_text',
    sizeBytes: textBytes,
    exceedsLimit: textBytes > MAX_ATTACHMENT_TEXT_BYTES,
    storageStrategy:
      textBytes > MAX_ATTACHMENT_TEXT_BYTES ? 'REQUIRES_OBJECT_STORAGE' : 'JSONB_INLINE',
  };

  // Truncate if exceeds limit (preserve hash reference)
  if (textBytes > MAX_ATTACHMENT_TEXT_BYTES) {
    log.warn(
      { documentId, sizeBytes: textBytes, limit: MAX_ATTACHMENT_TEXT_BYTES },
      'Attachment text exceeds size limit, truncating'
    );
    const truncatedBuffer = Buffer.from(text, 'utf-8').subarray(0, MAX_ATTACHMENT_TEXT_BYTES);
    text =
      truncatedBuffer.toString('utf-8') +
      '\n\n[TRUNCATED — original size: ' +
      textBytes +
      ' bytes]';
  }

  // Checksum validation
  let checksumValid: boolean | null = null;
  const contentHash = createHash('sha256').update(text).digest('hex');

  if (providerChecksum) {
    checksumValid = providerChecksum === contentHash;
    if (!checksumValid) {
      log.warn(
        {
          documentId,
          providerChecksum,
          computedHash: contentHash,
        },
        'Document checksum mismatch — marking as incomplete/corrupt'
      );
    }
  }

  const provenance: Partial<EvidenceProvenance> = {
    evidenceType: 'EXTRACTED_TEXT',
    pageNumber,
    section,
    bbox,
    contentHash,
    extractedAt: new Date().toISOString(),
  };

  return { text, provenance, checksumValid, sizeObservation };
}

/**
 * Persist extracted evidence to Supabase with full provenance.
 * G2X is recorded as the retrieval mechanism, NOT the author.
 */
export async function persistEvidence(
  sourceDocumentVersionId: string,
  text: string,
  provenance: Partial<EvidenceProvenance>,
  checksumValid: boolean | null
): Promise<string | null> {
  assertCommissioningEnvironment();

  // Do not persist if checksum validation failed
  if (checksumValid === false) {
    log.warn(
      { sourceDocumentVersionId },
      'Not persisting evidence with failed checksum — marked incomplete/corrupt'
    );
    return null;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('source_evidence')
    .insert({
      source_document_version_id: sourceDocumentVersionId,
      evidence_type: provenance.evidenceType || 'EXTRACTED_TEXT',
      content: text,
      page_number: provenance.pageNumber,
      section: provenance.section,
      bbox: provenance.bbox,
      content_hash: provenance.contentHash || '',
    })
    .select('id')
    .single();

  if (error || !data) {
    log.error({ error: error?.message, sourceDocumentVersionId }, 'Failed to persist evidence');
    return null;
  }

  log.info({ evidenceId: data.id, sourceDocumentVersionId }, 'Evidence persisted with provenance');

  return data.id;
}

// ============================================================
// Helpers
// ============================================================

function mapReadiness(status: unknown): 'READY' | 'PROCESSING' | 'NOT_AVAILABLE' | 'UNKNOWN' {
  if (typeof status !== 'string') return 'UNKNOWN';
  const s = status.toUpperCase();
  if (s === 'READY' || s === 'AVAILABLE' || s === 'COMPLETE') return 'READY';
  if (s === 'PROCESSING' || s === 'PENDING' || s === 'IN_PROGRESS') return 'PROCESSING';
  if (s === 'NOT_AVAILABLE' || s === 'UNAVAILABLE' || s === 'ERROR') return 'NOT_AVAILABLE';
  return 'UNKNOWN';
}

/**
 * Persist a raw external source record with bounded payload.
 */
export async function persistExternalSourceRecord(
  provider: string,
  dataset: string,
  providerRecordId: string,
  recordType: string,
  rawPayload: Record<string, unknown>,
  sourceUpdatedAt?: string
): Promise<string | null> {
  assertCommissioningEnvironment();

  const payloadStr = JSON.stringify(rawPayload);
  const payloadBytes = Buffer.byteLength(payloadStr, 'utf-8');
  const contentHash = createHash('sha256').update(payloadStr).digest('hex');

  // Bound the raw payload
  let storedPayload: Record<string, unknown>;
  if (payloadBytes > MAX_RAW_PAYLOAD_BYTES) {
    log.warn(
      { provider, providerRecordId, payloadBytes, limit: MAX_RAW_PAYLOAD_BYTES },
      'Raw payload exceeds size limit, storing truncated with hash'
    );
    storedPayload = {
      _truncated: true,
      _originalSizeBytes: payloadBytes,
      _contentHash: contentHash,
    };
  } else {
    storedPayload = rawPayload;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('external_source_records')
    .upsert(
      {
        provider,
        dataset,
        provider_record_id: providerRecordId,
        record_type: recordType,
        source_updated_at: sourceUpdatedAt || null,
        content_hash: contentHash,
        raw_payload: storedPayload,
        normalization_version: 1,
      },
      { onConflict: 'provider,dataset,provider_record_id,content_hash' }
    )
    .select('id')
    .single();

  if (error || !data) {
    log.error(
      { error: error?.message, provider, providerRecordId },
      'Failed to persist external source record'
    );
    return null;
  }

  return data.id;
}
