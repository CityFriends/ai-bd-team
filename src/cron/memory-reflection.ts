/**
 * Memory Reflection Cron
 *
 * Periodically synthesizes insights from recent agent observations.
 * This enables emergent intelligence by having agents "reflect" on
 * their experiences and identify patterns.
 *
 * Schedule: Daily (recommended to run during off-hours)
 */
import 'dotenv/config';
import {
  logJobStart,
  logJobComplete,
  logJobFailed,
  acquireCronLock,
} from '../integrations/database/cron.js';
import { getAnthropic } from '../integrations/claude.js';
import {
  storeMemory,
  getRecentMemories,
  getMemoriesByType,
  type AgentName,
} from '../memory/index.js';

// Agents to run reflection for
const AGENTS: AgentName[] = ['david', 'james', 'marcus', 'rosa'];

// How far back to look for observations (in days)
const LOOKBACK_DAYS = 7;

// Minimum observations needed to trigger reflection
const MIN_OBSERVATIONS = 3;

// ============================================================
// Reflection Generation
// ============================================================

interface ReflectionResult {
  patterns: string[];
  insights: string[];
  recommendations: string[];
}

async function generateReflection(
  agent: AgentName,
  observations: string[]
): Promise<ReflectionResult> {
  const client = getAnthropic();

  const agentContextMap: Record<AgentName, string> = {
    david:
      'a research analyst who investigates federal contracting opportunities, identifying red/green flags and incumbent advantages',
    james:
      'a strategic capture manager who makes go/no-go decisions on opportunities based on win probability and risk assessment',
    marcus:
      'a technical lead who assesses technical requirements, compliance needs, and engineering fit for opportunities',
    rosa: 'a partnerships specialist who evaluates teaming strategies and relationship opportunities',
    maya: 'an opportunity scout who discovers new federal contracts',
    patricia: 'a project manager who coordinates the team',
    jodie:
      'a proposal writer who drafts compliant, compelling responses to RFPs and helps with capture narratives',
  };

  const prompt = `You are ${agent}, ${agentContextMap[agent]}. Review your recent observations and identify patterns, insights, and recommendations.

RECENT OBSERVATIONS (last ${LOOKBACK_DAYS} days):
${observations.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Analyze these observations and provide:

1. PATTERNS: Recurring themes or trends you notice across multiple observations
2. INSIGHTS: Conclusions or learnings that could inform future decisions
3. RECOMMENDATIONS: Specific suggestions for the team based on what you've observed

Be specific and actionable. Reference actual observations when possible.

Respond in JSON format:
{
  "patterns": ["pattern 1", "pattern 2", ...],
  "insights": ["insight 1", "insight 2", ...],
  "recommendations": ["recommendation 1", "recommendation 2", ...]
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022', // Use Haiku for reflection (structured JSON output only)
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]) as ReflectionResult;
    return {
      patterns: result.patterns || [],
      insights: result.insights || [],
      recommendations: result.recommendations || [],
    };
  } catch (err) {
    console.error(`[Reflection] Claude analysis failed for ${agent}:`, err);
    return { patterns: [], insights: [], recommendations: [] };
  }
}

// ============================================================
// Store Reflections as Memories
// ============================================================

async function storeReflections(agent: AgentName, reflection: ReflectionResult): Promise<number> {
  let stored = 0;

  // Store patterns as reflections
  for (const pattern of reflection.patterns) {
    const result = await storeMemory(agent, 'reflection', `Pattern observed: ${pattern}`, {
      importance: 6,
      tags: ['pattern', 'weekly-reflection'],
    });
    if (result) stored++;
  }

  // Store insights with higher importance
  for (const insight of reflection.insights) {
    const result = await storeMemory(agent, 'insight', insight, {
      importance: 8,
      tags: ['insight', 'weekly-reflection'],
    });
    if (result) stored++;
  }

  // Store recommendations
  for (const rec of reflection.recommendations) {
    const result = await storeMemory(agent, 'insight', `Recommendation: ${rec}`, {
      importance: 7,
      tags: ['recommendation', 'weekly-reflection'],
    });
    if (result) stored++;
  }

  return stored;
}

// ============================================================
// Run Reflection for Single Agent
// ============================================================

async function reflectForAgent(agent: AgentName): Promise<{
  observationsCount: number;
  reflectionsStored: number;
  skipped: boolean;
}> {
  console.log(`[Reflection] Processing ${agent}...`);

  // Get recent observations
  const recentMemories = await getRecentMemories(agent, 50);
  const observations = recentMemories
    .filter((m) => m.memory_type === 'observation')
    .filter((m) => {
      const createdAt = new Date(m.created_at);
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      return createdAt >= cutoff;
    })
    .map((m) => m.content);

  console.log(`[Reflection] Found ${observations.length} observations for ${agent}`);

  if (observations.length < MIN_OBSERVATIONS) {
    console.log(`[Reflection] Skipping ${agent} - not enough observations`);
    return { observationsCount: observations.length, reflectionsStored: 0, skipped: true };
  }

  // Check if we already reflected recently (avoid duplicate reflections)
  const recentReflections = await getMemoriesByType(agent, 'reflection', 5);
  const hasRecentReflection = recentReflections.some((m) => {
    const createdAt = new Date(m.created_at);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return createdAt >= oneDayAgo && m.tags?.includes('weekly-reflection');
  });

  if (hasRecentReflection) {
    console.log(`[Reflection] Skipping ${agent} - already reflected in last 24h`);
    return { observationsCount: observations.length, reflectionsStored: 0, skipped: true };
  }

  // Generate reflection
  const reflection = await generateReflection(agent, observations);

  const totalItems =
    reflection.patterns.length + reflection.insights.length + reflection.recommendations.length;

  if (totalItems === 0) {
    console.log(`[Reflection] No insights generated for ${agent}`);
    return { observationsCount: observations.length, reflectionsStored: 0, skipped: false };
  }

  // Store reflections
  const stored = await storeReflections(agent, reflection);
  console.log(`[Reflection] Stored ${stored} reflections for ${agent}`);

  return { observationsCount: observations.length, reflectionsStored: stored, skipped: false };
}

// ============================================================
// Main Reflection Job
// ============================================================

export async function runMemoryReflection(): Promise<{
  agents: Record<string, { observations: number; reflections: number; skipped: boolean }>;
  totalReflections: number;
}> {
  console.log('[Reflection] Starting memory reflection job...');

  const results: Record<string, { observations: number; reflections: number; skipped: boolean }> =
    {};
  let totalReflections = 0;

  for (const agent of AGENTS) {
    try {
      const result = await reflectForAgent(agent);
      results[agent] = {
        observations: result.observationsCount,
        reflections: result.reflectionsStored,
        skipped: result.skipped,
      };
      totalReflections += result.reflectionsStored;
    } catch (err) {
      console.error(`[Reflection] Failed for ${agent}:`, err);
      results[agent] = { observations: 0, reflections: 0, skipped: true };
    }
  }

  console.log(`[Reflection] Complete. Total reflections stored: ${totalReflections}`);
  return { agents: results, totalReflections };
}

// ============================================================
// Cron Entry Point
// ============================================================

export async function cronMemoryReflection(): Promise<void> {
  // Acquire distributed lock to prevent duplicate runs across replicas
  const { acquired } = await acquireCronLock('memory-reflection', 30);
  if (!acquired) {
    console.log('[Reflection] Another instance already running, exiting');
    return;
  }

  const runId = await logJobStart('memory-reflection');

  try {
    const result = await runMemoryReflection();

    if (runId) {
      await logJobComplete(runId, {
        itemsProcessed: result.totalReflections,
        notes: `Reflected on ${Object.keys(result.agents).length} agents`,
      });
    }
  } catch (err) {
    if (runId) {
      await logJobFailed(runId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

// ============================================================
// Direct Execution
// ============================================================

async function main() {
  console.log('[Reflection] Starting manual reflection run...');

  try {
    await cronMemoryReflection();
    console.log('[Reflection] Done');
    process.exit(0);
  } catch (err) {
    console.error('[Reflection] Failed:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('memory-reflection')) {
  main();
}
