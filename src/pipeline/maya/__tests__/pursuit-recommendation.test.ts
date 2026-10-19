/**
 * Pursuit Recommendation Tests
 *
 * Regression cases from Phase 2B requirements:
 * - NOAA/HPC TEAMING_FIT → MONITOR (workshare marginal)
 * - VA Procurement Policy NOT_A_FIT → DECLINE
 * - MCC Software NOT_A_FIT → DECLINE
 * - Thin notice INSUFFICIENT_EVIDENCE → MONITOR
 * - Synthetic UX prime with sufficient evidence → PURSUE_PRIME
 * - Synthetic UX+backend with substantive workshare → EXPLORE_TEAMING
 * - Unknown eligibility → no unsupported positive recommendation
 */
import { describe, it, expect } from 'vitest';
import { recommendPursuit, DEFAULT_PURSUIT_CONFIG } from '../pursuit-recommendation.js';
import { qualifyOpportunity } from '../capability-qualifier.js';
import { CAPABILITIES, ENGAGEMENTS } from '../capability-data.js';
import type { NormalizedOpportunity } from '../types.js';

function makeOpp(overrides: Partial<NormalizedOpportunity>): NormalizedOpportunity {
  return {
    sourceId: 'test-1', source: 'sam_gov', solicitationNumber: null,
    title: 'Test', description: null, synopsis: null,
    agency: null, subAgency: null, office: null,
    noticeType: 'solicitation', naics: '541512', psc: null,
    setAside: null, setAsideDescription: null,
    postedDate: '2026-10-01', responseDeadline: '2026-11-15',
    estimatedValue: null, placeOfPerformance: null,
    vehicle: null, sourceUrl: 'https://sam.gov/test',
    attachments: [], active: true, archived: false, cancelled: false,
    rawHash: 'a', materialHash: 'b',
    ...overrides,
  };
}

// ============================================================
// Fixtures
// ============================================================

const NOAA_HPC = makeOpp({
  sourceId: 'noaa-hpc',
  title: 'High-Performance Computing Software Development and Technical Services',
  agency: 'COMMERCE, DEPARTMENT OF',
  naics: '541511',
  description: `Statement of Objectives for GFDL HPC IDIQ. Objective 1: Earth System Model Development. Objective 2: IT Operations and HPC Infrastructure. Objective 3: Cybersecurity per NIST 800-53, ATO packages, vulnerability management. Objective 4: Facilities Management. The Contractor shall actively involve scientific users in the design of software solutions, incorporating user research and usability testing (personas, wireframes, prototypes). Labor categories: Scientific Programmer, Systems Programmer, Network Engineer, Cybersecurity Analyst. Total 62+ FTE.`,
});

const VA_PROCUREMENT_POLICY = makeOpp({
  sourceId: 'va-proc-pol',
  title: 'VA Procurement Policy Documentation Control Software',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  description: `The VA seeks a SharePoint Online-based document control management system for ~400K users. COTS product acquisition. FedRAMP authorization, Section 508, ATO required. The contractor shall deliver installation, configuration, training, and maintenance.`,
});

const MCC_SOFTWARE = makeOpp({
  sourceId: 'mcc-sw',
  title: 'MCC Software Development Recompete',
  agency: 'MILLENNIUM CHALLENGE CORPORATION',
  naics: '541512', setAside: 'NONE',
  description: `Performance Work Statement: Full-stack application development, O&M, DevSecOps, CI/CD, AWS cloud infrastructure. Labor categories: Senior Software Engineer, DevOps Engineer, DBA, QA Analyst. React, Node.js, Python, PostgreSQL. Base + 4 option years.`,
});

const THIN_NOTICE = makeOpp({
  sourceId: 'thin-001',
  title: 'IT Support Services',
  description: 'The agency seeks information about IT support services for an upcoming requirement. This is for market research purposes only and does not constitute a solicitation. No award will result from this notice.',
});

const SYNTHETIC_UX_PRIME = makeOpp({
  sourceId: 'synth-prime',
  title: 'User Research and Service Design for Benefits Portal Redesign',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519', setAside: 'SBA',
  estimatedValue: 200000,
  responseDeadline: '2026-12-15',
  description: `Statement of Work: The contractor shall perform user research and service design. Tasks: conduct qualitative user research including user interviews, usability testing, and contextual inquiry; develop journey maps and service blueprints; create wireframes and deliver interactive prototypes using the VA Design System (VADS) and USWDS; conduct accessibility research with Veterans using screen readers. Deliverables: research plan, moderator guides, usability test reports, journey maps, wireframes, design recommendations. Key Personnel: Lead UX Researcher. Period of performance: 12 months. The contractor shall provide a Performance Work Statement response. Labor categories include UX Researcher, UX Designer, Content Strategist. This is a small business set-aside.`,
});

const SYNTHETIC_UX_BACKEND = makeOpp({
  sourceId: 'synth-team',
  title: 'Benefits Portal Modernization — Full Stack with User Research',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541512', setAside: 'SBA',
  responseDeadline: '2026-12-01',
  description: `Performance Work Statement: Task Area 1 — User Research and Design: Conduct user research with Veterans including usability testing, contextual inquiry, and co-design sessions. Develop journey maps and service blueprints. Create wireframes and deliver interactive prototypes using the VA Design System. Perform accessibility research with assistive technology users. Deliver behavioral archetypes and design recommendations. Key personnel: Lead UX Researcher. Task Area 2 — Application Development: Develop backend APIs using Node.js and PostgreSQL. Implement cloud infrastructure on AWS GovCloud with DevSecOps practices. Build CI/CD pipelines. Manage the ATO process. Key personnel: Technical Lead, Senior Backend Developer. Task Area 3 — Product Management: Provide embedded product management including backlog management and sprint planning.`,
});

const UNKNOWN_ELIGIBILITY = makeOpp({
  sourceId: 'unk-elig',
  title: 'UX Research Services',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519', setAside: 'ISBEE', // Unknown set-aside type
  estimatedValue: 150000,
  description: `Statement of Work: Conduct user research including usability testing and contextual inquiry. Deliver journey maps, wireframes, and interactive prototypes. Period of performance: 12 months.`,
});

// ============================================================
// Tests
// ============================================================

describe('Pursuit Recommendation', () => {
  describe('Regression Cases', () => {
    it('NOAA/HPC TEAMING_FIT → MONITOR (workshare marginal)', () => {
      const qual = qualifyOpportunity(NOAA_HPC, CAPABILITIES, ENGAGEMENTS);
      expect(qual.classification).toBe('TEAMING_FIT');

      const pursuit = recommendPursuit(NOAA_HPC, qual);
      expect(pursuit.action).toBe('MONITOR');
      expect(pursuit.teamingAssessment).not.toBeNull();
      expect(pursuit.teamingAssessment!.workshareSubstantive).not.toBe('YES');
      expect(pursuit.rationale).toContain('not confirmed substantive');
    });

    it('VA Procurement Policy NOT_A_FIT → DECLINE', () => {
      const qual = qualifyOpportunity(VA_PROCUREMENT_POLICY, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(VA_PROCUREMENT_POLICY, qual);
      expect(pursuit.action).toBe('DECLINE');
    });

    it('MCC Software NOT_A_FIT → DECLINE', () => {
      const qual = qualifyOpportunity(MCC_SOFTWARE, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(MCC_SOFTWARE, qual);
      expect(pursuit.action).toBe('DECLINE');
    });

    it('Thin notice INSUFFICIENT_EVIDENCE → MONITOR', () => {
      const qual = qualifyOpportunity(THIN_NOTICE, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(THIN_NOTICE, qual);
      expect(pursuit.action).toBe('MONITOR');
      expect(pursuit.evidenceCompleteness).toBe('INSUFFICIENT');
      expect(pursuit.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe('Positive Controls', () => {
    it('SYNTHETIC: Qualified UX prime with sufficient evidence → PURSUE_PRIME', () => {
      const qual = qualifyOpportunity(SYNTHETIC_UX_PRIME, CAPABILITIES, ENGAGEMENTS);
      expect(qual.classification).toBe('PRIME_FIT');

      const pursuit = recommendPursuit(SYNTHETIC_UX_PRIME, qual);
      expect(pursuit.action).toBe('PURSUE_PRIME');
      expect(pursuit.primeAssessment).not.toBeNull();
      expect(pursuit.primeAssessment!.eligibility).toBe('YES');
      expect(pursuit.primeAssessment!.fftcCapabilities.length).toBeGreaterThan(0);
      expect(pursuit.primeAssessment!.engagementEvidence.length).toBeGreaterThan(0);
    });

    it('SYNTHETIC: Substantive UX/backend workshare → EXPLORE_TEAMING', () => {
      const qual = qualifyOpportunity(SYNTHETIC_UX_BACKEND, CAPABILITIES, ENGAGEMENTS);
      expect(qual.classification).toBe('TEAMING_FIT');

      const pursuit = recommendPursuit(SYNTHETIC_UX_BACKEND, qual);
      expect(pursuit.action).toBe('EXPLORE_TEAMING');
      expect(pursuit.teamingAssessment).not.toBeNull();
      expect(pursuit.teamingAssessment!.workshareSubstantive).toBe('YES');
      expect(pursuit.teamingAssessment!.fftcWorkshare.length).toBeGreaterThan(0);
      expect(pursuit.teamingAssessment!.partnerCapabilities.length).toBeGreaterThan(0);
    });
  });

  describe('Safety Guards', () => {
    it('unknown eligibility → does not produce PURSUE_PRIME', () => {
      const qual = qualifyOpportunity(UNKNOWN_ELIGIBILITY, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(UNKNOWN_ELIGIBILITY, qual);
      // With unknown set-aside eligibility, should downgrade to MONITOR
      expect(pursuit.action).not.toBe('PURSUE_PRIME');
    });

    it('expired deadline → does not produce PURSUE_PRIME', () => {
      const expiredOpp = makeOpp({
        ...SYNTHETIC_UX_PRIME,
        sourceId: 'expired-prime',
        responseDeadline: '2026-10-10', // In the past
      });
      const qual = qualifyOpportunity(expiredOpp, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(expiredOpp, qual);
      expect(pursuit.action).not.toBe('PURSUE_PRIME');
    });

    it('insufficient evidence → does not produce PURSUE_PRIME', () => {
      const thinPrime = makeOpp({
        sourceId: 'thin-prime',
        title: 'UX Research Services',
        agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
        setAside: 'SBA',
        description: 'VA seeks UX research services.',
      });
      const qual = qualifyOpportunity(thinPrime, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(thinPrime, qual);
      expect(pursuit.action).not.toBe('PURSUE_PRIME');
      expect(pursuit.action).not.toBe('EXPLORE_TEAMING');
    });

    it('DECLINE includes no next steps', () => {
      const qual = qualifyOpportunity(MCC_SOFTWARE, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(MCC_SOFTWARE, qual);
      expect(pursuit.action).toBe('DECLINE');
      expect(pursuit.nextSteps).toEqual([]);
    });
  });

  describe('Output Completeness', () => {
    it('every recommendation includes required fields', () => {
      const opps = [NOAA_HPC, VA_PROCUREMENT_POLICY, MCC_SOFTWARE, THIN_NOTICE, SYNTHETIC_UX_PRIME, SYNTHETIC_UX_BACKEND];

      for (const opp of opps) {
        const qual = qualifyOpportunity(opp, CAPABILITIES, ENGAGEMENTS);
        const pursuit = recommendPursuit(opp, qual);

        expect(pursuit.action).toBeDefined();
        expect(pursuit.qualification).toBeDefined();
        expect(pursuit.evidenceCompleteness).toBeDefined();
        expect(pursuit.attractiveness).toBeDefined();
        expect(pursuit.rationale.length).toBeGreaterThan(0);
        expect(pursuit.recommenderVersion).toBe('v1');
        expect(pursuit.evaluatedAt).toBeDefined();
      }
    });

    it('PURSUE_PRIME includes prime assessment', () => {
      const qual = qualifyOpportunity(SYNTHETIC_UX_PRIME, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(SYNTHETIC_UX_PRIME, qual);
      expect(pursuit.primeAssessment).not.toBeNull();
      expect(pursuit.primeAssessment!.primeScaleRisk).toBeDefined();
    });

    it('EXPLORE_TEAMING includes Denise questions', () => {
      const qual = qualifyOpportunity(SYNTHETIC_UX_BACKEND, CAPABILITIES, ENGAGEMENTS);
      const pursuit = recommendPursuit(SYNTHETIC_UX_BACKEND, qual);
      expect(pursuit.deniseQuestions.length).toBeGreaterThan(0);
    });
  });

  describe('Configurable Deadline', () => {
    it('respects custom minDeadlineDays', () => {
      const shortDeadline = makeOpp({
        ...SYNTHETIC_UX_PRIME,
        sourceId: 'short-deadline',
        responseDeadline: new Date(Date.now() + 10 * 86400000).toISOString(), // 10 days
      });

      const qual = qualifyOpportunity(shortDeadline, CAPABILITIES, ENGAGEMENTS);

      // Default 14-day threshold → should NOT pursue
      const pursuit14 = recommendPursuit(shortDeadline, qual, { ...DEFAULT_PURSUIT_CONFIG, minDeadlineDays: 14 });
      expect(pursuit14.action).not.toBe('PURSUE_PRIME');

      // 7-day threshold → should pursue
      const pursuit7 = recommendPursuit(shortDeadline, qual, { ...DEFAULT_PURSUIT_CONFIG, minDeadlineDays: 7 });
      expect(pursuit7.action).toBe('PURSUE_PRIME');
    });
  });
});
