/**
 * Pursuit Recommendation Engine
 *
 * Deterministic, shadow-only recommendations for opportunity pursuit.
 * Takes capability qualification as input and produces actionable advice
 * with evidence references, rationale, and Denise questions.
 *
 * Actions are RECOMMENDATIONS, never execution authorization.
 * No LLM calls, no Slack posts, no database writes.
 */

import type { QualificationResult } from './capability-qualifier.js';
import type { NormalizedOpportunity } from './types.js';
import { CAPABILITIES } from './capability-data.js';

// ============================================================
// Types
// ============================================================

export type PursuitAction = 'PURSUE_PRIME' | 'EXPLORE_TEAMING' | 'MONITOR' | 'DECLINE';
export type Tristate = 'YES' | 'NO' | 'UNKNOWN';

export interface PursuitConfig {
  /** Minimum days to deadline for viable pursuit. Configurable. */
  minDeadlineDays: number;
  /** Minimum capability strength for substantive workshare */
  minWorkshareStrength: 'Strong' | 'Moderate' | 'Limited';
}

export const DEFAULT_PURSUIT_CONFIG: PursuitConfig = {
  minDeadlineDays: 14,
  minWorkshareStrength: 'Moderate',
};

export interface PrimeAssessment {
  fftcCapabilities: string[];
  engagementEvidence: string[];
  primeScaleRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  eligibility: Tristate;
  vehicleAccess: string | null;
}

export interface TeamingAssessment {
  fftcWorkshare: string[];
  partnerCapabilities: string[];
  workshareSubstantive: Tristate;
  workshareRationale: string;
}

export interface ContractAttractiveness {
  estimatedValue: number | null;
  withinFftcRange: Tristate;
  setAsideAdvantage: Tristate;
  agencyRelationship: 'ACTIVE' | 'PRIOR' | 'NONE';
  timelineViable: Tristate;
  daysToDeadline: number | null;
}

export interface PursuitRecommendation {
  action: PursuitAction;
  qualification: string;
  evidenceCompleteness: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT';

  primeAssessment: PrimeAssessment | null;
  teamingAssessment: TeamingAssessment | null;
  attractiveness: ContractAttractiveness;

  deniseQuestions: string[];
  nextSteps: string[];
  rationale: string;
  recommenderVersion: string;
  evaluatedAt: string;
}

// ============================================================
// Agency relationship mapping
// ============================================================

const ACTIVE_AGENCIES = ['VA', 'CMS'];
const PRIOR_AGENCIES = ['HHS', 'IRS', 'Smithsonian', 'Maryland', 'New Jersey', 'New York'];

function classifyAgencyRelationship(agency: string | null): 'ACTIVE' | 'PRIOR' | 'NONE' {
  if (!agency) return 'NONE';
  const upper = agency.toUpperCase();
  if (ACTIVE_AGENCIES.some((a) => upper.includes(a))) return 'ACTIVE';
  if (upper.includes('VETERANS AFFAIRS')) return 'ACTIVE';
  if (upper.includes('MEDICARE') || upper.includes('MEDICAID')) return 'ACTIVE';
  if (PRIOR_AGENCIES.some((a) => upper.includes(a.toUpperCase()))) return 'PRIOR';
  if (upper.includes('HEALTH AND HUMAN SERVICES')) return 'PRIOR';
  return 'NONE';
}

// ============================================================
// Core Recommendation
// ============================================================

export function recommendPursuit(
  opp: NormalizedOpportunity,
  qualification: QualificationResult,
  config: PursuitConfig = DEFAULT_PURSUIT_CONFIG
): PursuitRecommendation {
  const now = new Date();

  // Evidence completeness
  const evidenceCompleteness = assessEvidenceCompleteness(qualification);

  // Timeline
  const daysToDeadline = opp.responseDeadline
    ? Math.ceil((new Date(opp.responseDeadline).getTime() - now.getTime()) / (86400000))
    : null;

  const timelineViable: Tristate = daysToDeadline === null
    ? 'UNKNOWN'
    : daysToDeadline >= config.minDeadlineDays ? 'YES' : 'NO';

  // Set-aside eligibility
  const setAsideAdvantage = assessSetAsideAdvantage(opp.setAside);

  // Eligibility
  const eligibility = assessEligibility(opp.setAside);

  // Agency relationship
  const agencyRelationship = classifyAgencyRelationship(opp.agency);

  // Contract value assessment
  const withinFftcRange = assessValueRange(opp.estimatedValue);

  // Contract attractiveness
  const attractiveness: ContractAttractiveness = {
    estimatedValue: opp.estimatedValue,
    withinFftcRange,
    setAsideAdvantage,
    agencyRelationship,
    timelineViable,
    daysToDeadline,
  };

  // Route by qualification classification
  switch (qualification.classification) {
    case 'INSUFFICIENT_EVIDENCE':
      return buildMonitor(opp, qualification, evidenceCompleteness, attractiveness, config);

    case 'NOT_A_FIT':
      return buildDecline(opp, qualification, evidenceCompleteness, attractiveness);

    case 'PRIME_FIT':
      return buildPrimeRecommendation(opp, qualification, evidenceCompleteness, attractiveness, eligibility, config);

    case 'TEAMING_FIT':
      return buildTeamingRecommendation(opp, qualification, evidenceCompleteness, attractiveness, config);
  }
}

// ============================================================
// Evidence Completeness
// ============================================================

function assessEvidenceCompleteness(
  qual: QualificationResult
): 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' {
  if (qual.evidenceQuality.classification === 'TITLE_ONLY') return 'INSUFFICIENT';
  if (qual.evidenceQuality.classification === 'THIN_NOTICE') return 'INSUFFICIENT';
  if (qual.evidenceQuality.classification === 'DETAILED_SOW') return 'SUFFICIENT';

  // PARTIAL_SCOPE — check if we have enough signal
  const hasCapMatch = qual.matchedCapabilities.length > 0;
  const hasExclusions = qual.exclusions.length > 0;
  if (hasCapMatch || hasExclusions) return 'PARTIAL';

  return 'INSUFFICIENT';
}

// ============================================================
// Eligibility and Value Assessment
// ============================================================

function assessSetAsideAdvantage(setAside: string | null): Tristate {
  if (!setAside) return 'UNKNOWN';
  const lower = setAside.toLowerCase();
  if (lower === 'none' || lower === '') return 'NO';
  // FFTC holds: 8(a), SDVOSB, WOSB
  if (lower.includes('8a') || lower.includes('sdvosb') || lower.includes('wosb') || lower === 'sba') {
    return 'YES';
  }
  return 'NO';
}

function assessEligibility(setAside: string | null): Tristate {
  if (!setAside || setAside.toLowerCase() === 'none') return 'YES'; // full & open
  const lower = setAside.toLowerCase();
  if (lower.includes('8a') || lower.includes('sdvosb') || lower.includes('wosb') || lower === 'sba') {
    return 'YES';
  }
  // Unknown set-aside types
  return 'UNKNOWN';
}

function assessValueRange(value: number | null): Tristate {
  if (value === null) return 'UNKNOWN';
  // FFTC prime evidence: up to ~$241K. Comfortable range: $50K-$500K.
  // Teaming range: up to $30M. Above that, FFTC share would be minimal.
  if (value >= 50000 && value <= 500000) return 'YES';
  if (value > 500000 && value <= 30000000) return 'UNKNOWN'; // Could work for teaming
  return 'NO';
}

// ============================================================
// Workshare Substantiveness
// ============================================================

function assessWorkshareSubstantiveness(
  qual: QualificationResult,
  config: PursuitConfig
): { substantive: Tristate; rationale: string } {
  const workshare = qual.teamingFeasibility.fftcWorkshare;
  if (workshare.length === 0) {
    return { substantive: 'NO', rationale: 'No proven FFTC workshare identified' };
  }

  // Check if any matched capability has sufficient strength
  const matchedCaps = qual.matchedCapabilities.filter(
    (m) => m.relevance === 'PRIMARY_SCOPE' || m.relevance === 'SUPPORTING'
  );

  const strengthThreshold = config.minWorkshareStrength;
  const strengthOrder = { Strong: 3, Moderate: 2, Limited: 1 };
  const minStrength = strengthOrder[strengthThreshold];

  const substantiveCaps = matchedCaps.filter((m) => {
    const cap = CAPABILITIES.find((c) => c.id === m.capabilityId);
    if (!cap?.strength) return false;
    return strengthOrder[cap.strength] >= minStrength;
  });

  if (substantiveCaps.length === 0) {
    return {
      substantive: 'NO',
      rationale: `Identified workshare relies on capabilities below ${strengthThreshold} strength: ${workshare.join(', ')}`,
    };
  }

  // Check if workshare is a distinct task area (not just an embedded practice)
  // Look for multiple matching signals in the SOW — single mention is marginal
  const totalExcerpts = substantiveCaps.reduce((sum, m) => sum + m.excerpts.length, 0);
  if (totalExcerpts <= 1) {
    return {
      substantive: 'UNKNOWN',
      rationale: `Workshare (${substantiveCaps.map((c) => c.capabilityName).join(', ')}) appears once in the SOW — may be embedded practice rather than separable task area`,
    };
  }

  // Check if the workshare is proportional to the overall scope.
  // If exclusions heavily outnumber proven matches, the workshare
  // is likely marginal (e.g., "incorporate user research" in a 62-FTE
  // scientific computing effort).
  if (qual.exclusions.length > 0) {
    const exclusionRatio = qual.exclusions.length / (qual.exclusions.length + substantiveCaps.length);
    if (exclusionRatio > 0.6) {
      return {
        substantive: 'UNKNOWN',
        rationale: `Workshare (${substantiveCaps.map((c) => c.capabilityName).join(', ')}) is disproportionately small relative to the overall scope (${qual.exclusions.length} non-FFTC scope signals vs ${substantiveCaps.length} FFTC capabilities)`,
      };
    }
  }

  return {
    substantive: 'YES',
    rationale: `Substantive workshare: ${substantiveCaps.map((c) => c.capabilityName).join(', ')} with ${totalExcerpts} supporting references in the SOW`,
  };
}

// ============================================================
// Recommendation Builders
// ============================================================

function buildMonitor(
  _opp: NormalizedOpportunity,
  qual: QualificationResult,
  evidenceCompleteness: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT',
  attractiveness: ContractAttractiveness,
  _config: PursuitConfig
): PursuitRecommendation {
  const nextSteps: string[] = ['Await SOW/solicitation release'];
  if (qual.missingInformation.length > 0) {
    nextSteps.push(...qual.missingInformation.map((m) => `Resolve: ${m}`));
  }
  nextSteps.push('Monitor for amendments');

  return {
    action: 'MONITOR',
    qualification: qual.classification,
    evidenceCompleteness,
    primeAssessment: null,
    teamingAssessment: null,
    attractiveness,
    deniseQuestions: [],
    nextSteps,
    rationale: `Insufficient evidence to assess fit. ${qual.rationale}`,
    recommenderVersion: 'v1',
    evaluatedAt: new Date().toISOString(),
  };
}

function buildDecline(
  _opp: NormalizedOpportunity,
  qual: QualificationResult,
  evidenceCompleteness: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT',
  attractiveness: ContractAttractiveness
): PursuitRecommendation {
  return {
    action: 'DECLINE',
    qualification: qual.classification,
    evidenceCompleteness,
    primeAssessment: null,
    teamingAssessment: null,
    attractiveness,
    deniseQuestions: [],
    nextSteps: [],
    rationale: qual.rationale,
    recommenderVersion: 'v1',
    evaluatedAt: new Date().toISOString(),
  };
}

function buildPrimeRecommendation(
  opp: NormalizedOpportunity,
  qual: QualificationResult,
  evidenceCompleteness: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT',
  attractiveness: ContractAttractiveness,
  eligibility: Tristate,
  _config: PursuitConfig
): PursuitRecommendation {
  const primeAssessment: PrimeAssessment = {
    fftcCapabilities: qual.matchedCapabilities.map((m) => m.capabilityId),
    engagementEvidence: qual.supportingEngagements,
    primeScaleRisk: assessPrimeScaleRisk(opp.estimatedValue),
    eligibility,
    vehicleAccess: opp.vehicle,
  };

  const deniseQuestions = generateDeniseQuestions(opp, qual, 'prime');
  const nextSteps: string[] = [];

  // Only recommend PURSUE_PRIME with adequate evidence AND confirmed eligibility
  // SUFFICIENT or PARTIAL evidence is acceptable when qualification is confirmed PRIME_FIT
  const canPursue =
    evidenceCompleteness !== 'INSUFFICIENT' &&
    eligibility === 'YES' &&
    attractiveness.timelineViable !== 'NO';

  if (!canPursue) {
    // Downgrade to MONITOR with specific reasons
    if (evidenceCompleteness !== 'SUFFICIENT') {
      nextSteps.push('Await detailed SOW/solicitation for scope confirmation');
    }
    if (eligibility === 'UNKNOWN') {
      nextSteps.push(`Verify eligibility for set-aside: ${opp.setAside}`);
    }
    if (attractiveness.timelineViable === 'NO') {
      nextSteps.push(`Deadline in ${attractiveness.daysToDeadline} days — may be insufficient for proposal preparation`);
    }

    return {
      action: 'MONITOR',
      qualification: qual.classification,
      evidenceCompleteness,
      primeAssessment,
      teamingAssessment: null,
      attractiveness,
      deniseQuestions,
      nextSteps,
      rationale: `Prime-eligible but missing prerequisites: ${nextSteps.join('; ')}`,
      recommenderVersion: 'v1',
      evaluatedAt: new Date().toISOString(),
    };
  }

  nextSteps.push('Review SOW scope against FFTC capabilities');
  nextSteps.push('Assess proposal effort and team availability');
  if (deniseQuestions.length > 0) {
    nextSteps.push('Route acquisition questions to Denise');
  }

  return {
    action: 'PURSUE_PRIME',
    qualification: qual.classification,
    evidenceCompleteness,
    primeAssessment,
    teamingAssessment: null,
    attractiveness,
    deniseQuestions,
    nextSteps,
    rationale: `FFTC can credibly deliver primary scope. ${qual.rationale}`,
    recommenderVersion: 'v1',
    evaluatedAt: new Date().toISOString(),
  };
}

function buildTeamingRecommendation(
  opp: NormalizedOpportunity,
  qual: QualificationResult,
  evidenceCompleteness: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT',
  attractiveness: ContractAttractiveness,
  config: PursuitConfig
): PursuitRecommendation {
  const workshareAssessment = assessWorkshareSubstantiveness(qual, config);

  const teamingAssessment: TeamingAssessment = {
    fftcWorkshare: qual.teamingFeasibility.fftcWorkshare,
    partnerCapabilities: qual.teamingFeasibility.partnerRequirements,
    workshareSubstantive: workshareAssessment.substantive,
    workshareRationale: workshareAssessment.rationale,
  };

  const deniseQuestions = generateDeniseQuestions(opp, qual, 'teaming');

  // Only recommend EXPLORE_TEAMING with substantive workshare
  if (workshareAssessment.substantive !== 'YES') {
    const nextSteps: string[] = [];
    if (workshareAssessment.substantive === 'UNKNOWN') {
      nextSteps.push('Await detailed SOW to confirm FFTC workshare scope');
    }
    nextSteps.push('Monitor for solicitation release');

    return {
      action: 'MONITOR',
      qualification: qual.classification,
      evidenceCompleteness,
      primeAssessment: null,
      teamingAssessment,
      attractiveness,
      deniseQuestions: [],
      nextSteps,
      rationale: `Teaming potential identified but workshare is not confirmed substantive. ${workshareAssessment.rationale}`,
      recommenderVersion: 'v1',
      evaluatedAt: new Date().toISOString(),
    };
  }

  // Workshare is substantive — recommend exploration
  const nextSteps = [
    'Identify potential prime partners with required capabilities',
    'Assess FFTC workshare value relative to total contract scope',
  ];
  if (deniseQuestions.length > 0) {
    nextSteps.push('Route acquisition questions to Denise');
  }

  return {
    action: 'EXPLORE_TEAMING',
    qualification: qual.classification,
    evidenceCompleteness,
    primeAssessment: null,
    teamingAssessment,
    attractiveness,
    deniseQuestions,
    nextSteps,
    rationale: `Meaningful FFTC workshare identified within partner-led scope. ${workshareAssessment.rationale}`,
    recommenderVersion: 'v1',
    evaluatedAt: new Date().toISOString(),
  };
}

// ============================================================
// Helpers
// ============================================================

function assessPrimeScaleRisk(value: number | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (value === null) return 'MEDIUM';
  if (value <= 250000) return 'LOW';
  if (value <= 1000000) return 'MEDIUM';
  return 'HIGH';
}

function generateDeniseQuestions(
  opp: NormalizedOpportunity,
  qual: QualificationResult,
  context: 'prime' | 'teaming'
): string[] {
  const questions: string[] = [];

  // Vehicle requirements
  if (opp.vehicle) {
    questions.push(`Does FFTC have access to the required vehicle: ${opp.vehicle}?`);
  }

  // Security clearance
  const descLower = (opp.description || '').toLowerCase();
  if (descLower.includes('clearance') || descLower.includes('secret') || descLower.includes('top secret')) {
    questions.push('What security clearance level is required?');
  }

  // Set-aside implications for teaming
  if (context === 'teaming' && opp.setAside) {
    questions.push(`How does the ${opp.setAside} set-aside affect teaming arrangements?`);
  }

  // Incumbent
  if (descLower.includes('incumbent') || descLower.includes('recompete')) {
    questions.push('Who is the incumbent contractor?');
  }

  // Key personnel
  if (descLower.includes('key personnel')) {
    questions.push('What key personnel qualifications are required?');
  }

  // Contract type
  if (descLower.includes('idiq') || descLower.includes('bpa')) {
    questions.push('Is this an IDIQ/BPA — does it allow task-order-level teaming?');
  }

  // Missing info from qualifier
  for (const missing of qual.missingInformation) {
    if (!questions.some((q) => q.includes(missing))) {
      questions.push(`Resolve: ${missing}`);
    }
  }

  return questions.slice(0, 5);
}
