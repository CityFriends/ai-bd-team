/**
 * Jodie Amendment Handler
 *
 * Processes solicitation amendments — classifies change impact,
 * marks affected sections stale, invalidates approvals, and
 * escalates material-global changes for capture reassessment.
 *
 * Authority:
 *   Jodie MAY classify amendment impact and mark sections stale.
 *   Jodie MAY invalidate approvals on affected sections.
 *   Jodie MAY NOT make GO/NO_GO decisions based on amendments.
 *   Jodie MAY NOT suppress material-global escalation.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  ChangeClass,
  AmendmentStatus,
} from './types.js';
import { markStale, invalidateApproval } from './section-manager.js';

// ============================================================
// Input Types
// ============================================================

export interface ProcessAmendmentInput {
  idempotencyKey: string;
  amendmentVersion: number;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  description: string;
  affectedRequirementIds: string[];
  affectedSectionIds: string[];
  impactAssessment?: Record<string, unknown>;
}

// ============================================================
// Operations
// ============================================================

/**
 * Process an amendment: classify change, mark affected sections stale,
 * invalidate approvals, and persist the impact record.
 *
 * For MATERIAL_GLOBAL changes, sets status to CAPTURE_REASSESSMENT_REQUIRED.
 */
export async function processAmendment(
  supabase: SupabaseClient,
  workspaceId: string,
  input: ProcessAmendmentInput
): Promise<string> {
  // Check for existing record (idempotency)
  const { data: existing } = await supabase
    .from('proposal_amendment_impacts')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // Classify the change
  const changeClass = classifyChange(input.affectedRequirementIds);

  // Determine status based on classification
  let status: AmendmentStatus = 'PROCESSED';
  if (changeClass === 'MATERIAL_GLOBAL') {
    status = 'CAPTURE_REASSESSMENT_REQUIRED';
  }

  // Persist the amendment impact record
  const { data, error } = await supabase
    .from('proposal_amendment_impacts')
    .insert({
      proposal_workspace_id: workspaceId,
      amendment_version: input.amendmentVersion,
      source_document_id: input.sourceDocumentId || null,
      source_version_id: input.sourceVersionId || null,
      change_class: changeClass,
      affected_requirement_ids: input.affectedRequirementIds,
      affected_section_ids: input.affectedSectionIds,
      description: input.description,
      impact_assessment: input.impactAssessment || {},
      status,
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_amendment_impacts')
        .select('id')
        .eq('idempotency_key', input.idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to process amendment: ${error.message}`);
  }

  // Mark affected sections stale and invalidate approvals
  if (input.affectedSectionIds.length > 0) {
    await markAffectedSectionsStale(
      supabase,
      workspaceId,
      input.affectedSectionIds
    );
  }

  return data.id;
}

/**
 * Classify change impact based on affected requirements.
 *
 * NON_MATERIAL   — zero affected requirements (administrative only)
 * MATERIAL_LOCAL — 1-3 affected requirements (scoped impact)
 * MATERIAL_GLOBAL — 4+ affected requirements (broad impact, capture reassessment)
 */
export function classifyChange(affectedRequirementIds: string[]): ChangeClass {
  const count = affectedRequirementIds.length;

  if (count === 0) return 'NON_MATERIAL';
  if (count <= 3) return 'MATERIAL_LOCAL';
  return 'MATERIAL_GLOBAL';
}

/**
 * Mark affected sections as stale and invalidate their approvals.
 */
export async function markAffectedSectionsStale(
  supabase: SupabaseClient,
  _workspaceId: string,
  sectionIds: string[]
): Promise<void> {
  for (const sectionId of sectionIds) {
    // Mark stale
    await markStale(supabase, sectionId, 'Amendment impact — upstream change');

    // Invalidate any existing approvals
    await invalidateApproval(
      supabase,
      sectionId,
      'Amendment impact — material change invalidates prior approval'
    );
  }
}
