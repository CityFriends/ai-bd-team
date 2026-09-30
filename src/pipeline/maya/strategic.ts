/**
 * Strategic Override Rules
 *
 * Legitimate exceptional cases that force Maya review even if base score
 * is below normal threshold. Agency familiarity alone does NOT trigger override.
 *
 * Invariant: AGENCY SIGNAL + REAL CAPABILITY/ACQUISITION RELEVANCE = possible escalation.
 * Agency alone: NO. Certification alone: NO. Keyword alone: NO.
 */

import type { NormalizedOpportunity, FitScoreResult, StrategicOverride } from './types.js';
import { classifyNonCompetitive, type NonCompetitiveResult } from './non-competitive.js';
import type { CompanyProfileData } from './company-repository.js';
import type { PursuitPreferences } from './company-repository.js';

/** Minimum capability fit (out of 25) required for contextual escalation */
const MIN_CAPABILITY_FIT = 15;

export function checkStrategicOverrides(
  opp: NormalizedOpportunity,
  fitScore: FitScoreResult,
  preferences: PursuitPreferences,
  profile: CompanyProfileData
): StrategicOverride {
  const rules: string[] = [];

  // ============================================================
  // Legitimate directed/non-competitive overrides
  // These do NOT require agency experience or capability fit
  // because the opportunity is specifically targeted.
  // ============================================================

  // 8(a) sole-source / directed to FFTC
  const nonComp = classifyNonCompetitive(opp, profile);
  if (nonComp.classification === 'EIGHT_A_SOLE_SOURCE') {
    rules.push('Potential 8(a) sole-source — FFTC holds 8(a) certification');
  }
  if (nonComp.classification === 'DIRECTED_TO_FFTC') {
    rules.push('Non-competitive notice directed to FFTC');
  }

  // ============================================================
  // Capability-gated contextual escalation
  // All of these require genuine capability relevance (capabilityFit >= 15/25).
  // Agency experience, certification, recompete, modernization signals
  // may STRENGTHEN a relevant opportunity but cannot manufacture relevance.
  // ============================================================

  if (fitScore.breakdown.capabilityFit >= MIN_CAPABILITY_FIT) {
    // Strong prime-building opportunity
    if (fitScore.breakdown.primeSuitability >= 4) {
      rules.push('Strong prime-building opportunity with capability fit');
    }

    // Agency experience + capability fit
    const agencyText = (opp.agency || '').toLowerCase();
    const hasAgencyExperience = preferences.agencyExperience.some((a) =>
      agencyText.includes(a.toLowerCase())
    );
    if (hasAgencyExperience) {
      rules.push(`Agency experience (${opp.agency}) with capability fit`);
    }
  }

  return { triggered: rules.length > 0, rules };
}

/**
 * Return the non-competitive classification for pipeline decision-making.
 */
export function getNonCompetitiveClassification(
  opp: NormalizedOpportunity,
  profile: CompanyProfileData
): NonCompetitiveResult {
  return classifyNonCompetitive(opp, profile);
}
