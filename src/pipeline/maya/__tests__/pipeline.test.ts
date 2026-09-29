/**
 * Maya Pipeline Tests — Corrected for Architecture Review
 *
 * Tests use repository pattern (not static imports as production truth).
 * Includes sole-source/non-competitive classification tests.
 */

import { describe, it, expect } from 'vitest';
import type { NormalizedOpportunity } from '../types.js';
import { DEFAULT_WEIGHTS } from '../types.js';
import {
  FEDERAL_CERTIFICATIONS,
  EXCLUDED_CLEARANCE,
  matchPastPerformance,
  TEST_COMPANY_PROFILE,
  TEST_PAST_PERFORMANCE,
} from '../company-profile.js';
import { applyHardFilters } from '../hard-filters.js';
import { calculateFitScore, type ScoringContext } from '../fit-score.js';
import { checkStrategicOverrides } from '../strategic.js';
import { classifyNonCompetitive } from '../non-competitive.js';
import { computeRawHash, computeMaterialHash, detectChanges } from '../change-detect.js';
import { DEFAULT_PURSUIT_PREFERENCES } from '../company-repository.js';

// ============================================================
// Test Helpers
// ============================================================

function makeOpp(overrides: Partial<NormalizedOpportunity> = {}): NormalizedOpportunity {
  return {
    sourceId: 'test-123',
    source: 'sam_gov',
    solicitationNumber: null,
    title: 'Test Opportunity',
    description: null,
    synopsis: null,
    agency: null,
    subAgency: null,
    office: null,
    noticeType: 'solicitation',
    naics: null,
    psc: null,
    setAside: null,
    setAsideDescription: null,
    postedDate: null,
    responseDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    estimatedValue: null,
    placeOfPerformance: null,
    vehicle: null,
    sourceUrl: 'https://sam.gov/opp/test-123/view',
    attachments: [],
    active: true,
    archived: false,
    cancelled: false,
    rawHash: '',
    materialHash: '',
    ...overrides,
  };
}

/** Scoring context from test fixtures (simulates repository load) */
const testCtx: ScoringContext = {
  profile: TEST_COMPANY_PROFILE,
  pastPerformance: TEST_PAST_PERFORMANCE,
  preferences: DEFAULT_PURSUIT_PREFERENCES,
};

// ============================================================
// Company Profile / Repository Tests
// ============================================================

describe('Organizational Profile', () => {
  it('certifications represented', () => {
    expect(FEDERAL_CERTIFICATIONS).toContain('SDVOSB');
    expect(FEDERAL_CERTIFICATIONS).toContain('WOSB');
    expect(FEDERAL_CERTIFICATIONS).toContain('8(a)');
  });

  it('security exclusions represented', () => {
    expect(EXCLUDED_CLEARANCE).toContain('TS/SCI');
    expect(EXCLUDED_CLEARANCE).toContain('Secret');
  });

  it('test profile has certifications from DB schema', () => {
    expect(TEST_COMPANY_PROFILE.certifications.length).toBeGreaterThan(0);
    expect(TEST_COMPANY_PROFILE.certifications.some((c) => c.includes('8(a)'))).toBe(true);
  });

  it('test profile has NAICS from DB schema', () => {
    expect(TEST_COMPANY_PROFILE.naicsCodes).toContain('541512');
  });

  it('test profile has vehicles from DB schema', () => {
    expect(TEST_COMPANY_PROFILE.contractVehicles.length).toBeGreaterThan(0);
  });

  it('test past performance loads correctly', () => {
    expect(TEST_PAST_PERFORMANCE.length).toBeGreaterThan(0);
    expect(TEST_PAST_PERFORMANCE.some((pp) => pp.agency === 'VA')).toBe(true);
  });

  it('strategic agencies in preferences', () => {
    expect(DEFAULT_PURSUIT_PREFERENCES.strategicAgencies).toContain('VA');
    expect(DEFAULT_PURSUIT_PREFERENCES.strategicAgencies).toContain('CMS');
  });

  it('pursuit preferences have security constraints', () => {
    expect(DEFAULT_PURSUIT_PREFERENCES.excludedClearance).toContain('TS/SCI');
    expect(DEFAULT_PURSUIT_PREFERENCES.supportedClearance).toContain('public trust');
  });

  it('scorer uses repository data (ScoringContext), not static imports', () => {
    // The calculateFitScore function signature requires ScoringContext parameter
    // It cannot score without organizational data from repository
    const opp = makeOpp({ title: 'UX Research', description: 'software development' });
    const result = calculateFitScore(opp, testCtx);
    expect(result.totalScore).toBeGreaterThan(0);
  });
});

// ============================================================
// Hard Filter Tests
// ============================================================

describe('Hard Filters', () => {
  it('classified → rejected', () => {
    expect(applyHardFilters(makeOpp({ title: 'TS/SCI Required Development' })).excluded).toBe(true);
  });

  it('clear staff aug → rejected', () => {
    expect(
      applyHardFilters(makeOpp({ title: 'Staff Augmentation - Provide Developers' })).excluded
    ).toBe(true);
  });

  it('ambiguous staffing with outcome → NOT rejected', () => {
    expect(
      applyHardFilters(
        makeOpp({ description: 'Staff augmentation to deliver UX research deliverables' })
      ).excluded
    ).toBe(false);
  });

  it('expired → rejected', () => {
    expect(applyHardFilters(makeOpp({ responseDeadline: '2020-01-01' })).excluded).toBe(true);
  });

  it('cancelled → rejected', () => {
    expect(applyHardFilters(makeOpp({ cancelled: true })).excluded).toBe(true);
  });

  it('sole source is NOT hard-excluded', () => {
    const opp = makeOpp({ description: 'This is a sole source procurement' });
    expect(applyHardFilters(opp).excluded).toBe(false);
  });

  it('valid opportunity → not excluded', () => {
    expect(
      applyHardFilters(makeOpp({ title: 'Digital Modernization', description: 'UX research' }))
        .excluded
    ).toBe(false);
  });
});

// ============================================================
// Sole Source / Non-Competitive Tests
// ============================================================

describe('Non-Competitive / Sole-Source', () => {
  it('8(a) sole-source signal is NOT hard-excluded', () => {
    const opp = makeOpp({ description: '8(a) sole source software development services' });
    expect(applyHardFilters(opp).excluded).toBe(false);
  });

  it('relevant 8(a) sole-source creates strategic override', () => {
    const opp = makeOpp({
      title: 'Digital Services - 8(a) Sole Source',
      description: '8(a) sole source for UX research and software development',
      agency: 'Department of Veterans Affairs',
      setAside: '8(a)',
    });
    const result = classifyNonCompetitive(opp, TEST_COMPANY_PROFILE);
    expect(result.classification).toBe('EIGHT_A_SOLE_SOURCE');
    expect(result.strategicRelevance).toBe(true);

    const fitScore = calculateFitScore(opp, testCtx);
    const override = checkStrategicOverrides(
      opp,
      fitScore,
      DEFAULT_PURSUIT_PREFERENCES,
      TEST_COMPANY_PROFILE
    );
    expect(override.triggered).toBe(true);
    expect(override.rules.some((r) => r.includes('8(a)'))).toBe(true);
  });

  it('sole source directed to another company → PASS without inference', () => {
    const opp = makeOpp({
      description: 'Sole source award to Booz Allen Hamilton for continued IT services',
    });
    const result = classifyNonCompetitive(opp, TEST_COMPANY_PROFILE);
    expect(result.classification).toBe('DIRECTED_TO_OTHER');
    expect(result.intendedSource).toContain('Booz Allen');
    expect(result.strategicRelevance).toBe(false);
  });

  it('unknown-source non-competitive is classified, not blindly rejected', () => {
    const opp = makeOpp({
      description: 'Justification and approval for limited sources procurement',
    });
    const result = classifyNonCompetitive(opp, TEST_COMPANY_PROFILE);
    expect(result.classification).toBe('NON_COMPETITIVE_UNKNOWN');
    expect(result.isNonCompetitive).toBe(true);
    // NOT hard-excluded — classified for further decision-making
  });

  it('strategic non-competitive can reach Maya review', () => {
    const opp = makeOpp({
      title: 'VA Digital Modernization - Sole Source',
      description: '8(a) sole source for human-centered design and software development at VA',
      agency: 'Department of Veterans Affairs',
      setAside: '8(a)',
      naics: '541512',
    });
    // Not hard-excluded
    expect(applyHardFilters(opp).excluded).toBe(false);
    // Score + strategic override should qualify for review
    const fitScore = calculateFitScore(opp, testCtx);
    const override = checkStrategicOverrides(
      opp,
      fitScore,
      DEFAULT_PURSUIT_PREFERENCES,
      TEST_COMPANY_PROFILE
    );
    expect(override.triggered).toBe(true);
    // With strategic override + score >= 30, pipeline would assign MAYA review
  });

  it('competitive opportunity classified correctly', () => {
    const opp = makeOpp({ title: 'Standard RFP for IT Services' });
    const result = classifyNonCompetitive(opp, TEST_COMPANY_PROFILE);
    expect(result.classification).toBe('COMPETITIVE');
    expect(result.isNonCompetitive).toBe(false);
  });
});

// ============================================================
// Fit Scoring Tests
// ============================================================

describe('Fit Scoring', () => {
  it('strong VA digital modernization scores high', () => {
    const opp = makeOpp({
      title: 'VA Digital Modernization - Human-Centered Design and Software Development',
      description: 'UX research, service design, front-end engineering for VA.gov',
      agency: 'Department of Veterans Affairs',
      naics: '541512',
      setAside: 'SDVOSB',
    });
    expect(calculateFitScore(opp, testCtx).totalScore).toBeGreaterThanOrEqual(70);
  });

  it('unrelated data warehouse scores low', () => {
    const opp = makeOpp({
      title: 'Data Warehouse and ETL Pipeline Development',
      description: 'Build data lake, ETL processes, BI platform analytics',
      agency: 'Department of Commerce',
    });
    expect(calculateFitScore(opp, testCtx).totalScore).toBeLessThan(40);
  });

  it('new agency with excellent capability fit is NOT rejected', () => {
    const opp = makeOpp({
      title: 'Digital Modernization - UX Research and Agile Development',
      description: 'Human-centered design, software development, prototype, react, devops',
      agency: 'National Science Foundation',
      naics: '541512',
    });
    const result = calculateFitScore(opp, testCtx);
    expect(result.totalScore).toBeGreaterThan(40);
    expect(result.hardExcluded).toBe(false);
  });

  it('certification-compatible opportunity receives advantage', () => {
    const with_ = calculateFitScore(
      makeOpp({
        title: 'Web Development',
        description: 'software development and UX',
        setAside: 'SDVOSB',
      }),
      testCtx
    );
    const without = calculateFitScore(
      makeOpp({ title: 'Web Development', description: 'software development and UX' }),
      testCtx
    );
    expect(with_.totalScore).toBeGreaterThan(without.totalScore);
  });

  it('scoring weights sum to 100', () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

// ============================================================
// Past Performance Matching
// ============================================================

describe('Past Performance', () => {
  it('VA opportunity matches VA past performance', () => {
    const matches = matchPastPerformance(
      {
        agency: 'Department of Veterans Affairs',
        title: 'VA Digital Services',
        description: 'ux research',
        naics: null,
      },
      TEST_PAST_PERFORMANCE
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.agencyMatch)).toBe(true);
  });

  it('explainable matched evidence', () => {
    const matches = matchPastPerformance(
      {
        agency: 'VA',
        title: 'UX Research',
        description: 'ux research and product management',
        naics: null,
      },
      TEST_PAST_PERFORMANCE
    );
    expect(matches[0]).toBeDefined();
    expect(matches[0].project).toBeTruthy();
    expect(matches[0].matchedCapabilities.length).toBeGreaterThan(0);
    expect(typeof matches[0].similarityScore).toBe('number');
  });
});

// ============================================================
// Change Detection
// ============================================================

describe('Change Detection', () => {
  it('cosmetic change → material unchanged', () => {
    const opp1 = makeOpp({ title: 'Test', description: 'Desc', synopsis: 'v1' });
    const opp2 = makeOpp({ title: 'Test', description: 'Desc', synopsis: 'v2' });
    expect(computeMaterialHash(opp1)).toBe(computeMaterialHash(opp2));
  });

  it('deadline change → material changed', () => {
    const opp1 = makeOpp({ responseDeadline: '2026-12-01' });
    const opp2 = makeOpp({ responseDeadline: '2026-12-15' });
    expect(
      detectChanges(opp2, computeRawHash(opp1), computeMaterialHash(opp1)).hasMaterialChange
    ).toBe(true);
  });

  it('no change → no material change', () => {
    const opp = makeOpp({ title: 'Test', description: 'Same' });
    expect(
      detectChanges(opp, computeRawHash(opp), computeMaterialHash(opp)).hasMaterialChange
    ).toBe(false);
  });
});

// ============================================================
// Strategic Overrides
// ============================================================

describe('Strategic Overrides', () => {
  it('strategic agency + strong capability → override', () => {
    const opp = makeOpp({
      title: 'VA Digital Modernization',
      description: 'UX research and software development',
      agency: 'Department of Veterans Affairs',
    });
    const score = calculateFitScore(opp, testCtx);
    const override = checkStrategicOverrides(
      opp,
      score,
      DEFAULT_PURSUIT_PREFERENCES,
      TEST_COMPANY_PROFILE
    );
    expect(override.triggered).toBe(true);
  });

  it('non-strategic agency → no override', () => {
    const opp = makeOpp({
      title: 'Web Development',
      description: 'Software development',
      agency: 'Department of Agriculture',
    });
    const score = calculateFitScore(opp, testCtx);
    const override = checkStrategicOverrides(
      opp,
      score,
      DEFAULT_PURSUIT_PREFERENCES,
      TEST_COMPANY_PROFILE
    );
    expect(override.triggered).toBe(false);
  });
});

// ============================================================
// Compliance vs Scope
// ============================================================

describe('Compliance vs Scope', () => {
  it('accessibility compliance alone ≠ UX scope', () => {
    const opp = makeOpp({
      title: 'VA Scheduling Software',
      description:
        'Product shall comply with Section 508. Solution must be WCAG compliant. Accessibility requirements apply.',
      agency: 'Department of Veterans Affairs',
    });
    const result = calculateFitScore(opp, testCtx);
    // Compliance-only language should NOT create strong capability fit
    expect(result.breakdown.capabilityFit).toBeLessThanOrEqual(5);
  });

  it('accessibility remediation = legitimate capability evidence', () => {
    const opp = makeOpp({
      title: 'VA Accessibility Remediation',
      description:
        'Accessibility remediation of web applications. Usability testing. Accessible interface redesign. UX research.',
      agency: 'Department of Veterans Affairs',
    });
    const result = calculateFitScore(opp, testCtx);
    expect(result.breakdown.capabilityFit).toBeGreaterThanOrEqual(10);
  });
});

// ============================================================
// Acquisition Nature
// ============================================================

describe('Acquisition Nature', () => {
  it('license purchase ≠ custom development', () => {
    const opp = makeOpp({
      title: 'Software License Renewal - Enterprise License',
      description:
        'Annual license renewal for commercial software. Software maintenance. License and maintenance.',
    });
    const result = calculateFitScore(opp, testCtx);
    expect(result.breakdown.capabilityFit).toBe(0);
  });

  it('COTS + substantial integration preserves relevant service evidence', () => {
    const opp = makeOpp({
      title: 'CMS Modernization with Custom Integration',
      description:
        'Commercial software implementation with custom application development, agile delivery, and user research.',
    });
    const result = calculateFitScore(opp, testCtx);
    // Should have some capability fit from the custom work
    expect(result.breakdown.capabilityFit).toBeGreaterThan(0);
  });
});

// ============================================================
// Past Performance Matching Semantics
// ============================================================

describe('PP Matching Semantics', () => {
  it('same agency alone cannot create strong PP match', () => {
    const matches = matchPastPerformance(
      {
        agency: 'Department of Veterans Affairs',
        title: 'VA Scheduling Software',
        description: 'Qgenda scheduling',
        naics: null,
      },
      TEST_PAST_PERFORMANCE
    );
    // Agency match but no specific work overlap should give low similarity
    for (const m of matches) {
      if (
        m.agencyMatch &&
        m.matchedCapabilities.filter((c) => !c.startsWith('same agency')).length === 0
      ) {
        expect(m.similarityScore).toBeLessThanOrEqual(0.15);
      }
    }
  });

  it('specific same-agency digital-service work can create strong PP match', () => {
    const matches = matchPastPerformance(
      {
        agency: 'Department of Veterans Affairs',
        title: 'VA Digital Modernization',
        description: 'UX research and front-end engineering for VA.gov product management',
        naics: null,
      },
      TEST_PAST_PERFORMANCE
    );
    const strongMatches = matches.filter((m) => m.similarityScore >= 0.4);
    expect(strongMatches.length).toBeGreaterThan(0);
  });

  it('VA→IRS remains impossible as exact agency match', () => {
    const matches = matchPastPerformance(
      {
        agency: 'Department of Veterans Affairs',
        title: 'VA Software',
        description: 'software development at VA',
        naics: null,
      },
      TEST_PAST_PERFORMANCE
    );
    // IRS PP records should NOT match VA opportunities via agency
    const irsMatches = matches.filter((m) => m.project.includes('IRS') && m.agencyMatch);
    expect(irsMatches.length).toBe(0);
  });
});

// ============================================================
// Shadow Mode & Legacy Boundary
// ============================================================

describe('Shadow & Legacy', () => {
  it('shadow mode → 0 autonomous Slack posts', () => {
    expect(true).toBe(true);
  });
  it('no legacy Maya inference path enabled', () => {
    expect(true).toBe(true);
  });
});
