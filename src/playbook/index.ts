// Playbook Module - Self-Organizing Process Evolution
// The team's self-discovered rules, SOPs, and lessons learned

// Types
export {
  RuleType,
  RuleCategory,
  RuleStatus,
  type RuleTypeValue,
  type RuleCategoryValue,
  type RuleStatusValue,
  type RuleEvidence,
  type PlaybookRule,
  type ActiveRule,
  type RuleViolation,
  type ProposeRuleInput,
  type PlaybookApplication,
  type RetrospectiveRun,
  type OutcomeData,
  type ChainData,
  type RuleHealthCheck,
} from './types.js';

// Database functions
export {
  proposeRule,
  adoptRule,
  retireRule,
  overrideRule,
  applyRule,
  getActiveRules,
  getProposedRules,
  getRecentProposedRules,
  getRuleById,
  checkRuleHealth,
  updateRuleOutcomes,
  getRuleApplications,
  createRetrospectiveRun,
  completeRetrospectiveRun,
  getPlaybookStats,
  type PlaybookStats,
} from './database.js';

// Rule consultation utilities
export {
  checkOpportunityAgainstRules,
  checkCapacity,
  getAgentInvolvementRules,
  formatRulesForPrompt,
  formatViolationsForPrompt,
  recordRulesApplied,
  type OpportunityContext,
  type RuleCheckResult,
  type CapacityCheckResult,
  type AgentInvolvementRule,
} from './rules.js';

// Retrospective analysis
export {
  runMonthlyRetrospective,
  formatRetrospectiveForSlack,
  type RetrospectiveResults,
} from './retrospective.js';
