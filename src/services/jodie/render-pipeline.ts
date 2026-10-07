/**
 * Jodie Render Pipeline
 *
 * Orchestrates: structured proposal → DOCX + PDF → validation → Storage upload → metadata.
 *
 * Pipeline:
 *   Structured proposal → approved template → DOCX/PDF render
 *   → deterministic validation → private Supabase Storage
 *   → rendered artifact record → signed link generation
 *
 * Rendered files are NOT the source of truth — structured Postgres state is.
 */

import { renderDocx, DEFAULT_TEMPLATE } from './docx-renderer.js';
import type { StructuredProposalContent, ProposalTemplate, RenderResult } from './docx-renderer.js';
import { renderPdf } from './pdf-renderer.js';
import type { PdfRenderResult } from './pdf-renderer.js';
import type { SupabaseClient } from './types.js';

// ============================================================
// RENDER PIPELINE RESULT
// ============================================================

export interface RenderPipelineResult {
  docx: {
    storagePath: string;
    contentHash: string;
    sizeBytes: number;
    artifactId: string;
    signedUrl?: string;
  };
  pdf: {
    storagePath: string;
    contentHash: string;
    sizeBytes: number;
    pageCount: number;
    artifactId: string;
    signedUrl?: string;
  };
  validation: ValidationResult;
  metadata: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  docxChecks: ValidationCheck[];
  pdfChecks: ValidationCheck[];
}

export interface ValidationCheck {
  check: string;
  passed: boolean;
  detail?: string;
}

// ============================================================
// RENDER PIPELINE
// ============================================================

/**
 * Execute the full render pipeline:
 * 1. Render DOCX from structured content
 * 2. Render PDF from structured content
 * 3. Validate both artifacts
 * 4. Upload to private Supabase Storage
 * 5. Create artifact metadata records
 * 6. Generate signed URLs
 */
export async function executeRenderPipeline(
  supabase: SupabaseClient,
  content: StructuredProposalContent,
  template: ProposalTemplate = DEFAULT_TEMPLATE,
  signedUrlExpiry: number = 3600 // 1 hour default
): Promise<RenderPipelineResult> {
  const basePath = `proposals/${content.workspaceId}/${content.proposalVersion}`;

  // Step 1: Render DOCX
  const docxResult = await renderDocx(content, template);

  // Step 2: Render PDF
  const pdfResult = await renderPdf(content, template);

  // Step 3: Validate
  const validation = validateRenderResults(docxResult, pdfResult, content, template);
  if (!validation.valid) {
    throw new Error(`[Jodie] Render validation failed: ${validation.docxChecks.concat(validation.pdfChecks).filter(c => !c.passed).map(c => c.detail).join('; ')}`);
  }

  // Step 4: Upload to Storage
  const docxPath = `${basePath}/proposal.docx`;
  const pdfPath = `${basePath}/proposal.pdf`;

  await uploadToStorage(supabase, docxPath, docxResult.buffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  await uploadToStorage(supabase, pdfPath, pdfResult.buffer, 'application/pdf');

  // Step 5: Create artifact metadata records
  const docxArtifactId = await createArtifactRecord(supabase, {
    proposalWorkspaceId: content.workspaceId,
    artifactType: 'PROPOSAL_DOCX',
    storagePath: docxPath,
    contentHash: docxResult.contentHash,
    fileSizeBytes: docxResult.buffer.length,
    sourceProposalVersion: content.proposalVersion,
    templateVersion: template.templateVersion,
    solicitationVersion: content.solicitationVersion,
    amendmentVersion: content.amendmentVersion,
  });

  const pdfArtifactId = await createArtifactRecord(supabase, {
    proposalWorkspaceId: content.workspaceId,
    artifactType: 'PROPOSAL_PDF',
    storagePath: pdfPath,
    contentHash: pdfResult.contentHash,
    fileSizeBytes: pdfResult.buffer.length,
    sourceProposalVersion: content.proposalVersion,
    templateVersion: template.templateVersion,
    solicitationVersion: content.solicitationVersion,
    amendmentVersion: content.amendmentVersion,
  });

  // Step 6: Generate signed URLs
  const docxSignedUrl = await getSignedUrl(supabase, docxPath, signedUrlExpiry);
  const pdfSignedUrl = await getSignedUrl(supabase, pdfPath, signedUrlExpiry);

  return {
    docx: {
      storagePath: docxPath,
      contentHash: docxResult.contentHash,
      sizeBytes: docxResult.buffer.length,
      artifactId: docxArtifactId,
      signedUrl: docxSignedUrl,
    },
    pdf: {
      storagePath: pdfPath,
      contentHash: pdfResult.contentHash,
      sizeBytes: pdfResult.buffer.length,
      pageCount: pdfResult.pageCount,
      artifactId: pdfArtifactId,
      signedUrl: pdfSignedUrl,
    },
    validation,
    metadata: {
      ...docxResult.metadata,
      templateId: template.templateId,
      templateVersion: template.templateVersion,
    },
  };
}

// ============================================================
// VALIDATION
// ============================================================

function validateRenderResults(
  docx: RenderResult,
  pdf: PdfRenderResult,
  content: StructuredProposalContent,
  template: ProposalTemplate
): ValidationResult {
  const docxChecks: ValidationCheck[] = [];
  const pdfChecks: ValidationCheck[] = [];

  // DOCX checks
  docxChecks.push({
    check: 'DOCX nonzero size',
    passed: docx.buffer.length > 0,
    detail: `Size: ${docx.buffer.length} bytes`,
  });

  docxChecks.push({
    check: 'DOCX has content hash',
    passed: docx.contentHash.length === 64,
    detail: docx.contentHash,
  });

  docxChecks.push({
    check: 'DOCX section count matches',
    passed: docx.sectionCount === content.sections.length,
    detail: `Expected ${content.sections.length}, got ${docx.sectionCount}`,
  });

  docxChecks.push({
    check: 'DOCX has valid OOXML header',
    passed: docx.buffer[0] === 0x50 && docx.buffer[1] === 0x4B, // PK zip header
    detail: `First bytes: ${docx.buffer[0]?.toString(16)} ${docx.buffer[1]?.toString(16)}`,
  });

  docxChecks.push({
    check: 'DOCX template metadata',
    passed: docx.templateId === template.templateId,
    detail: `Template: ${docx.templateId} v${docx.templateVersion}`,
  });

  // PDF checks
  pdfChecks.push({
    check: 'PDF nonzero size',
    passed: pdf.buffer.length > 0,
    detail: `Size: ${pdf.buffer.length} bytes`,
  });

  pdfChecks.push({
    check: 'PDF has content hash',
    passed: pdf.contentHash.length === 64,
    detail: pdf.contentHash,
  });

  pdfChecks.push({
    check: 'PDF page count > 0',
    passed: pdf.pageCount > 0,
    detail: `Pages: ${pdf.pageCount}`,
  });

  pdfChecks.push({
    check: 'PDF has valid header',
    passed: pdf.buffer.slice(0, 5).toString() === '%PDF-',
    detail: `First bytes: ${pdf.buffer.slice(0, 5).toString()}`,
  });

  pdfChecks.push({
    check: 'PDF section count matches',
    passed: pdf.sectionCount === content.sections.length,
    detail: `Expected ${content.sections.length}, got ${pdf.sectionCount}`,
  });

  // Page limit check (if configured)
  if (template.maxPages) {
    pdfChecks.push({
      check: 'PDF within page limit',
      passed: pdf.pageCount <= template.maxPages,
      detail: `Pages: ${pdf.pageCount}, limit: ${template.maxPages}`,
    });
  }

  const allPassed = [...docxChecks, ...pdfChecks].every(c => c.passed);
  return { valid: allPassed, docxChecks, pdfChecks };
}

// ============================================================
// STORAGE HELPERS
// ============================================================

const PROPOSAL_BUCKET = 'proposal-artifacts';

async function uploadToStorage(
  supabase: SupabaseClient,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true, // Allow re-render of same version
    });

  if (error) {
    throw new Error(`[Jodie] Storage upload failed for ${path}: ${error.message}`);
  }
}

async function getSignedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresIn: number
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    console.error(`[Jodie] Signed URL generation failed for ${path}:`, error?.message);
    return '';
  }

  return data.signedUrl;
}

async function createArtifactRecord(
  supabase: SupabaseClient,
  input: {
    proposalWorkspaceId: string;
    artifactType: string;
    storagePath: string;
    contentHash: string;
    fileSizeBytes: number;
    sourceProposalVersion?: string;
    templateVersion?: string;
    solicitationVersion?: string;
    amendmentVersion?: number;
  }
): Promise<string> {
  const idempotencyKey = `render-${input.proposalWorkspaceId}-${input.artifactType}-${input.contentHash.slice(0, 16)}`;

  const { data, error } = await supabase
    .from('proposal_rendered_artifacts')
    .upsert({
      proposal_workspace_id: input.proposalWorkspaceId,
      artifact_type: input.artifactType,
      storage_path: input.storagePath,
      content_hash: input.contentHash,
      file_size_bytes: input.fileSizeBytes,
      source_proposal_version: input.sourceProposalVersion,
      template_version: input.templateVersion,
      solicitation_version: input.solicitationVersion,
      amendment_version: input.amendmentVersion,
      idempotency_key: idempotencyKey,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    .select('id');

  if (error && !error.message?.includes('duplicate')) {
    throw new Error(`[Jodie] Artifact record failed: ${error.message}`);
  }

  if (data?.[0]) return data[0].id;

  // Fetch existing
  const { data: existing } = await supabase
    .from('proposal_rendered_artifacts')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .single();

  return existing?.id || '';
}

// ============================================================
// SLACK PAYLOAD
// ============================================================

export interface JodieSlackPayload {
  text: string;
  blocks: Array<{
    type: string;
    text?: { type: string; text: string };
    elements?: Array<{ type: string; text?: { type: string; text: string }; url?: string; action_id?: string }>;
  }>;
}

/**
 * Generate Slack payload for proposal ready notification.
 * Does NOT post — only builds the payload.
 */
export function generateProposalReadyPayload(
  opportunity: string,
  version: string,
  complianceStatus: string,
  unresolvedItems: number,
  docxUrl: string,
  pdfUrl: string
): JodieSlackPayload {
  const text = [
    `*JODIE — Draft Proposal Ready*`,
    '',
    `*Opportunity:* ${opportunity}`,
    `*Proposal Version:* ${version}`,
    `*Compliance:* ${complianceStatus}`,
    `*Unresolved Items:* ${unresolvedItems}`,
  ].join('\n');

  return {
    text,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📝 JODIE — Draft Proposal Ready' } },
      { type: 'section', text: { type: 'mrkdwn', text } },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Open DOCX' }, url: docxUrl },
          { type: 'button', text: { type: 'plain_text', text: 'Open PDF' }, url: pdfUrl },
          { type: 'button', text: { type: 'plain_text', text: 'View Readiness' }, action_id: 'jodie_view_readiness' },
        ],
      },
    ],
  };
}

/**
 * Validate page limit from PDF render result.
 */
export function validatePageLimit(
  pageCount: number,
  maxPages: number | undefined
): { withinLimit: boolean; pages: number; limit: number | null } {
  if (!maxPages) return { withinLimit: true, pages: pageCount, limit: null };
  return {
    withinLimit: pageCount <= maxPages,
    pages: pageCount,
    limit: maxPages,
  };
}
