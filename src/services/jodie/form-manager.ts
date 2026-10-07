/**
 * Jodie Form Manager
 *
 * Manages form field mapping and deterministic value population.
 * Jodie proposes mappings from form fields to data sources;
 * humans approve mappings before values are populated.
 *
 * Authority:
 *   Jodie MAY propose mappings and populate values from approved sources.
 *   Jodie MAY NOT approve mappings — only humans may approve.
 *   Jodie MAY NOT fabricate form values.
 *   Jodie MAY NOT sign forms.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  ProposalFormValue,
} from './types.js';

// ============================================================
// Input Types
// ============================================================

export interface ProposeMappingInput {
  idempotencyKey: string;
  proposalWorkspaceId: string;
  formType: string;
  formVersion?: string;
  fieldIdentifier: string;
  targetDataPath: string;
}

// ============================================================
// Operations
// ============================================================

/**
 * Propose a form field mapping. Idempotent via
 * UNIQUE(proposal_workspace_id, form_type, field_identifier).
 * New mappings start with mapping_status=PROPOSED.
 */
export async function proposeMapping(
  supabase: SupabaseClient,
  input: ProposeMappingInput
): Promise<string> {
  // Check for existing mapping (idempotency via composite unique)
  const { data: existing } = await supabase
    .from('proposal_form_mappings')
    .select('id')
    .eq('proposal_workspace_id', input.proposalWorkspaceId)
    .eq('form_type', input.formType)
    .eq('field_identifier', input.fieldIdentifier)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from('proposal_form_mappings')
    .insert({
      proposal_workspace_id: input.proposalWorkspaceId,
      form_type: input.formType,
      form_version: input.formVersion || null,
      field_identifier: input.fieldIdentifier,
      target_data_path: input.targetDataPath,
      mapping_status: 'PROPOSED',
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_form_mappings')
        .select('id')
        .eq('proposal_workspace_id', input.proposalWorkspaceId)
        .eq('form_type', input.formType)
        .eq('field_identifier', input.fieldIdentifier)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to propose mapping: ${error.message}`);
  }

  return data.id;
}

/**
 * Approve a form field mapping. Only humans may approve.
 */
export async function approveMapping(
  supabase: SupabaseClient,
  mappingId: string,
  approvedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('proposal_form_mappings')
    .update({
      mapping_status: 'APPROVED',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', mappingId);

  if (error) {
    throw new Error(`[Jodie] Failed to approve mapping ${mappingId}: ${error.message}`);
  }
}

/**
 * Populate a form value from an approved mapping.
 * Resolves the value deterministically from approved evidence sources.
 * Only works for APPROVED mappings.
 */
export async function populateFormValue(
  supabase: SupabaseClient,
  mappingId: string,
  workspaceId: string
): Promise<string> {
  // Verify mapping is approved
  const { data: mapping } = await supabase
    .from('proposal_form_mappings')
    .select('id, mapping_status, target_data_path')
    .eq('id', mappingId)
    .single();

  if (!mapping) {
    throw new Error(`[Jodie] Mapping ${mappingId} not found`);
  }

  if (mapping.mapping_status !== 'APPROVED') {
    throw new Error(`[Jodie] Mapping ${mappingId} is not approved (status: ${mapping.mapping_status})`);
  }

  // Look up evidence by target_data_path
  const { data: evidence } = await supabase
    .from('proposal_evidence_items')
    .select('id, value')
    .eq('proposal_workspace_id', workspaceId)
    .eq('proposal_usable', true)
    .limit(1)
    .maybeSingle();

  const idempotencyKey = `fv:${mappingId}:${workspaceId}`;

  // Check for existing form value (idempotency)
  const { data: existingValue } = await supabase
    .from('proposal_form_values')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingValue) {
    return existingValue.id;
  }

  const resolutionStatus = evidence ? 'RESOLVED' : 'HUMAN_INPUT_REQUIRED';
  const resolvedValue = evidence ? evidence.value : null;

  const { data, error } = await supabase
    .from('proposal_form_values')
    .insert({
      proposal_workspace_id: workspaceId,
      form_mapping_id: mappingId,
      resolved_value: resolvedValue,
      resolution_status: resolutionStatus,
      source_evidence_id: evidence?.id || null,
      idempotency_key: idempotencyKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raceExisting } = await supabase
        .from('proposal_form_values')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .single();
      return raceExisting.id;
    }
    throw new Error(`[Jodie] Failed to populate form value: ${error.message}`);
  }

  return data.id;
}

/**
 * Get all unresolved form values (HUMAN_INPUT_REQUIRED) for a workspace.
 * These are submission blockers in the PRODUCTION gate.
 */
export async function getUnresolvedFormValues(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ProposalFormValue[]> {
  const { data, error } = await supabase
    .from('proposal_form_values')
    .select('*')
    .eq('proposal_workspace_id', workspaceId)
    .eq('resolution_status', 'HUMAN_INPUT_REQUIRED')
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`[Jodie] Failed to get unresolved form values for workspace ${workspaceId}: ${error.message}`);
  }

  return (data || []) as ProposalFormValue[];
}
