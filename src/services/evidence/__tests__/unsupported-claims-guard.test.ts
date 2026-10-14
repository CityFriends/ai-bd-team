/**
 * Unsupported Claims Guard
 *
 * Prevents re-introduction of three specific unsupported performance claims
 * that were removed during the 2026-10-14 evidence remediation:
 *
 *   1. "88% increase in waiver submissions" — unverified attribution to ENG-17
 *   2. "95% instant approval rate" — no source documentation
 *   3. "30K+ veterans helped" — program-scale metric, not FFTC outcome
 *
 * These tests scan the seed script (update-company-data.ts) to ensure
 * the claims cannot be reintroduced via hardcoded data. The database
 * remediation is handled separately by 20261014_evidence_remediation.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SEED_SCRIPT_PATH = resolve(
  __dirname,
  '../../../scripts/update-company-data.ts'
);

const seedContent = readFileSync(SEED_SCRIPT_PATH, 'utf-8');

describe('Unsupported Claims Guard', () => {
  describe('seed script (update-company-data.ts)', () => {
    it('does not contain "88% increase in waiver submissions"', () => {
      expect(seedContent).not.toMatch(/88%.*waiver/i);
      expect(seedContent).not.toMatch(/waiver.*88%/i);
    });

    it('does not contain "95% instant approval rate"', () => {
      expect(seedContent).not.toMatch(/95%.*approval/i);
      expect(seedContent).not.toMatch(/approval.*95%/i);
    });

    it('does not contain "30K+ veterans helped"', () => {
      expect(seedContent).not.toMatch(/30[,.]?000\+?\s*veterans\s*helped/i);
      expect(seedContent).not.toMatch(/30K\+?\s*veterans/i);
    });

    it('VA debt case study outcomes contain only verified claims', () => {
      // Extract the outcomes array for the "Resolving Veteran Debt" case study
      const debtCaseMatch = seedContent.match(
        /title:\s*['"]Resolving Veteran Debt in Minutes['"][\s\S]*?outcomes:\s*\[([\s\S]*?)\]/
      );
      expect(debtCaseMatch).not.toBeNull();

      const outcomesBlock = debtCaseMatch![1];

      // Must contain the verified outcome
      expect(outcomesBlock).toContain(
        'Veterans resolve debt in minutes instead of weeks'
      );

      // Must not contain any percentage-based claims
      expect(outcomesBlock).not.toMatch(/\d+%/);

      // Must not contain "30K" or "30,000"
      expect(outcomesBlock).not.toMatch(/30[K,]/i);
    });
  });
});
