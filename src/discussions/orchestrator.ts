/**
 * Discussion Orchestrator
 *
 * Manages multi-turn agent discussions anchored to specific opportunities.
 * Unlike the feed system (post/react), this enables real collaborative reasoning
 * where agents respond to each other's points and build toward recommendations.
 *
 * Flow:
 * 1. Maya triggers discussion when opportunity identified
 * 2. Agents contribute in sequence, each seeing prior turns
 * 3. Discussion converges on GO/NO-GO recommendation
 * 4. Synthesizer generates deliverable from discussion
 * 5. Discussion syncs to Notion opportunity page
 */

import { createClient } from '@supabase/supabase-js';
import { getAnthropic, MODEL_SONNET } from '../integrations/claude.js';
import { trackCost } from '../lib/cost-tracker.js';

// ============================================================
// Types
// ============================================================

export interface DiscussionTurn {
  agent: string;
  role: string;
  content: string;
  references: string[];
  turn_type: 'initial' | 'build' | 'challenge' | 'question' | 'answer' | 'synthesis';
  responds_to?: number;
  timestamp: string;
}

export type DiscussionState = 'gathering' | 'debating' | 'concluding' | 'synthesized' | 'stale';

export interface OpportunityDiscussion {
  id: string;
  opportunity_id: string;
  opportunity_name: string;
  notion_page_id: string | null;
  state: DiscussionState;
  turns: DiscussionTurn[];
  agents_contributed: string[];
  expected_agents: string[];
  deliverable_ids: string[];
  triggered_by: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  last_turn_at: string;
}

export interface OpportunityContext {
  title: string;
  agency?: string;
  setAside?: string;
  naicsCodes?: string[];
  dueDate?: string;
  estimatedValue?: string;
  description?: string;
  solicitationUrl?: string;
  incumbent?: string;
}

export interface NextAgentSuggestion {
  agent: string;
  role: string;
  prompt: string;
  context: string;
}

export interface ConvergenceCheck {
  converged: boolean;
  recommendation?: 'go' | 'no_go' | 'hold';
  confidence: number;
  dissenting_agents?: string[];
  ready_for_synthesis: boolean;
}

// ============================================================
// Constants
// ============================================================

const AGENT_SEQUENCE: Array<{ agent: string; role: string }> = [
  { agent: 'maya', role: 'scout' },
  { agent: 'david', role: 'analyst' },
  { agent: 'rosa', role: 'connector' },
  { agent: 'marcus', role: 'tech_lead' },
  { agent: 'james', role: 'strategist' },
];

const AGENT_DISCUSSION_PROMPTS: Record<string, string> = {
  maya: `You are Maya, the Opportunity Scout. Review this opportunity and provide your initial assessment.

ASSESS:
1. Set-aside fit - Do we qualify? (8(a), WOSB, SDVOSB, HUBZone, small business)
2. NAICS alignment - Is this our core competency or a stretch?
3. Timeline feasibility - Can we realistically respond?
4. Initial red flags - Anything that suggests this is wired or problematic?

Be specific. Reference actual details from the opportunity. If you don't have enough info, say what's missing.
Keep your response to 3-4 focused paragraphs.`,

  david: `You are David, the Research Analyst. Based on Maya's assessment and the opportunity details, provide your research perspective.

RESEARCH:
1. Incumbent analysis - Who holds this now? Are they vulnerable? Check contract history.
2. Agency context - Is this agency growing? What's their spending trend?
3. Risk factors - Any red flags from the solicitation, agency history, or market?
4. Data gaps - What do we still need to research?

Reference Maya's points where relevant. Only state facts you can support. Say "I don't have data on X" for unknowns.
Keep your response to 3-4 focused paragraphs.`,

  rosa: `You are Rosa, the Teaming Strategist. Based on the team's discussion so far, assess our teaming needs.

ASSESS:
1. Do we need a partner? What capability or certification gaps exist?
2. If yes, what type of partner? (Prime/sub structure, certifications needed)
3. Who might fit? (Use your SAM.gov search if needed to find candidates)
4. Relationship leverage - Any existing contacts or warm intros?

Build on what Maya and David shared. Be practical about our real capabilities.
Keep your response to 3-4 focused paragraphs.`,

  marcus: `You are Marcus, the Technical Lead. Based on the team's discussion, assess technical feasibility.

ASSESS:
1. Technical requirements - Can we deliver what they're asking for?
2. Compliance requirements - FedRAMP, IL levels, security clearances needed?
3. Architecture considerations - Standard or complex build?
4. Resource implications - Do we have the people/skills?

Be honest about gaps. Reference what Maya, David, and Rosa have shared.
Keep your response to 3-4 focused paragraphs.`,

  james: `You are James, the Capture Strategist. Synthesize the team's input into a recommendation.

SYNTHESIZE:
1. What does each team member's analysis tell us?
2. What's our competitive position?
3. What's the realistic win probability (PWIN)?

RECOMMEND:
- GO (pursue actively) | NO-GO (pass) | HOLD (need more info)
- Confidence level (high/medium/low)
- Key factors driving your recommendation (3-5 bullets)
- If GO: Immediate next steps
- If NO-GO or HOLD: What would change the decision?

Be decisive. Reference specific points from the team. This is your call.
Keep your response to 4-5 focused paragraphs.`,
};

const AGENT_EMOJIS: Record<string, string> = {
  maya: '🔍',
  david: '📊',
  rosa: '🤝',
  marcus: '🛠️',
  james: '🎯',
  jodie: '✍️',
  patricia: '📋',
};

// ============================================================
// Database Client
// ============================================================

function getSupabase() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || '');
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Start a new discussion for an opportunity
 */
export async function startDiscussion(params: {
  opportunityId: string;
  opportunityName: string;
  notionPageId?: string;
  triggeredBy: string;
  context: OpportunityContext;
  tags?: string[];
}): Promise<OpportunityDiscussion | null> {
  try {
    const supabase = getSupabase();

    // Check if discussion already exists
    const { data: existing } = await supabase
      .from('opportunity_discussions')
      .select('*')
      .eq('opportunity_id', params.opportunityId)
      .in('state', ['gathering', 'debating', 'concluding'])
      .single();

    if (existing) {
      console.log(`[Discussion] Discussion already exists for ${params.opportunityName}`);
      return existing as OpportunityDiscussion;
    }

    // Create new discussion
    const { data, error } = await supabase
      .from('opportunity_discussions')
      .insert({
        opportunity_id: params.opportunityId,
        opportunity_name: params.opportunityName,
        notion_page_id: params.notionPageId,
        triggered_by: params.triggeredBy,
        tags: params.tags || [],
        state: 'gathering',
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[Discussion] Started discussion for: ${params.opportunityName}`);
    return data as OpportunityDiscussion;
  } catch (err) {
    console.error('[Discussion] Failed to start:', err);
    return null;
  }
}

/**
 * Add a turn to an existing discussion
 */
export async function addTurn(params: {
  discussionId: string;
  agent: string;
  role: string;
  content: string;
  turnType: DiscussionTurn['turn_type'];
  references?: string[];
  respondsTo?: number;
}): Promise<OpportunityDiscussion | null> {
  try {
    const supabase = getSupabase();

    // Get current discussion
    const { data: discussion, error: fetchError } = await supabase
      .from('opportunity_discussions')
      .select('*')
      .eq('id', params.discussionId)
      .single();

    if (fetchError || !discussion) {
      throw new Error(`Discussion not found: ${params.discussionId}`);
    }

    const currentTurns = (discussion.turns as DiscussionTurn[]) || [];
    const agentsContributed = discussion.agents_contributed || [];

    // Create new turn
    const newTurn: DiscussionTurn = {
      agent: params.agent,
      role: params.role,
      content: params.content,
      references: params.references || [],
      turn_type: params.turnType,
      responds_to: params.respondsTo,
      timestamp: new Date().toISOString(),
    };

    // Update agents contributed
    if (!agentsContributed.includes(params.agent)) {
      agentsContributed.push(params.agent);
    }

    // Determine new state
    let newState = discussion.state;
    if (agentsContributed.length >= 2 && discussion.state === 'gathering') {
      newState = 'debating';
    }
    if (params.agent === 'james' && params.turnType === 'synthesis') {
      newState = 'concluding';
    }

    // Update discussion
    const { data, error } = await supabase
      .from('opportunity_discussions')
      .update({
        turns: [...currentTurns, newTurn],
        agents_contributed: agentsContributed,
        state: newState,
        last_turn_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.discussionId)
      .select()
      .single();

    if (error) throw error;

    console.log(`[Discussion] ${params.agent} added turn (${params.turnType})`);
    return data as OpportunityDiscussion;
  } catch (err) {
    console.error('[Discussion] Failed to add turn:', err);
    return null;
  }
}

/**
 * Get the next agent who should contribute
 */
export function getNextAgent(discussion: OpportunityDiscussion): NextAgentSuggestion | null {
  const contributed = new Set(discussion.agents_contributed);

  // Find first agent in sequence who hasn't contributed
  for (const { agent, role } of AGENT_SEQUENCE) {
    if (!contributed.has(agent)) {
      const prompt = AGENT_DISCUSSION_PROMPTS[agent];
      const context = formatDiscussionContext(discussion);

      return {
        agent,
        role,
        prompt,
        context,
      };
    }
  }

  // All agents have contributed
  return null;
}

/**
 * Format discussion context for next agent
 */
function formatDiscussionContext(discussion: OpportunityDiscussion): string {
  const lines: string[] = [
    `OPPORTUNITY: ${discussion.opportunity_name}`,
    '',
    'TEAM DISCUSSION SO FAR:',
  ];

  for (let i = 0; i < discussion.turns.length; i++) {
    const turn = discussion.turns[i];
    const emoji = AGENT_EMOJIS[turn.agent] || '💬';
    lines.push(`\n${emoji} ${turn.agent.toUpperCase()} (${turn.role}):`);
    lines.push(turn.content);

    if (turn.references.length > 0) {
      lines.push(`Sources: ${turn.references.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Check if discussion has converged on a recommendation
 */
export function checkForConvergence(discussion: OpportunityDiscussion): ConvergenceCheck {
  // Need James's synthesis to converge
  const jamesTurn = discussion.turns.find(
    (t) => t.agent === 'james' && t.turn_type === 'synthesis'
  );

  if (!jamesTurn) {
    return {
      converged: false,
      confidence: 0,
      ready_for_synthesis: discussion.agents_contributed.length >= 4,
    };
  }

  // Extract recommendation from James's turn
  const content = jamesTurn.content.toLowerCase();
  let recommendation: 'go' | 'no_go' | 'hold' = 'hold';

  if (content.includes('recommend: go') || content.includes('recommendation: go')) {
    recommendation = 'go';
  } else if (content.includes('recommend: no-go') || content.includes('no-go')) {
    recommendation = 'no_go';
  }

  // Extract confidence
  let confidence = 0.5;
  if (content.includes('high confidence') || content.includes('confidence: high')) {
    confidence = 0.8;
  } else if (content.includes('medium confidence') || content.includes('confidence: medium')) {
    confidence = 0.6;
  } else if (content.includes('low confidence') || content.includes('confidence: low')) {
    confidence = 0.4;
  }

  return {
    converged: true,
    recommendation,
    confidence,
    ready_for_synthesis: true,
  };
}

/**
 * Generate an agent's turn using Claude
 */
export async function generateAgentTurn(
  discussion: OpportunityDiscussion,
  opportunityContext: OpportunityContext
): Promise<{ agent: string; content: string; role: string } | null> {
  const next = getNextAgent(discussion);
  if (!next) {
    console.log('[Discussion] All agents have contributed');
    return null;
  }

  const { agent, role, prompt, context } = next;

  // Build full prompt
  const fullPrompt = `${context}

---

OPPORTUNITY DETAILS:
Title: ${opportunityContext.title}
${opportunityContext.agency ? `Agency: ${opportunityContext.agency}` : ''}
${opportunityContext.setAside ? `Set-Aside: ${opportunityContext.setAside}` : ''}
${opportunityContext.naicsCodes ? `NAICS: ${opportunityContext.naicsCodes.join(', ')}` : ''}
${opportunityContext.dueDate ? `Due Date: ${opportunityContext.dueDate}` : ''}
${opportunityContext.estimatedValue ? `Estimated Value: ${opportunityContext.estimatedValue}` : ''}
${opportunityContext.incumbent ? `Incumbent: ${opportunityContext.incumbent}` : ''}
${opportunityContext.description ? `\nDescription:\n${opportunityContext.description.slice(0, 1000)}` : ''}

---

YOUR TASK:
${prompt}`;

  try {
    const client = getAnthropic();
    const startTime = Date.now();

    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 800,
      messages: [{ role: 'user', content: fullPrompt }],
    });

    // Track cost
    if (response.usage) {
      trackCost({
        agent,
        purpose: 'discussion',
        model: MODEL_SONNET,
        usage: response.usage,
        durationMs: Date.now() - startTime,
        metadata: { discussionId: discussion.id },
      }).catch(() => {});
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return null;
    }

    return {
      agent,
      role,
      content: textBlock.text,
    };
  } catch (err) {
    console.error(`[Discussion] Failed to generate turn for ${agent}:`, err);
    return null;
  }
}

/**
 * Get a discussion by ID
 */
export async function getDiscussion(id: string): Promise<OpportunityDiscussion | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('opportunity_discussions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as OpportunityDiscussion;
  } catch (err) {
    console.error('[Discussion] Failed to get:', err);
    return null;
  }
}

/**
 * Get discussion for an opportunity
 */
export async function getDiscussionForOpportunity(
  opportunityId: string
): Promise<OpportunityDiscussion | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('opportunity_discussions')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .neq('state', 'stale')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data as OpportunityDiscussion;
  } catch (err) {
    console.error('[Discussion] Failed to get for opportunity:', err);
    return null;
  }
}

/**
 * Get discussions needing attention
 */
export async function getPendingDiscussions(): Promise<OpportunityDiscussion[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('opportunity_discussions')
      .select('*')
      .in('state', ['gathering', 'debating', 'concluding'])
      .order('last_turn_at', { ascending: true });

    if (error) throw error;
    return (data || []) as OpportunityDiscussion[];
  } catch (err) {
    console.error('[Discussion] Failed to get pending:', err);
    return [];
  }
}

/**
 * Mark discussion as synthesized
 */
export async function markSynthesized(
  discussionId: string,
  deliverableId: string
): Promise<boolean> {
  try {
    const supabase = getSupabase();

    const { data: discussion } = await supabase
      .from('opportunity_discussions')
      .select('deliverable_ids')
      .eq('id', discussionId)
      .single();

    const deliverableIds = (discussion?.deliverable_ids || []) as string[];

    const { error } = await supabase
      .from('opportunity_discussions')
      .update({
        state: 'synthesized',
        deliverable_ids: [...deliverableIds, deliverableId],
        updated_at: new Date().toISOString(),
      })
      .eq('id', discussionId);

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Discussion] Failed to mark synthesized:', err);
    return false;
  }
}

/**
 * Format discussion for Slack
 */
export function formatDiscussionForSlack(discussion: OpportunityDiscussion): string {
  const lines: string[] = [
    `*Team Discussion: ${discussion.opportunity_name}*`,
    `State: ${discussion.state} | Contributors: ${discussion.agents_contributed.join(', ')}`,
    '',
  ];

  for (const turn of discussion.turns) {
    const emoji = AGENT_EMOJIS[turn.agent] || '💬';
    const preview = turn.content.slice(0, 150) + (turn.content.length > 150 ? '...' : '');
    lines.push(`${emoji} *${turn.agent}*: ${preview}`);
  }

  return lines.join('\n');
}

/**
 * Format discussion for Notion (markdown)
 */
export function formatDiscussionForNotion(discussion: OpportunityDiscussion): string {
  const lines: string[] = ['## Team Discussion', ''];

  for (const turn of discussion.turns) {
    const emoji = AGENT_EMOJIS[turn.agent] || '💬';
    lines.push(`### ${emoji} ${turn.agent.toUpperCase()} (${turn.role})`);
    lines.push('');
    lines.push(turn.content);
    lines.push('');

    if (turn.references.length > 0) {
      lines.push(`*Sources: ${turn.references.join(', ')}*`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
