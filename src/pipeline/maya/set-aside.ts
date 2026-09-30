/**
 * Set-Aside Normalization
 *
 * Canonical mapping of SAM.gov typeOfSetAside codes to normalized types
 * with deterministic FFTC eligibility resolution.
 */

export interface NormalizedSetAside {
  rawCode: string | null;
  rawLabel: string | null;
  normalizedType: SetAsideType;
  fftcEligible: boolean;
  evidenceSource: 'sam_gov';
}

export type SetAsideType =
  | 'UNRESTRICTED'
  | 'SBA_SMALL_BUSINESS'
  | 'SBA_8A'
  | 'SDVOSB'
  | 'WOSB'
  | 'EDWOSB'
  | 'HUBZONE'
  | 'VOSB'
  | 'PARTIAL_SMALL_BUSINESS'
  | 'UNKNOWN';

/**
 * SAM.gov typeOfSetAside code → normalized type.
 * Source: SAM.gov API documentation and observed values.
 */
const SAM_CODE_MAP: Record<string, SetAsideType> = {
  // Unrestricted / no set-aside
  NONE: 'UNRESTRICTED',

  // Small business total set-aside
  SBA: 'SBA_SMALL_BUSINESS',
  SBP: 'PARTIAL_SMALL_BUSINESS',

  // 8(a) program
  '8A': 'SBA_8A',
  '8AN': 'SBA_8A', // 8(a) with Native American participation
  '8AE': 'SBA_8A', // 8(a) sole source

  // Service-Disabled Veteran-Owned
  SDVOSB: 'SDVOSB',
  SDVOSBS: 'SDVOSB', // SDVOSB sole source
  SDVOSBC: 'SDVOSB', // SDVOSB competitive

  // Women-Owned
  WOSB: 'WOSB',
  WOSBSS: 'WOSB', // WOSB sole source
  EDWOSB: 'EDWOSB',
  EDWOSBSS: 'EDWOSB', // EDWOSB sole source

  // HUBZone
  HZC: 'HUBZONE',
  HZS: 'HUBZONE', // HUBZone sole source

  // Veteran-Owned (non-service-disabled)
  VSA: 'VOSB',
  VSS: 'VOSB',
};

/**
 * Human-readable labels for normalized set-aside types.
 */
export const SET_ASIDE_LABELS: Record<SetAsideType, string> = {
  UNRESTRICTED: 'Unrestricted (Full & Open Competition)',
  SBA_SMALL_BUSINESS: 'Small Business Set-Aside (Total)',
  SBA_8A: 'SBA 8(a) Business Development Program',
  SDVOSB: 'Service-Disabled Veteran-Owned Small Business',
  WOSB: 'Women-Owned Small Business',
  EDWOSB: 'Economically Disadvantaged Women-Owned Small Business',
  HUBZONE: 'HUBZone Small Business',
  VOSB: 'Veteran-Owned Small Business',
  PARTIAL_SMALL_BUSINESS: 'Partial Small Business Set-Aside',
  UNKNOWN: 'Unknown Set-Aside Type',
};

/**
 * Determine FFTC eligibility for a normalized set-aside type.
 * Uses company certifications from the profile.
 */
export function determineFftcEligibility(
  normalizedType: SetAsideType,
  companyCertifications: string[],
  companySetAsides: string[]
): boolean {
  const certs = companyCertifications.map((c) => c.toLowerCase());
  const setAsides = companySetAsides.map((s) => s.toLowerCase());

  switch (normalizedType) {
    case 'UNRESTRICTED':
      return true; // Anyone can compete

    case 'SBA_SMALL_BUSINESS':
    case 'PARTIAL_SMALL_BUSINESS':
      return true; // FFTC is a small business

    case 'SBA_8A':
      return certs.some((c) => c.includes('8(a)')) || setAsides.includes('8(a)');

    case 'SDVOSB':
      return (
        certs.some((c) => c.includes('sdvosb') || c.includes('service-disabled')) ||
        setAsides.includes('sdvosb')
      );

    case 'WOSB':
    case 'EDWOSB':
      return (
        certs.some((c) => c.includes('wosb') || c.includes('women-owned')) ||
        setAsides.includes('wosb')
      );

    case 'HUBZONE':
      return certs.some((c) => c.includes('hubzone')) || setAsides.includes('hubzone');

    case 'VOSB':
      return (
        certs.some(
          (c) => c.includes('veteran-owned') || c.includes('sdvosb') || c.includes('vosb')
        ) ||
        setAsides.includes('vosb') ||
        setAsides.includes('sdvosb')
      );

    case 'UNKNOWN':
      return false; // Cannot determine eligibility
  }
}

/**
 * Normalize a SAM.gov set-aside code and description into a structured representation.
 */
export function normalizeSetAside(
  rawCode: string | null,
  rawLabel: string | null,
  companyCertifications: string[],
  companySetAsides: string[]
): NormalizedSetAside {
  const code = rawCode?.trim().toUpperCase() || null;
  const normalizedType = code ? SAM_CODE_MAP[code] || 'UNKNOWN' : 'UNRESTRICTED';
  const fftcEligible = determineFftcEligibility(
    normalizedType,
    companyCertifications,
    companySetAsides
  );

  return {
    rawCode: rawCode || null,
    rawLabel: rawLabel || null,
    normalizedType,
    fftcEligible,
    evidenceSource: 'sam_gov',
  };
}

/**
 * Format set-aside information for Maya's prompt context.
 * Provides normalized fact rather than raw ambiguous values.
 */
export function formatSetAsideForPrompt(setAside: NormalizedSetAside): string {
  const label = SET_ASIDE_LABELS[setAside.normalizedType];
  const eligibility = setAside.fftcEligible ? 'FFTC ELIGIBLE' : 'FFTC NOT ELIGIBLE';
  return `${label} [${eligibility}]`;
}
