/**
 * Jodie Readiness Gate
 *
 * Deterministic submission checklist evaluator. Evaluates ALL gates
 * (COMPLIANCE, EVIDENCE, PRODUCTION) and returns a structured result
 * with pass/fail and specific blockers.
 *
 * This is the authoritative READY_TO_SUBMIT gate. No proposal may
 * be submitted until all blocking checks pass.
 *
 * Authority:
 *   Jodie MAY evaluate and persist readiness checklists.
 *   Jodie MAY NOT waive blocking checks.
 *   Jodie MAY NOT submit proposals externally.
 *
 * Zero LLM calls. Zero provider imports. Zero G2X imports.
 */

import type {
  SupabaseClient,
  GateType,
  CheckStatus,
  ReadinessBlocker,
  ReadinessResult,
} from './types.js';

// ============================================================
// Core Gate Evaluation
// ============================================================

/**
 * Evaluate all readiness gates deterministically.
 * Returns structured result with blockers for each failing check.
 */
export async function evaluateReadiness(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ReadinessResult> {
  const blockers: ReadinessBlocker[] = [];

  // ---- COMPLIANCE GATE ----
  await evaluateComplianceGate(supabase, workspaceId, blockers);

  // ---- EVIDENCE GATE ----
  await evaluateEvidenceGate(supabase, workspaceId, blockers);

  // ---- PRODUCTION GATE ----
  await evaluateProductionGate(supabase, workspaceId, blockers);

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

/**
 * Convenience boolean: is the workspace ready to submit?
 */
export async function isReadyToSubmit(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<boolean> {
  const result = await evaluateReadiness(supabase, workspaceId);
  return result.ready;
}

/**
 * Persist the readiness checklist to proposal_submission_checklist.
 * Upserts each check by (proposal_workspace_id, check_id).
 */
export async function persistChecklist(
  supabase: SupabaseClient,
  workspaceId: string,
  result: ReadinessResult
): Promise<void> {
  const now = new Date().toISOString();
  const checks = buildChecklistItems(result);

  for (const check of checks) {
    const idempotencyKey = `checklist:${workspaceId}:${check.checkId}`;

    const { data: existing } = await supabase
      .from('proposal_submission_checklist')
      .select('id')
      .eq('proposal_workspace_id', workspaceId)
      .eq('check_id', check.checkId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('proposal_submission_checklist')
        .update({
          status: check.status,
          evidence: check.evidence,
          last_evaluated_at: now,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('proposal_submission_checklist')
        .insert({
          proposal_workspace_id: workspaceId,
          gate_type: check.gateType,
          check_id: check.checkId,
          check_description: check.description,
          status: check.status,
          blocking: check.blocking,
          evidence: check.evidence,
          last_evaluated_at: now,
          idempotency_key: idempotencyKey,
        });
    }
  }
}

// ============================================================
// Gate Evaluators
// ============================================================

async function evaluateComplianceGate(
  supabase: SupabaseClient,
  workspaceId: string,
  blockers: ReadinessBlocker[]
): Promise<void> {
  // Check 1: All mandatory requirements must be COVERED
  const { data: uncoveredMandatory } = await supabase
    .from('proposal_requirements')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('mandatory', true)
    .not('status', 'in', '("COVERED","NOT_APPLICABLE","SUPERSEDED")');

  const uncoveredCount = uncoveredMandatory?.length ?? 0;
  if (uncoveredCount > 0) {
    blockers.push({
      gate: 'COMPLIANCE',
      check: 'mandatory_requirements_covered',
      reason: `${uncoveredCount} mandatory requirement(s) not yet covered`,
    });
  }

  // Check 2: Zero FATAL compliance risks
  const { count: fatalCount } = await supabase
    .from('proposal_requirements')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('compliance_risk', 'FATAL');

  if ((fatalCount || 0) > 0) {
    blockers.push({
      gate: 'COMPLIANCE',
      check: 'zero_fatal_risks',
      reason: `${fatalCount} requirement(s) with FATAL compliance risk`,
    });
  }

  // Check 3: Latest amendment reconciled (no PENDING amendment impacts)
  const { count: pendingAmendments } = await supabase
    .from('proposal_amendment_impacts')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('status', 'PENDING');

  if ((pendingAmendments || 0) > 0) {
    blockers.push({
      gate: 'COMPLIANCE',
      check: 'amendments_reconciled',
      reason: `${pendingAmendments} amendment impact(s) not yet processed`,
    });
  }
}

async function evaluateEvidenceGate(
  supabase: SupabaseClient,
  workspaceId: string,
  blockers: ReadinessBlocker[]
): Promise<void> {
  // Check 1: Zero unsupported material claims
  const { count: unsupportedCount } = await supabase
    .from('proposal_claims')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('material', true)
    .eq('validation_status', 'UNSUPPORTED');

  if ((unsupportedCount || 0) > 0) {
    blockers.push({
      gate: 'EVIDENCE',
      check: 'zero_unsupported_material_claims',
      reason: `${unsupportedCount} material claim(s) without supporting evidence`,
    });
  }

  // Check 2: All PAST_PERFORMANCE evidence must be approved
  const { count: unapprovedPP } = await supabase
    .from('proposal_evidence_items')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('evidence_type', 'PAST_PERFORMANCE')
    .eq('proposal_usable', false);

  if ((unapprovedPP || 0) > 0) {
    blockers.push({
      gate: 'EVIDENCE',
      check: 'past_performance_approved',
      reason: `${unapprovedPP} past performance evidence item(s) not yet approved`,
    });
  }

  // Check 3: All RESUME evidence must be approved
  const { count: unapprovedResumes } = await supabase
    .from('proposal_evidence_items')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('evidence_type', 'RESUME')
    .eq('proposal_usable', false);

  if ((unapprovedResumes || 0) > 0) {
    blockers.push({
      gate: 'EVIDENCE',
      check: 'resumes_approved',
      reason: `${unapprovedResumes} resume evidence item(s) not yet approved`,
    });
  }
}

async function evaluateProductionGate(
  supabase: SupabaseClient,
  workspaceId: string,
  blockers: ReadinessBlocker[]
): Promise<void> {
  // Check 1: All required sections must be APPROVED
  const { count: unapprovedSections } = await supabase
    .from('proposal_sections')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .neq('status', 'APPROVED');

  if ((unapprovedSections || 0) > 0) {
    blockers.push({
      gate: 'PRODUCTION',
      check: 'all_sections_approved',
      reason: `${unapprovedSections} section(s) not yet approved`,
    });
  }

  // Check 2: No stale sections
  const { count: staleSections } = await supabase
    .from('proposal_sections')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('stale', true);

  if ((staleSections || 0) > 0) {
    blockers.push({
      gate: 'PRODUCTION',
      check: 'no_stale_sections',
      reason: `${staleSections} section(s) marked stale and need revision`,
    });
  }

  // Check 3: Forms complete (no HUMAN_INPUT_REQUIRED values)
  const { count: unresolvedForms } = await supabase
    .from('proposal_form_values')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('resolution_status', 'HUMAN_INPUT_REQUIRED');

  if ((unresolvedForms || 0) > 0) {
    blockers.push({
      gate: 'PRODUCTION',
      check: 'forms_complete',
      reason: `${unresolvedForms} form value(s) require human input`,
    });
  }

  // Check 4: Required attachments present (ATTACHMENT requirements covered)
  const { count: missingAttachments } = await supabase
    .from('proposal_requirements')
    .select('id', { count: 'exact', head: true })
    .eq('proposal_workspace_id', workspaceId)
    .eq('requirement_type', 'ATTACHMENT')
    .eq('mandatory', true)
    .not('status', 'in', '("COVERED","NOT_APPLICABLE","SUPERSEDED")');

  if ((missingAttachments || 0) > 0) {
    blockers.push({
      gate: 'PRODUCTION',
      check: 'attachments_present',
      reason: `${missingAttachments} required attachment(s) not yet covered`,
    });
  }
}

// ============================================================
// Helpers
// ============================================================

interface ChecklistItem {
  gateType: GateType;
  checkId: string;
  description: string;
  status: CheckStatus;
  blocking: boolean;
  evidence: Record<string, unknown>;
}

function buildChecklistItems(result: ReadinessResult): ChecklistItem[] {
  const allChecks: Array<{ gate: GateType; checkId: string; description: string }> = [
    { gate: 'COMPLIANCE', checkId: 'mandatory_requirements_covered', description: 'All mandatory requirements covered' },
    { gate: 'COMPLIANCE', checkId: 'zero_fatal_risks', description: 'Zero fatal compliance risks' },
    { gate: 'COMPLIANCE', checkId: 'amendments_reconciled', description: 'Latest amendment reconciled' },
    { gate: 'EVIDENCE', checkId: 'zero_unsupported_material_claims', description: 'Zero unsupported material claims' },
    { gate: 'EVIDENCE', checkId: 'past_performance_approved', description: 'All past performance evidence approved' },
    { gate: 'EVIDENCE', checkId: 'resumes_approved', description: 'All resume evidence approved' },
    { gate: 'PRODUCTION', checkId: 'all_sections_approved', description: 'All required sections approved' },
    { gate: 'PRODUCTION', checkId: 'no_stale_sections', description: 'No stale sections' },
    { gate: 'PRODUCTION', checkId: 'forms_complete', description: 'All form values resolved' },
    { gate: 'PRODUCTION', checkId: 'attachments_present', description: 'All required attachments present' },
  ];

  const blockerMap = new Map<string, ReadinessBlocker>();
  for (const b of result.blockers) {
    blockerMap.set(b.check, b);
  }

  return allChecks.map((check) => {
    const blocker = blockerMap.get(check.checkId);
    return {
      gateType: check.gate,
      checkId: check.checkId,
      description: check.description,
      status: blocker ? 'FAILED' as CheckStatus : 'PASSED' as CheckStatus,
      blocking: true,
      evidence: blocker ? { reason: blocker.reason } : {},
    };
  });
}
