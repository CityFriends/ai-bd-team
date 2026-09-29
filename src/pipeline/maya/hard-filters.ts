/**
 * Hard Exclusion Filters
 *
 * Applied BEFORE any AI request. Zero LLM calls for filtered opportunities.
 *
 * Supports evaluationAsOf for historical replay — deadline viability is
 * evaluated relative to the observation date, not today's date.
 */

import type { NormalizedOpportunity, HardFilterResult } from './types.js';

/**
 * Options for hard filter evaluation.
 * evaluationAsOf: reference date for deadline checks.
 *   - undefined → use current time (production default)
 *   - Date → evaluate deadline relative to this date (historical replay)
 *   - 'UNKNOWN' → skip temporal evaluation entirely
 */
export interface HardFilterOptions {
  evaluationAsOf?: Date | 'UNKNOWN';
}

// ============================================================
// Classified Work
// ============================================================

const CLASSIFIED_KEYWORDS = [
  'ts/sci',
  'top secret',
  'sci clearance',
  'security clearance required',
  'cleared personnel',
  'secret clearance',
  'facility clearance',
  'classified environment',
  'classified network',
  'classified system',
  'scif',
  'sensitive compartmented',
];

function isClassified(opp: NormalizedOpportunity): boolean {
  const text = `${opp.title} ${opp.description || ''} ${opp.synopsis || ''}`.toLowerCase();
  return CLASSIFIED_KEYWORDS.some((kw) => text.includes(kw));
}

// ============================================================
// Staff Augmentation
// ============================================================

const CLEAR_STAFFING_KEYWORDS = [
  'staffing augmentation',
  'staff aug',
  'body shop',
  'provide developers',
  'provide programmers',
  'provide staff',
  'temporary staffing',
  'staffing services',
];

function isClearStaffAugmentation(opp: NormalizedOpportunity): boolean {
  const text = `${opp.title} ${opp.description || ''}`.toLowerCase();
  const hasStaffingKeyword = CLEAR_STAFFING_KEYWORDS.some((kw) => text.includes(kw));
  if (!hasStaffingKeyword) return false;
  const outcomeKeywords = ['deliverable', 'outcome', 'product', 'design', 'research', 'prototype'];
  return !outcomeKeywords.some((kw) => text.includes(kw));
}

// ============================================================
// Deadline — supports evaluationAsOf
// ============================================================

export type TemporalStatus = 'ACTIVE' | 'EXPIRED' | 'UNKNOWN' | 'NO_DEADLINE';

function evaluateDeadline(
  opp: NormalizedOpportunity,
  options: HardFilterOptions = {}
): TemporalStatus {
  if (!opp.responseDeadline) return 'NO_DEADLINE';

  if (options.evaluationAsOf === 'UNKNOWN') return 'UNKNOWN';

  const referenceDate = options.evaluationAsOf || new Date();
  const deadline = new Date(opp.responseDeadline);

  return deadline.getTime() < referenceDate.getTime() ? 'EXPIRED' : 'ACTIVE';
}

// ============================================================
// Inactive / Cancelled
// ============================================================

function isInactiveOrCancelled(opp: NormalizedOpportunity): boolean {
  return !opp.active || opp.cancelled || opp.archived;
}

// ============================================================
// Main Hard Filter
// ============================================================

export function applyHardFilters(
  opp: NormalizedOpportunity,
  options: HardFilterOptions = {}
): HardFilterResult {
  if (isInactiveOrCancelled(opp)) {
    return {
      excluded: true,
      reason: 'Opportunity is inactive or cancelled',
      rule: 'inactive_cancelled',
    };
  }

  const temporal = evaluateDeadline(opp, options);
  if (temporal === 'EXPIRED') {
    return { excluded: true, reason: 'Response deadline has passed', rule: 'expired' };
  }
  // UNKNOWN temporal status → do not exclude (fail open for temporal uncertainty)

  if (isClassified(opp)) {
    return {
      excluded: true,
      reason: 'Requires security clearance FFTC cannot support',
      rule: 'classified',
    };
  }

  if (isClearStaffAugmentation(opp)) {
    return {
      excluded: true,
      reason: 'Clear staff augmentation / body shop work',
      rule: 'staff_augmentation',
    };
  }

  return { excluded: false, reason: null, rule: null };
}

export const _testExports = {
  isClassified,
  isClearStaffAugmentation,
  evaluateDeadline,
  isInactiveOrCancelled,
};
