/**
 * Evidence Sufficiency Model + Metadata Pre-Screen
 *
 * Policy B: Evidence-seeking pre-screen.
 * Evidence sufficiency uses substantive-scope indicators, not just character count.
 *
 * Capability evidence states:
 *   MATCH — substantive scope text present AND capability keywords found
 *   NO_MATCH — substantive scope text present AND no keywords (conclusive negative)
 *   INSUFFICIENT_EVIDENCE — text is boilerplate/short/administrative, cannot judge
 *   EVIDENCE_UNAVAILABLE — attachment retrieval failed
 */

import type { NormalizedOpportunity } from './types.js';
import { CAPABILITY_POSITIVE_KEYWORDS } from './company-profile.js';
import type { PastPerformanceRecord } from './company-repository.js';
import { agenciesMatch } from './company-profile.js';

// ============================================================
// Evidence Sufficiency Assessment
// ============================================================

export interface EvidenceSufficiency {
  sufficientForCapabilityScoring: boolean;
  scopeTextCharacters: number;
  hasDetailedScope: boolean;
  hasSubstantiveScope: boolean;
  hasAttachmentReferences: boolean;
  missingEvidence: string[];
  capabilityResult: 'MATCH' | 'NO_MATCH' | 'INSUFFICIENT_EVIDENCE';
}

/** Indicators that text contains substantive scope/requirements content */
const SUBSTANTIVE_SCOPE_INDICATORS = [
  'scope',
  'objective',
  'requirement',
  'task order',
  'tasks',
  'deliverable',
  'performance requirement',
  'technical requirement',
  'statement of work',
  'performance work statement',
  'statement of objectives',
  'required services',
  'contractor shall',
  'contractor will',
  'functional requirement',
  'the government requires',
  'work statement',
  'period of performance',
  'labor category',
  'sow',
  'pws',
  'soo',
  'purpose of this',
  'background',
  'the purpose',
];

/** Indicators that text is primarily boilerplate/administrative */
const BOILERPLATE_INDICATORS = [
  'far clause',
  '52.2',
  'representations and certifications',
  'submission instructions',
  'proposal submission',
  'how to respond',
  'this announcement is not a request for proposal',
  'this notice does not constitute a solicitation',
  'sf-',
  'sf 1449',
  'sf 33',
  'wage determination',
  'equal opportunity',
  'provisions and clauses',
];

const MIN_SCOPE_CHARS = 200;

/**
 * Determine if text contains substantive scope description,
 * not just administrative boilerplate.
 */
function hasSubstantiveScopeContent(text: string): boolean {
  const lower = text.toLowerCase();
  const substantiveHits = SUBSTANTIVE_SCOPE_INDICATORS.filter((s) => lower.includes(s)).length;
  const boilerplateHits = BOILERPLATE_INDICATORS.filter((s) => lower.includes(s)).length;

  // Substantive if scope indicators outnumber boilerplate, or strong scope present
  if (substantiveHits >= 3) return true;
  if (substantiveHits >= 1 && boilerplateHits === 0) return true;
  if (text.length >= 500 && substantiveHits >= 1) return true;

  return false;
}

export function assessEvidenceSufficiency(opp: NormalizedOpportunity): EvidenceSufficiency {
  const scopeText = `${opp.title} ${opp.description || ''} ${opp.synopsis || ''}`;
  const scopeChars = scopeText.trim().length;
  const hasDetailedScope = scopeChars >= MIN_SCOPE_CHARS;
  const hasSubstantive = hasSubstantiveScopeContent(scopeText);
  const hasAttachments = opp.attachments.length > 0;

  const missing: string[] = [];
  if (!hasDetailedScope) missing.push('detailed scope/description');
  if (!hasSubstantive) missing.push('substantive scope indicators');
  if (!hasAttachments) missing.push('solicitation attachments');

  // Count capability keyword matches
  const textLower = scopeText.toLowerCase();
  let keywordHits = 0;
  for (const kw of CAPABILITY_POSITIVE_KEYWORDS) {
    if (kw.length <= 3 ? new RegExp(`\\b${kw}\\b`, 'i').test(textLower) : textLower.includes(kw)) {
      keywordHits++;
    }
  }

  let capabilityResult: EvidenceSufficiency['capabilityResult'];

  if (keywordHits >= 1) {
    capabilityResult = 'MATCH';
  } else if (hasDetailedScope && hasSubstantive) {
    // Text is both long enough AND contains substantive scope indicators
    // Absence of capability keywords is a meaningful negative signal
    capabilityResult = 'NO_MATCH';
  } else {
    // Text is too short, or is primarily boilerplate/administrative
    // Cannot conclude no match — need better evidence
    capabilityResult = 'INSUFFICIENT_EVIDENCE';
  }

  return {
    sufficientForCapabilityScoring: capabilityResult !== 'INSUFFICIENT_EVIDENCE',
    scopeTextCharacters: scopeChars,
    hasDetailedScope,
    hasSubstantiveScope: hasSubstantive,
    hasAttachmentReferences: hasAttachments,
    missingEvidence: missing,
    capabilityResult,
  };
}

// ============================================================
// Policy B Metadata Pre-Screen (Evidence-Seeking)
// ============================================================

export type PreScreenDecision = 'PASS' | 'WATCH' | 'NEEDS_EVIDENCE';

export interface PreScreenResult {
  decision: PreScreenDecision;
  reasons: string[];
  evidence: EvidenceSufficiency;
}

/**
 * Policy B: Evidence-seeking metadata pre-screen.
 *
 * NEEDS_EVIDENCE when: has attachments + (relevant NAICS OR relevant PSC)
 *   + at least one of: strategic agency, cert advantage, title signal, PP agency.
 *
 * Also NEEDS_EVIDENCE when: capability keyword already matches (proceed to scoring).
 *
 * WATCH when: some positive signals but doesn't qualify for evidence retrieval.
 *
 * PASS when: no compelling signals OR conclusive NO_MATCH with substantive scope.
 */
export function metadataPreScreen(
  opp: NormalizedOpportunity,
  strategicAgencies: string[],
  companyNaics: string[],
  _companyCerts?: string[],
  pastPerformance?: PastPerformanceRecord[]
): PreScreenResult {
  const evidence = assessEvidenceSufficiency(opp);
  const reasons: string[] = [];

  // Already have enough evidence for a keyword match — proceed to scoring
  if (evidence.capabilityResult === 'MATCH') {
    return {
      decision: 'NEEDS_EVIDENCE',
      reasons: ['Capability keyword match — proceed to full scoring'],
      evidence,
    };
  }

  // Conclusive NO_MATCH: substantive scope text present, no keywords
  if (evidence.capabilityResult === 'NO_MATCH') {
    return {
      decision: 'PASS',
      reasons: ['Substantive scope text present, no capability match'],
      evidence,
    };
  }

  // INSUFFICIENT_EVIDENCE: use metadata signals to decide if enrichment is worthwhile

  const hasAttachments = evidence.hasAttachmentReferences;

  // Base qualifiers
  const hasRelevantNaics = opp.naics ? companyNaics.includes(opp.naics) : false;
  const hasRelevantPsc = opp.psc ? ['DA01', 'DG01', 'DA10'].includes(opp.psc) : false;
  const hasBaseQualifier = hasRelevantNaics || hasRelevantPsc;

  if (hasRelevantNaics) reasons.push(`NAICS: ${opp.naics}`);
  if (hasRelevantPsc) reasons.push(`PSC: ${opp.psc}`);

  // Secondary signals
  const agencyText = opp.agency || '';
  const isStrategicAgency = strategicAgencies.some(
    (a) => agenciesMatch(agencyText, a) || agencyText.toUpperCase().includes(a.toUpperCase())
  );
  if (isStrategicAgency) reasons.push('Strategic agency');

  const setAside = (opp.setAside || opp.setAsideDescription || '').toLowerCase();
  const hasCertAdvantage = ['8(a)', 'sdvosb', 'wosb', 'service-disabled', 'women-owned'].some((c) =>
    setAside.includes(c)
  );
  if (hasCertAdvantage) reasons.push('Certification advantage');

  const titleLower = opp.title.toLowerCase();
  const titleSignals = [
    'digital',
    'modernization',
    'software',
    'development',
    'design',
    'ux',
    'user experience',
    'web',
    'application',
    'product',
    'agile',
  ];
  const titleMatches = titleSignals.filter((s) => titleLower.includes(s));
  if (titleMatches.length > 0) reasons.push(`Title: ${titleMatches.slice(0, 3).join(', ')}`);

  const hasPPAgency = pastPerformance?.some((pp) => agenciesMatch(agencyText, pp.agency)) || false;
  if (hasPPAgency) reasons.push('Past performance at this agency');

  const hasSecondarySignal =
    isStrategicAgency || hasCertAdvantage || titleMatches.length > 0 || hasPPAgency;

  // Policy B decision
  if (hasAttachments && hasBaseQualifier && hasSecondarySignal) {
    return { decision: 'NEEDS_EVIDENCE', reasons, evidence };
  }

  if (hasBaseQualifier || hasSecondarySignal) {
    return {
      decision: 'WATCH',
      reasons: reasons.length > 0 ? reasons : ['Some positive signals'],
      evidence,
    };
  }

  return { decision: 'PASS', reasons: ['No compelling metadata signals'], evidence };
}
