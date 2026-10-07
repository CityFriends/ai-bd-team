/**
 * Jodie Section Manager
 *
 * Manages proposal section lifecycle: creation, versioning, locking,
 * staleness, pass counting, and approval. Sections are versioned with
 * immutable content history. Locks prevent concurrent edits.
 *
 * Authority:
 *   Jodie MAY create sections, versions, and manage lifecycle state.
 *   Jodie MAY NOT revise locked sections.
 *   Jodie MAY NOT exceed MAX_AUTONOMOUS_PASSES (2) without human review.
 *   Jodie MAY NOT approve sections — only humans may approve.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  AuthorType,
  ReviewRole,
  ProposalSection,
} from './types.js';
import { MAX_AUTONOMOUS_PASSES } from './types.js';

// ============================================================
// Input Types
// ============================================================

export interface CreateSectionInput {
  idempotencyKey: string;
  proposalWorkspaceId: string;
  sectionKey: string;
  title: string;
  requirementRefs?: string[];
  owner?: string;
  maxPages?: number;
  maxWords?: number;
}

// ============================================================
// Section CRUD
// ============================================================

/**
 * Create a section idempotently via UNIQUE(proposal_workspace_id, section_key).
 * Returns the section ID.
 */
export async function createSection(
  supabase: SupabaseClient,
  input: CreateSectionInput
): Promise<string> {
  // Check for existing record (idempotency via workspace+sectionKey)
  const { data: existing } = await supabase
    .from('proposal_sections')
    .select('id')
    .eq('proposal_workspace_id', input.proposalWorkspaceId)
    .eq('section_key', input.sectionKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from('proposal_sections')
    .insert({
      proposal_workspace_id: input.proposalWorkspaceId,
      section_key: input.sectionKey,
      title: input.title,
      requirement_refs: input.requirementRefs || [],
      owner: input.owner || null,
      max_pages: input.maxPages || null,
      max_words: input.maxWords || null,
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_sections')
        .select('id')
        .eq('proposal_workspace_id', input.proposalWorkspaceId)
        .eq('section_key', input.sectionKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to create section: ${error.message}`);
  }

  return data.id;
}

// ============================================================
// Section Versioning
// ============================================================

/**
 * Create an immutable section version and update the section's current_version_id.
 * Calculates version_number from the previous version count.
 */
export async function createSectionVersion(
  supabase: SupabaseClient,
  sectionId: string,
  content: string,
  evidenceRefs: string[],
  authorType: AuthorType,
  authorId?: string
): Promise<string> {
  // Get current version info
  const { data: section } = await supabase
    .from('proposal_sections')
    .select('current_version_id')
    .eq('id', sectionId)
    .single();

  if (!section) {
    throw new Error(`[Jodie] Section ${sectionId} not found`);
  }

  // Count existing versions to determine version_number
  const { count } = await supabase
    .from('proposal_section_versions')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', sectionId);

  const versionNumber = (count || 0) + 1;

  // Compute simple content hash
  const contentHash = simpleHash(content);
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  // Insert immutable version
  const { data: version, error: versionError } = await supabase
    .from('proposal_section_versions')
    .insert({
      section_id: sectionId,
      version_number: versionNumber,
      previous_version_id: section.current_version_id || null,
      content,
      content_hash: contentHash,
      evidence_refs: evidenceRefs,
      requirement_coverage: [],
      upstream_artifact_versions: {},
      author_type: authorType,
      author_id: authorId || null,
      word_count: wordCount,
    })
    .select('id')
    .single();

  if (versionError) {
    throw new Error(`[Jodie] Failed to create section version: ${versionError.message}`);
  }

  // Update section to point to new version
  const { error: updateError } = await supabase
    .from('proposal_sections')
    .update({
      current_version_id: version.id,
      status: 'DRAFTED',
      stale: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sectionId);

  if (updateError) {
    throw new Error(`[Jodie] Failed to update section current_version_id: ${updateError.message}`);
  }

  return version.id;
}

// ============================================================
// Locking
// ============================================================

/**
 * Lock a section to prevent concurrent edits.
 */
export async function lockSection(
  supabase: SupabaseClient,
  sectionId: string,
  lockedBy: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('proposal_sections')
    .update({
      locked: true,
      locked_by: lockedBy,
      locked_at: new Date().toISOString(),
      lock_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sectionId);

  if (error) {
    throw new Error(`[Jodie] Failed to lock section ${sectionId}: ${error.message}`);
  }
}

/**
 * Unlock a section.
 */
export async function unlockSection(
  supabase: SupabaseClient,
  sectionId: string
): Promise<void> {
  const { error } = await supabase
    .from('proposal_sections')
    .update({
      locked: false,
      locked_by: null,
      locked_at: null,
      lock_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sectionId);

  if (error) {
    throw new Error(`[Jodie] Failed to unlock section ${sectionId}: ${error.message}`);
  }
}

// ============================================================
// Staleness
// ============================================================

/**
 * Mark a section as stale (e.g., due to upstream input change).
 * Preserves lock state — a locked stale section stays locked.
 */
export async function markStale(
  supabase: SupabaseClient,
  sectionId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase
    .from('proposal_sections')
    .update({
      stale: true,
      status: 'REVISION_REQUIRED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sectionId);

  if (error) {
    throw new Error(`[Jodie] Failed to mark section ${sectionId} stale (${reason}): ${error.message}`);
  }
}

// ============================================================
// Pass Count / Autonomous Revision Gate
// ============================================================

/**
 * Check if Jodie may autonomously revise this section.
 * Requires: not locked AND pass_count < MAX_AUTONOMOUS_PASSES.
 */
export async function canJodieRevise(
  supabase: SupabaseClient,
  sectionId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('proposal_sections')
    .select('locked, pass_count')
    .eq('id', sectionId)
    .single();

  if (error || !data) return false;

  return data.locked !== true && data.pass_count < MAX_AUTONOMOUS_PASSES;
}

/**
 * Increment the pass count for a section after an autonomous revision.
 */
export async function incrementPassCount(
  supabase: SupabaseClient,
  sectionId: string
): Promise<void> {
  // Use raw SQL increment to avoid race conditions
  const { error } = await supabase.rpc('increment_field', {
    table_name: 'proposal_sections',
    field_name: 'pass_count',
    row_id: sectionId,
  });

  // Fallback: if RPC doesn't exist, do read-then-write
  if (error) {
    const { data: section } = await supabase
      .from('proposal_sections')
      .select('pass_count')
      .eq('id', sectionId)
      .single();

    if (section) {
      await supabase
        .from('proposal_sections')
        .update({
          pass_count: section.pass_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sectionId);
    }
  }
}

// ============================================================
// Approval
// ============================================================

/**
 * Approve a section — creates a review record and sets section status to APPROVED.
 * Only humans may approve. Jodie calls this on behalf of a human reviewer.
 */
export async function approveSection(
  supabase: SupabaseClient,
  sectionId: string,
  reviewer: string,
  reviewRole: ReviewRole
): Promise<string> {
  // Get section with current version
  const { data: section } = await supabase
    .from('proposal_sections')
    .select('id, proposal_workspace_id, current_version_id')
    .eq('id', sectionId)
    .single();

  if (!section) {
    throw new Error(`[Jodie] Section ${sectionId} not found for approval`);
  }

  const idempotencyKey = `review:${sectionId}:${reviewer}:${section.current_version_id}`;

  // Create review record (idempotent)
  const { data: existingReview } = await supabase
    .from('proposal_reviews')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingReview) {
    return existingReview.id;
  }

  const { data: review, error: reviewError } = await supabase
    .from('proposal_reviews')
    .insert({
      proposal_workspace_id: section.proposal_workspace_id,
      target_type: 'SECTION',
      target_id: sectionId,
      target_version_id: section.current_version_id,
      review_role: reviewRole,
      reviewer,
      status: 'APPROVED',
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (reviewError) {
    if (reviewError.code === '23505') {
      const { data: raceReview } = await supabase
        .from('proposal_reviews')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();
      return raceReview.id;
    }
    throw new Error(`[Jodie] Failed to create approval review: ${reviewError.message}`);
  }

  // Update section status to APPROVED
  await supabase
    .from('proposal_sections')
    .update({
      status: 'APPROVED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sectionId);

  return review.id;
}

/**
 * Invalidate an existing approval on a section (e.g., after material change).
 */
export async function invalidateApproval(
  supabase: SupabaseClient,
  sectionId: string,
  reason: string
): Promise<void> {
  const now = new Date().toISOString();

  // Invalidate all active approvals for this section
  const { error } = await supabase
    .from('proposal_reviews')
    .update({
      status: 'INVALIDATED',
      invalidated_at: now,
      invalidation_reason: reason,
      updated_at: now,
    })
    .eq('target_type', 'SECTION')
    .eq('target_id', sectionId)
    .eq('status', 'APPROVED');

  if (error) {
    throw new Error(`[Jodie] Failed to invalidate approvals for section ${sectionId}: ${error.message}`);
  }

  // Set section status to REVISION_REQUIRED
  await supabase
    .from('proposal_sections')
    .update({
      status: 'REVISION_REQUIRED',
      updated_at: now,
    })
    .eq('id', sectionId);
}

// ============================================================
// Query
// ============================================================

/**
 * Get all sections for a workspace.
 */
export async function getSections(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ProposalSection[]> {
  const { data, error } = await supabase
    .from('proposal_sections')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[Jodie] Failed to get sections for workspace ${workspaceId}: ${error.message}`);
  }

  return (data || []) as ProposalSection[];
}

// ============================================================
// Helpers
// ============================================================

/**
 * Simple deterministic hash for content deduplication.
 * Not cryptographic — used only for change detection.
 */
function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `sh-${Math.abs(hash).toString(36)}`;
}
