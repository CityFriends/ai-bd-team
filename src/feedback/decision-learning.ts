/**
 * Decision Learning Module
 *
 * Records human go/no-go decisions and compares them to agent recommendations
 * to enable the system to learn and improve over time.
 *
 * Flow:
 * 1. Human makes a decision (via Slack command or reaction)
 * 2. System records decision with reasoning
 * 3. Compare to what agents recommended
 * 4. Extract patterns from disagreements
 * 5. Monthly: Patricia analyzes feedback and proposes adjustments
 */

import { createClient } from '@supabase/supabase-js';
import { getRecentDeliverables } from '../integrations/database/deliverables.js';

// ============================================================
// Types
// ============================================================

export type DecisionType = 'go' | 'no_go' | 'hold';

export interface DecisionFeedback {
  id: string;
  opportunity_id: string | null;
  opportunity_title: string | null;
  decision: DecisionType;
  human_reasoning: string | null;
  agent_recommendation: string | null;
  agent_reasoning: string | null;
  alignment: boolean;
  factors_cited: string[];
  decided_by: string;
  created_at: string;
}

export interface DecisionInput {
  opportunityId?: string;
  opportunityTitle: string;
  decision: DecisionType;
  humanReasoning: string;
  decidedBy?: string;
}

export interface LearningPattern {
  pattern: string;
  frequency: number;
  examples: string[];
  suggestedAction: string;
}

// ============================================================
// Database Client
// ============================================================

function getSupabase() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
}

// ============================================================
// Decision Recording
// ============================================================

/**
 * Record a human decision with reasoning
 */
export async function recordDecision(input: DecisionInput): Promise<DecisionFeedback | null> {
  try {
    const supabase = getSupabase();

    // Find any recent agent recommendation for this opportunity
    let agentRecommendation: string | null = null;
    let agentReasoning: string | null = null;

    if (input.opportunityId) {
      const memos = await getRecentDeliverables({
        type: 'go_no_go_memo',
        opportunityId: input.opportunityId,
        limit: 1,
      });

      if (memos.length > 0) {
        const memo = memos[0];
        // Extract recommendation from content
        const goMatch = memo.content?.match(/recommendation[:\s]*(go|no.?go|hold)/i);
        if (goMatch) {
          agentRecommendation = goMatch[1].toLowerCase().replace('-', '_') as DecisionType;
        }
        agentReasoning = memo.content?.slice(0, 500) || null;
      }
    }

    // Determine alignment
    const alignment = agentRecommendation
      ? normalizeDecision(input.decision) === normalizeDecision(agentRecommendation)
      : true; // If no agent recommendation, consider aligned by default

    // Extract factors from reasoning
    const factors = extractFactors(input.humanReasoning);

    const { data, error } = await supabase
      .from('decision_feedback')
      .insert({
        opportunity_id: input.opportunityId,
        opportunity_title: input.opportunityTitle,
        decision: input.decision,
        human_reasoning: input.humanReasoning,
        agent_recommendation: agentRecommendation,
        agent_reasoning: agentReasoning,
        alignment,
        factors_cited: factors,
        decided_by: input.decidedBy || 'lapedra',
      })
      .select()
      .single();

    if (error) throw error;

    console.log(
      `[DecisionLearning] Recorded ${input.decision} for ${input.opportunityTitle} (alignment: ${alignment})`
    );

    return data as DecisionFeedback;
  } catch (err) {
    console.error('[DecisionLearning] Failed to record decision:', err);
    return null;
  }
}

function normalizeDecision(decision: string): DecisionType {
  const d = decision.toLowerCase().replace(/[^a-z]/g, '');
  if (d === 'go') return 'go';
  if (d === 'nogo' || d === 'no') return 'no_go';
  return 'hold';
}

/**
 * Extract decision factors from reasoning text
 */
function extractFactors(reasoning: string): string[] {
  const factors: string[] = [];
  const lowerReasoning = reasoning.toLowerCase();

  // Common factor keywords
  const factorKeywords = [
    { keyword: 'incumbent', factor: 'incumbent_concern' },
    { keyword: 'timeline', factor: 'timeline' },
    { keyword: 'deadline', factor: 'timeline' },
    { keyword: 'partner', factor: 'partnership' },
    { keyword: 'team', factor: 'partnership' },
    { keyword: 'budget', factor: 'budget' },
    { keyword: 'cost', factor: 'budget' },
    { keyword: 'price', factor: 'budget' },
    { keyword: 'clearance', factor: 'clearance' },
    { keyword: 'security', factor: 'security' },
    { keyword: 'experience', factor: 'past_performance' },
    { keyword: 'past performance', factor: 'past_performance' },
    { keyword: 'relationship', factor: 'relationship' },
    { keyword: 'agency', factor: 'agency_fit' },
    { keyword: 'naics', factor: 'naics_fit' },
    { keyword: 'set-aside', factor: 'set_aside' },
    { keyword: 'small business', factor: 'set_aside' },
    { keyword: 'competition', factor: 'competition' },
    { keyword: 'competitive', factor: 'competition' },
    { keyword: 'scope', factor: 'scope' },
    { keyword: 'fit', factor: 'fit' },
    { keyword: 'strategic', factor: 'strategic' },
    { keyword: 'risk', factor: 'risk' },
  ];

  for (const { keyword, factor } of factorKeywords) {
    if (lowerReasoning.includes(keyword) && !factors.includes(factor)) {
      factors.push(factor);
    }
  }

  return factors;
}

// ============================================================
// Feedback Analysis
// ============================================================

/**
 * Get all decision feedback for analysis
 */
export async function getDecisionFeedback(options?: {
  sinceDays?: number;
  alignmentOnly?: boolean;
  misalignmentOnly?: boolean;
}): Promise<DecisionFeedback[]> {
  try {
    const supabase = getSupabase();
    let query = supabase.from('decision_feedback').select('*');

    if (options?.sinceDays) {
      const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', since);
    }

    if (options?.alignmentOnly) {
      query = query.eq('alignment', true);
    }

    if (options?.misalignmentOnly) {
      query = query.eq('alignment', false);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;
    return (data || []) as DecisionFeedback[];
  } catch (err) {
    console.error('[DecisionLearning] Failed to get feedback:', err);
    return [];
  }
}

/**
 * Analyze decision patterns to find learning opportunities
 */
export async function analyzeLearningPatterns(sinceDays: number = 90): Promise<LearningPattern[]> {
  const patterns: LearningPattern[] = [];

  const feedback = await getDecisionFeedback({ sinceDays });
  const misaligned = feedback.filter((f) => !f.alignment);

  if (misaligned.length === 0) {
    return [
      {
        pattern: 'high_alignment',
        frequency: feedback.length,
        examples: [],
        suggestedAction: 'Agent recommendations are well-calibrated. Continue current approach.',
      },
    ];
  }

  // Analyze misalignment patterns
  const factorCounts: Record<string, { count: number; examples: string[] }> = {};

  for (const decision of misaligned) {
    for (const factor of decision.factors_cited) {
      if (!factorCounts[factor]) {
        factorCounts[factor] = { count: 0, examples: [] };
      }
      factorCounts[factor].count++;
      if (factorCounts[factor].examples.length < 3) {
        factorCounts[factor].examples.push(decision.opportunity_title || 'Unknown');
      }
    }
  }

  // Convert to patterns
  for (const [factor, data] of Object.entries(factorCounts)) {
    if (data.count >= 2) {
      // Pattern appears at least twice
      patterns.push({
        pattern: `${factor}_override`,
        frequency: data.count,
        examples: data.examples,
        suggestedAction: getSuggestedAction(factor, data.count, misaligned.length),
      });
    }
  }

  // Sort by frequency
  patterns.sort((a, b) => b.frequency - a.frequency);

  return patterns;
}

function getSuggestedAction(factor: string, count: number, total: number): string {
  const percentage = Math.round((count / total) * 100);

  const suggestions: Record<string, string> = {
    incumbent_concern: `Human overrides ${percentage}% of the time citing incumbent concerns. Consider increasing incumbent penalty in scoring.`,
    timeline: `Timeline is a frequent override factor (${percentage}%). Consider stricter deadline thresholds.`,
    partnership: `Partnership considerations drive ${percentage}% of overrides. May need to involve Rosa earlier in evaluation.`,
    budget: `Budget/cost cited in ${percentage}% of overrides. Consider adding value assessment to scoring.`,
    clearance: `Clearance requirements causing ${percentage}% of overrides. Add clearance check to early filtering.`,
    past_performance: `Past performance gaps causing ${percentage}% of overrides. Strengthen past performance matching.`,
    competition: `Competition level is underweighted - ${percentage}% of overrides cite this.`,
    fit: `General fit concerns in ${percentage}% of overrides. May need qualitative assessment layer.`,
  };

  return (
    suggestions[factor] ||
    `Factor "${factor}" appears in ${percentage}% of human overrides. Review scoring weight.`
  );
}

// ============================================================
// Summary Generation
// ============================================================

/**
 * Generate learning summary for Patricia's retrospective
 */
export async function generateLearningSummary(sinceDays: number = 30): Promise<string> {
  const feedback = await getDecisionFeedback({ sinceDays });
  const patterns = await analyzeLearningPatterns(sinceDays);

  const total = feedback.length;
  const aligned = feedback.filter((f) => f.alignment).length;
  const alignmentRate = total > 0 ? Math.round((aligned / total) * 100) : 100;

  const lines: string[] = [
    `## Decision Learning Summary (Last ${sinceDays} Days)`,
    '',
    `**Total Decisions:** ${total}`,
    `**Alignment Rate:** ${alignmentRate}% (${aligned}/${total})`,
    '',
  ];

  if (patterns.length > 0 && patterns[0].pattern !== 'high_alignment') {
    lines.push('### Learning Patterns', '');
    for (const pattern of patterns.slice(0, 5)) {
      lines.push(`**${pattern.pattern}** (${pattern.frequency} occurrences)`);
      lines.push(`- ${pattern.suggestedAction}`);
      lines.push(`- Examples: ${pattern.examples.join(', ')}`);
      lines.push('');
    }
  } else {
    lines.push(
      '### Observations',
      '',
      'Agent recommendations are well-aligned with human decisions.',
      'No significant adjustment patterns detected.'
    );
  }

  // Decision breakdown
  const goCount = feedback.filter((f) => f.decision === 'go').length;
  const noGoCount = feedback.filter((f) => f.decision === 'no_go').length;
  const holdCount = feedback.filter((f) => f.decision === 'hold').length;

  lines.push(
    '',
    '### Decision Breakdown',
    `- Go: ${goCount}`,
    `- No-Go: ${noGoCount}`,
    `- Hold: ${holdCount}`
  );

  return lines.join('\n');
}

// ============================================================
// Exports for External Use
// ============================================================

export { extractFactors };
