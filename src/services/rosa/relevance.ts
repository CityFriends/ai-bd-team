/**
 * Rosa Deterministic Partner Relevance Scoring
 *
 * Separates two concerns:
 * 1. Partner relevance scoring (7 weighted dimensions, NO LLM)
 * 2. Partner material change detection (field-aware, following David's pattern)
 *
 * Anti-noise caps prevent over-indexing on shallow signals.
 * Threshold mapping determines Rosa's response level.
 *
 * This module is fully deterministic -- zero LLM calls.
 */

import { logger } from '../../lib/logger.js';
import {
  RosaWakeThreshold,
  type RosaWakeThresholdValue,
} from './types.js';

const log = logger.child({ service: 'RosaRelevance' });

// ============================================================
// Types
// ============================================================

export interface PartnerCandidate {
  /** Company name */
  companyName: string;
  /** Unique Entity Identifier */
  uei?: string;
  /** CAGE Code */
  cageCode?: string;
  /** Company capabilities */
  capabilities: string[];
  /** Agencies the company has presence with */
  agencyPresence: string[];
  /** Contract vehicles held */
  vehicles: string[];
  /** Certifications (8(a), SDVOSB, etc.) */
  certifications: string[];
  /** Set-aside classifications */
  setAsides: string[];
  /** Past performance domains */
  pastPerformanceDomains: string[];
  /** Revenue tier (e.g., 'small', 'mid-tier', 'large') */
  revenueTier?: string;
  /** Known FFTC relationship history */
  fftcRelationshipHistory: string[];
  /** Active contract/award count */
  activeAwardCount?: number;
}

export interface PartnerRelevanceContext {
  /** FFTC capabilities */
  fftcCapabilities: string[];
  /** FFTC target agencies */
  fftcTargetAgencies: string[];
  /** FFTC certifications */
  fftcCertifications: string[];
  /** FFTC needed capabilities (gaps) */
  fftcCapabilityGaps: string[];
  /** Active captures that need teaming partners */
  activeCaptures: Array<{
    captureId: string;
    agency?: string;
    naics?: string;
    setAside?: string;
    vehicleRequired?: string;
  }>;
  /** Known FFTC relationships */
  knownRelationships: Array<{
    companyName: string;
    type: string;
    active: boolean;
  }>;
}

export interface RelevanceDimension {
  name: string;
  score: number;
  weight: number;
  reason: string;
}

export interface RelevanceResult {
  totalScore: number;
  dimensions: RelevanceDimension[];
  tier: RosaWakeThresholdValue;
  antiNoiseCaps: string[];
}

// ============================================================
// Material Change Types (following David's pattern)
// ============================================================

export interface PartnerMaterialChangeResult {
  /** Did the raw content change at all? */
  changed: boolean;
  /** Is the change significant enough to wake Rosa? */
  material: boolean;
  /** Specific material change reasons */
  reasons: PartnerMaterialChangeReason[];
  /** Fields that changed (including non-material) */
  changedFields: string[];
}

export interface PartnerMaterialChangeReason {
  field: string;
  description: string;
  oldValue: string | null;
  newValue: string | null;
}

// ============================================================
// Anti-Noise Caps
// ============================================================

/** Anti-noise caps prevent single shallow signals from inflating scores */
const ANTI_NOISE_CAPS: Record<string, { maxScore: number; label: string }> = {
  revenueTierOnly: { maxScore: 15, label: 'Company size/revenue alone' },
  agencyNameOnly: { maxScore: 20, label: 'Agency name alone' },
  relationshipOnly: { maxScore: 15, label: 'Relationship strength alone' },
  broadIT: { maxScore: 20, label: 'Broad "IT company"' },
  genericSmallBusiness: { maxScore: 15, label: 'Generic small business alone' },
};

// ============================================================
// Main Scoring Function
// ============================================================

/**
 * Calculate deterministic partner relevance score.
 * NO LLM calls -- purely rule-based across 7 weighted dimensions.
 *
 * Returns a score 0-100 with tier mapping:
 *   0-39  STORE_ONLY
 *   40-59 WATCH
 *   60-79 ROSA_QUICK
 *   80-100 ROSA_FULL
 */
export function calculatePartnerRelevance(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceResult {
  const dimensions: RelevanceDimension[] = [];
  const antiNoiseCaps: string[] = [];

  // 1. Capability complementarity (weight: 25)
  const capDim = scoreCapabilityComplementarity(candidate, context);
  dimensions.push(capDim);

  // 2. Customer/agency presence (weight: 20)
  const agencyDim = scoreAgencyPresence(candidate, context);
  dimensions.push(agencyDim);

  // 3. Contract/vehicle position (weight: 15)
  const vehicleDim = scoreVehiclePosition(candidate, context);
  dimensions.push(vehicleDim);

  // 4. Past-performance complementarity (weight: 15)
  const ppDim = scorePastPerformance(candidate, context);
  dimensions.push(ppDim);

  // 5. Existing FFTC relationship (weight: 10)
  const relDim = scoreExistingRelationship(candidate, context);
  dimensions.push(relDim);

  // 6. Socioeconomic/teaming strategy (weight: 10)
  const socioDim = scoreSocioeconomicStrategy(candidate, context);
  dimensions.push(socioDim);

  // 7. Strategic timing (weight: 5)
  const timingDim = scoreStrategicTiming(candidate, context);
  dimensions.push(timingDim);

  // Calculate raw weighted score
  let rawTotal = 0;
  for (const dim of dimensions) {
    rawTotal += dim.score * dim.weight;
  }
  // Weights sum to 1.0, so rawTotal is already 0-100
  let totalScore = Math.round(rawTotal);

  // Apply anti-noise caps
  totalScore = applyAntiNoiseCaps(totalScore, dimensions, candidate, context, antiNoiseCaps);

  // Clamp
  totalScore = Math.max(0, Math.min(100, totalScore));

  // Map to tier
  const tier = mapScoreToTier(totalScore);

  log.debug(
    {
      company: candidate.companyName,
      totalScore,
      tier,
      dimensions: dimensions.map((d) => ({ name: d.name, score: d.score })),
      antiNoiseCaps,
    },
    'Partner relevance scored'
  );

  return { totalScore, dimensions, tier, antiNoiseCaps };
}

// ============================================================
// Dimension Scorers (each returns score 0-100)
// ============================================================

function scoreCapabilityComplementarity(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.25;
  const candidateCaps = new Set(candidate.capabilities.map((c) => c.toLowerCase()));
  const fftcCaps = new Set(context.fftcCapabilities.map((c) => c.toLowerCase()));
  const fftcGaps = new Set(context.fftcCapabilityGaps.map((c) => c.toLowerCase()));

  let score = 0;
  let reason = '';

  // Check if candidate fills FFTC capability gaps
  const gapsFilled: string[] = [];
  for (const gap of fftcGaps) {
    for (const cap of candidateCaps) {
      if (cap.includes(gap) || gap.includes(cap)) {
        gapsFilled.push(gap);
        break;
      }
    }
  }

  if (gapsFilled.length > 0) {
    score = Math.min(100, gapsFilled.length * 30 + 20);
    reason = `Fills ${gapsFilled.length} FFTC capability gap(s): ${gapsFilled.slice(0, 3).join(', ')}`;
  } else {
    // Check for complementary (non-overlapping) capabilities
    const complementary = [...candidateCaps].filter((c) => !fftcCaps.has(c));
    if (complementary.length > 0) {
      score = Math.min(50, complementary.length * 10);
      reason = `${complementary.length} complementary capability(s)`;
    } else {
      reason = 'No complementary capabilities identified';
    }
  }

  return { name: 'Capability complementarity', score, weight, reason };
}

function scoreAgencyPresence(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.20;
  const candidateAgencies = new Set(candidate.agencyPresence.map((a) => a.toLowerCase()));
  const targetAgencies = new Set(context.fftcTargetAgencies.map((a) => a.toLowerCase()));

  let score = 0;
  const overlapping: string[] = [];

  for (const target of targetAgencies) {
    for (const agency of candidateAgencies) {
      if (agency.includes(target) || target.includes(agency)) {
        overlapping.push(target);
        break;
      }
    }
  }

  if (overlapping.length > 0) {
    score = Math.min(100, overlapping.length * 25 + 25);
  }

  const reason = overlapping.length > 0
    ? `Presence at ${overlapping.length} FFTC target agency(ies): ${overlapping.slice(0, 3).join(', ')}`
    : 'No overlap with FFTC target agencies';

  return { name: 'Customer/agency presence', score, weight, reason };
}

function scoreVehiclePosition(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.15;
  const candidateVehicles = new Set(candidate.vehicles.map((v) => v.toLowerCase()));
  const neededVehicles = new Set(
    context.activeCaptures
      .filter((c) => c.vehicleRequired)
      .map((c) => c.vehicleRequired!.toLowerCase())
  );

  let score = 0;
  const matchedVehicles: string[] = [];

  for (const needed of neededVehicles) {
    for (const vehicle of candidateVehicles) {
      if (vehicle.includes(needed) || needed.includes(vehicle)) {
        matchedVehicles.push(needed);
        break;
      }
    }
  }

  if (matchedVehicles.length > 0) {
    score = Math.min(100, matchedVehicles.length * 40 + 20);
  } else if (candidateVehicles.size > 0) {
    // Has vehicles but not ones we need -- partial credit
    score = 15;
  }

  const reason = matchedVehicles.length > 0
    ? `Holds ${matchedVehicles.length} needed vehicle(s): ${matchedVehicles.slice(0, 3).join(', ')}`
    : candidateVehicles.size > 0
      ? `Holds ${candidateVehicles.size} vehicle(s) but none match active capture needs`
      : 'No vehicles identified';

  return { name: 'Contract/vehicle position', score, weight, reason };
}

function scorePastPerformance(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.15;
  const candidateDomains = new Set(candidate.pastPerformanceDomains.map((d) => d.toLowerCase()));
  const fftcGaps = new Set(context.fftcCapabilityGaps.map((g) => g.toLowerCase()));

  let score = 0;
  const relevantDomains: string[] = [];

  for (const gap of fftcGaps) {
    for (const domain of candidateDomains) {
      if (domain.includes(gap) || gap.includes(domain)) {
        relevantDomains.push(domain);
        break;
      }
    }
  }

  if (relevantDomains.length > 0) {
    score = Math.min(100, relevantDomains.length * 30 + 20);
  } else if (candidateDomains.size > 0) {
    score = 10;
  }

  const reason = relevantDomains.length > 0
    ? `Relevant past performance in ${relevantDomains.length} area(s): ${relevantDomains.slice(0, 3).join(', ')}`
    : candidateDomains.size > 0
      ? `Past performance in ${candidateDomains.size} domain(s) but none directly complement FFTC gaps`
      : 'No past performance domains identified';

  return { name: 'Past-performance complementarity', score, weight, reason };
}

function scoreExistingRelationship(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.10;
  const candidateName = candidate.companyName.toLowerCase();

  const knownRelationship = context.knownRelationships.find(
    (r) => r.companyName.toLowerCase() === candidateName
  );

  const fftcHistory = candidate.fftcRelationshipHistory.length > 0;

  let score = 0;
  let reason = '';

  if (knownRelationship) {
    if (knownRelationship.active) {
      score = 80;
      reason = `Active FFTC relationship: ${knownRelationship.type}`;
    } else {
      score = 50;
      reason = `Prior FFTC relationship: ${knownRelationship.type} (inactive)`;
    }
  } else if (fftcHistory) {
    score = 40;
    reason = `${candidate.fftcRelationshipHistory.length} prior interaction(s) with FFTC`;
  } else {
    reason = 'No known FFTC relationship';
  }

  return { name: 'Existing FFTC relationship', score, weight, reason };
}

function scoreSocioeconomicStrategy(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.10;
  const candidateCerts = new Set(candidate.certifications.map((c) => c.toLowerCase()));
  const candidateSetAsides = new Set(candidate.setAsides.map((s) => s.toLowerCase()));

  // Check if candidate's certs/set-asides create strategic teaming value
  const neededSetAsides = new Set(
    context.activeCaptures
      .filter((c) => c.setAside)
      .map((c) => c.setAside!.toLowerCase())
  );

  let score = 0;
  const strategicMatches: string[] = [];

  for (const needed of neededSetAsides) {
    for (const setAside of candidateSetAsides) {
      if (setAside.includes(needed) || needed.includes(setAside)) {
        strategicMatches.push(needed);
        break;
      }
    }
  }

  if (strategicMatches.length > 0) {
    score = Math.min(100, strategicMatches.length * 40 + 20);
  } else if (candidateCerts.size > 0 || candidateSetAsides.size > 0) {
    // Has certs/set-asides but not specifically needed
    score = 15;
  }

  const reason = strategicMatches.length > 0
    ? `Set-aside alignment for ${strategicMatches.length} active capture(s)`
    : candidateCerts.size > 0
      ? `Holds ${candidateCerts.size} cert(s) but no direct set-aside match`
      : 'No certifications or set-asides identified';

  return { name: 'Socioeconomic/teaming strategy', score, weight, reason };
}

function scoreStrategicTiming(
  candidate: PartnerCandidate,
  context: PartnerRelevanceContext
): RelevanceDimension {
  const weight = 0.05;
  const candidateAgencies = new Set(candidate.agencyPresence.map((a) => a.toLowerCase()));

  // Check if candidate is relevant to any active capture
  let score = 0;
  const matchedCaptures: string[] = [];

  for (const capture of context.activeCaptures) {
    if (capture.agency) {
      const captureAgency = capture.agency.toLowerCase();
      for (const agency of candidateAgencies) {
        if (agency.includes(captureAgency) || captureAgency.includes(agency)) {
          matchedCaptures.push(capture.captureId);
          break;
        }
      }
    }
  }

  if (matchedCaptures.length > 0) {
    score = Math.min(100, matchedCaptures.length * 40 + 20);
  }

  const reason = matchedCaptures.length > 0
    ? `Relevant to ${matchedCaptures.length} active capture(s)`
    : context.activeCaptures.length > 0
      ? 'No direct alignment with active captures'
      : 'No active captures for timing assessment';

  return { name: 'Strategic timing', score, weight, reason };
}

// ============================================================
// Anti-Noise Cap Application
// ============================================================

function applyAntiNoiseCaps(
  score: number,
  dimensions: RelevanceDimension[],
  candidate: PartnerCandidate,
  _context: PartnerRelevanceContext,
  appliedCaps: string[]
): number {
  let capped = score;

  // Revenue tier only: if the only contributing factor is company size
  const nonRevenueDims = dimensions.filter(
    (d) => d.name !== 'Existing FFTC relationship' && d.score > 0
  );
  if (
    nonRevenueDims.length === 0 &&
    candidate.revenueTier &&
    !candidate.capabilities.length &&
    !candidate.vehicles.length
  ) {
    capped = Math.min(capped, ANTI_NOISE_CAPS.revenueTierOnly.maxScore);
    appliedCaps.push(ANTI_NOISE_CAPS.revenueTierOnly.label);
  }

  // Agency name only: if only signal is agency presence
  const agencyDim = dimensions.find((d) => d.name === 'Customer/agency presence');
  const otherContributing = dimensions.filter(
    (d) => d.name !== 'Customer/agency presence' && d.score > 0
  );
  if (agencyDim && agencyDim.score > 0 && otherContributing.length === 0) {
    capped = Math.min(capped, ANTI_NOISE_CAPS.agencyNameOnly.maxScore);
    appliedCaps.push(ANTI_NOISE_CAPS.agencyNameOnly.label);
  }

  // Relationship strength only: if only signal is existing relationship
  const relDim = dimensions.find((d) => d.name === 'Existing FFTC relationship');
  const otherNonRel = dimensions.filter(
    (d) => d.name !== 'Existing FFTC relationship' && d.score > 0
  );
  if (relDim && relDim.score > 0 && otherNonRel.length === 0) {
    capped = Math.min(capped, ANTI_NOISE_CAPS.relationshipOnly.maxScore);
    appliedCaps.push(ANTI_NOISE_CAPS.relationshipOnly.label);
  }

  // Broad "IT company": if capabilities are only generic IT terms
  const genericITTerms = new Set(['it', 'information technology', 'technology', 'software', 'consulting']);
  const allCapsGenericIT = candidate.capabilities.length > 0 &&
    candidate.capabilities.every((c) => genericITTerms.has(c.toLowerCase()));
  if (allCapsGenericIT && candidate.capabilities.length > 0) {
    capped = Math.min(capped, ANTI_NOISE_CAPS.broadIT.maxScore);
    appliedCaps.push(ANTI_NOISE_CAPS.broadIT.label);
  }

  // Generic small business: if only signal is small business status
  const hasOnlySBCerts =
    candidate.certifications.length > 0 &&
    candidate.capabilities.length === 0 &&
    candidate.vehicles.length === 0 &&
    candidate.agencyPresence.length === 0 &&
    candidate.pastPerformanceDomains.length === 0;
  if (hasOnlySBCerts) {
    capped = Math.min(capped, ANTI_NOISE_CAPS.genericSmallBusiness.maxScore);
    appliedCaps.push(ANTI_NOISE_CAPS.genericSmallBusiness.label);
  }

  if (capped < score) {
    log.debug(
      { company: candidate.companyName, originalScore: score, cappedScore: capped, caps: appliedCaps },
      'Anti-noise cap applied'
    );
  }

  return capped;
}

// ============================================================
// Threshold Mapping
// ============================================================

function mapScoreToTier(score: number): RosaWakeThresholdValue {
  if (score >= 80) return RosaWakeThreshold.ROSA_FULL;
  if (score >= 60) return RosaWakeThreshold.ROSA_QUICK;
  if (score >= 40) return RosaWakeThreshold.WATCH;
  return RosaWakeThreshold.STORE_ONLY;
}

// ============================================================
// Partner Material Change Detection
// ============================================================

/** Fields whose change is material for partner profiles */
const PARTNER_MATERIAL_FIELDS: Record<
  string,
  (oldVal: unknown, newVal: unknown) => PartnerMaterialChangeReason | null
> = {
  // New awards/contracts -- always material
  activeAwardCount: numericIncreaseDetector(
    'activeAwardCount',
    'New award or contract detected'
  ),
  vehicles: arrayAdditionDetector('vehicles', 'New contract vehicle added'),

  // Certification changes -- material
  certifications: arrayAdditionDetector('certifications', 'Certification changed'),
  setAsides: arrayAdditionDetector('setAsides', 'Set-aside classification changed'),

  // Customer presence changes -- material
  agencyPresence: arrayAdditionDetector('agencyPresence', 'New agency presence detected'),

  // FFTC relationship changes -- material
  fftcRelationshipHistory: arrayAdditionDetector(
    'fftcRelationshipHistory',
    'New FFTC relationship detected'
  ),
};

// Cosmetic fields (companyName, revenueTier, timestamps, URLs) are excluded
// from material change detection by the field-specific detectors above.

/**
 * Detect whether a partner profile change is material enough to wake Rosa.
 * Follows David's material-change.ts pattern.
 *
 * Material: new award/vehicle, changed certs, new customer presence, new FFTC relationship.
 * Non-material: cosmetic profile changes, timestamp updates.
 */
export function detectPartnerMaterialChange(
  oldFields: Record<string, unknown>,
  newFields: Record<string, unknown>
): PartnerMaterialChangeResult {
  const changedFields: string[] = [];
  const reasons: PartnerMaterialChangeReason[] = [];

  const allKeys = new Set([...Object.keys(oldFields), ...Object.keys(newFields)]);

  for (const key of allKeys) {
    const oldVal = oldFields[key];
    const newVal = newFields[key];

    if (normalizeValue(oldVal) === normalizeValue(newVal)) continue;

    changedFields.push(key);

    const detector = PARTNER_MATERIAL_FIELDS[key];
    if (detector) {
      const reason = detector(oldVal, newVal);
      if (reason) {
        reasons.push(reason);
      }
    }
    // Not in material detectors and not cosmetic = unknown, treat as cosmetic
  }

  const changed = changedFields.length > 0;
  const material = reasons.length > 0;

  if (changed && !material) {
    log.info(
      { changedFields, cosmeticOnly: true },
      'Partner changed but non-material -- profile updated, no Rosa wake'
    );
  }

  if (material) {
    log.info(
      {
        materialReasons: reasons.map((r) => r.description),
        changedFields,
      },
      'Material partner change detected -- Rosa wake eligible'
    );
  }

  return { changed, material, reasons, changedFields };
}

// ============================================================
// Field Change Detectors
// ============================================================

function numericIncreaseDetector(
  field: string,
  description: string
): (oldVal: unknown, newVal: unknown) => PartnerMaterialChangeReason | null {
  return (oldVal, newVal) => {
    const oldNum = typeof oldVal === 'number' ? oldVal : parseInt(String(oldVal || '0'), 10);
    const newNum = typeof newVal === 'number' ? newVal : parseInt(String(newVal || '0'), 10);

    if (isNaN(oldNum) || isNaN(newNum)) return null;

    // Only material if count increased (new award)
    if (newNum > oldNum) {
      return {
        field,
        description,
        oldValue: String(oldNum),
        newValue: String(newNum),
      };
    }

    return null;
  };
}

function arrayAdditionDetector(
  field: string,
  description: string
): (oldVal: unknown, newVal: unknown) => PartnerMaterialChangeReason | null {
  return (oldVal, newVal) => {
    const oldArr = Array.isArray(oldVal) ? oldVal : [];
    const newArr = Array.isArray(newVal) ? newVal : [];

    const oldSet = new Set(oldArr.map((v) => String(v).toLowerCase().trim()));
    const added = newArr.filter((v) => !oldSet.has(String(v).toLowerCase().trim()));

    if (added.length > 0) {
      return {
        field,
        description: `${description}: ${added.slice(0, 3).join(', ')}`,
        oldValue: oldArr.length > 0 ? oldArr.join(', ') : null,
        newValue: newArr.join(', '),
      };
    }

    return null;
  };
}

// ============================================================
// Helpers
// ============================================================

function normalizeValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return JSON.stringify(val.map((v) => String(v).toLowerCase().trim()).sort());
  if (typeof val === 'string') return val.trim().toLowerCase();
  return String(val).trim().toLowerCase();
}
