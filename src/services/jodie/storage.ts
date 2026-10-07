/**
 * Jodie Storage
 *
 * Supabase Storage integration for rendered proposal artifacts
 * (DOCX, PDF, XLSX). Manages upload, signed URL generation,
 * human-edited re-ingestion, and artifact metadata.
 *
 * Authority:
 *   Jodie MAY upload system-generated artifacts.
 *   Jodie MAY record human uploads for reconciliation.
 *   Jodie MAY generate short-lived signed URLs.
 *   Jodie MAY NOT delete artifacts.
 *   Jodie MAY NOT submit artifacts externally.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  ArtifactType,
  ProposalRenderedArtifact,
} from './types.js';

// ============================================================
// Constants
// ============================================================

/** Private storage bucket for proposal artifacts */
export const PROPOSAL_BUCKET = 'proposal-artifacts';

/** Default signed URL expiration (seconds) */
const DEFAULT_SIGNED_URL_EXPIRES_IN = 3600; // 1 hour

// ============================================================
// Operations
// ============================================================

/**
 * Upload a rendered artifact to Supabase Storage and create a metadata record.
 * Idempotent via content hash — same content won't create duplicate records.
 */
export async function uploadRenderedArtifact(
  supabase: SupabaseClient,
  workspaceId: string,
  artifactType: ArtifactType,
  fileBuffer: Buffer,
  contentHash: string
): Promise<string> {
  const idempotencyKey = `artifact:${workspaceId}:${artifactType}:${contentHash}`;

  // Check for existing artifact with same content
  const { data: existing } = await supabase
    .from('proposal_rendered_artifacts')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Determine version number
  const { count: existingCount } = await supabase
    .from('proposal_rendered_artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('artifact_type', artifactType);

  const versionNumber = (existingCount || 0) + 1;

  // Build storage path
  const extension = getExtension(artifactType);
  const storagePath = `${workspaceId}/${artifactType.toLowerCase()}/v${versionNumber}${extension}`;

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: getContentType(artifactType),
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`[Jodie] Failed to upload artifact to storage: ${uploadError.message}`);
  }

  // Create metadata record
  const { data, error } = await supabase
    .from('proposal_rendered_artifacts')
    .insert({
      proposal_workspace_id: workspaceId,
      artifact_type: artifactType,
      version_number: versionNumber,
      storage_bucket: PROPOSAL_BUCKET,
      storage_path: storagePath,
      content_hash: contentHash,
      file_size_bytes: fileBuffer.length,
      review_status: 'DRAFT',
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_rendered_artifacts')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to create artifact record: ${error.message}`);
  }

  return data.id;
}

/**
 * Generate a short-lived signed URL for a storage path.
 */
export async function getSignedUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresIn?: number
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .createSignedUrl(storagePath, expiresIn || DEFAULT_SIGNED_URL_EXPIRES_IN);

  if (error) {
    throw new Error(`[Jodie] Failed to generate signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Record a human-uploaded file version for an existing rendered artifact.
 * Creates a new file version and marks it RECONCILIATION_REQUIRED.
 */
export async function recordHumanUpload(
  supabase: SupabaseClient,
  renderedArtifactId: string,
  fileBuffer: Buffer,
  uploadedBy: string
): Promise<string> {
  // Get artifact info
  const { data: artifact } = await supabase
    .from('proposal_rendered_artifacts')
    .select('id, proposal_workspace_id, artifact_type, storage_path')
    .eq('id', renderedArtifactId)
    .single();

  if (!artifact) {
    throw new Error(`[Jodie] Rendered artifact ${renderedArtifactId} not found`);
  }

  // Determine file version number
  const { count: existingVersions } = await supabase
    .from('proposal_file_versions')
    .select('id', { count: 'exact', head: true })
    .eq('rendered_artifact_id', renderedArtifactId);

  const versionNumber = (existingVersions || 0) + 1;

  // Compute content hash
  const contentHash = simpleHash(fileBuffer.toString('base64').slice(0, 1000));

  // Build storage path for human edit
  const extension = getExtension(artifact.artifact_type);
  const storagePath = `${artifact.proposal_workspace_id}/${artifact.artifact_type.toLowerCase()}/human-v${versionNumber}${extension}`;

  const idempotencyKey = `fv:${renderedArtifactId}:human:${versionNumber}:${contentHash}`;

  // Check idempotency
  const { data: existing } = await supabase
    .from('proposal_file_versions')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from(PROPOSAL_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: getContentType(artifact.artifact_type),
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`[Jodie] Failed to upload human edit to storage: ${uploadError.message}`);
  }

  // Create file version record
  const { data, error } = await supabase
    .from('proposal_file_versions')
    .insert({
      rendered_artifact_id: renderedArtifactId,
      version_number: versionNumber,
      storage_path: storagePath,
      content_hash: contentHash,
      file_size_bytes: fileBuffer.length,
      upload_source: 'HUMAN_EDIT',
      uploaded_by: uploadedBy,
      reconciliation_status: 'RECONCILIATION_REQUIRED',
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_file_versions')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to create file version record: ${error.message}`);
  }

  return data.id;
}

/**
 * Get the latest rendered artifact for a workspace and artifact type,
 * including a signed URL.
 */
export async function getLatestArtifact(
  supabase: SupabaseClient,
  workspaceId: string,
  artifactType: ArtifactType
): Promise<(ProposalRenderedArtifact & { signedUrl: string }) | null> {
  const { data: artifact, error } = await supabase
    .from('proposal_rendered_artifacts')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .eq('artifact_type', artifactType)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[Jodie] Failed to get latest artifact: ${error.message}`);
  }

  if (!artifact) return null;

  const signedUrl = await getSignedUrl(supabase, artifact.storage_path);

  return { ...artifact, signedUrl } as ProposalRenderedArtifact & { signedUrl: string };
}

// ============================================================
// Helpers
// ============================================================

function getExtension(artifactType: ArtifactType): string {
  switch (artifactType) {
    case 'PROPOSAL_DOCX': return '.docx';
    case 'PROPOSAL_PDF': return '.pdf';
    case 'PRICING_XLSX': return '.xlsx';
    case 'ATTACHMENT': return '.pdf';
    case 'FORM': return '.pdf';
    case 'PACKAGE': return '.zip';
    default: return '.bin';
  }
}

function getContentType(artifactType: ArtifactType): string {
  switch (artifactType) {
    case 'PROPOSAL_DOCX': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'PROPOSAL_PDF': return 'application/pdf';
    case 'PRICING_XLSX': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ATTACHMENT': return 'application/pdf';
    case 'FORM': return 'application/pdf';
    case 'PACKAGE': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `sh-${Math.abs(hash).toString(36)}`;
}
