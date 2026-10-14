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
const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../supabase/migrations/20261014_evidence_remediation.sql'
);

const seedContent = readFileSync(SEED_SCRIPT_PATH, 'utf-8');
const migrationContent = readFileSync(MIGRATION_PATH, 'utf-8');

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

  describe('SQL migration (20261014_evidence_remediation.sql)', () => {
    it('uses surgical removal, not full-content replacement', () => {
      // Must use regexp_replace or similar for proposal_snippets, not SET content = '...'
      // The migration should use regexp_replace to remove only specific sentences
      expect(migrationContent).toMatch(/regexp_replace/);
    });

    it('uses array_remove for case_studies, not full array replacement', () => {
      // Must use array_remove() to remove elements by value from text[]
      expect(migrationContent).toMatch(/array_remove/);
    });

    it('captures rollback artifacts before modification', () => {
      expect(migrationContent).toMatch(/rollback/i);
      expect(migrationContent).toMatch(/INSERT INTO _evidence_remediation_rollback/);
    });

    it('asserts pre-modification state before writing', () => {
      // Must verify row contents match expected values before modifying
      expect(migrationContent).toMatch(/RAISE EXCEPTION.*ABORT.*does not match/);
    });

    it('asserts post-modification state after writing', () => {
      // Must verify claims are actually removed
      expect(migrationContent).toMatch(/POST-MODIFICATION ASSERTIONS/);
      expect(migrationContent).toMatch(/still contains.*88/);
    });

    it('wraps everything in an explicit transaction', () => {
      expect(migrationContent).toMatch(/^BEGIN;/m);
      expect(migrationContent).toMatch(/^COMMIT;/m);
    });

    it('targets exactly the 3 known row IDs', () => {
      expect(migrationContent).toContain('d9a7ca5d-cd41-4f81-ae21-b8355525eb4c');
      expect(migrationContent).toContain('23618839-647b-4d14-a681-681499f2045b');
      expect(migrationContent).toContain('2dd5af3b-c2e2-4d20-8884-73b85371825a');
    });

    it('does not use supabase db push as an execution method', () => {
      // The migration header may mention "does NOT use supabase db push" as documentation.
      // Ensure there is no uncommented instruction to run supabase db push.
      const uncommentedLines = migrationContent
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'));
      const uncommented = uncommentedLines.join('\n');
      expect(uncommented).not.toMatch(/supabase db push/i);
    });

    it('includes a commented rollback script with exact-value conflict guards', () => {
      expect(migrationContent).toMatch(/ROLLBACK SCRIPT/);
      expect(migrationContent).toMatch(/ROLLBACK ABORT.*modified since remediation/);
      // Must compare exact values, not just claim absence or array length
      expect(migrationContent).toMatch(/IS DISTINCT FROM expected_outcomes/);
      expect(migrationContent).toMatch(/IS DISTINCT FROM expected_ps1/);
      expect(migrationContent).toMatch(/IS DISTINCT FROM expected_ps2/);
    });

    it('is idempotent-safe: reruns abort on changed source values', () => {
      // The pre-modification assertions check for the original 4-element outcomes array.
      // After first run, outcomes has 1 element, so rerun will RAISE EXCEPTION.
      expect(migrationContent).toMatch(
        /88% increase in waiver submissions/
      );
      expect(migrationContent).toMatch(/array_length\(outcomes, 1\) = 4/);
    });
  });
});
