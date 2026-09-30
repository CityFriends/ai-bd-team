/**
 * FFTC Company Profile — Typed Schema, Seed Data, and Test Fixtures
 *
 * This module provides:
 *   - Type-safe constants for test fixtures and seed data
 *   - Keyword lists for deterministic scoring
 *   - Agency alias mapping
 *   - Past performance matching logic that works with repository data
 *
 * IMPORTANT: This is NOT the production source of truth for company data.
 * Production reads from Supabase through CompanyProfileRepository.
 * This module provides scoring logic, keyword taxonomies, and test fixtures.
 */

import type { PastPerformanceMatch } from './types.js';
import type { PastPerformanceRecord, CompanyProfileData } from './company-repository.js';

// ============================================================
// NAICS / PSC (reference constants — production uses DB)
// ============================================================

export const PRIMARY_NAICS = ['541512'];
export const SECONDARY_NAICS = ['541511', '541519', '541611'];
export const ALL_NAICS = [...PRIMARY_NAICS, ...SECONDARY_NAICS];
export const PRIMARY_PSC = ['DA01'];

// ============================================================
// Certification identifiers (for scoring logic)
// ============================================================

export const FEDERAL_CERTIFICATIONS = ['SDVOSB', 'WOSB', '8(a)'] as const;
export const EXCLUDED_CLEARANCE = ['facility clearance', 'Secret', 'Top Secret', 'TS/SCI'] as const;

// ============================================================
// Capability Keywords — for deterministic scoring
// ============================================================

/**
 * Core capability keywords — always count as capability evidence.
 * These represent actual deliverable work, not compliance checkboxes.
 */
export const CAPABILITY_POSITIVE_KEYWORDS = [
  // HCD / UX (core deliverables)
  'human-centered design',
  'hcd',
  'user experience',
  'ux',
  'user research',
  'usability',
  'usability testing',
  'service design',
  'customer experience',
  'cx',
  'design thinking',
  'journey mapping',
  'design system',
  // Product
  'product management',
  'product design',
  'product strategy',
  'product owner',
  // Content
  'content strategy',
  'content design',
  'plain language',
  'information architecture',
  // Engineering (custom development)
  'software development',
  'application development',
  'web development',
  'front-end',
  'frontend',
  'back-end',
  'backend',
  'full-stack',
  'full stack',
  'agile development',
  'react',
  'node.js',
  'typescript',
  'python',
  'prototype',
  'prototyping',
  'mvp',
  // Digital modernization
  'digital services',
  'digital transformation',
  'digital modernization',
  'it modernization',
  'legacy modernization',
  // DevOps / Cloud
  'cloud native',
  'devops',
  'ci/cd',
  'api development',
  'microservices',
  // AI (when FFTC is building AI, not buying AI products)
  'artificial intelligence',
  'machine learning',
  'ai/ml',
  'generative ai',
];

/**
 * Compliance-context keywords — only count as capability evidence when
 * accompanied by contextual indicators that accessibility/compliance work
 * is itself a meaningful DELIVERABLE, not just a compliance checkbox.
 *
 * "Solution must be WCAG compliant" → NOT capability evidence
 * "Accessibility remediation of the application" → IS capability evidence
 */
export const COMPLIANCE_CONTEXT_KEYWORDS = [
  'accessibility',
  '508 compliance',
  'wcag',
  'section 508',
];

/** Contextual indicators that compliance work is a deliverable */
export const COMPLIANCE_AS_DELIVERABLE_INDICATORS = [
  'accessibility remediation',
  'accessibility testing',
  'accessibility audit',
  'accessibility engineering',
  'accessible interface',
  'accessible design',
  'accessibility research',
  'accessibility assessment',
  'accessibility implementation',
  'remediate',
  'vpat',
  'voluntary product accessibility',
  'make accessible',
  'ensure accessibility',
];

/** Contextual indicators that compliance is just a checkbox requirement */
export const COMPLIANCE_AS_CHECKBOX_INDICATORS = [
  'shall comply with',
  'must comply with',
  'must meet',
  'in accordance with section 508',
  'conformance',
  'compliance with section 508',
  'wcag compliant',
  '508 compliant',
  'accessibility requirements',
  'adhere to',
  'conform to',
];

export const CAPABILITY_NEGATIVE_KEYWORDS = [
  'data engineering',
  'data warehouse',
  'data lake',
  'etl',
  'bi platform',
  'analytics platform',
  'business intelligence',
  'data pipeline',
  'data integration',
];

// ============================================================
// Agency Canonical Identifiers
// ============================================================

/**
 * Maps known agency name variations to canonical identifiers.
 * Covers: DB past-performance names, SAM.gov API names, common abbreviations.
 */
export const AGENCY_ALIASES: Record<string, string> = {
  // VA
  'department of veterans affairs': 'VA',
  'veterans affairs': 'VA',
  'veterans affairs, department of': 'VA',
  va: 'VA',
  // CMS
  'centers for medicare & medicaid services': 'CMS',
  'centers for medicare and medicaid services': 'CMS',
  'centers for medicare & medicaid': 'CMS',
  cms: 'CMS',
  // HHS
  'department of health and human services': 'HHS',
  'health and human services': 'HHS',
  'health and human services, department of': 'HHS',
  hhs: 'HHS',
  // IRS
  'internal revenue service': 'IRS',
  irs: 'IRS',
  // Treasury
  'department of the treasury': 'Treasury',
  'treasury, department of the': 'Treasury',
  treasury: 'Treasury',
  // FEMA
  'federal emergency management agency': 'FEMA',
  fema: 'FEMA',
  // DHS
  'department of homeland security': 'DHS',
  'homeland security, department of': 'DHS',
  dhs: 'DHS',
  // State
  'department of state': 'State',
  'state, department of': 'State',
  // Smithsonian
  'smithsonian institution': 'Smithsonian',
  smithsonian: 'Smithsonian',
  // GSA
  'general services administration': 'GSA',
  gsa: 'GSA',
  // SBA
  'small business administration': 'SBA',
  sba: 'SBA',
  // DoD
  'dept of defense': 'DOD',
  'department of defense': 'DOD',
  'defense, department of': 'DOD',
  dod: 'DOD',
  // Education
  'department of education': 'ED',
  'education, department of': 'ED',
  // Labor
  'department of labor': 'DOL',
  'labor, department of': 'DOL',
  // DOT
  'department of transportation': 'DOT',
  'transportation, department of': 'DOT',
  // Justice
  'department of justice': 'DOJ',
  'justice, department of': 'DOJ',
  // USDA
  'department of agriculture': 'USDA',
  'agriculture, department of': 'USDA',
  // Commerce
  'department of commerce': 'DOC',
  'commerce, department of': 'DOC',
};

/**
 * Parent-department relationships.
 * CMS is under HHS, IRS is under Treasury, etc.
 * These represent department adjacency — NOT exact agency equality.
 */
export const AGENCY_PARENT: Record<string, string> = {
  CMS: 'HHS',
  IRS: 'Treasury',
  FEMA: 'DHS',
};

/**
 * Normalize agency name to canonical identifier.
 * Returns the canonical code if known, otherwise the original string.
 */
export function normalizeAgency(agency: string): string {
  if (!agency) return '';
  const lower = agency.toLowerCase().trim();
  // Direct lookup
  const direct = AGENCY_ALIASES[lower];
  if (direct) return direct;
  // Try removing trailing commas/periods
  const cleaned = lower.replace(/[,.]$/, '').trim();
  const cleanedMatch = AGENCY_ALIASES[cleaned];
  if (cleanedMatch) return cleanedMatch;
  // Return original if no match
  return agency;
}

/**
 * Check if two agencies are the same (exact canonical match).
 * Does NOT treat parent-department adjacency as equality.
 * Unknown agency does NOT equal another unknown agency.
 */
export function agenciesMatch(a: string, b: string): boolean {
  const canonA = normalizeAgency(a);
  const canonB = normalizeAgency(b);
  if (!canonA || !canonB) return false;
  // Both must resolve to known canonical IDs to match
  const aIsKnown = Object.values(AGENCY_ALIASES).includes(canonA);
  const bIsKnown = Object.values(AGENCY_ALIASES).includes(canonB);
  if (!aIsKnown || !bIsKnown) return false;
  return canonA === canonB;
}

/**
 * Check if two agencies are in the same department family.
 * Weaker than exact match — for adjacency scoring only.
 */
export function agenciesRelated(a: string, b: string): boolean {
  if (agenciesMatch(a, b)) return true;
  const canonA = normalizeAgency(a);
  const canonB = normalizeAgency(b);
  // Check parent relationships
  const parentA = AGENCY_PARENT[canonA] || canonA;
  const parentB = AGENCY_PARENT[canonB] || canonB;
  return parentA === parentB || parentA === canonB || canonA === parentB;
}

// ============================================================
// Agency Experience (reference — production reads from DB)
// FFTC is open to ALL federal agencies. These are experience signals, not discovery filters.
// ============================================================

export const AGENCY_EXPERIENCE = [
  'VA',
  'CMS',
  'HHS',
  'IRS',
  'Treasury',
  'FEMA',
  'DHS',
  'Smithsonian',
  'Department of State',
] as const;

// ============================================================
// Past Performance Matching — works with repository data
// ============================================================

/**
 * Terms too generic to independently create strong PP match.
 * These contribute small evidence but must not dominate scoring alone.
 */
const GENERIC_TERMS = new Set([
  'development',
  'design',
  'software',
  'support',
  'engineering',
  'modernization',
  'services',
  'management',
  'system',
  'systems',
  'technical',
  'solution',
  'platform',
  'application',
  'technology',
  'implementation',
  'integration',
  'program',
  'project',
]);

/**
 * Specific capability terms that provide strong match evidence.
 */
const SPECIFIC_TERMS = new Set([
  'ux research',
  'user research',
  'usability',
  'service design',
  'human-centered design',
  'hcd',
  'content strategy',
  'content design',
  'product management',
  'product design',
  'product owner',
  'front-end engineering',
  'front-end',
  'frontend',
  'back-end engineering',
  'back-end',
  'backend',
  'agile development',
  'digital modernization',
  'digital services',
  'accessibility',
  '508 compliance',
  'wcag',
  'design system',
  'react',
  'node.js',
  'typescript',
  'drupal',
  'devops',
  'ci/cd',
  'api development',
  'microservices',
  'prototype',
  'mvp',
  'journey mapping',
  'plain language',
  'information architecture',
  'cloud native',
  'artificial intelligence',
  'machine learning',
]);

/**
 * Match an opportunity against structured past performance records.
 *
 * Prevents generic false positives: terms like "development" alone
 * contribute only small evidence. Strong matches require specific
 * capability overlap AND/OR agency match.
 */
export function matchPastPerformance(
  opportunity: {
    agency: string | null;
    title: string;
    description: string | null;
    naics: string | null;
  },
  pastPerformance: PastPerformanceRecord[]
): PastPerformanceMatch[] {
  const matches: PastPerformanceMatch[] = [];
  const oppText = `${opportunity.title} ${opportunity.description || ''}`.toLowerCase();
  const oppAgency = normalizeAgency(opportunity.agency || '');

  for (const pp of pastPerformance) {
    const evidence: string[] = [];
    let agencyMatch = false;
    let specificMatchCount = 0;
    let genericMatchCount = 0;

    // Agency match — exact canonical equality only
    // VA ≠ IRS, CMS ≠ HHS (parent-dept adjacency is separate)
    if (oppAgency && agenciesMatch(opportunity.agency || '', pp.agency)) {
      agencyMatch = true;
      evidence.push(`same agency: ${normalizeAgency(pp.agency)}`);
    }

    // Capability matching with generic/specific distinction
    const ppCapabilities = [...new Set([...pp.tags, ...pp.keyAccomplishments])].map((s) =>
      s.toLowerCase()
    );

    for (const cap of ppCapabilities) {
      const capNormalized = cap.replace(/-/g, ' ').trim();
      if (!capNormalized) continue;

      // Check if this capability appears in the opportunity
      const found = oppText.includes(capNormalized) || oppText.includes(cap);
      if (!found) continue;

      // Classify as specific or generic
      if (SPECIFIC_TERMS.has(capNormalized) || SPECIFIC_TERMS.has(cap)) {
        specificMatchCount++;
        evidence.push(capNormalized);
      } else if (GENERIC_TERMS.has(capNormalized)) {
        genericMatchCount++;
        // Generic terms listed as evidence only if alongside specific or agency
      } else if (capNormalized.length > 5) {
        // Multi-word or longer terms that aren't in either list — treat as moderate
        specificMatchCount += 0.5;
        evidence.push(capNormalized);
      }
    }

    // Calculate similarity — agency BOOSTS an existing match, cannot create one alone
    let workSimilarity = 0;

    // Specific capability matches are primary evidence of work similarity
    if (specificMatchCount >= 3) workSimilarity = 0.6;
    else if (specificMatchCount >= 2) workSimilarity = 0.4;
    else if (specificMatchCount >= 1) workSimilarity = 0.2;

    // Generic matches contribute only small supplementary evidence
    if (genericMatchCount > 0 && specificMatchCount > 0) {
      workSimilarity += Math.min(genericMatchCount * 0.05, 0.1);
    }
    // Generic alone: near-zero (prevents false matches)
    else if (genericMatchCount > 0 && specificMatchCount === 0) {
      workSimilarity = Math.min(genericMatchCount * 0.02, 0.05);
    }

    // Agency BOOSTS an existing meaningful match, but cannot manufacture one
    let similarity = workSimilarity;
    if (agencyMatch && workSimilarity >= 0.15) {
      // Strong boost when work is also relevant
      similarity = Math.min(workSimilarity + 0.3, 1.0);
    } else if (agencyMatch && workSimilarity > 0) {
      // Moderate boost for weak work match + same agency
      similarity = Math.min(workSimilarity + 0.15, 0.5);
    } else if (agencyMatch) {
      // Agency alone: capped at low similarity
      similarity = 0.1;
    }

    // Only include if work-level similarity exists OR strong agency-specific relevance
    if (similarity >= 0.1 && (workSimilarity > 0 || agencyMatch)) {
      // Add generic terms to evidence if they're supplementary
      if (genericMatchCount > 0 && evidence.length > 0) {
        evidence.push(`+${genericMatchCount} general term(s)`);
      }

      matches.push({
        project: pp.contractName,
        agency: pp.agency,
        matchedCapabilities: evidence,
        agencyMatch,
        similarityScore: Math.round(Math.min(similarity, 1.0) * 100) / 100,
      });
    }
  }

  return matches.sort((a, b) => b.similarityScore - a.similarityScore);
}

// ============================================================
// Test Fixture — for unit tests only, not production
// ============================================================

export const TEST_COMPANY_PROFILE: CompanyProfileData = {
  companyName: 'Friends From The City',
  capabilities: [
    'Human-centered design',
    'UX research',
    'Service design',
    'Product management',
    'Content strategy',
    'Front-end engineering',
    'Back-end engineering',
    'AI-assisted code development',
    'Digital modernization',
  ],
  differentiators: ['Veteran-owned', 'Design-led'],
  certifications: [
    'SBA 8(a) Business Development',
    'SBA Women-Owned Small Business (WOSB)',
    'Service-Disabled Veteran-Owned Small Business (SDVOSB)',
  ],
  setAsides: ['8(a)', 'WOSB', 'SDVOSB'],
  naicsCodes: ['541511', '541512', '541519'],
  contractVehicles: ['GSA MAS Schedule 47QTCA23D0076'],
  agencyExperience: ['VA', 'CMS', 'IRS', 'FEMA', 'Smithsonian', 'Department of State'],
  idealOpportunity: 'Digital modernization, HCD, UX research',
  noBidCriteria: ['Classified work', 'Staff augmentation'],
  teamSize: 25,
  location: 'Chicago, IL',
  cageCode: null,
  uei: null,
};

export const TEST_PAST_PERFORMANCE: PastPerformanceRecord[] = [
  {
    id: 'test-pp-1',
    contractName: 'VFS-CMS',
    agency: 'VA',
    subAgency: null,
    contractVehicle: null,
    ourRole: 'subcontractor',
    primeContractor: 'Agile Six',
    description: 'VA.gov CMS',
    keyAccomplishments: ['product management', 'ux research'],
    relevantNaics: ['541512'],
    tags: ['product management', 'ux research'],
    contractValue: null,
    popStart: null,
    popEnd: null,
  },
  {
    id: 'test-pp-2',
    contractName: 'SEAS-IT',
    agency: 'CMS',
    subAgency: 'HHS',
    contractVehicle: null,
    ourRole: 'subcontractor',
    primeContractor: null,
    description: 'CMS SEAS-IT',
    keyAccomplishments: ['ux research', 'service design', 'engineering'],
    relevantNaics: ['541512'],
    tags: ['ux research', 'service design', 'front-end engineering'],
    contractValue: null,
    popStart: null,
    popEnd: null,
  },
  {
    id: 'test-pp-3',
    contractName: 'Direct File',
    agency: 'IRS',
    subAgency: 'Treasury',
    contractVehicle: null,
    ourRole: 'subcontractor',
    primeContractor: null,
    description: 'IRS Direct File',
    keyAccomplishments: ['product design'],
    relevantNaics: ['541512'],
    tags: ['product design'],
    contractValue: null,
    popStart: null,
    popEnd: null,
  },
];
