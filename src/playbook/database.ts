// Playbook Database Functions

import { getSupabase } from '../integrations/database/client.js';
import type {
  PlaybookRule,
  ActiveRule,
  ProposeRuleInput,
  PlaybookApplication,
  RetrospectiveRun,
  RuleHealthCheck,
  RuleCategoryValue,
} from './types.js';

// ============================================================
// Propose a new rule
// ============================================================
export async function proposeRule(input: ProposeRuleInput): Promise<string | null> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('propose_rule', {
      p_rule_type: input.rule_type,
      p_category: input.category,
      p_rule: input.rule,
      p_evidence: input.evidence,
      p_proposed_by: input.proposed_by,
      p_confidence: input.confidence ?? 0.5,
    });

    if (error) {
      console.error('[Playbook] Failed to propose rule:', error);
      return null;
    }

    const ruleId = data as string;
    console.log(`[Playbook] Proposed rule: "${input.rule.slice(0, 50)}..." (id: ${ruleId})`);
    return ruleId;
  } catch (err) {
    console.error('[Playbook] Exception proposing rule:', err);
    return null;
  }
}

// ============================================================
// Adopt a proposed rule (make it active)
// ============================================================
export async function adoptRule(ruleId: string): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('adopt_rule', {
      p_rule_id: ruleId,
    });

    if (error) {
      console.error('[Playbook] Failed to adopt rule:', error);
      return false;
    }

    console.log(`[Playbook] Adopted rule ${ruleId}`);
    return data as boolean;
  } catch (err) {
    console.error('[Playbook] Exception adopting rule:', err);
    return false;
  }
}

// ============================================================
// Retire a rule
// ============================================================
export async function retireRule(ruleId: string, reason?: string): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('retire_rule', {
      p_rule_id: ruleId,
      p_reason: reason || null,
    });

    if (error) {
      console.error('[Playbook] Failed to retire rule:', error);
      return false;
    }

    console.log(`[Playbook] Retired rule ${ruleId}`);
    return data as boolean;
  } catch (err) {
    console.error('[Playbook] Exception retiring rule:', err);
    return false;
  }
}

// ============================================================
// Override a rule for a specific opportunity
// ============================================================
export async function overrideRule(
  ruleId: string,
  opportunityId: string,
  reason: string,
  overriddenBy: string = 'human'
): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('override_rule', {
      p_rule_id: ruleId,
      p_opportunity_id: opportunityId,
      p_reason: reason,
      p_overridden_by: overriddenBy,
    });

    if (error) {
      console.error('[Playbook] Failed to override rule:', error);
      return false;
    }

    console.log(`[Playbook] Rule ${ruleId} overridden for opportunity ${opportunityId}`);
    return data as boolean;
  } catch (err) {
    console.error('[Playbook] Exception overriding rule:', err);
    return false;
  }
}

// ============================================================
// Record that a rule was applied
// ============================================================
export async function applyRule(
  ruleId: string,
  opportunityId: string,
  opportunityTitle: string,
  appliedBy: string,
  context?: Record<string, unknown>
): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('apply_rule', {
      p_rule_id: ruleId,
      p_opportunity_id: opportunityId,
      p_opportunity_title: opportunityTitle,
      p_applied_by: appliedBy,
      p_context: context || {},
    });

    if (error) {
      console.error('[Playbook] Failed to apply rule:', error);
      return false;
    }

    console.log(`[Playbook] Applied rule ${ruleId} to opportunity ${opportunityId}`);
    return data as boolean;
  } catch (err) {
    console.error('[Playbook] Exception applying rule:', err);
    return false;
  }
}

// ============================================================
// Get active rules for a category
// ============================================================
export async function getActiveRules(
  category?: RuleCategoryValue,
  minConfidence: number = 0.6
): Promise<ActiveRule[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_active_rules', {
      p_category: category || null,
      p_min_confidence: minConfidence,
    });

    if (error) {
      console.error('[Playbook] Failed to get active rules:', error);
      return [];
    }

    return (data || []) as ActiveRule[];
  } catch (err) {
    console.error('[Playbook] Exception getting active rules:', err);
    return [];
  }
}

// ============================================================
// Get all proposed rules
// ============================================================
export async function getProposedRules(): Promise<PlaybookRule[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('team_playbook')
      .select('*')
      .eq('status', 'proposed')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Playbook] Failed to get proposed rules:', error);
      return [];
    }

    return (data || []) as PlaybookRule[];
  } catch (err) {
    console.error('[Playbook] Exception getting proposed rules:', err);
    return [];
  }
}

// ============================================================
// Get recent proposed rules (for retro summary)
// ============================================================
export async function getRecentProposedRules(sinceHours: number = 24): Promise<PlaybookRule[]> {
  try {
    const supabase = getSupabase();
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('team_playbook')
      .select('*')
      .eq('status', 'proposed')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Playbook] Failed to get recent proposed rules:', error);
      return [];
    }

    return (data || []) as PlaybookRule[];
  } catch (err) {
    console.error('[Playbook] Exception getting recent proposed rules:', err);
    return [];
  }
}

// ============================================================
// Get rule by ID
// ============================================================
export async function getRuleById(ruleId: string): Promise<PlaybookRule | null> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('team_playbook')
      .select('*')
      .eq('id', ruleId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      console.error('[Playbook] Failed to get rule:', error);
      return null;
    }

    return data as PlaybookRule;
  } catch (err) {
    console.error('[Playbook] Exception getting rule:', err);
    return null;
  }
}

// ============================================================
// Check rule health (override frequency)
// ============================================================
export async function checkRuleHealth(): Promise<RuleHealthCheck[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('check_rule_health');

    if (error) {
      console.error('[Playbook] Failed to check rule health:', error);
      return [];
    }

    return (data || []) as RuleHealthCheck[];
  } catch (err) {
    console.error('[Playbook] Exception checking rule health:', err);
    return [];
  }
}

// ============================================================
// Update rule outcomes (supporting or contradicting)
// ============================================================
export async function updateRuleOutcomes(
  ruleId: string,
  opportunityId: string,
  supports: boolean
): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('update_rule_outcomes', {
      p_rule_id: ruleId,
      p_opportunity_id: opportunityId,
      p_supports: supports,
    });

    if (error) {
      console.error('[Playbook] Failed to update rule outcomes:', error);
      return false;
    }

    return data as boolean;
  } catch (err) {
    console.error('[Playbook] Exception updating rule outcomes:', err);
    return false;
  }
}

// ============================================================
// Get playbook applications for a rule
// ============================================================
export async function getRuleApplications(
  ruleId: string,
  limit: number = 50
): Promise<PlaybookApplication[]> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('playbook_applications')
      .select('*')
      .eq('rule_id', ruleId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Playbook] Failed to get rule applications:', error);
      return [];
    }

    return (data || []) as PlaybookApplication[];
  } catch (err) {
    console.error('[Playbook] Exception getting rule applications:', err);
    return [];
  }
}

// ============================================================
// Create retrospective run
// ============================================================
export async function createRetrospectiveRun(
  periodStart: Date,
  periodEnd: Date
): Promise<string | null> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('retrospective_runs')
      .insert({
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        status: 'running',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Playbook] Failed to create retrospective run:', error);
      return null;
    }

    return data.id;
  } catch (err) {
    console.error('[Playbook] Exception creating retrospective run:', err);
    return null;
  }
}

// ============================================================
// Complete retrospective run
// ============================================================
export async function completeRetrospectiveRun(
  runId: string,
  results: {
    outcomes_analyzed: number;
    chains_analyzed: number;
    rules_proposed: number;
    rules_adopted: number;
    findings: Record<string, unknown>;
  }
): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('retrospective_runs')
      .update({
        ...results,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (error) {
      console.error('[Playbook] Failed to complete retrospective run:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Playbook] Exception completing retrospective run:', err);
    return false;
  }
}

// ============================================================
// Get playbook statistics
// ============================================================
export interface PlaybookStats {
  total_rules: number;
  active_rules: number;
  proposed_rules: number;
  retired_rules: number;
  total_applications: number;
  total_overrides: number;
  avg_confidence: number;
}

export async function getPlaybookStats(): Promise<PlaybookStats> {
  try {
    const supabase = getSupabase();

    // Get rule counts by status
    const { data: rules, error: rulesError } = await supabase
      .from('team_playbook')
      .select('status, confidence, times_applied, times_overridden');

    if (rulesError) {
      console.error('[Playbook] Failed to get playbook stats:', rulesError);
      return {
        total_rules: 0,
        active_rules: 0,
        proposed_rules: 0,
        retired_rules: 0,
        total_applications: 0,
        total_overrides: 0,
        avg_confidence: 0,
      };
    }

    const rulesList = rules || [];
    const activeRules = rulesList.filter((r) => r.status === 'active');

    return {
      total_rules: rulesList.length,
      active_rules: activeRules.length,
      proposed_rules: rulesList.filter((r) => r.status === 'proposed').length,
      retired_rules: rulesList.filter((r) => r.status === 'retired').length,
      total_applications: rulesList.reduce((sum, r) => sum + (r.times_applied || 0), 0),
      total_overrides: rulesList.reduce((sum, r) => sum + (r.times_overridden || 0), 0),
      avg_confidence:
        activeRules.length > 0
          ? activeRules.reduce((sum, r) => sum + (r.confidence || 0), 0) / activeRules.length
          : 0,
    };
  } catch (err) {
    console.error('[Playbook] Exception getting playbook stats:', err);
    return {
      total_rules: 0,
      active_rules: 0,
      proposed_rules: 0,
      retired_rules: 0,
      total_applications: 0,
      total_overrides: 0,
      avg_confidence: 0,
    };
  }
}
