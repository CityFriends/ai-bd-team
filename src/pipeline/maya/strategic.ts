/**
 * Strategic Override Rules
 *
 * Forces Maya review even if base score is below normal threshold.
 * Uses organizational data from repository, not static imports.
 */

import type { NormalizedOpportunity, FitScoreResult, StrategicOverride } from './types.js';
import type { PursuitPreferences } from './company-repository.js';
import { classifyNonCompetitive, type NonCompetitiveResult } from './non-competitive.js';
import type { CompanyProfileData } from './company-repository.js';

export function checkStrategicOverrides(
  opp: NormalizedOpportunity,
  fitScore: FitScoreResult,
  preferences: PursuitPreferences,
  profile: CompanyProfileData
): StrategicOverride {
  const rules: string[] = [];
  const text = `${opp.title} ${opp.description || ''}`.toLowerCase();

  // Strategic agency + strong capability fit
  const agencyText = (opp.agency || '').toLowerCase();
  const isStrategicAgency = preferences.strategicAgencies.some((a) =>
    agencyText.includes(a.toLowerCase())
  );
  if (isStrategicAgency && fitScore.breakdown.capabilityFit >= 15) {
    rules.push(`Strategic agency (${opp.agency}) with strong capability fit`);
  }

  // 8(a) sole-source possibility
  const nonComp = classifyNonCompetitive(opp, profile);
  if (nonComp.classification === 'EIGHT_A_SOLE_SOURCE') {
    rules.push('Potential 8(a) sole-source — FFTC holds 8(a) certification');
  }
  if (nonComp.classification === 'DIRECTED_TO_FFTC') {
    rules.push('Non-competitive notice directed to FFTC');
  }

  // SDVOSB/WOSB advantage at strategic agency
  const setAside = (opp.setAside || opp.setAsideDescription || '').toLowerCase();
  if (isStrategicAgency) {
    const hasCertAdvantage =
      setAside.includes('sdvosb') ||
      setAside.includes('wosb') ||
      setAside.includes('service-disabled') ||
      setAside.includes('women-owned');
    if (hasCertAdvantage) {
      rules.push(`Certification advantage (${setAside.slice(0, 30)}) at strategic agency`);
    }
  }

  // Prime-building opportunity
  if (fitScore.breakdown.primeSuitability >= 4 && fitScore.breakdown.capabilityFit >= 15) {
    rules.push('Strong prime-building opportunity');
  }

  // Recompete at strategic agency
  const recompeteSignals = ['recompete', 'follow-on', 'successor', 'incumbent'];
  if (recompeteSignals.some((s) => text.includes(s)) && isStrategicAgency) {
    rules.push('Strategic agency recompete');
  }

  // Digital modernization at strategic agency
  const modernizationSignals = ['modernization', 'digital transformation', 'digital services'];
  if (modernizationSignals.some((s) => text.includes(s)) && isStrategicAgency) {
    rules.push('Digital modernization at strategic agency');
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
