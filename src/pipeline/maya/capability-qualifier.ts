/**
 * Capability-Based Opportunity Qualifier
 *
 * Produces explainable qualification results by matching opportunity
 * requirements against FFTC's documented capability reference.
 *
 * Design principles:
 * - Keyword occurrence is not proof of primary scope or workshare
 * - TEAMING_REQUIRED capabilities are not FFTC delivery evidence
 * - Every finding includes source excerpts and provenance
 * - Insufficient evidence is a valid, explicit outcome
 * - No hard contract-value cutoffs — evidence-based assessment
 *
 * This module is offline/testable. It does not read from databases,
 * call LLMs, or modify production state.
 */

import type { NormalizedOpportunity } from './types.js';
import {
  type CapabilityEntry,
  type EngagementEntry,
  type CapabilityClassification,
  CAPABILITIES,
  ENGAGEMENTS,
} from './capability-data.js';
import {
  assessEvidenceQuality,
  extractRequirements,
  type EvidenceQuality,
} from './requirement-extractor.js';

// ============================================================
// Output Types
// ============================================================

export type QualificationClassification =
  | 'PRIME_FIT'
  | 'TEAMING_FIT'
  | 'NOT_A_FIT'
  | 'INSUFFICIENT_EVIDENCE';

export interface CapabilityMatch {
  capabilityId: string;
  capabilityName: string;
  classification: CapabilityClassification;
  relevance: 'PRIMARY_SCOPE' | 'SUPPORTING' | 'ANCILLARY';
  engagementIds: string[];
  limitations: string[];
  excerpts: Array<{ text: string; charOffset: number }>;
}

export interface ExclusionMatch {
  capabilityId: string;
  capabilityName: string;
  signal: string;
  inPrimaryScope: boolean;
  excerpt: string;
  charOffset: number;
}

export interface PrimeFeasibility {
  feasible: boolean;
  reasons: string[];
  concerns: string[];
}

export interface TeamingFeasibility {
  feasible: boolean;
  fftcWorkshare: string[];
  partnerRequirements: string[];
  concerns: string[];
}

export interface QualificationResult {
  classification: QualificationClassification;
  primaryScope: string;
  evidenceQuality: EvidenceQuality;
  matchedCapabilities: CapabilityMatch[];
  exclusions: ExclusionMatch[];
  primeFeasibility: PrimeFeasibility;
  teamingFeasibility: TeamingFeasibility;
  supportingEngagements: string[];
  deliveryLimitations: string[];
  missingInformation: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rationale: string;
}

// ============================================================
// Core Qualifier
// ============================================================

export function qualifyOpportunity(
  opp: NormalizedOpportunity,
  capabilities: CapabilityEntry[] = CAPABILITIES,
  engagements: EngagementEntry[] = ENGAGEMENTS
): QualificationResult {
  // 1. Assess evidence quality
  const evidenceQuality = assessEvidenceQuality(opp.title, opp.description);

  // If we can't determine scope, return early
  if (evidenceQuality.classification === 'TITLE_ONLY') {
    return insufficientEvidence(opp, evidenceQuality, 'Notice text is too short to determine primary scope');
  }

  const text = `${opp.title} ${opp.description || ''}`;
  const lowerText = text.toLowerCase();

  // 2. Check for NOT_ESTABLISHED exclusions in primary scope
  const exclusions = findExclusions(opp, capabilities);
  const primaryExclusions = exclusions.filter((e) => e.inPrimaryScope);

  // 3. Find PROVEN/ADJACENT capability matches
  const provenMatches = findCapabilityMatches(opp, capabilities, 'PROVEN');
  const adjacentMatches = findCapabilityMatches(opp, capabilities, 'ADJACENT');
  const teamingMatches = findCapabilityMatches(opp, capabilities, 'TEAMING_REQUIRED');

  // Only count matches that appear in primary scope
  const primaryProven = provenMatches.filter((m) => m.relevance === 'PRIMARY_SCOPE');
  const primaryTeaming = teamingMatches.filter((m) => m.relevance === 'PRIMARY_SCOPE');

  // 4. Determine primary scope description
  const primaryScope = inferPrimaryScope(opp, exclusions, provenMatches, teamingMatches);

  // 5. Collect all supporting engagements
  const allEngagementIds = new Set<string>();
  for (const m of [...provenMatches, ...adjacentMatches]) {
    m.engagementIds.forEach((eid) => allEngagementIds.add(eid));
  }

  // 6. Assess delivery limitations
  const limitations = collectLimitations(provenMatches, adjacentMatches, capabilities);

  // 7. Determine prime feasibility
  const primeFeasibility = assessPrimeFeasibility(
    opp, primaryProven, primaryExclusions, primaryTeaming, capabilities, engagements
  );

  // 8. Determine teaming feasibility
  const teamingFeasibility = assessTeamingFeasibility(
    opp, provenMatches, adjacentMatches, teamingMatches, primaryExclusions, capabilities
  );

  // 9. Missing information
  const missing = identifyMissingInformation(opp, evidenceQuality, provenMatches);

  // 10. Classify
  const classification = determineClassification(
    evidenceQuality, primaryProven, primaryExclusions, primaryTeaming,
    primeFeasibility, teamingFeasibility, lowerText
  );

  // 11. Confidence
  const confidence = determineConfidence(evidenceQuality, provenMatches, exclusions);

  // 12. Build rationale
  const rationale = buildRationale(
    classification, primaryScope, primaryProven, primaryExclusions,
    primeFeasibility, teamingFeasibility
  );

  return {
    classification,
    primaryScope,
    evidenceQuality,
    matchedCapabilities: [...provenMatches, ...adjacentMatches],
    exclusions,
    primeFeasibility,
    teamingFeasibility,
    supportingEngagements: [...allEngagementIds],
    deliveryLimitations: limitations,
    missingInformation: missing,
    confidence,
    rationale,
  };
}

// ============================================================
// Internal Functions
// ============================================================

function insufficientEvidence(
  _opp: NormalizedOpportunity,
  evidenceQuality: EvidenceQuality,
  reason: string
): QualificationResult {
  return {
    classification: 'INSUFFICIENT_EVIDENCE',
    primaryScope: 'Cannot determine from available notice text',
    evidenceQuality,
    matchedCapabilities: [],
    exclusions: [],
    primeFeasibility: { feasible: false, reasons: [], concerns: [reason] },
    teamingFeasibility: { feasible: false, fftcWorkshare: [], partnerRequirements: [], concerns: [reason] },
    supportingEngagements: [],
    deliveryLimitations: [],
    missingInformation: ['Full SOW/PWS needed to assess scope'],
    confidence: 'LOW',
    rationale: reason,
  };
}

function findExclusions(
  opp: NormalizedOpportunity,
  capabilities: CapabilityEntry[]
): ExclusionMatch[] {
  const results: ExclusionMatch[] = [];
  const notEstablished = capabilities.filter(
    (c) => c.classification === 'NOT_ESTABLISHED' || c.classification === 'TEAMING_REQUIRED'
  );

  for (const cap of notEstablished) {
    if (cap.exclusionSignals.length === 0) continue;

    const extracted = extractRequirements(
      opp.title,
      opp.description,
      cap.exclusionSignals
    );

    for (const req of extracted) {
      // Use the first non-title excerpt for provenance
      const bestExcerpt = req.excerpts.find((e) => e.context !== 'title') || req.excerpts[0];
      results.push({
        capabilityId: cap.id,
        capabilityName: cap.name,
        signal: req.signal,
        inPrimaryScope: req.inPrimaryScope,
        excerpt: bestExcerpt.text,
        charOffset: bestExcerpt.charOffset,
      });
    }
  }

  return results;
}

function findCapabilityMatches(
  opp: NormalizedOpportunity,
  capabilities: CapabilityEntry[],
  classification: CapabilityClassification
): CapabilityMatch[] {
  const results: CapabilityMatch[] = [];
  const filtered = capabilities.filter((c) => c.classification === classification);

  for (const cap of filtered) {
    if (cap.matchSignals.length === 0) continue;

    const extracted = extractRequirements(
      opp.title,
      opp.description,
      cap.matchSignals
    );

    if (extracted.length === 0) continue;

    // Determine relevance based on where signals appear
    const hasPrimaryScope = extracted.some((r) => r.inPrimaryScope);
    const hasTitle = extracted.some((r) => r.excerpts.some((e) => e.context === 'title'));

    let relevance: 'PRIMARY_SCOPE' | 'SUPPORTING' | 'ANCILLARY';
    if (hasPrimaryScope) {
      relevance = 'PRIMARY_SCOPE';
    } else if (hasTitle) {
      relevance = 'SUPPORTING';
    } else {
      relevance = 'ANCILLARY';
    }

    const allExcerpts = extracted.flatMap((r) =>
      r.excerpts.slice(0, 2).map((e) => ({ text: e.text, charOffset: e.charOffset }))
    );

    results.push({
      capabilityId: cap.id,
      capabilityName: cap.name,
      classification: cap.classification,
      relevance,
      engagementIds: cap.engagementIds,
      limitations: cap.scopeLimitations,
      excerpts: allExcerpts.slice(0, 3),
    });
  }

  return results;
}

function inferPrimaryScope(
  _opp: NormalizedOpportunity,
  exclusions: ExclusionMatch[],
  provenMatches: CapabilityMatch[],
  teamingMatches: CapabilityMatch[]
): string {
  const parts: string[] = [];

  // Primary exclusions first (these dominate scope)
  const primaryExcl = exclusions.filter((e) => e.inPrimaryScope);
  if (primaryExcl.length > 0) {
    const uniqueCaps = Array.from(new Set(primaryExcl.map((e) => e.capabilityName)));
    parts.push(uniqueCaps.join(', '));
  }

  // Primary teaming requirements
  const primaryTeaming = teamingMatches.filter((m) => m.relevance === 'PRIMARY_SCOPE');
  if (primaryTeaming.length > 0) {
    const names = primaryTeaming.map((m) => m.capabilityName);
    for (const n of names) {
      if (!parts.some((p) => p.includes(n))) parts.push(n);
    }
  }

  // Primary proven matches
  const primaryProven = provenMatches.filter((m) => m.relevance === 'PRIMARY_SCOPE');
  if (primaryProven.length > 0) {
    const names = primaryProven.map((m) => m.capabilityName);
    for (const n of names) {
      if (!parts.some((p) => p.includes(n))) parts.push(n);
    }
  }

  if (parts.length === 0) {
    return `Scope unclear from notice text for: ${_opp.title.slice(0, 100)}`;
  }

  return parts.join('; ');
}

function collectLimitations(
  proven: CapabilityMatch[],
  adjacent: CapabilityMatch[],
  _capabilities: CapabilityEntry[]
): string[] {
  const lims: string[] = [];
  for (const m of [...proven, ...adjacent]) {
    for (const l of m.limitations) {
      if (!lims.includes(l)) lims.push(l);
    }
  }
  return lims;
}

function assessPrimeFeasibility(
  opp: NormalizedOpportunity,
  primaryProven: CapabilityMatch[],
  primaryExclusions: ExclusionMatch[],
  primaryTeaming: CapabilityMatch[],
  _capabilities: CapabilityEntry[],
  engagements: EngagementEntry[]
): PrimeFeasibility {
  const reasons: string[] = [];
  const concerns: string[] = [];

  // Must have at least one proven capability matching primary scope
  if (primaryProven.length === 0) {
    concerns.push('No PROVEN capability matches the primary scope');
  } else {
    reasons.push(
      `PROVEN capability match: ${primaryProven.map((m) => m.capabilityName).join(', ')}`
    );
  }

  // Primary scope dominated by NOT_ESTABLISHED or TEAMING_REQUIRED?
  if (primaryExclusions.length > 0) {
    const uniqueExcl = Array.from(new Set(primaryExclusions.map((e) => e.capabilityName)));
    concerns.push(
      `Primary scope includes capabilities outside FFTC evidence: ${uniqueExcl.join(', ')}`
    );
  }

  if (primaryTeaming.length > 0 && primaryProven.length === 0) {
    concerns.push('Primary scope requires capabilities FFTC cannot deliver independently');
  }

  // Check prime delivery evidence
  const primeEngagements = engagements.filter((e) => e.role === 'Prime');
  if (primeEngagements.length === 0) {
    concerns.push('No prime contract delivery history');
  } else {
    reasons.push(
      `Prime experience: ${primeEngagements.map((e) => e.name).join(', ')}`
    );
    // Note the scale limitation without a hard cutoff
    const maxPrimeScale = 'Largest prime delivery: ~$241K (NJ Permitting)';
    if (opp.estimatedValue && opp.estimatedValue > 500000) {
      concerns.push(`${maxPrimeScale}; this opportunity may exceed demonstrated prime scale`);
    } else {
      concerns.push(maxPrimeScale);
    }
  }

  // Set-aside eligibility
  if (opp.setAside) {
    const setAsideLower = opp.setAside.toLowerCase();
    const eligible =
      setAsideLower.includes('8a') ||
      setAsideLower.includes('sdvosb') ||
      setAsideLower.includes('wosb') ||
      setAsideLower === 'sba';
    if (!eligible && setAsideLower !== 'none') {
      concerns.push(`Set-aside ${opp.setAside} may not match FFTC certifications`);
    }
  }

  return {
    feasible: reasons.length > 0 && concerns.filter((c) => c.includes('outside FFTC') || c.includes('cannot deliver')).length === 0,
    reasons,
    concerns,
  };
}

function assessTeamingFeasibility(
  _opp: NormalizedOpportunity,
  provenMatches: CapabilityMatch[],
  _adjacentMatches: CapabilityMatch[],
  teamingMatches: CapabilityMatch[],
  primaryExclusions: ExclusionMatch[],
  capabilities: CapabilityEntry[]
): TeamingFeasibility {
  const fftcWorkshare: string[] = [];
  const partnerRequirements: string[] = [];
  const concerns: string[] = [];

  // FFTC workshare comes from PROVEN matches only (not TEAMING_REQUIRED)
  const relevantProven = provenMatches.filter(
    (m) => m.relevance === 'PRIMARY_SCOPE' || m.relevance === 'SUPPORTING'
  );

  for (const m of relevantProven) {
    fftcWorkshare.push(`${m.capabilityName} (${m.capabilityId})`);
  }

  // Partner requirements from TEAMING_REQUIRED matches
  for (const m of teamingMatches) {
    const cap = capabilities.find((c) => c.id === m.capabilityId);
    if (cap?.teamingRequirement) {
      partnerRequirements.push(cap.teamingRequirement);
    }
  }

  // Also from NOT_ESTABLISHED exclusions in primary scope
  for (const e of primaryExclusions) {
    const cap = capabilities.find((c) => c.id === e.capabilityId);
    if (cap && cap.classification === 'NOT_ESTABLISHED') {
      partnerRequirements.push(`${cap.name} partner required`);
    }
  }

  // Is the workshare meaningful?
  if (fftcWorkshare.length === 0) {
    concerns.push('No PROVEN capability produces a separable, deliverable workshare');
  }

  // Is the workshare a real deliverable or just "review accessibility"?
  const workshareStrong = relevantProven.some(
    (m) => m.classification === 'PROVEN' &&
      capabilities.find((c) => c.id === m.capabilityId)?.strength !== 'Limited'
  );
  if (!workshareStrong && fftcWorkshare.length > 0) {
    concerns.push('Identified workshare relies on capabilities with Limited evidence strength');
  }

  return {
    feasible: fftcWorkshare.length > 0 && partnerRequirements.length > 0,
    fftcWorkshare,
    partnerRequirements: Array.from(new Set(partnerRequirements)),
    concerns,
  };
}

function identifyMissingInformation(
  opp: NormalizedOpportunity,
  evidence: EvidenceQuality,
  provenMatches: CapabilityMatch[]
): string[] {
  const missing: string[] = [];

  if (evidence.classification === 'THIN_NOTICE' || evidence.classification === 'TITLE_ONLY') {
    missing.push('Full SOW/PWS needed to assess scope');
  }

  if (!opp.estimatedValue) {
    missing.push('Contract value not available');
  }

  if (!opp.responseDeadline) {
    missing.push('Response deadline not specified');
  }

  if (provenMatches.length > 0 && provenMatches.every((m) => m.relevance === 'ANCILLARY')) {
    missing.push('Capability matches appear only in ancillary text; SOW core requirements unclear');
  }

  return missing;
}

function determineClassification(
  evidence: EvidenceQuality,
  primaryProven: CapabilityMatch[],
  primaryExclusions: ExclusionMatch[],
  primaryTeaming: CapabilityMatch[],
  prime: PrimeFeasibility,
  teaming: TeamingFeasibility,
  _lowerText: string
): QualificationClassification {
  // Insufficient evidence if we can't see scope
  if (evidence.classification === 'THIN_NOTICE') {
    // Even thin notices can be clearly NOT_A_FIT if exclusions dominate
    if (primaryExclusions.length >= 2 && primaryProven.length === 0) {
      return 'NOT_A_FIT';
    }
    return 'INSUFFICIENT_EVIDENCE';
  }

  // NOT_A_FIT if it's a COTS/SaaS/product licensing procurement
  if (isCOTSOrProductProcurement(_lowerText)) {
    return 'NOT_A_FIT';
  }

  const notEstablishedExclusions = primaryExclusions.filter((e) => {
    const cap = CAPABILITIES.find((c) => c.id === e.capabilityId);
    return cap?.classification === 'NOT_ESTABLISHED';
  });

  // NOT_A_FIT if primary scope is NOT_ESTABLISHED and no proven anchor exists
  // AND no teaming workshare is feasible
  if (notEstablishedExclusions.length > 0 && primaryProven.length === 0 && !teaming.feasible) {
    return 'NOT_A_FIT';
  }

  // NOT_A_FIT if primary scope requires only TEAMING capabilities with no proven anchor
  // AND no teaming workshare is feasible
  if (primaryTeaming.length > 0 && primaryProven.length === 0 && !teaming.feasible) {
    return 'NOT_A_FIT';
  }

  // No proven matches in primary scope at all AND no teaming workshare → NOT_A_FIT
  if (primaryProven.length === 0 && !teaming.feasible) {
    return 'NOT_A_FIT';
  }

  // PRIME_FIT if prime feasibility is assessed as feasible and no NOT_ESTABLISHED
  // exclusions dominate the primary scope
  if (prime.feasible && notEstablishedExclusions.length === 0 && primaryExclusions.length === 0) {
    return 'PRIME_FIT';
  }

  // TEAMING_FIT: a credible separable FFTC workshare exists alongside
  // TEAMING_REQUIRED or NOT_ESTABLISHED scope that requires a partner.
  // Discovery is broad; qualification is against FFTC capabilities.
  if (teaming.feasible && teaming.fftcWorkshare.length > 0) {
    return 'TEAMING_FIT';
  }

  // NOT_A_FIT if exclusions dominate and no workshare identified
  if (notEstablishedExclusions.length > primaryProven.length && !teaming.feasible) {
    return 'NOT_A_FIT';
  }

  // Fallback: proven matches exist but feasibility is unclear
  return 'INSUFFICIENT_EVIDENCE';
}

function determineConfidence(
  evidence: EvidenceQuality,
  provenMatches: CapabilityMatch[],
  exclusions: ExclusionMatch[]
): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (evidence.classification === 'TITLE_ONLY' || evidence.classification === 'THIN_NOTICE') {
    return 'LOW';
  }

  // High confidence when we have detailed SOW and clear signal
  if (evidence.classification === 'DETAILED_SOW') {
    if (exclusions.some((e) => e.inPrimaryScope) || provenMatches.some((m) => m.relevance === 'PRIMARY_SCOPE')) {
      return 'HIGH';
    }
    return 'MEDIUM';
  }

  return 'MEDIUM';
}

function buildRationale(
  classification: QualificationClassification,
  primaryScope: string,
  primaryProven: CapabilityMatch[],
  primaryExclusions: ExclusionMatch[],
  prime: PrimeFeasibility,
  teaming: TeamingFeasibility
): string {
  const parts: string[] = [];

  parts.push(`Primary scope: ${primaryScope}.`);

  switch (classification) {
    case 'PRIME_FIT':
      parts.push(`FFTC can credibly deliver via: ${primaryProven.map((m) => m.capabilityName).join(', ')}.`);
      if (prime.concerns.length > 0) {
        parts.push(`Considerations: ${prime.concerns[0]}.`);
      }
      break;

    case 'TEAMING_FIT':
      parts.push(`FFTC workshare: ${teaming.fftcWorkshare.join(', ')}.`);
      parts.push(`Partner must bring: ${teaming.partnerRequirements.join(', ')}.`);
      break;

    case 'NOT_A_FIT':
      if (primaryExclusions.length > 0) {
        const excNames = Array.from(new Set(primaryExclusions.map((e) => e.capabilityName)));
        parts.push(`Primary scope requires ${excNames.join(', ')} — outside FFTC documented capabilities.`);
      }
      if (primaryProven.length === 0) {
        parts.push('No PROVEN FFTC capability matches the primary delivery scope.');
      }
      break;

    case 'INSUFFICIENT_EVIDENCE':
      parts.push('Available notice text does not establish primary scope or separable workshare.');
      break;
  }

  return parts.join(' ');
}

/**
 * Detect COTS, SaaS, or product licensing procurements.
 * These are not service delivery opportunities regardless of keyword matches.
 */
function isCOTSOrProductProcurement(lowerText: string): boolean {
  const cotsSignals = [
    'cots product',
    'cots solution',
    'cots saas',
    'saas solution',
    'software as a service',
    'software as a solution',
    'product licensing',
    'licensing procurement',
    'software licensing',
    'commercial off-the-shelf',
    'this is a product licensing procurement',
    'this is a cots',
  ];
  return cotsSignals.some((s) => lowerText.includes(s));
}
