/**
 * Publication Classifier Tests
 *
 * Tests the deterministic content classification engine.
 * All fixtures are synthetic — not actual FFTC policies.
 */
import { describe, it, expect } from 'vitest';
import { classifyForPublication, type PriorApprovalContext } from '../notion/publication-classifier.js';
import type { ExtractionReport } from '../notion/publication-types.js';

describe('classifyForPublication — confidential exclusion', () => {
  it('excludes individual salary records', () => {
    const d = classifyForPublication('Individual Salary Report', '', 'HR / Compensation', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes payroll data', () => {
    const d = classifyForPublication('Payroll Records Q4 2026', '', 'HR / Finance', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes performance reviews', () => {
    const d = classifyForPublication('Performance Review - Annual', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes performance improvement plans', () => {
    const d = classifyForPublication('PIP Documentation', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes manager-only documents', () => {
    const d = classifyForPublication('Manager-Only Compensation Guide', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes content with individual salary patterns', () => {
    const d = classifyForPublication('Compensation Update', '$85,000/yr base salary adjustment', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes SSN patterns in content', () => {
    const d = classifyForPublication('Employee Info', 'SSN: 123-45-6789', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes candidate evaluations', () => {
    const d = classifyForPublication('Candidate Scorecard - Software Engineer', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes credential pages', () => {
    const d = classifyForPublication('Credentials and API Keys', '', 'IT', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes tax forms', () => {
    const d = classifyForPublication('W-2 Processing Guide', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes litigation materials', () => {
    const d = classifyForPublication('Litigation Hold Procedures', '', 'Legal', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });
});

describe('classifyForPublication — personalized exclusion', () => {
  it('excludes personalized root classification', () => {
    const d = classifyForPublication('Onboarding Board', '', 'HR', 'personalized');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('personalized');
  });

  it('excludes hr_restricted classification', () => {
    const d = classifyForPublication('Admin Guide', '', 'HR', 'hr_restricted');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('confidential');
  });

  it('excludes possessive individual content', () => {
    const d = classifyForPublication("Joshua's Performance Goals", '', "HR / Joshua's Review", 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('personalized');
  });

  it('excludes My-prefixed content', () => {
    const d = classifyForPublication('My Onboarding Plan', '', 'HR / My Onboarding', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('personalized');
  });

  it('excludes directory/roster pages', () => {
    const d = classifyForPublication('Employee Directory', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
    expect(d.category).toBe('personalized');
  });
});

describe('classifyForPublication — salary bands (owner review)', () => {
  it('requires review for salary band pages', () => {
    const d = classifyForPublication('Salary Band Structure 2027', '', 'HR / Compensation', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('salary_band');
  });

  it('requires review for pay range pages', () => {
    const d = classifyForPublication('Pay Range by Level', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('salary_band');
  });

  it('requires review for step increase tables', () => {
    const d = classifyForPublication('Step Increase Schedule', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('salary_band');
  });

  it('requires review for content with salary band patterns', () => {
    const d = classifyForPublication('Compensation Info', 'Step 1: $45,000 to Step 5: $65,000', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('salary_band');
  });

  it('does NOT exclude salary bands (they are employee-facing)', () => {
    const d = classifyForPublication('Salary Band Structure', '', 'HR', 'employee_safe');
    expect(d.disposition).not.toBe('exclude');
  });
});

describe('classifyForPublication — sensitive policies (owner review)', () => {
  it('requires review for harassment policy', () => {
    const d = classifyForPublication('Harassment Prevention Policy', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('sensitive_policy');
  });

  it('requires review for termination policy', () => {
    const d = classifyForPublication('Termination of Employment Policy', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('sensitive_policy');
  });

  it('requires review for compliance policy', () => {
    const d = classifyForPublication('Compliance Training Requirements', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('sensitive_policy');
  });

  it('requires review for furlough guidelines', () => {
    const d = classifyForPublication('Temporary Furlough Guidelines', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('sensitive_policy');
  });

  it('requires review for drug testing policy', () => {
    const d = classifyForPublication('Drug Testing Policy', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('sensitive_policy');
  });
});

describe('classifyForPublication — routine employee-safe (auto-publish)', () => {
  it('auto-publishes PTO policy', () => {
    const d = classifyForPublication('Paid Time Off (PTO)', '', 'HR / Leave', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes sick leave', () => {
    const d = classifyForPublication('Sick Leave Policy', '', 'HR / Leave', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes parental leave', () => {
    const d = classifyForPublication('Parental Leave', '', 'HR / Leave', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes remote work policy', () => {
    const d = classifyForPublication('Remote Work Policy', '', 'HR / Workplace', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes healthcare benefits', () => {
    const d = classifyForPublication('Healthcare Benefits Guide', '', 'HR / Benefits', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes 401k information', () => {
    const d = classifyForPublication('401k Retirement Plan', '', 'HR / Benefits', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes cybersecurity policy', () => {
    const d = classifyForPublication('Cybersecurity Policy', '', 'IT', 'employee_safe');
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });

  it('auto-publishes previously approved ROUTINE pages with matching hash', () => {
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: true, priorCategory: 'routine_employee_safe' };
    const d = classifyForPublication('Some Other Policy', '', 'HR', 'employee_safe', undefined, prior);
    expect(d.disposition).toBe('auto_publish');
    expect(d.category).toBe('routine_employee_safe');
  });
});

describe('classifyForPublication — approval history hardening (C8X-105B.1)', () => {
  it('does NOT auto-publish previously approved SENSITIVE page', () => {
    // A page approved via owner review as sensitive_policy must require review again
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: true, priorCategory: 'sensitive_policy' };
    const d = classifyForPublication('Some General Page', '', 'HR', 'employee_safe', undefined, prior);
    // Should quarantine (unknown), not auto-publish
    expect(d.disposition).toBe('quarantine');
    expect(d.category).toBe('unknown');
  });

  it('does NOT auto-publish previously approved SALARY BAND page', () => {
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: true, priorCategory: 'salary_band' };
    const d = classifyForPublication('Compensation Info', '', 'HR', 'employee_safe', undefined, prior);
    expect(d.disposition).toBe('quarantine');
  });

  it('does NOT auto-publish when approval hash does not match current hash', () => {
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: false, priorCategory: 'routine_employee_safe' };
    const d = classifyForPublication('Some Page', '', 'HR', 'employee_safe', undefined, prior);
    expect(d.disposition).toBe('quarantine'); // unknown, no matching rule
  });

  it('sensitive title ALWAYS requires owner review regardless of prior approval', () => {
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: true, priorCategory: 'routine_employee_safe' };
    const d = classifyForPublication('Harassment Prevention Policy', '', 'HR', 'employee_safe', undefined, prior);
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('sensitive_policy');
  });

  it('confidential content ALWAYS excluded regardless of prior approval', () => {
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: true, priorCategory: 'routine_employee_safe' };
    const d = classifyForPublication('PTO Info', 'SSN: 123-45-6789', 'HR', 'employee_safe', undefined, prior);
    expect(d.disposition).toBe('exclude');
  });

  it('salary band title requires review even with routine prior approval', () => {
    const prior: PriorApprovalContext = { hasApprovalForCurrentHash: true, priorCategory: 'routine_employee_safe' };
    const d = classifyForPublication('Salary Band Structure', '', 'HR', 'employee_safe', undefined, prior);
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('salary_band');
  });
});

describe('classifyForPublication — incomplete extraction', () => {
  it('quarantines pages with unextracted table content', () => {
    const report: ExtractionReport = {
      totalBlocks: 10, extractedBlocks: 7,
      unsupportedBlockTypes: ['table', 'table_row'],
      hasTableContent: true, isComplete: false,
    };
    const d = classifyForPublication('Policy Info', '', 'HR', 'employee_safe', report);
    expect(d.disposition).toBe('quarantine');
    expect(d.category).toBe('incomplete_extraction');
  });

  it('allows pages with minor unsupported blocks (no tables)', () => {
    const report: ExtractionReport = {
      totalBlocks: 10, extractedBlocks: 9,
      unsupportedBlockTypes: ['embed'],
      hasTableContent: false, isComplete: false,
    };
    // Should still classify based on title (the embed is noted but not blocking)
    const d = classifyForPublication('Paid Time Off (PTO)', '', 'HR', 'employee_safe', report);
    expect(d.disposition).toBe('auto_publish');
  });
});

describe('classifyForPublication — unknown / quarantine', () => {
  it('quarantines pages with no matching rules', () => {
    const d = classifyForPublication('Random Page Title', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('quarantine');
    expect(d.category).toBe('unknown');
  });

  it('quarantines pages without existing approval', () => {
    const d = classifyForPublication('Unnamed Document', '', 'HR', 'employee_safe', undefined, false);
    expect(d.disposition).toBe('quarantine');
    expect(d.category).toBe('unknown');
  });
});

describe('classifyForPublication — precedence', () => {
  it('confidential overrides safe title', () => {
    // Title says "PTO" (safe) but content has SSN (confidential)
    const d = classifyForPublication('PTO Information', 'SSN: 999-88-7777 for verification', 'HR', 'employee_safe');
    expect(d.disposition).toBe('exclude');
  });

  it('confidential child overrides safe parent', () => {
    const d = classifyForPublication('Confidential Notes', '', 'HR / Leave / PTO', 'employee_safe');
    expect(d.disposition).toBe('exclude');
  });

  it('salary band detected before routine safe', () => {
    // Title matches both "salary band" and nothing routine
    const d = classifyForPublication('Salary Band Structure', '', 'HR', 'employee_safe');
    expect(d.disposition).toBe('owner_review');
    expect(d.category).toBe('salary_band');
  });
});
