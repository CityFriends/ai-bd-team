/**
 * Patricia Reconciliation Processor
 *
 * Bounded deterministic reconciliation suitable for periodic execution.
 * Recommended future cadence: every 15 minutes.
 * Production disabled until commissioning.
 *
 * The cycle:
 * 1. Inspect bounded changed/active workflows
 * 2. Evaluate deterministic rules
 * 3. Repair allowlisted mechanical inconsistencies
 * 4. Update deadlines/dependencies/escalations
 * 5. Create no inference
 *
 * Uses durable checkpoints for restart-safe processing.
 *
 * Zero LLM calls. Zero provider calls.
 */

import type { SupabaseClient, ReconciliationResult } from './types.js';
import { evaluateWorkflowHealth } from './workflow-health.js';
import { executeSafeRepair } from './safe-repair.js';
import { detectOverdueMilestones } from './internal-milestones.js';
import { updateCommitmentStatus, getOverdueCommitments } from './commitment-registry.js';
// recordAction available for future use in reconciler audit trail
// import { recordAction } from './operational-actions.js';

/**
 * Run a bounded reconciliation cycle.
 * Idempotent checkpoint prevents overlapping runs.
 */
export async function runReconciliationCycle(
  supabase: SupabaseClient
): Promise<ReconciliationResult> {
  const cycleId = `reconcile-${new Date().toISOString().slice(0, 16)}`; // minute-level granularity

  // Create checkpoint (idempotent — prevents concurrent runs)
  const { data: checkpoint, error: cpErr } = await supabase
    .from('patricia_reconciliation_checkpoints')
    .upsert(
      {
        checkpoint_type: 'PERIODIC',
        status: 'IN_PROGRESS',
        idempotency_key: cycleId,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    )
    .select('id')
    .single();

  if (cpErr && !cpErr.message?.includes('duplicate')) {
    return {
      checkpointId: '',
      itemsInspected: 0,
      findingsCount: 0,
      repairsCount: 0,
      escalationsCount: 0,
      status: 'FAILED',
      error: `Checkpoint creation failed: ${cpErr.message}`,
    };
  }

  // If checkpoint already exists, this is a duplicate run
  if (!checkpoint) {
    const { data: existing } = await supabase
      .from('patricia_reconciliation_checkpoints')
      .select('id, status')
      .eq('idempotency_key', cycleId)
      .single();

    if (existing?.status === 'COMPLETED') {
      return {
        checkpointId: existing.id,
        itemsInspected: 0,
        findingsCount: 0,
        repairsCount: 0,
        escalationsCount: 0,
        status: 'COMPLETED',
      };
    }
    // Still in progress from another worker — skip
    return {
      checkpointId: existing?.id || '',
      itemsInspected: 0,
      findingsCount: 0,
      repairsCount: 0,
      escalationsCount: 0,
      status: 'COMPLETED',
    };
  }

  const checkpointId = checkpoint.id;
  let itemsInspected = 0;
  let findingsCount = 0;
  let repairsCount = 0;
  let escalationsCount = 0;

  try {
    // Step 1: Detect overdue milestones
    const overdueCount = await detectOverdueMilestones(supabase);
    itemsInspected += overdueCount;

    // Step 2: Mark overdue commitments
    const overdueCommitments = await getOverdueCommitments(supabase);
    for (const commitment of overdueCommitments) {
      if (commitment.status !== 'OVERDUE') {
        await updateCommitmentStatus(supabase, commitment.id, 'OVERDUE');
        itemsInspected++;
      }
    }

    // Step 3: Evaluate workflow health rules
    const findings = await evaluateWorkflowHealth(supabase);
    findingsCount = findings.length;
    itemsInspected += findings.length;

    // Step 4: Persist findings and execute allowed repairs
    for (const finding of findings) {
      const { data: persistedFinding } = await supabase.rpc('upsert_patricia_finding', {
        p_idempotency_key: `finding-${finding.ruleId}-${finding.idempotencyKeySuffix}`,
        p_rule_id: finding.ruleId,
        p_opportunity_id: finding.opportunityId || null,
        p_capture_id: finding.captureId || null,
        p_proposal_workspace_id: finding.proposalWorkspaceId || null,
        p_severity: finding.severity,
        p_title: finding.title,
        p_description: finding.description,
        p_evidence: finding.evidence,
        p_recommended_action: finding.recommendedAction || null,
        p_auto_repair_permitted: finding.autoRepairPermitted,
      });

      // Execute safe repair if permitted
      if (finding.autoRepairPermitted && persistedFinding) {
        const { data: findingRow } = await supabase
          .from('patricia_workflow_findings')
          .select('*')
          .eq('id', persistedFinding)
          .single();

        if (findingRow && !findingRow.auto_repair_executed) {
          const repairResult = await executeSafeRepair(supabase, findingRow);
          if (repairResult.repaired) {
            repairsCount++;
            await supabase
              .from('patricia_workflow_findings')
              .update({
                auto_repair_executed: true,
                auto_repair_action_id: repairResult.actionId,
                status: 'RESOLVED',
                resolved_at: new Date().toISOString(),
                resolved_by: 'patricia-reconciler',
                resolution_reason: repairResult.description,
                updated_at: new Date().toISOString(),
              })
              .eq('id', persistedFinding);
          }
        }
      }

      // Count escalations (AT_RISK findings)
      if (finding.severity === 'AT_RISK') {
        escalationsCount++;
      }
    }

    // Complete checkpoint
    await supabase
      .from('patricia_reconciliation_checkpoints')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        findings_count: findingsCount,
        repairs_count: repairsCount,
        escalations_count: escalationsCount,
        items_inspected: itemsInspected,
      })
      .eq('id', checkpointId);

    return {
      checkpointId,
      itemsInspected,
      findingsCount,
      repairsCount,
      escalationsCount,
      status: 'COMPLETED',
    };
  } catch (err) {
    // Mark checkpoint as failed
    await supabase
      .from('patricia_reconciliation_checkpoints')
      .update({
        status: 'FAILED',
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq('id', checkpointId);

    return {
      checkpointId,
      itemsInspected,
      findingsCount,
      repairsCount,
      escalationsCount,
      status: 'FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
