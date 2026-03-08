/**
 * Team Directives Database Operations
 *
 * Manages human-set focus areas and priorities that influence agent behavior.
 * Directives allow the human to steer agent attention without micromanaging.
 *
 * Example directives:
 * - focus:agency:VA - "Prioritize VA opportunities"
 * - avoid:keyword:staffing - "Skip staffing contracts"
 * - priority:naics:541511 - "Custom software is our sweet spot"
 * - pause:agency:DOD - "Don't pursue DOD until clearance ready"
 */

import { createClient } from '@supabase/supabase-js';

// ============================================================
// Types
// ============================================================

export type DirectiveType = 'focus' | 'avoid' | 'priority' | 'pause';
export type TargetType = 'agency' | 'naics' | 'keyword' | 'partner' | 'opportunity_type';

export interface TeamDirective {
  id: string;
  directive_type: DirectiveType;
  target_type: TargetType;
  target_value: string;
  reason: string | null;
  set_by: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DirectiveInput {
  directive_type: DirectiveType;
  target_type: TargetType;
  target_value: string;
  reason?: string;
  set_by?: string;
  expires_at?: string;
}

export interface ApplicableDirective {
  id: string;
  directive_type: DirectiveType;
  target_type: TargetType;
  target_value: string;
  reason: string | null;
}

// ============================================================
// Database Client
// ============================================================

function getSupabase() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
}

// ============================================================
// CRUD Operations
// ============================================================

/**
 * Set a new directive
 */
export async function setDirective(input: DirectiveInput): Promise<TeamDirective | null> {
  try {
    const supabase = getSupabase();

    // Check if similar directive already exists
    const { data: existing } = await supabase
      .from('team_directives')
      .select('*')
      .eq('directive_type', input.directive_type)
      .eq('target_type', input.target_type)
      .eq('target_value', input.target_value)
      .eq('active', true)
      .single();

    if (existing) {
      // Update existing directive
      const { data, error } = await supabase
        .from('team_directives')
        .update({
          reason: input.reason,
          expires_at: input.expires_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data as TeamDirective;
    }

    // Create new directive
    const { data, error } = await supabase
      .from('team_directives')
      .insert({
        directive_type: input.directive_type,
        target_type: input.target_type,
        target_value: input.target_value,
        reason: input.reason,
        set_by: input.set_by || 'lapedra',
        expires_at: input.expires_at,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(
      `[Directives] Set ${input.directive_type}:${input.target_type}:${input.target_value}`
    );
    return data as TeamDirective;
  } catch (err) {
    console.error('[Directives] Failed to set directive:', err);
    return null;
  }
}

/**
 * Get all active directives
 */
export async function getActiveDirectives(): Promise<TeamDirective[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('team_directives')
      .select('*')
      .eq('active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as TeamDirective[];
  } catch (err) {
    console.error('[Directives] Failed to get active directives:', err);
    return [];
  }
}

/**
 * Get directives by type
 */
export async function getDirectivesByType(directiveType: DirectiveType): Promise<TeamDirective[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('team_directives')
      .select('*')
      .eq('directive_type', directiveType)
      .eq('active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (error) throw error;
    return (data || []) as TeamDirective[];
  } catch (err) {
    console.error('[Directives] Failed to get directives by type:', err);
    return [];
  }
}

/**
 * Deactivate a directive
 */
export async function clearDirective(id: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('team_directives')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    console.log(`[Directives] Cleared directive ${id}`);
    return true;
  } catch (err) {
    console.error('[Directives] Failed to clear directive:', err);
    return false;
  }
}

/**
 * Clear all directives of a type
 */
export async function clearDirectivesByType(directiveType: DirectiveType): Promise<number> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('team_directives')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('directive_type', directiveType)
      .eq('active', true)
      .select();

    if (error) throw error;
    const count = data?.length || 0;
    console.log(`[Directives] Cleared ${count} ${directiveType} directives`);
    return count;
  } catch (err) {
    console.error('[Directives] Failed to clear directives:', err);
    return 0;
  }
}

// ============================================================
// Query Helpers
// ============================================================

/**
 * Get directives applicable to an opportunity
 */
export async function getDirectivesForOpportunity(opp: {
  agency?: string | null;
  naics_codes?: string[] | null;
  description?: string | null;
  type?: string | null;
}): Promise<ApplicableDirective[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_applicable_directives', {
      p_agency: opp.agency || null,
      p_naics_codes: opp.naics_codes || null,
      p_description: opp.description || null,
    });

    if (error) throw error;
    return (data || []) as ApplicableDirective[];
  } catch (err) {
    console.error('[Directives] Failed to get applicable directives:', err);
    return [];
  }
}

/**
 * Apply directive weights to a fit score
 * Returns adjusted score and list of applied directives
 */
export function applyDirectiveWeights(
  baseScore: number,
  directives: ApplicableDirective[]
): { score: number; applied: string[] } {
  let score = baseScore;
  const applied: string[] = [];

  for (const directive of directives) {
    switch (directive.directive_type) {
      case 'focus':
        // Boost score by 15 points for focus areas
        score = Math.min(score + 15, 100);
        applied.push(`+15 (focus: ${directive.target_value})`);
        break;

      case 'priority':
        // Boost score by 10 points for priority areas
        score = Math.min(score + 10, 100);
        applied.push(`+10 (priority: ${directive.target_value})`);
        break;

      case 'avoid':
        // Reduce score by 30 points for avoided areas
        score = Math.max(score - 30, 0);
        applied.push(`-30 (avoid: ${directive.target_value})`);
        break;

      case 'pause':
        // Set score to 0 for paused areas
        score = 0;
        applied.push(`=0 (paused: ${directive.target_value})`);
        break;
    }
  }

  return { score, applied };
}

// ============================================================
// Formatting Helpers
// ============================================================

/**
 * Format directives for agent context
 */
export function formatDirectivesForContext(directives: TeamDirective[]): string {
  if (directives.length === 0) {
    return 'No active directives.';
  }

  const lines = ['ACTIVE TEAM DIRECTIVES:'];

  const focus = directives.filter((d) => d.directive_type === 'focus');
  const priority = directives.filter((d) => d.directive_type === 'priority');
  const avoid = directives.filter((d) => d.directive_type === 'avoid');
  const pause = directives.filter((d) => d.directive_type === 'pause');

  if (focus.length > 0) {
    lines.push(
      `FOCUS: ${focus.map((d) => `${d.target_value} (${d.reason || 'no reason'})`).join(', ')}`
    );
  }

  if (priority.length > 0) {
    lines.push(`PRIORITY: ${priority.map((d) => d.target_value).join(', ')}`);
  }

  if (avoid.length > 0) {
    lines.push(`AVOID: ${avoid.map((d) => d.target_value).join(', ')}`);
  }

  if (pause.length > 0) {
    lines.push(`PAUSED: ${pause.map((d) => d.target_value).join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format directive as Slack message
 */
export function formatDirectiveForSlack(directive: TeamDirective): string {
  const emoji: Record<DirectiveType, string> = {
    focus: ':dart:',
    priority: ':star:',
    avoid: ':no_entry_sign:',
    pause: ':pause_button:',
  };

  return `${emoji[directive.directive_type]} *${directive.directive_type.toUpperCase()}* ${directive.target_type}: \`${directive.target_value}\`${directive.reason ? ` - ${directive.reason}` : ''}`;
}
