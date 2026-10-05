/**
 * David Deterministic Relevance Scoring
 *
 * Proactive relevance scoring for signals detected by David's collectors.
 * Determines whether a signal is worth waking David for reasoning.
 *
 * ZERO LLM calls. All scoring is deterministic keyword/match-based.
 *
 * Scoring dimensions (weighted, total = 100):
 *   Capability Alignment      25  — NAICS, capabilities, certifications
 *   Active Pursuit Relationship 25 — related capture/pursuit activity
 *   Acquisition Timing         15  — actionable timeframe proximity
 *   Signal Strength            15  — specificity and reinforcement
 *   Market Position            10  — watched market/customer/competitor
 *   Set-Aside/Cert Fit         10  — 8(a), SDVOSB, WOSB, HUBZone match
 *
 * Anti-noise rules (hard):
 *   Agency name alone → max 20 points (never crosses 60 threshold)
 *   Single weak generic event → max 30 points
 *   Score < 60 → STORE_ONLY (no David task)
 *   Score >= 60 → David task created
 */

import { createHash } from 'crypto';
import type { ProactiveRelevanceScore } from '../david/types.js';

// ============================================================
// Constants
// ============================================================

/** Minimum score to wake David for reasoning */
export const WAKE_THRESHOLD = 60;

/** Hard ceiling when only an agency name matches — prevents false positives */
const AGENCY_ONLY_CEILING = 20;

/** Hard ceiling for a single weak generic signal */
const WEAK_GENERIC_CEILING = 30;

// ============================================================
// Input Types
// ============================================================

/**
 * A signal detected by a collector (forecast, event, competitive info).
 * Contains the normalized fields needed for deterministic scoring.
 */
export interface RelevanceSignal {
  /** Source type: forecast, event, competitive */
  sourceType: 'forecast' | 'event' | 'competitive';
  /** Source identifier (e.g., G2X forecast ID) */
  sourceId: string;
  /** Title or name of the signal */
  title: string;
  /** Description or scope text */
  description?: string;
  /** Procuring agency name */
  agency?: string;
  /** Sub-agency or bureau */
  subAgency?: string;
  /** Program name if available */
  programName?: string;
  /** NAICS codes associated with the signal */
  naicsCodes?: string[];
  /** Set-aside type if applicable */
  setAside?: string;
  /** Contract vehicle if known */
  contractVehicle?: string;
  /** Expected date/deadline (ISO string) */
  expectedDate?: string;
  /** Keywords extracted from the signal */
  keywords?: string[];
  /** Estimated contract value if known */
  estimatedValue?: string;
  /** Specific opportunity/solicitation number */
  solicitationNumber?: string;
  /** Known competitor names mentioned */
  competitorsMentioned?: string[];
}

/**
 * Organizational context used for relevance scoring.
 * Loaded from company profile / pursuit data. NOT from LLM.
 */
export interface RelevanceContext {
  /** FFTC NAICS codes */
  naicsCodes: string[];
  /** FFTC capability keywords (lowercase) */
  capabilities: string[];
  /** FFTC certifications: 8a, SDVOSB, WOSB, HUBZone, etc. */
  certifications: string[];
  /** Active pursuit agency names (lowercase) */
  activePursuitAgencies: string[];
  /** Active pursuit program names (lowercase) */
  activePursuitPrograms: string[];
  /** Active pursuit opportunity IDs */
  activePursuitOpportunityIds: string[];
  /** Watched market segments (lowercase keywords) */
  watchedMarkets: string[];
  /** Known customer agency names (lowercase) */
  knownCustomers: string[];
  /** Known competitor company names (lowercase) */
  knownCompetitors: string[];
}

// ============================================================
// Scoring Dimensions
// ============================================================

interface ScoringDimension {
  name: string;
  weight: number;
  score: number;
  reason: string;
}

/**
 * Score capability alignment: NAICS codes, capability keywords, certifications.
 * Weight: 25
 */
function scoreCapabilityAlignment(
  signal: RelevanceSignal,
  context: RelevanceContext
): ScoringDimension {
  let score = 0;
  const reasons: string[] = [];

  // NAICS match (strongest signal)
  if (signal.naicsCodes && signal.naicsCodes.length > 0) {
    const matchedNaics = signal.naicsCodes.filter((n) =>
      context.naicsCodes.some((cn) => n.startsWith(cn) || cn.startsWith(n))
    );
    if (matchedNaics.length > 0) {
      score += 60 + Math.min(matchedNaics.length * 10, 30);
      reasons.push(`NAICS match: ${matchedNaics.join(', ')}`);
    }
  }

  // Capability keyword match
  const signalText = `${signal.title} ${signal.description || ''}`.toLowerCase();
  const matchedCaps = context.capabilities.filter((cap) => signalText.includes(cap));
  if (matchedCaps.length > 0) {
    score += Math.min(matchedCaps.length * 15, 40);
    reasons.push(`Capability match: ${matchedCaps.slice(0, 3).join(', ')}`);
  }

  return {
    name: 'Capability Alignment',
    weight: 0.25,
    score: Math.min(score, 100),
    reason: reasons.length > 0 ? reasons.join('; ') : 'No capability alignment detected',
  };
}

/**
 * Score active pursuit relationship: agency, program, or opportunity overlap.
 * Weight: 25
 */
function scoreActivePursuitRelationship(
  signal: RelevanceSignal,
  context: RelevanceContext
): { dimension: ScoringDimension; hasActivePursuit: boolean } {
  let score = 0;
  const reasons: string[] = [];
  let hasActivePursuit = false;

  // Direct opportunity ID match (strongest)
  if (
    signal.solicitationNumber &&
    context.activePursuitOpportunityIds.some(
      (id) => id.toLowerCase() === signal.solicitationNumber!.toLowerCase()
    )
  ) {
    score = 100;
    hasActivePursuit = true;
    reasons.push(`Direct pursuit match: ${signal.solicitationNumber}`);
  }

  // Program name match
  if (signal.programName) {
    const programLower = signal.programName.toLowerCase();
    if (context.activePursuitPrograms.some((p) => programLower.includes(p) || p.includes(programLower))) {
      score = Math.max(score, 80);
      hasActivePursuit = true;
      reasons.push(`Program match: ${signal.programName}`);
    }
  }

  // Agency match (weaker alone)
  if (signal.agency) {
    const agencyLower = signal.agency.toLowerCase();
    if (context.activePursuitAgencies.some((a) => agencyLower.includes(a) || a.includes(agencyLower))) {
      score = Math.max(score, 40);
      hasActivePursuit = true;
      reasons.push(`Pursuit agency match: ${signal.agency}`);
    }
  }

  return {
    dimension: {
      name: 'Active Pursuit Relationship',
      weight: 0.25,
      score: Math.min(score, 100),
      reason: reasons.length > 0 ? reasons.join('; ') : 'No active pursuit relationship',
    },
    hasActivePursuit,
  };
}

/**
 * Score acquisition timing: how close is the event/forecast to action?
 * Weight: 15
 */
function scoreAcquisitionTiming(signal: RelevanceSignal): ScoringDimension {
  if (!signal.expectedDate) {
    return {
      name: 'Acquisition Timing',
      weight: 0.15,
      score: 20,
      reason: 'No timing information available',
    };
  }

  const now = new Date();
  const target = new Date(signal.expectedDate);
  const daysUntil = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) {
    return {
      name: 'Acquisition Timing',
      weight: 0.15,
      score: 10,
      reason: `Event/forecast is ${Math.abs(daysUntil)} days in the past`,
    };
  }

  if (daysUntil <= 30) {
    return {
      name: 'Acquisition Timing',
      weight: 0.15,
      score: 90,
      reason: `Within 30-day actionable window (${daysUntil} days)`,
    };
  }

  if (daysUntil <= 90) {
    return {
      name: 'Acquisition Timing',
      weight: 0.15,
      score: 60,
      reason: `Within 90-day planning window (${daysUntil} days)`,
    };
  }

  return {
    name: 'Acquisition Timing',
    weight: 0.15,
    score: 30,
    reason: `Beyond 90-day window (${daysUntil} days)`,
  };
}

/**
 * Score signal strength: specificity and reinforcement of the signal.
 * Weight: 15
 */
function scoreSignalStrength(signal: RelevanceSignal): ScoringDimension {
  let score = 0;
  const reasons: string[] = [];

  // Specific program/contract reference
  if (signal.programName) {
    score += 30;
    reasons.push('Specific program referenced');
  }

  if (signal.solicitationNumber) {
    score += 30;
    reasons.push('Solicitation number present');
  }

  if (signal.estimatedValue) {
    score += 15;
    reasons.push('Estimated value present');
  }

  if (signal.contractVehicle) {
    score += 10;
    reasons.push('Contract vehicle identified');
  }

  // Description length as a proxy for specificity
  if (signal.description && signal.description.length > 200) {
    score += 15;
    reasons.push('Detailed description available');
  }

  // Multiple reinforcing keywords
  if (signal.keywords && signal.keywords.length >= 3) {
    score += 10;
    reasons.push(`${signal.keywords.length} reinforcing keywords`);
  }

  // If nothing specific, this is a weak generic signal
  if (score === 0) {
    return {
      name: 'Signal Strength',
      weight: 0.15,
      score: 10,
      reason: 'Weak generic signal — no specific program, contract, or detail',
    };
  }

  return {
    name: 'Signal Strength',
    weight: 0.15,
    score: Math.min(score, 100),
    reason: reasons.join('; '),
  };
}

/**
 * Score market position: watched market, known customer, known competitor.
 * Weight: 10
 */
function scoreMarketPosition(
  signal: RelevanceSignal,
  context: RelevanceContext
): ScoringDimension {
  let score = 0;
  const reasons: string[] = [];
  const signalText = `${signal.title} ${signal.description || ''}`.toLowerCase();

  // Known customer match
  if (signal.agency) {
    const agencyLower = signal.agency.toLowerCase();
    if (context.knownCustomers.some((c) => agencyLower.includes(c) || c.includes(agencyLower))) {
      score += 50;
      reasons.push(`Known customer: ${signal.agency}`);
    }
  }

  // Known competitor mentioned
  if (signal.competitorsMentioned && signal.competitorsMentioned.length > 0) {
    const matchedCompetitors = signal.competitorsMentioned.filter((comp) =>
      context.knownCompetitors.some((kc) => comp.toLowerCase().includes(kc))
    );
    if (matchedCompetitors.length > 0) {
      score += 30;
      reasons.push(`Known competitor: ${matchedCompetitors.join(', ')}`);
    }
  }

  // Watched market keyword match
  const matchedMarkets = context.watchedMarkets.filter((m) => signalText.includes(m));
  if (matchedMarkets.length > 0) {
    score += Math.min(matchedMarkets.length * 20, 40);
    reasons.push(`Watched market: ${matchedMarkets.slice(0, 3).join(', ')}`);
  }

  return {
    name: 'Market Position',
    weight: 0.10,
    score: Math.min(score, 100),
    reason: reasons.length > 0 ? reasons.join('; ') : 'No market position signals',
  };
}

/**
 * Score set-aside/certification fit: does the signal match FFTC certs?
 * Weight: 10
 */
function scoreSetAsideCertFit(
  signal: RelevanceSignal,
  context: RelevanceContext
): ScoringDimension {
  if (!signal.setAside) {
    return {
      name: 'Set-Aside/Cert Fit',
      weight: 0.10,
      score: 0,
      reason: 'No set-aside specified',
    };
  }

  const setAsideLower = signal.setAside.toLowerCase();

  // Map common set-aside codes to certification names
  const setAsideToCert: Record<string, string[]> = {
    '8a': ['8a', '8(a)'],
    '8(a)': ['8a', '8(a)'],
    'sdvosb': ['sdvosb'],
    'service-disabled veteran': ['sdvosb'],
    'wosb': ['wosb'],
    'women-owned': ['wosb'],
    'edwosb': ['wosb', 'edwosb'],
    'hubzone': ['hubzone'],
    'sba': ['8a', 'sba'],
    'small business': ['small business'],
    'sdb': ['sdb'],
  };

  const certLower = context.certifications.map((c) => c.toLowerCase());
  let matched = false;

  for (const [saKey, certNames] of Object.entries(setAsideToCert)) {
    if (setAsideLower.includes(saKey)) {
      if (certNames.some((cn) => certLower.some((fc) => fc.includes(cn)))) {
        matched = true;
        break;
      }
    }
  }

  // Also do direct string match
  if (!matched) {
    matched = certLower.some((c) => setAsideLower.includes(c));
  }

  if (matched) {
    return {
      name: 'Set-Aside/Cert Fit',
      weight: 0.10,
      score: 90,
      reason: `Set-aside "${signal.setAside}" matches FFTC certifications`,
    };
  }

  // Set-aside present but does not match — actively harmful
  return {
    name: 'Set-Aside/Cert Fit',
    weight: 0.10,
    score: 5,
    reason: `Set-aside "${signal.setAside}" does not match FFTC certifications`,
  };
}

// ============================================================
// Anti-Noise Detection
// ============================================================

/**
 * Detect if the signal is agency-name-only (no other specifics).
 * Agency name alone should never cross the 60 threshold.
 */
function isAgencyNameOnly(signal: RelevanceSignal): boolean {
  const hasSpecificContent =
    (signal.naicsCodes && signal.naicsCodes.length > 0) ||
    signal.programName ||
    signal.solicitationNumber ||
    signal.estimatedValue ||
    signal.contractVehicle ||
    signal.setAside ||
    (signal.keywords && signal.keywords.length > 0) ||
    (signal.description && signal.description.length > 50);

  return !!signal.agency && !hasSpecificContent;
}

/**
 * Detect if the signal is a single weak generic event.
 */
function isWeakGenericSignal(signal: RelevanceSignal, signalStrengthScore: number): boolean {
  return signalStrengthScore <= 10 && !signal.programName && !signal.solicitationNumber;
}

// ============================================================
// Core Function
// ============================================================

/**
 * Calculate proactive relevance for a signal against org context.
 *
 * ZERO LLM calls. All scoring is deterministic keyword/match-based.
 *
 * Returns a ProactiveRelevanceScore with totalScore 0-100.
 * Score >= 60 → create David intelligence task
 * Score < 60 → store only, no David wake
 */
export function calculateProactiveRelevance(
  signal: RelevanceSignal,
  context: RelevanceContext
): ProactiveRelevanceScore {
  // Score each dimension
  const capAlignment = scoreCapabilityAlignment(signal, context);
  const { dimension: pursuitRel, hasActivePursuit } = scoreActivePursuitRelationship(signal, context);
  const timing = scoreAcquisitionTiming(signal);
  const strength = scoreSignalStrength(signal);
  const marketPos = scoreMarketPosition(signal, context);
  const certFit = scoreSetAsideCertFit(signal, context);

  const dimensions = [capAlignment, pursuitRel, timing, strength, marketPos, certFit];

  // Weighted total
  let totalScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  // Collect signal descriptions for audit
  const signalsMatched = dimensions
    .filter((d) => d.score > 0)
    .map((d) => `${d.name}: ${d.reason}`);

  // ── Anti-noise rules (hard ceilings) ──

  // Rule 1: Agency name alone → max 20 points
  if (isAgencyNameOnly(signal)) {
    totalScore = Math.min(totalScore, AGENCY_ONLY_CEILING);
    signalsMatched.push('Anti-noise: agency name only — capped at 20');
  }

  // Rule 2: Single weak generic event → max 30 points
  if (isWeakGenericSignal(signal, strength.score)) {
    totalScore = Math.min(totalScore, WEAK_GENERIC_CEILING);
    signalsMatched.push('Anti-noise: weak generic signal — capped at 30');
  }

  return {
    totalScore,
    dimensions: dimensions.map((d) => ({
      name: d.name,
      score: d.score,
      weight: d.weight,
      reason: d.reason,
    })),
    wakeThreshold: WAKE_THRESHOLD,
    signalsMatched,
    activeRelatedPursuit: hasActivePursuit,
  };
}

// ============================================================
// Helpers: Hashing and Change Detection
// ============================================================

/**
 * Compute a deterministic content hash for a signal.
 * Used for deduplication and change detection.
 */
export function computeSignalHash(signal: RelevanceSignal): string {
  const hashInput = [
    signal.sourceType,
    signal.sourceId,
    signal.title,
    signal.description || '',
    signal.agency || '',
    signal.subAgency || '',
    signal.programName || '',
    (signal.naicsCodes || []).sort().join(','),
    signal.setAside || '',
    signal.expectedDate || '',
    signal.estimatedValue || '',
    signal.solicitationNumber || '',
  ].join('|');

  return createHash('sha256').update(hashInput).digest('hex').slice(0, 32);
}

/**
 * Detect whether a change between two hashes is material enough
 * to re-wake David for a signal that was previously watched or dismissed.
 *
 * Signal types have different materiality thresholds:
 *   - forecast: Any hash change is material (acquisition details shifted)
 *   - event: Hash change is material (schedule, scope, or speakers changed)
 *   - competitive: Hash change is material (new award, new intel)
 *
 * Returns true if David should be re-notified.
 */
export function detectMaterialChange(
  newHash: string,
  existingHash: string | null,
  _signalType: RelevanceSignal['sourceType']
): boolean {
  // No existing hash → first observation, always material
  if (!existingHash) {
    return true;
  }

  // Different hash → material change for all signal types
  // All collector signal types are considered material on content change
  // because David's deterministic collectors only produce signals from
  // structured G2X data, not free-form text that fluctuates.
  return newHash !== existingHash;
}
