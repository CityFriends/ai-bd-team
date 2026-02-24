/**
 * Shared Context for All Agents
 *
 * Provides pipeline visibility, extended memory, and cross-session context
 * so agents aren't stateless and know what's actually happening.
 */

import { getSupabase, getExtractedFacts } from '../integrations/supabase.js';

// Notion API
const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const PIPELINE_DATABASE_ID = '1bb07a7951ff80fe9e6dfd1284f99a48';

// ============================================================
// PIPELINE VISIBILITY - What we're actually working on
// ============================================================

export interface PipelineOpportunity {
  name: string;
  stage: string;
  agency?: string;
  dueDate?: string;
  type?: string;
}

/**
 * Get active opportunities from Notion pipeline
 * Excludes Pass/No Bid items - only shows what we're actively working on
 */
export async function getActivePipeline(): Promise<PipelineOpportunity[]> {
  if (!NOTION_API_KEY) {
    console.log('[SharedContext] No Notion API key, skipping pipeline fetch');
    return [];
  }

  try {
    const response = await fetch(
      `https://api.notion.com/v1/databases/${PIPELINE_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            and: [
              { property: 'Stage', status: { does_not_equal: 'Pass' } },
              { property: 'Stage', status: { does_not_equal: 'No Bid' } },
            ],
          },
          sorts: [{ property: 'Date Added', direction: 'descending' }],
          page_size: 20,
        }),
      }
    );

    if (!response.ok) {
      console.warn('[SharedContext] Notion API error:', response.status);
      return [];
    }

    const data = (await response.json()) as { results?: any[] };
    const items: PipelineOpportunity[] = [];

    for (const page of data.results || []) {
      const props = page.properties;
      items.push({
        name: props.Name?.title?.[0]?.plain_text || 'Untitled',
        stage: props.Stage?.status?.name || 'Unknown',
        agency: props.Agency?.select?.name || undefined,
        dueDate: props['Due Date']?.date?.start || undefined,
        type: props['Solicitation Type']?.select?.name || undefined,
      });
    }

    console.log(`[SharedContext] Loaded ${items.length} pipeline opportunities`);
    return items;
  } catch (err) {
    console.warn('[SharedContext] Error fetching pipeline:', err);
    return [];
  }
}

/**
 * Format pipeline for agent prompt
 */
export function formatPipelineForPrompt(pipeline: PipelineOpportunity[]): string {
  if (pipeline.length === 0) {
    return `
=== ACTIVE PIPELINE ===
No active opportunities in the pipeline.
`;
  }

  const byStage: Record<string, PipelineOpportunity[]> = {};
  for (const opp of pipeline) {
    if (!byStage[opp.stage]) byStage[opp.stage] = [];
    byStage[opp.stage].push(opp);
  }

  let output = `
=== ACTIVE PIPELINE (What We're Working On) ===
`;

  for (const [stage, opps] of Object.entries(byStage)) {
    output += `\n**${stage}:**\n`;
    for (const opp of opps) {
      output += `• ${opp.name}`;
      if (opp.agency) output += ` (${opp.agency})`;
      if (opp.dueDate) output += ` - Due: ${opp.dueDate}`;
      output += '\n';
    }
  }

  output += `
=== END PIPELINE ===
`;

  return output;
}

// ============================================================
// RECENT DECISIONS - What we've decided
// ============================================================

export interface RecentDecision {
  opportunity: string;
  decision: string;
  rationale?: string;
  date: string;
}

/**
 * Get recent opportunity decisions from seen_opportunities
 */
export async function getRecentDecisions(days: number = 14): Promise<RecentDecision[]> {
  try {
    const supabase = getSupabase();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const { data } = await supabase
      .from('seen_opportunities')
      .select('title, decision, decision_rationale, decision_date')
      .not('decision', 'is', null)
      .gte('decision_date', cutoff.toISOString())
      .order('decision_date', { ascending: false })
      .limit(15);

    if (!data) return [];

    return data.map((d) => ({
      opportunity: d.title,
      decision: d.decision,
      rationale: d.decision_rationale || undefined,
      date: d.decision_date,
    }));
  } catch (err) {
    console.warn('[SharedContext] Error fetching decisions:', err);
    return [];
  }
}

/**
 * Format recent decisions for prompt
 */
export function formatDecisionsForPrompt(decisions: RecentDecision[]): string {
  if (decisions.length === 0) return '';

  let output = `
=== RECENT DECISIONS (Remember these - don't bring up passed opportunities) ===
`;

  for (const d of decisions) {
    output += `• ${d.decision.toUpperCase()}: "${d.opportunity}"`;
    if (d.rationale) output += ` - ${d.rationale}`;
    output += '\n';
  }

  return output;
}

// ============================================================
// TEAM FACTS - What we know
// ============================================================

/**
 * Get relevant team facts (availability, preferences, etc.)
 */
export async function getTeamFacts(days: number = 7): Promise<string[]> {
  try {
    const facts = await getExtractedFacts({ limit: 30 });
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    return facts
      .filter((f) => f.created_at && new Date(f.created_at).getTime() > cutoff)
      .map((f) => f.content);
  } catch (err) {
    console.warn('[SharedContext] Error fetching team facts:', err);
    return [];
  }
}

/**
 * Format team facts for prompt
 */
export function formatTeamFactsForPrompt(facts: string[]): string {
  if (facts.length === 0) return '';

  return `
=== THINGS YOU KNOW (from recent conversations) ===
${facts.map((f) => `• ${f}`).join('\n')}
`;
}

// ============================================================
// CONVERSATION HISTORY - What we've discussed
// ============================================================

export interface ConversationSummary {
  topic: string;
  summary: string;
  outcome?: string;
  date: string;
}

/**
 * Get recent conversation summaries
 */
export async function getRecentConversations(days: number = 7): Promise<ConversationSummary[]> {
  try {
    const supabase = getSupabase();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const { data } = await supabase
      .from('conversation_memory')
      .select('topic, summary, outcome, created_at')
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (!data) return [];

    return data.map((c) => ({
      topic: c.topic || 'General',
      summary: c.summary,
      outcome: c.outcome || undefined,
      date: c.created_at,
    }));
  } catch (err) {
    console.warn('[SharedContext] Error fetching conversations:', err);
    return [];
  }
}

/**
 * Format conversations for prompt
 */
export function formatConversationsForPrompt(convos: ConversationSummary[]): string {
  if (convos.length === 0) return '';

  return `
=== RECENT CONVERSATIONS (What we've discussed) ===
${convos.map((c) => `• ${c.topic}: ${c.summary}${c.outcome ? ` → ${c.outcome}` : ''}`).join('\n')}
`;
}

// ============================================================
// FULL CONTEXT BUILDER
// ============================================================

export interface SharedContext {
  pipeline: PipelineOpportunity[];
  decisions: RecentDecision[];
  teamFacts: string[];
  conversations: ConversationSummary[];
}

/**
 * Load all shared context in parallel
 */
export async function loadSharedContext(): Promise<SharedContext> {
  const [pipeline, decisions, teamFacts, conversations] = await Promise.all([
    getActivePipeline(),
    getRecentDecisions(),
    getTeamFacts(),
    getRecentConversations(),
  ]);

  return { pipeline, decisions, teamFacts, conversations };
}

/**
 * Format full shared context for agent prompt
 */
export function formatSharedContextForPrompt(ctx: SharedContext): string {
  return [
    formatPipelineForPrompt(ctx.pipeline),
    formatDecisionsForPrompt(ctx.decisions),
    formatTeamFactsForPrompt(ctx.teamFacts),
    formatConversationsForPrompt(ctx.conversations),
  ].join('\n');
}
