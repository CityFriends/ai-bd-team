/**
 * Deterministic Fit Scoring — 0-100
 *
 * Configurable weights. No LLM calls.
 * Company data comes from CompanyProfileRepository (DB), not static imports.
 * Keyword taxonomies are scoring logic, not organizational data.
 */

import type {
  NormalizedOpportunity,
  FitScoreResult,
  FitScoreBreakdown,
  ScoringWeights,
  PastPerformanceMatch,
} from './types.js';
import { DEFAULT_WEIGHTS } from './types.js';
import {
  CAPABILITY_POSITIVE_KEYWORDS,
  CAPABILITY_NEGATIVE_KEYWORDS,
  COMPLIANCE_CONTEXT_KEYWORDS,
  COMPLIANCE_AS_DELIVERABLE_INDICATORS,
  COMPLIANCE_AS_CHECKBOX_INDICATORS,
  matchPastPerformance,
  normalizeAgency,
  agenciesMatch,
  agenciesRelated,
} from './company-profile.js';
import {
  classifyAcquisitionNature,
  type AcquisitionClassification,
} from './acquisition-classifier.js';
import type {
  CompanyProfileData,
  PastPerformanceRecord,
  PursuitPreferences,
} from './company-repository.js';

// ============================================================
// Scoring Context — loaded from repository, passed to scorer
// ============================================================

export interface ScoringContext {
  profile: CompanyProfileData;
  pastPerformance: PastPerformanceRecord[];
  preferences: PursuitPreferences;
}

// ============================================================
// Dimension Scorers
// ============================================================

function scoreCapabilityFit(opp: NormalizedOpportunity): {
  score: number;
  reasons: string[];
  concerns: string[];
  acquisitionNature: AcquisitionClassification;
} {
  const text = `${opp.title} ${opp.description || ''} ${opp.synopsis || ''}`.toLowerCase();
  const reasons: string[] = [];
  const concerns: string[] = [];

  // Classify acquisition nature
  const acqNature = classifyAcquisitionNature(opp.title, opp.description || '');

  // If clearly COTS/license/medical with no custom component, capability ≈ 0
  if (
    (acqNature.nature === 'SOFTWARE_LICENSE' ||
      acqNature.nature === 'COTS_PRODUCT' ||
      acqNature.nature === 'MEDICAL_OR_SPECIALIZED_PRODUCT') &&
    !acqNature.hasCustomServiceComponent &&
    acqNature.confidence !== 'LOW'
  ) {
    concerns.push(`Acquisition nature: ${acqNature.nature}`);
    return { score: 0, reasons: [], concerns, acquisitionNature: acqNature };
  }

  // Count core capability keyword hits
  let positiveHits = 0;
  const matched: string[] = [];
  for (const kw of CAPABILITY_POSITIVE_KEYWORDS) {
    if (kw.length <= 3 ? new RegExp(`\\b${kw}\\b`, 'i').test(text) : text.includes(kw)) {
      positiveHits++;
      if (matched.length < 5) matched.push(kw);
    }
  }

  // Compliance-context keywords: only count if accessibility is a DELIVERABLE
  for (const kw of COMPLIANCE_CONTEXT_KEYWORDS) {
    if (kw.length <= 3 ? new RegExp(`\\b${kw}\\b`, 'i').test(text) : text.includes(kw)) {
      // Check context: is this a deliverable or a checkbox?
      const isDeliverable = COMPLIANCE_AS_DELIVERABLE_INDICATORS.some((d) => text.includes(d));
      const isCheckbox = COMPLIANCE_AS_CHECKBOX_INDICATORS.some((c) => text.includes(c));

      if (isDeliverable && !isCheckbox) {
        positiveHits++;
        matched.push(`${kw} (deliverable)`);
      } else if (isDeliverable && isCheckbox) {
        // Both present — give partial credit
        positiveHits += 0.5;
        matched.push(`${kw} (mixed)`);
      }
      // Pure checkbox compliance → no capability credit
    }
  }

  let negativeHits = 0;
  for (const kw of CAPABILITY_NEGATIVE_KEYWORDS) {
    if (text.includes(kw)) {
      negativeHits++;
      concerns.push(`Low-fit: "${kw}"`);
    }
  }

  if (positiveHits === 0) {
    concerns.push('No capability keywords matched');
    return { score: 0, reasons: [], concerns, acquisitionNature: acqNature };
  }

  // Reduce score for COTS/license with some custom component (MIXED)
  let raw = Math.min(positiveHits * 0.12, 1.0);
  if (positiveHits >= 8) raw = 1.0;
  else if (positiveHits >= 5) raw = Math.max(raw, 0.85);
  else if (positiveHits >= 3) raw = Math.max(raw, 0.6);
  raw = Math.max(0, raw - negativeHits * 0.15);

  // Discount for COTS/license acquisitions with some custom component
  if (
    acqNature.nature === 'SOFTWARE_LICENSE' ||
    acqNature.nature === 'COTS_PRODUCT' ||
    acqNature.nature === 'MAINTENANCE_SUPPORT'
  ) {
    raw *= 0.4; // Significant reduction
    concerns.push(`Acquisition nature: ${acqNature.nature} (capability discounted)`);
  }

  if (matched.length > 0) reasons.push(`Capability match: ${matched.slice(0, 3).join(', ')}`);
  return { score: raw, reasons, concerns, acquisitionNature: acqNature };
}

function scorePastPerformance(matches: PastPerformanceMatch[]): {
  score: number;
  reasons: string[];
} {
  if (matches.length === 0) return { score: 0, reasons: [] };
  const best = matches[0];
  let raw = best.similarityScore;
  if (matches.length >= 3) raw = Math.min(raw + 0.15, 1.0);
  else if (matches.length >= 2) raw = Math.min(raw + 0.08, 1.0);
  const reasons = [
    `Past perf: ${best.project} (${(best.similarityScore * 100).toFixed(0)}% match)`,
  ];
  if (matches.length > 1) reasons.push(`${matches.length} past performance matches`);
  return { score: raw, reasons };
}

function scoreAgencyFit(
  opp: NormalizedOpportunity,
  ctx: ScoringContext
): { score: number; reasons: string[] } {
  const agencyText = opp.agency || opp.subAgency || '';
  if (!agencyText) return { score: 0.2, reasons: ['Agency unknown'] };
  const canonical = normalizeAgency(agencyText);

  // Check strategic agencies — exact canonical match
  if (ctx.preferences.strategicAgencies.some((a) => agenciesMatch(agencyText, a))) {
    return { score: 1.0, reasons: [`Strategic agency: ${canonical}`] };
  }
  // Check experienced agencies — exact canonical match
  if (ctx.profile.agencyExperience.some((a) => agenciesMatch(agencyText, a))) {
    return { score: 0.7, reasons: [`Experienced agency: ${canonical}`] };
  }
  // Check department-level adjacency (weaker signal)
  if (ctx.preferences.strategicAgencies.some((a) => agenciesRelated(agencyText, a))) {
    return { score: 0.5, reasons: [`Related department: ${canonical}`] };
  }
  return { score: 0.25, reasons: [`New agency: ${canonical}`] };
}

function scoreSetAsideAdvantage(
  opp: NormalizedOpportunity,
  ctx: ScoringContext
): { score: number; reasons: string[] } {
  const setAside = (opp.setAside || opp.setAsideDescription || '').toLowerCase();
  if (!setAside) return { score: 0.5, reasons: [] };

  // Check against company's actual certifications from DB
  const companyCerts = ctx.profile.certifications.map((c) => c.toLowerCase());
  const companySetAsides = ctx.profile.setAsides.map((s) => s.toLowerCase());

  const eligible = [
    { keyword: '8(a)', match: (c: string) => c.includes('8(a)') },
    {
      keyword: 'sdvosb',
      match: (c: string) => c.includes('sdvosb') || c.includes('service-disabled'),
    },
    {
      keyword: 'service-disabled',
      match: (c: string) => c.includes('sdvosb') || c.includes('service-disabled'),
    },
    { keyword: 'wosb', match: (c: string) => c.includes('wosb') || c.includes('women-owned') },
    {
      keyword: 'women-owned',
      match: (c: string) => c.includes('wosb') || c.includes('women-owned'),
    },
    { keyword: 'small business', match: () => true }, // FFTC is small business
    { keyword: 'total small', match: () => true },
  ];

  for (const e of eligible) {
    if (setAside.includes(e.keyword)) {
      const hasCert = companyCerts.some(e.match) || companySetAsides.some(e.match);
      if (hasCert) return { score: 1.0, reasons: [`Strong set-aside advantage: ${e.keyword}`] };
      return { score: 0.8, reasons: [`Eligible set-aside: ${e.keyword}`] };
    }
  }

  return { score: 0.1, reasons: [`May not be eligible: ${setAside.slice(0, 40)}`] };
}

function scoreRevenueRoleQuality(
  opp: NormalizedOpportunity,
  ctx: ScoringContext
): { score: number; reasons: string[]; concerns: string[] } {
  const text = `${opp.title} ${opp.description || ''}`.toLowerCase();
  const concerns: string[] = [];
  const reasons: string[] = [];

  const commoditySignals = [
    'staff augmentation',
    'labor hour',
    'time and materials',
    'provide developers',
    'provide staff',
  ];
  if (commoditySignals.some((s) => text.includes(s))) {
    concerns.push('Commodity staffing signals detected');
    return { score: 0.2, reasons: [], concerns };
  }

  const outcomeSignals = [
    'deliverable',
    'outcome',
    'product',
    'design',
    'research',
    'prototype',
    'modernization',
  ];
  const hasOutcome = outcomeSignals.some((s) => text.includes(s));

  const value = opp.estimatedValue;
  const prefs = ctx.preferences;
  let valueFit = 0.5;
  if (value) {
    if (value >= prefs.contractSizeSweetMin && value <= prefs.contractSizeSweetMax) {
      valueFit = 1.0;
      reasons.push(`Sweet spot value: $${(value / 1e6).toFixed(1)}M`);
    } else if (value >= prefs.contractSizeMin && value <= prefs.contractSizeMax) {
      valueFit = 0.7;
    } else if (value < prefs.contractSizeMin) {
      valueFit = 0.3;
      concerns.push('Below minimum contract size preference');
    } else {
      valueFit = 0.5;
    }
  }

  return { score: hasOutcome ? Math.min(valueFit + 0.2, 1.0) : valueFit, reasons, concerns };
}

function scoreNaicsPscFit(
  opp: NormalizedOpportunity,
  ctx: ScoringContext
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const companyNaics = ctx.profile.naicsCodes;

  if (opp.naics) {
    if (companyNaics.includes(opp.naics)) {
      score += 0.7;
      reasons.push(`NAICS match: ${opp.naics}`);
    }
  }

  // PSC matching uses keyword taxonomy (scoring logic, not org data)
  if (opp.psc && ['DA01'].includes(opp.psc)) {
    score += 0.3;
    reasons.push(`PSC match: ${opp.psc}`);
  }

  return { score: Math.min(score, 1.0), reasons };
}

function scoreVehicleAccessFit(
  opp: NormalizedOpportunity,
  ctx: ScoringContext
): { score: number; reasons: string[] } {
  if (!opp.vehicle) return { score: 0.5, reasons: [] };
  const vehicleLower = opp.vehicle.toLowerCase();
  const hasGSA = ctx.profile.contractVehicles.some((v) => v.toLowerCase().includes('gsa'));
  if (
    hasGSA &&
    (vehicleLower.includes('gsa') ||
      vehicleLower.includes('mas') ||
      vehicleLower.includes('schedule'))
  ) {
    return { score: 1.0, reasons: ['GSA MAS vehicle access'] };
  }
  return { score: 0.3, reasons: [`Vehicle: ${opp.vehicle.slice(0, 30)}`] };
}

function scorePrimeSuitability(
  opp: NormalizedOpportunity,
  ppMatches: PastPerformanceMatch[],
  ctx: ScoringContext
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0.5;
  if (ppMatches.some((m) => m.agencyMatch && m.similarityScore >= 0.5)) {
    score += 0.2;
    reasons.push('Agency past performance supports prime role');
  }
  const setAside = (opp.setAside || '').toLowerCase();
  const hasCertAdv = ctx.profile.setAsides.some((s) => setAside.includes(s.toLowerCase()));
  if (hasCertAdv) {
    score += 0.2;
    reasons.push('Certification advantage supports prime');
  }
  if (opp.estimatedValue && opp.estimatedValue <= ctx.preferences.contractSizeSweetMax) {
    score += 0.1;
  }
  return { score: Math.min(score, 1.0), reasons };
}

function scoreTimingViability(
  opp: NormalizedOpportunity,
  evaluationAsOf?: Date
): { score: number; reasons: string[]; concerns: string[] } {
  if (!opp.responseDeadline) return { score: 0.5, reasons: [], concerns: [] };
  const referenceTime = evaluationAsOf?.getTime() || Date.now();
  const daysLeft = Math.ceil(
    (new Date(opp.responseDeadline).getTime() - referenceTime) / (1000 * 60 * 60 * 24)
  );
  if (daysLeft < 7)
    return { score: 0.1, reasons: [], concerns: [`Very short timeline: ${daysLeft} days`] };
  if (daysLeft < 14)
    return { score: 0.3, reasons: [], concerns: [`Tight timeline: ${daysLeft} days`] };
  if (daysLeft >= 30)
    return { score: 1.0, reasons: [`Good timeline: ${daysLeft} days`], concerns: [] };
  return { score: 0.6, reasons: [`${daysLeft} days remaining`], concerns: [] };
}

// ============================================================
// Main Scoring Function — accepts repository data
// ============================================================

export interface ScoringOptions {
  weights?: ScoringWeights;
  evaluationAsOf?: Date;
}

export function calculateFitScore(
  opp: NormalizedOpportunity,
  ctx: ScoringContext,
  options: ScoringOptions = {}
): FitScoreResult {
  const weights = options.weights || DEFAULT_WEIGHTS;
  const allReasons: string[] = [];
  const allConcerns: string[] = [];

  const ppMatches = matchPastPerformance(
    { agency: opp.agency, title: opp.title, description: opp.description, naics: opp.naics },
    ctx.pastPerformance
  );

  const cap = scoreCapabilityFit(opp);
  const pp = scorePastPerformance(ppMatches);
  const agency = scoreAgencyFit(opp, ctx);
  const setAside = scoreSetAsideAdvantage(opp, ctx);
  const revenue = scoreRevenueRoleQuality(opp, ctx);
  const naics = scoreNaicsPscFit(opp, ctx);
  const vehicle = scoreVehicleAccessFit(opp, ctx);
  const prime = scorePrimeSuitability(opp, ppMatches, ctx);
  const timing = scoreTimingViability(opp, options.evaluationAsOf);

  allReasons.push(...cap.reasons, ...pp.reasons, ...agency.reasons, ...setAside.reasons);
  allReasons.push(
    ...revenue.reasons,
    ...naics.reasons,
    ...vehicle.reasons,
    ...prime.reasons,
    ...timing.reasons
  );
  allConcerns.push(...cap.concerns, ...revenue.concerns, ...timing.concerns);

  const breakdown: FitScoreBreakdown = {
    capabilityFit: Math.round(cap.score * weights.capabilityFit),
    pastPerformance: Math.round(pp.score * weights.pastPerformance),
    agencyFit: Math.round(agency.score * weights.agencyFit),
    setAsideAdvantage: Math.round(setAside.score * weights.setAsideAdvantage),
    revenueRoleQuality: Math.round(revenue.score * weights.revenueRoleQuality),
    naicsPscFit: Math.round(naics.score * weights.naicsPscFit),
    vehicleAccessFit: Math.round(vehicle.score * weights.vehicleAccessFit),
    primeSuitability: Math.round(prime.score * weights.primeSuitability),
    timingViability: Math.round(timing.score * weights.timingViability),
  };

  const totalScore = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  if (cap.score === 0) {
    return {
      totalScore: Math.min(totalScore, 30),
      breakdown,
      reasons: allReasons,
      concerns: ['No capability keywords matched — unlikely FFTC fit'],
      hardExcluded: false,
    };
  }

  return {
    totalScore: Math.min(totalScore, 100),
    breakdown,
    reasons: allReasons,
    concerns: allConcerns,
    hardExcluded: false,
  };
}
