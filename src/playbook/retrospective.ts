// Playbook Retrospective - Patricia's monthly analysis

import { getSupabase } from '../integrations/database/client.js';
import {
  proposeRule,
  checkRuleHealth,
  retireRule,
  createRetrospectiveRun,
  completeRetrospectiveRun,
} from './database.js';
import { RuleCategory, RuleType } from './types.js';
import type { OutcomeData, ChainData, PlaybookRule } from './types.js';

// ============================================================
// Get Completed Outcomes
// ============================================================
async function getOutcomes(months: number = 6): Promise<OutcomeData[]> {
  try {
    const supabase = getSupabase();
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const { data, error } = await supabase
      .from('decision_outcomes')
      .select('*')
      .gte('created_at', since.toISOString())
      .not('outcome', 'is', null);

    if (error) {
      console.error('[Retrospective] Failed to get outcomes:', error);
      return [];
    }

    return (data || []).map((row) => ({
      opportunity_id: row.id,
      notice_id: row.notice_id,
      title: row.opportunity_title || 'Unknown',
      outcome: row.outcome,
      discovery_to_go_days: row.discovery_to_go_days || 0,
      days_from_discovery_to_due: row.days_to_deadline || 0,
      agents_involved: row.agents_involved || [],
      value: row.value,
      agency: row.agency,
      created_at: row.created_at,
    }));
  } catch (err) {
    console.error('[Retrospective] Exception getting outcomes:', err);
    return [];
  }
}

// ============================================================
// Get Completed Event Chains
// ============================================================
async function getCompletedChains(months: number = 3): Promise<ChainData[]> {
  try {
    const supabase = getSupabase();
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    // Get completed event chains
    const { data, error } = await supabase
      .from('agent_events')
      .select('root_event_id, source_agent, event_type, created_at, completed_at, payload')
      .eq('status', 'completed')
      .eq('chain_depth', 0) // Root events only
      .gte('created_at', since.toISOString());

    if (error) {
      console.error('[Retrospective] Failed to get chains:', error);
      return [];
    }

    // Group by root_event_id and aggregate
    const chainMap = new Map<string, ChainData>();

    for (const event of data || []) {
      const rootId = event.root_event_id || event.root_event_id;
      if (!rootId) continue;

      if (!chainMap.has(rootId)) {
        const payload = event.payload as Record<string, unknown>;
        chainMap.set(rootId, {
          root_event_id: rootId,
          opportunity_id: (payload?.noticeId as string) || '',
          title: (payload?.title as string) || 'Unknown',
          agents_involved: [],
          events_count: 0,
          chain_duration_hours: 0,
          outcome: null,
          created_at: event.created_at,
          completed_at: event.completed_at,
        });
      }

      const chain = chainMap.get(rootId)!;
      chain.events_count++;

      if (!chain.agents_involved.includes(event.source_agent)) {
        chain.agents_involved.push(event.source_agent);
      }

      if (event.completed_at) {
        const duration =
          new Date(event.completed_at).getTime() - new Date(chain.created_at).getTime();
        chain.chain_duration_hours = Math.max(
          chain.chain_duration_hours,
          duration / (1000 * 60 * 60)
        );
      }
    }

    return Array.from(chainMap.values());
  } catch (err) {
    console.error('[Retrospective] Exception getting chains:', err);
    return [];
  }
}

// ============================================================
// Get Active Pursuit Count
// ============================================================
async function getActivePursuitCount(): Promise<number> {
  try {
    const supabase = getSupabase();

    const { count, error } = await supabase
      .from('opportunity_workflow')
      .select('*', { count: 'exact', head: true })
      .eq('stage', 'pursuing');

    if (error) {
      console.error('[Retrospective] Failed to get pursuit count:', error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error('[Retrospective] Exception getting pursuit count:', err);
    return 0;
  }
}

// ============================================================
// Helper Functions
// ============================================================
function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function getWinRate(items: { outcome?: string }[]): number {
  if (items.length === 0) return 0;
  const wins = items.filter((i) => i.outcome === 'won').length;
  return wins / items.length;
}

// ============================================================
// Monthly Retrospective - Main Analysis
// ============================================================
export interface RetrospectiveResults {
  runId: string;
  outcomesAnalyzed: number;
  chainsAnalyzed: number;
  rulesProposed: PlaybookRule[];
  findings: {
    timingPatterns?: {
      avgWinDiscoveryToGo: number;
      avgLossDiscoveryToGo: number;
    };
    deadlinePatterns?: {
      shortDeadlineWinRate: number;
      sampleSize: number;
    };
    agentPatterns?: Array<{
      agent: string;
      winRateWith: number;
      winRateWithout: number;
    }>;
    capacityPatterns?: {
      overloadWinRate: number;
      normalWinRate: number;
      threshold: number;
    };
  };
}

export async function runMonthlyRetrospective(): Promise<RetrospectiveResults | null> {
  console.log('[Retrospective] Starting monthly retrospective...');

  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - 3); // Analyze last 3 months

  // Create retrospective run
  const runId = await createRetrospectiveRun(periodStart, periodEnd);
  if (!runId) {
    console.error('[Retrospective] Failed to create retrospective run');
    return null;
  }

  const rulesProposed: PlaybookRule[] = [];
  const findings: RetrospectiveResults['findings'] = {};

  try {
    // Get data
    const outcomes = await getOutcomes(6); // 6 months of outcomes
    const chains = await getCompletedChains(3); // 3 months of chains

    console.log(
      `[Retrospective] Analyzing ${outcomes.length} outcomes and ${chains.length} chains`
    );

    // ─── TIMING PATTERNS ───
    const winTimelines = outcomes.filter((o) => o.outcome === 'won');
    const lossTimelines = outcomes.filter((o) => o.outcome === 'lost');

    if (winTimelines.length >= 3 && lossTimelines.length >= 3) {
      const avgWinDiscoveryToGo = average(winTimelines.map((o) => o.discovery_to_go_days));
      const avgLossDiscoveryToGo = average(lossTimelines.map((o) => o.discovery_to_go_days));

      findings.timingPatterns = { avgWinDiscoveryToGo, avgLossDiscoveryToGo };

      // If wins are significantly faster, propose a rule
      if (avgWinDiscoveryToGo < avgLossDiscoveryToGo * 0.7) {
        const ruleId = await proposeRule({
          rule_type: RuleType.PROCESS_RULE,
          category: RuleCategory.TIMELINE,
          rule: `Move faster on go/no-go decisions. Wins averaged ${Math.round(avgWinDiscoveryToGo)} days from discovery to GO vs ${Math.round(avgLossDiscoveryToGo)} days for losses.`,
          evidence: { avgWinDiscoveryToGo, avgLossDiscoveryToGo, sample_size: outcomes.length },
          proposed_by: 'patricia',
          confidence: 0.6,
        });

        if (ruleId) {
          const rule = { id: ruleId, rule: 'Timing pattern rule' } as PlaybookRule;
          rulesProposed.push(rule);
        }
      }
    }

    // ─── RESPONSE TIME THRESHOLD ───
    const shortDeadlineOutcomes = outcomes.filter((o) => o.days_from_discovery_to_due < 30);

    if (shortDeadlineOutcomes.length >= 3) {
      const shortDeadlineWinRate = getWinRate(shortDeadlineOutcomes);

      findings.deadlinePatterns = {
        shortDeadlineWinRate,
        sampleSize: shortDeadlineOutcomes.length,
      };

      if (shortDeadlineWinRate < 0.2) {
        const ruleId = await proposeRule({
          rule_type: RuleType.THRESHOLD,
          category: RuleCategory.PURSUIT_CRITERIA,
          rule: `Avoid opportunities with less than 30 days to respond. Our win rate on those is ${Math.round(shortDeadlineWinRate * 100)}%.`,
          evidence: {
            shortDeadlineWinRate,
            sample_size: shortDeadlineOutcomes.length,
            threshold: 30,
          },
          proposed_by: 'patricia',
          confidence: 0.65,
        });

        if (ruleId) {
          rulesProposed.push({ id: ruleId, rule: 'Short deadline rule' } as PlaybookRule);
        }
      }
    }

    // ─── MISSING STEPS CORRELATION ───
    const agents = ['maya', 'david', 'marcus', 'rosa', 'james', 'patricia'];

    for (const agent of agents) {
      const chainsWithAgent = chains.filter((c) => c.agents_involved.includes(agent));
      const chainsWithoutAgent = chains.filter((c) => !c.agents_involved.includes(agent));

      if (chainsWithAgent.length >= 3 && chainsWithoutAgent.length >= 3) {
        // Cross-reference with outcomes
        const outcomesByNoticeId = new Map(outcomes.map((o) => [o.notice_id, o]));

        const withAgentOutcomes = chainsWithAgent
          .map((c) => outcomesByNoticeId.get(c.opportunity_id))
          .filter((o): o is OutcomeData => o !== undefined);

        const withoutAgentOutcomes = chainsWithoutAgent
          .map((c) => outcomesByNoticeId.get(c.opportunity_id))
          .filter((o): o is OutcomeData => o !== undefined);

        const winRateWith = getWinRate(withAgentOutcomes);
        const winRateWithout = getWinRate(withoutAgentOutcomes);

        if (!findings.agentPatterns) findings.agentPatterns = [];
        findings.agentPatterns.push({ agent, winRateWith, winRateWithout });

        // If win rate is significantly higher with the agent, propose a rule
        if (winRateWith > winRateWithout * 1.5 && withAgentOutcomes.length >= 3) {
          const ruleId = await proposeRule({
            rule_type: RuleType.SOP,
            category: RuleCategory.TECH_ASSESSMENT,
            rule: `Always include ${agent}'s assessment. Win rate with their input: ${Math.round(winRateWith * 100)}%. Without: ${Math.round(winRateWithout * 100)}%.`,
            evidence: {
              agent,
              winRateWithAgent: winRateWith,
              winRateWithoutAgent: winRateWithout,
              sample_size: withAgentOutcomes.length + withoutAgentOutcomes.length,
            },
            proposed_by: 'patricia',
            confidence: 0.7,
          });

          if (ruleId) {
            rulesProposed.push({ id: ruleId, rule: `${agent} involvement rule` } as PlaybookRule);
          }
        }
      }
    }

    // ─── TEAM CAPACITY PATTERNS ───
    // This would need historical pursuit count data - simplified for now
    const currentPursuits = await getActivePursuitCount();

    if (currentPursuits > 5) {
      // Check if we have evidence of overload affecting performance
      const recentOutcomes = outcomes.filter((o) => {
        const created = new Date(o.created_at);
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        return created > threeMonthsAgo;
      });

      if (recentOutcomes.length >= 5) {
        const recentWinRate = getWinRate(recentOutcomes);

        if (recentWinRate < 0.3) {
          findings.capacityPatterns = {
            overloadWinRate: recentWinRate,
            normalWinRate: 0.5, // Assumed baseline
            threshold: 5,
          };

          const ruleId = await proposeRule({
            rule_type: RuleType.THRESHOLD,
            category: RuleCategory.CAPACITY,
            rule: `Cap active pursuits at 4 simultaneously. Win rate drops significantly when we're running 5+.`,
            evidence: {
              threshold: 5,
              overloadWinRate: recentWinRate,
              normalWinRate: 0.5,
              currentPursuits,
            },
            proposed_by: 'patricia',
            confidence: 0.55,
          });

          if (ruleId) {
            rulesProposed.push({ id: ruleId, rule: 'Capacity threshold rule' } as PlaybookRule);
          }
        }
      }
    }

    // ─── CHECK RULE HEALTH ───
    const healthChecks = await checkRuleHealth();

    for (const check of healthChecks) {
      if (check.should_retire) {
        console.log(
          `[Retrospective] Retiring rule "${check.rule_text}" - ${Math.round(check.override_rate * 100)}% override rate`
        );
        await retireRule(
          check.rule_id,
          `Override rate ${Math.round(check.override_rate * 100)}% exceeds threshold`
        );
      }
    }

    // Complete the run
    await completeRetrospectiveRun(runId, {
      outcomes_analyzed: outcomes.length,
      chains_analyzed: chains.length,
      rules_proposed: rulesProposed.length,
      rules_adopted: 0, // Will be updated when human adopts
      findings,
    });

    console.log(`[Retrospective] Complete. Proposed ${rulesProposed.length} new rule(s).`);

    return {
      runId,
      outcomesAnalyzed: outcomes.length,
      chainsAnalyzed: chains.length,
      rulesProposed,
      findings,
    };
  } catch (err) {
    console.error('[Retrospective] Failed:', err);
    return null;
  }
}

// ============================================================
// Format Retrospective Results for Slack
// ============================================================
export function formatRetrospectiveForSlack(results: RetrospectiveResults): string {
  let message = `📊 *Monthly Retrospective Complete*\n\n`;
  message += `Analyzed ${results.outcomesAnalyzed} outcomes and ${results.chainsAnalyzed} event chains.\n\n`;

  if (results.rulesProposed.length === 0) {
    message += `_No new patterns discovered this month._\n`;
    return message;
  }

  message += `*I found ${results.rulesProposed.length} pattern(s) worth discussing:*\n\n`;

  // Get the actual proposed rules
  // Note: In real implementation, we'd fetch the full rules
  if (results.findings.timingPatterns) {
    const tp = results.findings.timingPatterns;
    message += `1. *Timing matters:* Wins averaged ${Math.round(tp.avgWinDiscoveryToGo)} days from discovery to GO vs ${Math.round(tp.avgLossDiscoveryToGo)} days for losses.\n`;
  }

  if (results.findings.deadlinePatterns) {
    const dp = results.findings.deadlinePatterns;
    message += `2. *Short deadlines hurt:* Our win rate on <30 day opportunities is only ${Math.round(dp.shortDeadlineWinRate * 100)}% (n=${dp.sampleSize}).\n`;
  }

  if (results.findings.agentPatterns) {
    for (const ap of results.findings.agentPatterns) {
      if (ap.winRateWith > ap.winRateWithout * 1.3) {
        message += `3. *${ap.agent}'s input matters:* Win rate with their assessment: ${Math.round(ap.winRateWith * 100)}% vs ${Math.round(ap.winRateWithout * 100)}% without.\n`;
      }
    }
  }

  if (results.findings.capacityPatterns) {
    const cp = results.findings.capacityPatterns;
    message += `4. *We're overloaded:* Win rate drops to ${Math.round(cp.overloadWinRate * 100)}% when running 5+ pursuits.\n`;
  }

  message += `\n<@lapedra> — Want to adopt any of these as team rules? Reply with the rule number(s) to approve.`;

  return message;
}
