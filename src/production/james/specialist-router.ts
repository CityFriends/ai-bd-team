/**
 * Specialist Router — Maps research needs to specialist tasks
 *
 * James identifies evidence gaps. This module creates durable
 * specialist_tasks rows for each REQUIRED research need.
 */

import { emitEvent, CAPTURE_EVENT_TYPES } from './events.js';
import { SPECIALIST_TIMEOUT_SECONDS } from './types.js';
import type { ResearchNeed, ResearchAuthority } from './types.js';

/**
 * Dispatch specialist tasks for REQUIRED research needs.
 * Only REQUIRED priority tasks are dispatched. USEFUL gaps are recorded
 * in the decision payload but do not create tasks.
 */
export async function dispatchResearchNeeds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  opportunityId: string,
  needs: ResearchNeed[],
  round: number,
  authority: ResearchAuthority = 'AUTONOMOUS'
): Promise<string[]> {
  const requiredNeeds = needs.filter((n) => n.priority === 'REQUIRED');
  const taskIds: string[] = [];

  for (const need of requiredNeeds) {
    const idempKey = `specialist:${captureId}:${round}:${need.type}:${hashQuestion(need.question)}`;
    const timeoutSeconds = SPECIALIST_TIMEOUT_SECONDS[need.type] || 300;

    const { data: task, error } = await supabase
      .from('specialist_tasks')
      .upsert(
        {
          capture_id: captureId,
          opportunity_id: opportunityId,
          task_type: need.type,
          question: need.question,
          why_decision_blocking: need.whyDecisionBlocking,
          evidence_refs: need.evidenceRefs || [],
          research_round: round,
          research_authority: authority,
          priority: need.priority,
          status: 'pending',
          timeout_seconds: timeoutSeconds,
          timeout_at: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
          idempotency_key: idempKey,
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true }
      )
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') continue; // Duplicate — already dispatched
      console.error(`[SpecialistRouter] Failed to create task:`, error.message);
      continue;
    }

    if (task?.id) {
      taskIds.push(task.id);

      await emitEvent(supabase, {
        eventType: CAPTURE_EVENT_TYPES.SPECIALIST_TASK_REQUESTED,
        aggregateType: 'capture',
        aggregateId: captureId,
        opportunityId,
        actorType: 'AGENT',
        actorId: 'james',
        source: 'specialist-router',
        correlationId: `capture:${captureId}`,
        idempotencyKey: `evt:${idempKey}`,
        schemaVersion: 1,
        payload: { taskType: need.type, question: need.question, round, authority },
      });
    }
  }

  return taskIds;
}

/**
 * Check if all specialist tasks for a capture round are terminal.
 */
export async function areAllTasksTerminal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string,
  round: number
): Promise<boolean> {
  const { data: tasks } = await supabase
    .from('specialist_tasks')
    .select('status')
    .eq('capture_id', captureId)
    .eq('research_round', round);

  if (!tasks || tasks.length === 0) return true;

  const terminalStatuses = new Set(['completed', 'failed', 'skipped', 'timed_out']);
  return tasks.every((t: { status: string }) => terminalStatuses.has(t.status));
}

/**
 * Mark timed-out specialist tasks.
 */
export async function markTimedOutTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  captureId: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('specialist_tasks')
    .update({ status: 'timed_out', completed_at: now })
    .eq('capture_id', captureId)
    .in('status', ['pending', 'in_progress'])
    .lt('timeout_at', now)
    .select('id');

  return data?.length || 0;
}

function hashQuestion(question: string): string {
  // Simple deterministic hash for idempotency — not crypto-strength
  let hash = 0;
  for (let i = 0; i < question.length; i++) {
    hash = ((hash << 5) - hash + question.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
