// Data-driven opinion formation
// Determines WHAT agents think based on real analysis
// Phrases module determines HOW they express it

import type { Opportunity, Agency, Company } from '../types/index.js';

export interface OpportunityAnalysis {
  // Timeline assessment
  daysUntilDue: number | null;
  timelinePressure: 'critical' | 'tight' | 'reasonable' | 'comfortable';

  // Fit assessment
  fitScore: number;
  keywordsMatched: string[];
  fitLevel: 'strong' | 'moderate' | 'weak';

  // Competition assessment
  hasIncumbent: boolean;
  incumbentName: string | null;
  incumbentStrength: 'strong' | 'moderate' | 'weak' | 'none';

  // Set-aside assessment
  setAside: string | null;
  canPrime: boolean;

  // Agency assessment
  agencyPriority: boolean;
  agencyHistory: 'positive' | 'neutral' | 'negative' | 'none';

  // Requirements clarity
  requirementsClarity: 'clear' | 'moderate' | 'vague';

  // Overall signals
  davidSentiment: 'positive' | 'neutral' | 'skeptical';
  davidConcerns: string[];
  davidPositives: string[];
}

export interface PartnerAnalysis {
  availablePartners: Company[];
  strongMatches: Company[];
  possibleMatches: Company[];
  partnerConfidence: 'high' | 'medium' | 'low';
  missingCapabilities: string[];
  missingCertifications: string[];
}

export interface StrategicAnalysis {
  winProbability: 'high' | 'medium' | 'low';
  strategicValue: 'high' | 'medium' | 'low';
  recommendation: 'go' | 'no_go' | 'lean_go' | 'lean_no' | 'torn';
  keyFactors: string[];
  override: boolean; // Does strategic value override low pwin?
}

export interface ConversationDynamic {
  type: 'smooth' | 'debate' | 'tension';
  disagreements: Array<{
    between: [string, string];
    topic: string;
    resolution: string;
  }>;
  overallMood: 'optimistic' | 'cautious' | 'concerned';
}

// Priority agencies for our company
const PRIORITY_AGENCIES = ['VA', 'HHS', 'DOL', 'GSA', 'SBA', 'ED'];

// Analyze opportunity from David's perspective
export function analyzeOpportunity(opp: Opportunity, agency: Agency | null): OpportunityAnalysis {
  const concerns: string[] = [];
  const positives: string[] = [];

  // Timeline analysis
  let daysUntilDue: number | null = null;
  let timelinePressure: OpportunityAnalysis['timelinePressure'] = 'comfortable';

  if (opp.due_date) {
    const due = new Date(opp.due_date);
    daysUntilDue = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 21) {
      timelinePressure = 'critical';
      concerns.push(`Only ${daysUntilDue} days - very tight timeline`);
    } else if (daysUntilDue < 30) {
      timelinePressure = 'tight';
      concerns.push(`${daysUntilDue} days is tight but doable`);
    } else if (daysUntilDue < 60) {
      timelinePressure = 'reasonable';
      positives.push(`${daysUntilDue} days - reasonable runway`);
    } else {
      timelinePressure = 'comfortable';
      positives.push(`${daysUntilDue} days - good timeline`);
    }
  }

  // Fit analysis
  const fitScore = opp.fit_score || 0;
  const keywordsMatched = opp.keywords_matched || [];
  let fitLevel: OpportunityAnalysis['fitLevel'];

  if (fitScore >= 75) {
    fitLevel = 'strong';
    positives.push('Strong capability match');
  } else if (fitScore >= 50) {
    fitLevel = 'moderate';
    positives.push('Moderate capability fit');
  } else {
    fitLevel = 'weak';
    concerns.push(`Weak fit score (${fitScore}/100)`);
  }

  // Requirements clarity (based on keyword matches and description length)
  let requirementsClarity: OpportunityAnalysis['requirementsClarity'] = 'moderate';
  if (keywordsMatched.length >= 5 && opp.description && opp.description.length > 500) {
    requirementsClarity = 'clear';
    positives.push('Clear, well-defined requirements');
  } else if (keywordsMatched.length < 2 || !opp.description || opp.description.length < 200) {
    requirementsClarity = 'vague';
    concerns.push('Vague requirements - scope unclear');
  }

  // Set-aside analysis
  const setAside = null; // Would come from SAM data
  const canPrime = true; // Simplified - would check actual set-aside

  // Agency analysis
  const agencyPriority = PRIORITY_AGENCIES.includes(opp.agency || '');
  const agencyHistory: OpportunityAnalysis['agencyHistory'] = 'none';

  if (agencyPriority) {
    positives.push(`${opp.agency} is a priority agency for us`);
  }

  // Competition analysis (simplified - would use FPDS data)
  const hasIncumbent = false; // Would analyze from agency research
  const incumbentName: string | null = null;
  let incumbentStrength: OpportunityAnalysis['incumbentStrength'] = 'none';

  if (agency?.research_notes?.toLowerCase().includes('incumbent')) {
    // Check for incumbent mentions in research
    incumbentStrength = 'moderate';
    concerns.push('Likely incumbent advantage');
  }

  // Determine overall David sentiment
  let davidSentiment: OpportunityAnalysis['davidSentiment'] = 'neutral';

  if (concerns.length === 0 && positives.length >= 2) {
    davidSentiment = 'positive';
  } else if (concerns.length >= 2 || concerns.length > positives.length) {
    davidSentiment = 'skeptical';
  }

  return {
    daysUntilDue,
    timelinePressure,
    fitScore,
    keywordsMatched,
    fitLevel,
    hasIncumbent,
    incumbentName,
    incumbentStrength,
    setAside,
    canPrime,
    agencyPriority,
    agencyHistory,
    requirementsClarity,
    davidSentiment,
    davidConcerns: concerns,
    davidPositives: positives,
  };
}

// Analyze partner options from Rosa's perspective
export function analyzePartners(
  opp: Opportunity,
  partners: Company[],
  analysis: OpportunityAnalysis
): PartnerAnalysis {
  const strongMatches: Company[] = [];
  const possibleMatches: Company[] = [];
  const missingCapabilities: string[] = [];
  const missingCertifications: string[] = [];

  for (const partner of partners) {
    // Check if partner has relevant certifications
    const hasCerts = partner.certifications && partner.certifications.length > 0;
    // Check if partner has worked with this agency
    const hasAgencyHistory = partner.past_agencies?.includes(opp.agency || '');
    // Check relationship status
    const hasRelationship =
      partner.relationship_status === 'teamed' || partner.relationship_status === 'met';

    if (hasAgencyHistory && hasRelationship) {
      strongMatches.push(partner);
    } else if (hasCerts || hasAgencyHistory || hasRelationship) {
      possibleMatches.push(partner);
    }
  }

  // Determine confidence level
  let partnerConfidence: PartnerAnalysis['partnerConfidence'] = 'low';
  if (strongMatches.length >= 2) {
    partnerConfidence = 'high';
  } else if (strongMatches.length === 1 || possibleMatches.length >= 2) {
    partnerConfidence = 'medium';
  }

  // Check for missing capabilities
  if (!analysis.canPrime && partners.length === 0) {
    missingCertifications.push(analysis.setAside || 'required set-aside certification');
  }

  return {
    availablePartners: partners,
    strongMatches,
    possibleMatches,
    partnerConfidence,
    missingCapabilities,
    missingCertifications,
  };
}

// Strategic analysis from James's perspective
export function analyzeStrategy(
  _opp: Opportunity,
  oppAnalysis: OpportunityAnalysis,
  partnerAnalysis: PartnerAnalysis
): StrategicAnalysis {
  const keyFactors: string[] = [];
  let override = false;

  // Calculate win probability based on all factors
  let pwinScore = 50; // Start at neutral

  // Fit impact
  if (oppAnalysis.fitLevel === 'strong') {
    pwinScore += 15;
    keyFactors.push('Strong capability fit');
  } else if (oppAnalysis.fitLevel === 'weak') {
    pwinScore -= 15;
    keyFactors.push('Weak capability fit');
  }

  // Timeline impact
  if (oppAnalysis.timelinePressure === 'critical') {
    pwinScore -= 20;
    keyFactors.push('Critical timeline pressure');
  } else if (oppAnalysis.timelinePressure === 'comfortable') {
    pwinScore += 10;
  }

  // Competition impact
  if (oppAnalysis.incumbentStrength === 'strong') {
    pwinScore -= 20;
    keyFactors.push('Strong incumbent');
  } else if (oppAnalysis.incumbentStrength === 'none') {
    pwinScore += 10;
    keyFactors.push('No incumbent lock');
  }

  // Partner impact
  if (partnerAnalysis.partnerConfidence === 'high') {
    pwinScore += 10;
    keyFactors.push('Strong partner options');
  } else if (partnerAnalysis.partnerConfidence === 'low') {
    pwinScore -= 10;
    keyFactors.push('Limited partner options');
  }

  // Agency priority impact on strategic value
  let strategicValue: StrategicAnalysis['strategicValue'] = 'medium';
  if (oppAnalysis.agencyPriority) {
    strategicValue = 'high';
    keyFactors.push('Priority agency');
  }

  // Determine win probability bucket
  let winProbability: StrategicAnalysis['winProbability'] = 'medium';
  if (pwinScore >= 65) {
    winProbability = 'high';
  } else if (pwinScore < 40) {
    winProbability = 'low';
  }

  // Determine recommendation
  let recommendation: StrategicAnalysis['recommendation'];

  if (winProbability === 'high' && oppAnalysis.davidSentiment !== 'skeptical') {
    recommendation = 'go';
  } else if (winProbability === 'low' && strategicValue !== 'high') {
    recommendation = 'no_go';
  } else if (strategicValue === 'high' && winProbability === 'low') {
    // Strategic override
    recommendation = 'lean_go';
    override = true;
    keyFactors.push('Strategic value overrides low pwin');
  } else if (pwinScore >= 50) {
    recommendation = 'lean_go';
  } else {
    recommendation = 'lean_no';
  }

  return {
    winProbability,
    strategicValue,
    recommendation,
    keyFactors,
    override,
  };
}

// Determine conversation dynamic based on actual analysis
export function determineConversationDynamic(
  oppAnalysis: OpportunityAnalysis,
  partnerAnalysis: PartnerAnalysis,
  strategyAnalysis: StrategicAnalysis
): ConversationDynamic {
  const disagreements: ConversationDynamic['disagreements'] = [];

  // Check for David vs Maya disagreement
  // Maya excited (high fit score) but David skeptical
  if (oppAnalysis.fitScore >= 70 && oppAnalysis.davidSentiment === 'skeptical') {
    disagreements.push({
      between: ['David', 'Maya'],
      topic: oppAnalysis.davidConcerns[0] || 'concerns about the opportunity',
      resolution: 'David notes concerns but acknowledges the fit',
    });
  }

  // Check for David vs Rosa disagreement
  // David skeptical but Rosa has good connections
  if (oppAnalysis.davidSentiment === 'skeptical' && partnerAnalysis.partnerConfidence === 'high') {
    disagreements.push({
      between: ['David', 'Rosa'],
      topic: 'Whether partner relationships can offset risks',
      resolution: 'Rosa provides intel that addresses some concerns',
    });
  }

  // Check for James override situation
  if (strategyAnalysis.override) {
    disagreements.push({
      between: ['James', 'David'],
      topic: 'Strategic value vs risk assessment',
      resolution: 'James overrides with strategic justification',
    });
  }

  // Determine overall type
  let type: ConversationDynamic['type'] = 'smooth';
  if (disagreements.length >= 2 || strategyAnalysis.override) {
    type = 'tension';
  } else if (disagreements.length === 1) {
    type = 'debate';
  }

  // Determine mood
  let overallMood: ConversationDynamic['overallMood'] = 'cautious';
  if (strategyAnalysis.recommendation === 'go') {
    overallMood = 'optimistic';
  } else if (strategyAnalysis.recommendation === 'no_go') {
    overallMood = 'concerned';
  }

  return {
    type,
    disagreements,
    overallMood,
  };
}
