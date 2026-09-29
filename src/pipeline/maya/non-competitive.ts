/**
 * Non-Competitive / Sole-Source Classification
 *
 * FFTC holds 8(a), SDVOSB, WOSB — certain sole-source signals are
 * strategically valuable, not automatic exclusions.
 *
 * Decision matrix:
 *   Intended for FFTC → STRATEGIC_REVIEW
 *   8(a) sole-source possibility → STRATEGIC_OVERRIDE
 *   Directed to another identified company → PASS (normally)
 *   Unknown source, non-competitive → classify by strategic relevance
 */

import type { NormalizedOpportunity } from './types.js';
import type { CompanyProfileData } from './company-repository.js';

// ============================================================
// Non-Competitive Signal Detection
// ============================================================

const NON_COMPETITIVE_KEYWORDS = [
  'sole source',
  'sole-source',
  'j&a',
  'justification and approval',
  'justification & approval',
  'limited sources',
  'brand name only',
  'only one responsible source',
  'one responsible source',
  'directed award',
];

const EIGHT_A_SOLE_SOURCE_SIGNALS = [
  '8(a) sole source',
  '8(a) sole-source',
  '8a sole source',
  '8a sole-source',
  'sole source 8(a)',
  'sole-source 8(a)',
  'competitive 8(a)',
];

export type NonCompetitiveClassification =
  | 'COMPETITIVE' // Not a non-competitive notice
  | 'EIGHT_A_SOLE_SOURCE' // 8(a) sole-source — strategic override
  | 'DIRECTED_TO_FFTC' // Evidence suggests FFTC is intended source
  | 'DIRECTED_TO_OTHER' // Another company identified as intended source
  | 'NON_COMPETITIVE_UNKNOWN'; // Non-competitive but intended source unclear

export interface NonCompetitiveResult {
  classification: NonCompetitiveClassification;
  isNonCompetitive: boolean;
  intendedSource: string | null;
  evidence: string[];
  strategicRelevance: boolean;
}

/**
 * Classify non-competitive/sole-source opportunity.
 * Uses structured company profile for FFTC identity matching.
 */
export function classifyNonCompetitive(
  opp: NormalizedOpportunity,
  companyProfile: CompanyProfileData
): NonCompetitiveResult {
  const text = `${opp.title} ${opp.description || ''} ${opp.synopsis || ''}`.toLowerCase();
  const setAside = (opp.setAside || opp.setAsideDescription || '').toLowerCase();

  // 1. Check if this is a non-competitive notice at all
  const hasNonCompetitiveSignal = NON_COMPETITIVE_KEYWORDS.some((kw) => text.includes(kw));
  if (!hasNonCompetitiveSignal) {
    return {
      classification: 'COMPETITIVE',
      isNonCompetitive: false,
      intendedSource: null,
      evidence: [],
      strategicRelevance: false,
    };
  }

  const evidence: string[] = [];

  // 2. Check for 8(a) sole-source — strategically valuable for FFTC
  const has8aSoleSource =
    EIGHT_A_SOLE_SOURCE_SIGNALS.some((s) => text.includes(s)) ||
    (setAside.includes('8(a)') && text.includes('sole source'));

  if (has8aSoleSource) {
    const fftcHas8a = companyProfile.certifications.some((c) => c.toLowerCase().includes('8(a)'));

    if (fftcHas8a) {
      evidence.push('8(a) sole-source signal detected');
      evidence.push('FFTC holds 8(a) certification');

      // Check if FFTC is mentioned as intended source
      const fftcMentioned = isFftcMentioned(text, companyProfile);
      if (fftcMentioned) {
        evidence.push('FFTC identified as intended source');
        return {
          classification: 'DIRECTED_TO_FFTC',
          isNonCompetitive: true,
          intendedSource: companyProfile.companyName,
          evidence,
          strategicRelevance: true,
        };
      }

      return {
        classification: 'EIGHT_A_SOLE_SOURCE',
        isNonCompetitive: true,
        intendedSource: null,
        evidence,
        strategicRelevance: true,
      };
    }
  }

  // 3. Check if FFTC is mentioned as intended source (non-8(a) context)
  if (isFftcMentioned(text, companyProfile)) {
    evidence.push('FFTC identified as intended source in sole-source notice');
    return {
      classification: 'DIRECTED_TO_FFTC',
      isNonCompetitive: true,
      intendedSource: companyProfile.companyName,
      evidence,
      strategicRelevance: true,
    };
  }

  // 4. Check if ANOTHER company is identified as intended source
  const otherSource = extractIntendedSource(text, companyProfile);
  if (otherSource) {
    evidence.push(`Directed to: ${otherSource}`);
    return {
      classification: 'DIRECTED_TO_OTHER',
      isNonCompetitive: true,
      intendedSource: otherSource,
      evidence,
      strategicRelevance: false,
    };
  }

  // 5. Non-competitive with unknown intended source
  evidence.push('Non-competitive notice — intended source not identified');
  return {
    classification: 'NON_COMPETITIVE_UNKNOWN',
    isNonCompetitive: true,
    intendedSource: null,
    evidence,
    strategicRelevance: false, // Strategic relevance determined by score + overrides
  };
}

// ============================================================
// Helpers
// ============================================================

function isFftcMentioned(text: string, profile: CompanyProfileData): boolean {
  const identifiers = [profile.companyName.toLowerCase(), 'friends from the city', 'fftc'];
  if (profile.uei) identifiers.push(profile.uei.toLowerCase());
  if (profile.cageCode) identifiers.push(profile.cageCode.toLowerCase());

  return identifiers.some((id) => id && text.includes(id));
}

function extractIntendedSource(text: string, profile: CompanyProfileData): string | null {
  // Look for "award to <company>" or "sole source to <company>" patterns
  const patterns = [
    /(?:award(?:ed)?|sole[- ]?source(?:d)?|directed)\s+to\s+([A-Z][A-Za-z\s&,.'()-]+?)(?:\.|,|\s+for|\s+under|\s+to\s+provide)/i,
    /intended\s+(?:source|awardee|vendor|contractor)\s*(?:is|:)\s*([A-Z][A-Za-z\s&,.'()-]+?)(?:\.|,|\s+for)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Capitalize extracted name (text was lowercased for matching)
      const extracted = match[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
      if (!isFftcMentioned(extracted.toLowerCase(), profile)) {
        return extracted;
      }
    }
  }

  return null;
}
