import { getSupabase } from './client.js';

// ============================================
// OPPORTUNITY WORKFLOW FUNCTIONS
// ============================================

export type WorkflowStage =
  | 'found'
  | 'researching'
  | 'partner_search'
  | 'strategy'
  | 'decision'
  | 'pursuing'
  | 'passed';

export interface OpportunityWorkflow {
  id?: string;
  notice_id: string;
  title: string;
  sam_url?: string;
  agency?: string;
  score?: number;
  stage: WorkflowStage;
  agent_responsible?: string;
  auto_action_at?: string;
  awaiting_input_from?: 'lapedra' | 'tamara' | 'auto' | null;
  channel_id?: string;
  thread_ts?: string;
  incumbent?: string;
  incumbent_contract_value?: string;
  red_flags?: string[];
  teaming_recommended?: boolean;
  teaming_partners?: string[];
  james_recommendation?: 'GO' | 'PASS' | 'NEEDS_DISCUSSION';
  decision?: 'go' | 'pass' | 'hold';
  decision_by?: string;
  decision_at?: string;
  decision_notes?: string;
  created_at?: string;
  updated_at?: string;
  stage_entered_at?: string;
}

/**
 * Create a new opportunity workflow entry
 */
export async function createOpportunityWorkflow(
  workflow: Omit<OpportunityWorkflow, 'id' | 'created_at' | 'updated_at' | 'stage_entered_at'>
): Promise<OpportunityWorkflow | null> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .insert({
        ...workflow,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        stage_entered_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Could not create workflow:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not create workflow:', err);
    return null;
  }
}

/**
 * Get workflow by notice ID
 */
export async function getWorkflowByNoticeId(noticeId: string): Promise<OpportunityWorkflow | null> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .eq('notice_id', noticeId)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Update workflow (stage transition or data update)
 */
export async function updateOpportunityWorkflow(
  noticeId: string,
  updates: Partial<OpportunityWorkflow>
): Promise<OpportunityWorkflow | null> {
  try {
    const updateData: Record<string, unknown> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    // If stage is changing, update stage_entered_at
    if (updates.stage) {
      updateData.stage_entered_at = new Date().toISOString();
    }

    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .update(updateData)
      .eq('notice_id', noticeId)
      .select()
      .single();

    if (error) {
      console.error('Could not update workflow:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Could not update workflow:', err);
    return null;
  }
}

/**
 * Get workflows that need automatic action (auto_action_at has passed)
 */
export async function getWorkflowsNeedingAction(): Promise<OpportunityWorkflow[]> {
  try {
    const now = new Date().toISOString();

    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .lte('auto_action_at', now)
      .not('stage', 'in', '("pursuing","passed","decision")')
      .order('auto_action_at', { ascending: true });

    if (error) {
      console.warn('Could not get workflows needing action:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.warn('Could not get workflows needing action:', err);
    return [];
  }
}

/**
 * Get workflows by stage
 */
export async function getWorkflowsByStage(stage: WorkflowStage): Promise<OpportunityWorkflow[]> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .eq('stage', stage)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Get workflows awaiting human input
 */
export async function getWorkflowsAwaitingHuman(): Promise<OpportunityWorkflow[]> {
  try {
    const { data, error } = await getSupabase()
      .from('opportunity_workflow')
      .select('*')
      .not('awaiting_input_from', 'is', null)
      .neq('awaiting_input_from', 'auto')
      .order('created_at', { ascending: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Record stage transition history
 */
export async function recordStageTransition(
  workflowId: string,
  fromStage: WorkflowStage | null,
  toStage: WorkflowStage,
  triggeredBy: string,
  reason?: string
): Promise<void> {
  try {
    await getSupabase().from('workflow_stage_history').insert({
      workflow_id: workflowId,
      from_stage: fromStage,
      to_stage: toStage,
      triggered_by: triggeredBy,
      trigger_reason: reason,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not record stage transition:', err);
  }
}

// ============================================
// DECISION OUTCOME TRACKING
// ============================================

export interface DecisionOutcome {
  id?: string;
  notice_id?: string;
  opportunity_title?: string;
  workflow_id?: string;
  james_recommendation?: 'GO' | 'PASS' | 'NEEDS_DISCUSSION';
  david_red_flags?: string[];
  rosa_teaming_suggested?: boolean;
  human_decision?: 'go' | 'pass';
  decision_by?: string;
  outcome?: 'won' | 'lost' | 'no_bid' | 'withdrawn';
  outcome_notes?: string;
  recommended_at?: string;
  decided_at?: string;
  outcome_recorded_at?: string;
  created_at?: string;
}

/**
 * Record a decision outcome for learning
 */
export async function recordDecisionOutcome(
  outcome: Omit<DecisionOutcome, 'id' | 'created_at'>
): Promise<void> {
  try {
    await getSupabase()
      .from('decision_outcomes')
      .insert({
        ...outcome,
        created_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not record decision outcome:', err);
  }
}

/**
 * Get accuracy stats for agent recommendations
 */
export async function getRecommendationAccuracy(): Promise<{
  goRecommendations: { total: number; won: number; lost: number };
  passRecommendations: { total: number; correct: number };
}> {
  try {
    const { data, error } = await getSupabase()
      .from('decision_outcomes')
      .select('james_recommendation, human_decision, outcome')
      .not('outcome', 'is', null);

    if (error || !data) {
      return {
        goRecommendations: { total: 0, won: 0, lost: 0 },
        passRecommendations: { total: 0, correct: 0 },
      };
    }

    const stats = {
      goRecommendations: { total: 0, won: 0, lost: 0 },
      passRecommendations: { total: 0, correct: 0 },
    };

    for (const record of data) {
      if (record.james_recommendation === 'GO' && record.human_decision === 'go') {
        stats.goRecommendations.total++;
        if (record.outcome === 'won') stats.goRecommendations.won++;
        if (record.outcome === 'lost') stats.goRecommendations.lost++;
      }

      if (record.james_recommendation === 'PASS') {
        stats.passRecommendations.total++;
        if (record.human_decision === 'pass') {
          stats.passRecommendations.correct++;
        }
      }
    }

    return stats;
  } catch {
    return {
      goRecommendations: { total: 0, won: 0, lost: 0 },
      passRecommendations: { total: 0, correct: 0 },
    };
  }
}
