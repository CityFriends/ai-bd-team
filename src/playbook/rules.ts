// Playbook Rules - Utilities for agents to consult the playbook

import { getActiveRules, applyRule } from './database.js';
import { RuleCategory } from './types.js';
import type { ActiveRule, RuleViolation, RuleCategoryValue } from './types.js';

// ============================================================
// Rule Checker - Check opportunity against active rules
// ============================================================
export interface OpportunityContext {
  noticeId: string;
  title: string;
  agency?: string;
  value?: number;
  daysToRespond?: number;
  setAside?: string;
  naics?: string;
}

export interface RuleCheckResult {
  violations: RuleViolation[];
  passed: ActiveRule[];
  recommendation: 'proceed' | 'caution' | 'stop';
  summary: string;
}

/**
 * Check an opportunity against active playbook rules
 */
export async function checkOpportunityAgainstRules(
  opportunity: OpportunityContext,
  categories?: RuleCategoryValue[]
): Promise<RuleCheckResult> {
  const violations: RuleViolation[] = [];
  const passed: ActiveRule[] = [];

  // Get all active rules or filter by category
  let rules: ActiveRule[] = [];

  if (categories && categories.length > 0) {
    for (const category of categories) {
      const categoryRules = await getActiveRules(category);
      rules.push(...categoryRules);
    }
  } else {
    rules = await getActiveRules();
  }

  for (const rule of rules) {
    const violation = checkRuleViolation(rule, opportunity);

    if (violation) {
      violations.push(violation);
    } else {
      passed.push(rule);
    }
  }

  // Determine overall recommendation
  let recommendation: 'proceed' | 'caution' | 'stop';
  let summary: string;

  const highConfidenceViolations = violations.filter((v) => v.rule.confidence >= 0.8);
  const criticalViolations = violations.filter((v) => !v.overrideable);

  if (criticalViolations.length > 0) {
    recommendation = 'stop';
    summary = `${criticalViolations.length} critical rule violation(s) - recommend NO-GO`;
  } else if (highConfidenceViolations.length > 0) {
    recommendation = 'caution';
    summary = `${highConfidenceViolations.length} high-confidence rule violation(s) - review carefully`;
  } else if (violations.length > 0) {
    recommendation = 'caution';
    summary = `${violations.length} rule concern(s) - consider before proceeding`;
  } else {
    recommendation = 'proceed';
    summary = `No rule violations - ${passed.length} rule(s) passed`;
  }

  return {
    violations,
    passed,
    recommendation,
    summary,
  };
}

/**
 * Check if a specific rule is violated by an opportunity
 */
function checkRuleViolation(
  rule: ActiveRule,
  opportunity: OpportunityContext
): RuleViolation | null {
  const evidence = rule.evidence;

  // Timeline rules - check days to respond
  if (rule.category === RuleCategory.TIMELINE || rule.category === RuleCategory.PURSUIT_CRITERIA) {
    // Short deadline threshold
    if (evidence.shortDeadlineWinRate !== undefined && opportunity.daysToRespond !== undefined) {
      const threshold = evidence.threshold || 30;
      if (opportunity.daysToRespond < threshold) {
        return {
          rule,
          violation: `Only ${opportunity.daysToRespond} days to respond (threshold: ${threshold})`,
          recommendation: 'Consider passing unless compelling reason to override',
          overrideable: true,
        };
      }
    }
  }

  // Capacity rules
  if (rule.category === RuleCategory.CAPACITY) {
    // This would need to check current pursuit count - handled elsewhere
    // Just flag as potential concern
    if (evidence.threshold !== undefined) {
      // Capacity check happens at runtime, not here
    }
  }

  // Value rules
  const minValue = evidence.minValue as number | undefined;
  const maxValue = evidence.maxValue as number | undefined;

  if (typeof minValue === 'number' && opportunity.value !== undefined) {
    if (opportunity.value < minValue) {
      return {
        rule,
        violation: `Value $${opportunity.value.toLocaleString()} below minimum $${minValue.toLocaleString()}`,
        recommendation: 'May not be worth the BD investment',
        overrideable: true,
      };
    }
  }

  if (typeof maxValue === 'number' && opportunity.value !== undefined) {
    if (opportunity.value > maxValue) {
      return {
        rule,
        violation: `Value $${opportunity.value.toLocaleString()} above maximum $${maxValue.toLocaleString()}`,
        recommendation: 'May be too large for our current capacity',
        overrideable: true,
      };
    }
  }

  // Agency rules
  if (evidence.excludedAgencies !== undefined && opportunity.agency) {
    const excluded = evidence.excludedAgencies as string[];
    if (excluded.some((a) => opportunity.agency?.toLowerCase().includes(a.toLowerCase()))) {
      return {
        rule,
        violation: `Agency "${opportunity.agency}" is in excluded list`,
        recommendation: rule.rule,
        overrideable: true,
      };
    }
  }

  // Note: preferredAgencies is a positive check, not a violation
  // It's intentionally not used here since we only return violations

  return null;
}

// ============================================================
// Capacity Check
// ============================================================
export interface CapacityCheckResult {
  currentPursuits: number;
  threshold: number;
  overCapacity: boolean;
  rule: ActiveRule | null;
}

/**
 * Check current team capacity against playbook rules
 */
export async function checkCapacity(currentPursuitCount: number): Promise<CapacityCheckResult> {
  const rules = await getActiveRules(RuleCategory.CAPACITY);

  for (const rule of rules) {
    const threshold = rule.evidence.threshold as number | undefined;

    if (threshold !== undefined && currentPursuitCount >= threshold) {
      return {
        currentPursuits: currentPursuitCount,
        threshold,
        overCapacity: true,
        rule,
      };
    }
  }

  return {
    currentPursuits: currentPursuitCount,
    threshold: 5, // Default
    overCapacity: false,
    rule: null,
  };
}

// ============================================================
// Agent Involvement Check
// ============================================================
export interface AgentInvolvementRule {
  agent: string;
  required: boolean;
  winRateWith: number;
  winRateWithout: number;
  rule: ActiveRule;
}

/**
 * Get rules about required agent involvement
 */
export async function getAgentInvolvementRules(): Promise<AgentInvolvementRule[]> {
  const rules = await getActiveRules(RuleCategory.TECH_ASSESSMENT);
  const results: AgentInvolvementRule[] = [];

  for (const rule of rules) {
    if (rule.evidence.agent && rule.evidence.winRateWithAgent !== undefined) {
      results.push({
        agent: rule.evidence.agent as string,
        required: true,
        winRateWith: rule.evidence.winRateWithAgent as number,
        winRateWithout: (rule.evidence.winRateWithoutAgent as number) || 0,
        rule,
      });
    }
  }

  return results;
}

// ============================================================
// Format Rules for Prompt
// ============================================================

/**
 * Format active rules for inclusion in agent prompts
 */
export async function formatRulesForPrompt(categories?: RuleCategoryValue[]): Promise<string> {
  let rules: ActiveRule[] = [];

  if (categories && categories.length > 0) {
    for (const category of categories) {
      const categoryRules = await getActiveRules(category);
      rules.push(...categoryRules);
    }
  } else {
    rules = await getActiveRules();
  }

  if (rules.length === 0) {
    return '';
  }

  let formatted = '\n📋 TEAM PLAYBOOK RULES (learned from past outcomes):\n';

  for (const rule of rules) {
    const confidence = Math.round(rule.confidence * 100);
    formatted += `• [${confidence}% confidence] ${rule.rule}\n`;
  }

  formatted += '\nConsider these rules in your analysis. You can override with good reason.\n';

  return formatted;
}

/**
 * Format rule violations for inclusion in recommendations
 */
export function formatViolationsForPrompt(violations: RuleViolation[]): string {
  if (violations.length === 0) {
    return '';
  }

  let formatted = '\n⚠️ PLAYBOOK CONCERNS:\n';

  for (const v of violations) {
    const confidence = Math.round(v.rule.confidence * 100);
    formatted += `• ${v.violation}\n`;
    formatted += `  Rule: "${v.rule.rule}" (${confidence}% confidence)\n`;
    formatted += `  Recommendation: ${v.recommendation}\n`;
  }

  return formatted;
}

// ============================================================
// Record Rule Application
// ============================================================

/**
 * Record that rules were applied to an opportunity
 */
export async function recordRulesApplied(
  opportunity: OpportunityContext,
  appliedRules: ActiveRule[],
  appliedBy: string
): Promise<void> {
  for (const rule of appliedRules) {
    await applyRule(rule.id, opportunity.noticeId, opportunity.title, appliedBy, {
      agency: opportunity.agency,
      value: opportunity.value,
      daysToRespond: opportunity.daysToRespond,
    });
  }
}
