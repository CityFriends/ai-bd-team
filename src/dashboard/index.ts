/**
 * System Dashboard
 *
 * Provides observability into the BD team system:
 * - Active workflows and their states
 * - Memory stats per agent
 * - Tool cache hit rates
 * - Recent escalations
 * - System health overview
 */

import { getSupabase } from '../integrations/database/client.js';
import { getActiveWorkflows, getBreachedWorkflows } from '../workflows/index.js';
import { getToolCacheStats } from '../tools/cache.js';

/**
 * Dashboard data structure
 */
export interface DashboardData {
  timestamp: string;
  workflows: {
    active: number;
    byState: Record<string, number>;
    breached: number;
    recentTransitions: Array<{
      reference: string;
      from: string;
      to: string;
      agent?: string;
      timestamp: string;
    }>;
  };
  memory: {
    totalMemories: number;
    byAgent: Record<string, number>;
    recentMemories: number; // Last 24 hours
  };
  cache: {
    totalEntries: number;
    totalHits: number;
    hitRate: string;
    byTool: Record<string, { entries: number; hits: number }>;
  };
  escalations: {
    total24h: number;
    recent: Array<{
      reference: string;
      level: number;
      action: string;
      timestamp: string;
      successful: boolean;
    }>;
  };
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
  };
}

/**
 * Gather all dashboard data
 */
export async function getDashboardData(): Promise<DashboardData> {
  const [workflows, memory, cache, escalations] = await Promise.all([
    getWorkflowStats(),
    getMemoryStats(),
    getCacheStats(),
    getEscalationStats(),
  ]);

  // Determine overall health
  const issues: string[] = [];
  if (workflows.breached > 0) {
    issues.push(`${workflows.breached} workflow(s) past SLA`);
  }
  if (cache.totalEntries === 0) {
    issues.push('Cache is empty');
  }
  if (escalations.total24h > 5) {
    issues.push(`${escalations.total24h} escalations in 24h`);
  }

  const status: 'healthy' | 'degraded' | 'unhealthy' =
    issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'degraded' : 'unhealthy';

  return {
    timestamp: new Date().toISOString(),
    workflows,
    memory,
    cache,
    escalations,
    health: { status, issues },
  };
}

/**
 * Get workflow statistics
 */
async function getWorkflowStats(): Promise<DashboardData['workflows']> {
  const [active, breached] = await Promise.all([
    getActiveWorkflows({ limit: 50 }),
    getBreachedWorkflows(),
  ]);

  // Count by state
  const byState: Record<string, number> = {};
  for (const w of active) {
    byState[w.current_state] = (byState[w.current_state] || 0) + 1;
  }

  // Get recent transitions
  const { data: transitions } = await getSupabase()
    .from('workflow_state_history')
    .select('*, workflow_instances(reference_id, reference_title)')
    .order('transitioned_at', { ascending: false })
    .limit(5);

  const recentTransitions = (transitions || []).map((t: any) => ({
    reference:
      t.workflow_instances?.reference_title || t.workflow_instances?.reference_id || 'Unknown',
    from: t.from_state || 'start',
    to: t.to_state,
    agent: t.agent,
    timestamp: t.transitioned_at,
  }));

  return {
    active: active.length,
    byState,
    breached: breached.length,
    recentTransitions,
  };
}

/**
 * Get memory statistics
 */
async function getMemoryStats(): Promise<DashboardData['memory']> {
  const supabase = getSupabase();

  // Total memories
  const { count: totalMemories } = await supabase
    .from('agent_memories')
    .select('*', { count: 'exact', head: true });

  // By agent
  const { data: agentCounts } = await supabase
    .from('agent_memories')
    .select('agent')
    .then(async (result) => {
      if (!result.data) return { data: [] };
      const counts: Record<string, number> = {};
      for (const row of result.data) {
        counts[row.agent] = (counts[row.agent] || 0) + 1;
      }
      return { data: Object.entries(counts).map(([agent, count]) => ({ agent, count })) };
    });

  const byAgent: Record<string, number> = {};
  for (const row of agentCounts || []) {
    byAgent[row.agent] = row.count;
  }

  // Recent memories (last 24 hours)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentMemories } = await supabase
    .from('agent_memories')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', yesterday);

  return {
    totalMemories: totalMemories || 0,
    byAgent,
    recentMemories: recentMemories || 0,
  };
}

/**
 * Get cache statistics
 */
async function getCacheStats(): Promise<DashboardData['cache']> {
  const stats = await getToolCacheStats();

  const totalHits = stats.totalHits;
  const totalEntries = stats.totalEntries;
  const hitRate =
    totalEntries > 0 ? `${Math.round((totalHits / Math.max(totalEntries, 1)) * 100)}%` : 'N/A';

  return {
    totalEntries,
    totalHits,
    hitRate,
    byTool: stats.byTool,
  };
}

/**
 * Get escalation statistics
 */
async function getEscalationStats(): Promise<DashboardData['escalations']> {
  const supabase = getSupabase();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Count escalations in last 24 hours
  const { count: total24h } = await supabase
    .from('workflow_escalations')
    .select('*', { count: 'exact', head: true })
    .gte('triggered_at', yesterday);

  // Recent escalations
  const { data: recent } = await supabase
    .from('workflow_escalations')
    .select('*, workflow_instances(reference_id, reference_title)')
    .order('triggered_at', { ascending: false })
    .limit(5);

  const recentEscalations = (recent || []).map((e: any) => ({
    reference:
      e.workflow_instances?.reference_title || e.workflow_instances?.reference_id || 'Unknown',
    level: e.escalation_level,
    action: e.action_taken,
    timestamp: e.triggered_at,
    successful: e.action_successful,
  }));

  return {
    total24h: total24h || 0,
    recent: recentEscalations,
  };
}

/**
 * Format dashboard data for Slack
 */
export function formatDashboardForSlack(data: DashboardData): string {
  const lines: string[] = [];

  // Header with health status
  const healthEmoji =
    data.health.status === 'healthy' ? '🟢' : data.health.status === 'degraded' ? '🟡' : '🔴';
  lines.push(`${healthEmoji} *System Dashboard* - ${new Date(data.timestamp).toLocaleString()}\n`);

  // Health issues
  if (data.health.issues.length > 0) {
    lines.push(`⚠️ *Issues:* ${data.health.issues.join(', ')}\n`);
  }

  // Workflows section
  lines.push('*📋 Workflows*');
  lines.push(`• Active: ${data.workflows.active}`);
  if (data.workflows.breached > 0) {
    lines.push(`• ⚠️ Past SLA: ${data.workflows.breached}`);
  }
  if (Object.keys(data.workflows.byState).length > 0) {
    const states = Object.entries(data.workflows.byState)
      .map(([state, count]) => `${state}: ${count}`)
      .join(', ');
    lines.push(`• By state: ${states}`);
  }

  // Memory section
  lines.push('\n*🧠 Agent Memories*');
  lines.push(`• Total: ${data.memory.totalMemories}`);
  lines.push(`• Last 24h: ${data.memory.recentMemories}`);
  if (Object.keys(data.memory.byAgent).length > 0) {
    const agents = Object.entries(data.memory.byAgent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([agent, count]) => `${agent}: ${count}`)
      .join(', ');
    lines.push(`• By agent: ${agents}`);
  }

  // Cache section
  lines.push('\n*💾 Tool Cache*');
  lines.push(`• Entries: ${data.cache.totalEntries}`);
  lines.push(`• Total hits: ${data.cache.totalHits}`);
  if (Object.keys(data.cache.byTool).length > 0) {
    const tools = Object.entries(data.cache.byTool)
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, 3)
      .map(([tool, stats]) => `${tool}: ${stats.hits} hits`)
      .join(', ');
    lines.push(`• Top tools: ${tools}`);
  }

  // Escalations section
  if (data.escalations.total24h > 0) {
    lines.push('\n*🚨 Escalations (24h)*');
    lines.push(`• Total: ${data.escalations.total24h}`);
    if (data.escalations.recent.length > 0) {
      lines.push('• Recent:');
      for (const esc of data.escalations.recent.slice(0, 3)) {
        const status = esc.successful ? '✓' : '✗';
        lines.push(`  ${status} ${esc.reference.slice(0, 30)}... - ${esc.action}`);
      }
    }
  }

  // Recent workflow activity
  if (data.workflows.recentTransitions.length > 0) {
    lines.push('\n*🔄 Recent Transitions*');
    for (const t of data.workflows.recentTransitions.slice(0, 3)) {
      const time = new Date(t.timestamp).toLocaleTimeString();
      lines.push(`• ${t.reference.slice(0, 25)}... ${t.from} → ${t.to} (${time})`);
    }
  }

  return lines.join('\n');
}

/**
 * Format dashboard data as compact JSON for API
 */
export function formatDashboardAsJSON(data: DashboardData): string {
  return JSON.stringify(data, null, 2);
}
