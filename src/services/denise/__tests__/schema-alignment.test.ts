/**
 * Schema Alignment and Paid-Output Recovery Tests
 *
 * Verifies:
 * - uncertainties.max(3) accepted per prompt contract
 * - Excessive findings (>3) rejected without truncation
 * - Legal-safety gate with 3 uncertainties
 * - Cost association survives validation failure
 * - No silent truncation
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Schema alignment — uncertainties contract', () => {
  it('InterpretationOutputSchema accepts 3 uncertainty findings', async () => {
    const { InterpretationOutputSchema } = await import('../regulatory-interpretation.js');

    const validOutput = {
      sourceFacts: [{ category: 'SOURCE_FACT', statement: 'Test fact', regulatoryExcerpt: 'test' }],
      interpretations: [{ category: 'INTERPRETATION', statement: 'Test interpretation' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION', statement: 'Test implication' }],
      uncertainties: [
        { category: 'UNCERTAINTY', statement: 'Uncertainty one' },
        { category: 'UNCERTAINTY', statement: 'Uncertainty two' },
        { category: 'UNCERTAINTY', statement: 'Uncertainty three' },
      ],
      suggestedOwner: 'PATRICIA',
      legalReviewRequired: false,
      confidence: 'HIGH',
    };

    const result = InterpretationOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it('InterpretationOutputSchema rejects 4+ uncertainty findings', async () => {
    const { InterpretationOutputSchema } = await import('../regulatory-interpretation.js');

    const tooMany = {
      sourceFacts: [{ category: 'SOURCE_FACT', statement: 'Fact' }],
      interpretations: [{ category: 'INTERPRETATION', statement: 'Interp' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION', statement: 'Impl' }],
      uncertainties: [
        { category: 'UNCERTAINTY', statement: 'U1' },
        { category: 'UNCERTAINTY', statement: 'U2' },
        { category: 'UNCERTAINTY', statement: 'U3' },
        { category: 'UNCERTAINTY', statement: 'U4' },
      ],
      suggestedOwner: 'HUMAN',
      confidence: 'LOW',
    };

    const result = InterpretationOutputSchema.safeParse(tooMany);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('3');
  });

  it('all four arrays have consistent max(3) constraint', async () => {
    const { InterpretationOutputSchema } = await import('../regulatory-interpretation.js');

    // Test all arrays at exactly 3
    const atLimit = {
      sourceFacts: Array.from({ length: 3 }, (_, i) => ({ category: 'SOURCE_FACT', statement: `F${i}`, regulatoryExcerpt: `e${i}` })),
      interpretations: Array.from({ length: 3 }, (_, i) => ({ category: 'INTERPRETATION', statement: `I${i}` })),
      operationalImplications: Array.from({ length: 3 }, (_, i) => ({ category: 'OPERATIONAL_IMPLICATION', statement: `O${i}` })),
      uncertainties: Array.from({ length: 3 }, (_, i) => ({ category: 'UNCERTAINTY', statement: `U${i}` })),
      confidence: 'MEDIUM',
    };
    expect(InterpretationOutputSchema.safeParse(atLimit).success).toBe(true);

    // Test each array at 4 individually — all should fail
    for (const key of ['sourceFacts', 'interpretations', 'operationalImplications', 'uncertainties']) {
      const overLimit = { ...atLimit, [key]: [...(atLimit as any)[key], { category: 'UNCERTAINTY', statement: 'Extra' }] };
      expect(InterpretationOutputSchema.safeParse(overLimit).success).toBe(false);
    }
  });

  it('schema does not silently truncate — rejects without modifying input', async () => {
    const { InterpretationOutputSchema } = await import('../regulatory-interpretation.js');

    const input = {
      sourceFacts: [{ category: 'SOURCE_FACT', statement: 'F1' }],
      interpretations: [{ category: 'INTERPRETATION', statement: 'I1' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION', statement: 'O1' }],
      uncertainties: [
        { category: 'UNCERTAINTY', statement: 'U1' },
        { category: 'UNCERTAINTY', statement: 'U2' },
        { category: 'UNCERTAINTY', statement: 'U3' },
        { category: 'UNCERTAINTY', statement: 'U4' },
      ],
      confidence: 'LOW',
    };

    const result = InterpretationOutputSchema.safeParse(input);
    expect(result.success).toBe(false);
    // Input is unchanged
    expect(input.uncertainties).toHaveLength(4);
  });
});

describe('Legal-safety gate with 3 uncertainties', () => {
  it('enforceNoUnsupportedLegalConclusions processes 3 uncertainties', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');

    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'Clause requires 50% rule' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'FFTC must comply with limitations' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Track subcontract spend' }],
      uncertainties: [
        { category: 'UNCERTAINTY' as const, statement: 'Set-aside status must be verified' },
        { category: 'UNCERTAINTY' as const, statement: 'NAICS code assignment may vary' },
        { category: 'UNCERTAINTY' as const, statement: 'Joint venture provisions unclear' },
      ],
      suggestedOwner: 'PATRICIA',
      legalReviewRequired: false,
      confidence: 'MEDIUM' as const,
    };

    const result = enforceNoUnsupportedLegalConclusions(output);
    // No unsupported legal assertions — should not downgrade
    expect(result.modified).toBe(false);
    expect(result.downgrades).toHaveLength(0);
  });

  it('flags definitive legal assertions even with 3 uncertainties', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');

    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'This provision is legally binding and enforceable' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'FFTC is required to comply' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Ensure compliance tracking' }],
      uncertainties: [
        { category: 'UNCERTAINTY' as const, statement: 'U1' },
        { category: 'UNCERTAINTY' as const, statement: 'U2' },
        { category: 'UNCERTAINTY' as const, statement: 'U3' },
      ],
      suggestedOwner: 'HUMAN',
      legalReviewRequired: false,
      confidence: 'MEDIUM' as const,
    };

    const result = enforceNoUnsupportedLegalConclusions(output);
    // "legally binding and enforceable" should trigger legalReviewRequired
    expect(output.legalReviewRequired).toBe(true);
  });
});

describe('Cost association on validation failure', () => {
  it('regulatory-interpretation preserves ledgerId and costUsd on schema failure', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts'),
      'utf-8'
    );
    // After fail_denise_eval_claim for SCHEMA error, should update claim with ledger_id and cost_usd
    const schemaSection = content.slice(content.indexOf("p_error_code: 'SCHEMA'"));
    expect(schemaSection).toContain('ledger_id: ledgerId');
    expect(schemaSection).toContain('cost_usd: costUsd');
  });

  it('regulatory-interpretation preserves ledgerId and costUsd on JSON parse failure', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts'),
      'utf-8'
    );
    const parseSection = content.slice(content.indexOf("p_error_code: 'JSON_PARSE'"));
    expect(parseSection).toContain('ledger_id: ledgerId');
    expect(parseSection).toContain('cost_usd: costUsd');
  });

  it('Gateway ledger is financial source of truth (not task claim)', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts'),
      'utf-8'
    );
    // The return statement for schema failures includes ledgerId for reconciliation
    expect(content).toContain("return { ...fail('Schema validation failed'), ledgerId, costUsd");
    expect(content).toContain("return { ...fail('Invalid JSON output'), ledgerId, costUsd");
  });
});

describe('Prompt-schema consistency', () => {
  it('system prompt says max 3 items, schema enforces max 3', () => {
    const content = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts'),
      'utf-8'
    );
    // Prompt
    expect(content).toContain('max 3 items per array');
    // Schema — all arrays should be .max(3)
    expect(content).not.toContain('.max(2)');
    // Count .max(3) occurrences — should be 4 (one per array)
    const maxThreeCount = (content.match(/\.max\(3\)/g) || []).length;
    expect(maxThreeCount).toBe(4);
  });
});
