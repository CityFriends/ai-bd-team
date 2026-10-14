/**
 * Milestone D Closeout Tests
 *
 * Canonical evidence hashing and legal-review rationale behavior.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

describe('Canonical evidence hash contract', () => {
  it('computeEvidenceHash uses SHA-256 of exact UTF-8 bytes', async () => {
    const { computeEvidenceHash } = await import('../regulatory-interpretation.js');
    const text = 'FAR 52.219-14 test content';
    const expected = createHash('sha256').update(text).digest('hex');
    expect(computeEvidenceHash(text)).toBe(expected);
  });

  it('trailing newline produces a different hash', async () => {
    const { computeEvidenceHash } = await import('../regulatory-interpretation.js');
    const text = 'FAR 52.219-14 test content';
    const withNewline = text + '\n';
    expect(computeEvidenceHash(text)).not.toBe(computeEvidenceHash(withNewline));
  });

  it('trailing whitespace produces a different hash', async () => {
    const { computeEvidenceHash } = await import('../regulatory-interpretation.js');
    const text = 'test';
    expect(computeEvidenceHash(text)).not.toBe(computeEvidenceHash(text + ' '));
    expect(computeEvidenceHash(text)).not.toBe(computeEvidenceHash(text + '\t'));
  });

  it('hash is byte-exact (no normalization)', async () => {
    const { computeEvidenceHash } = await import('../regulatory-interpretation.js');
    // Em-dash vs hyphen-hyphen should differ
    const withEmDash = 'that\u2014means';
    const withHyphens = 'that--means';
    expect(computeEvidenceHash(withEmDash)).not.toBe(computeEvidenceHash(withHyphens));
  });

  it('empty string has a defined hash', async () => {
    const { computeEvidenceHash } = await import('../regulatory-interpretation.js');
    const emptyHash = createHash('sha256').update('').digest('hex');
    expect(computeEvidenceHash('')).toBe(emptyHash);
  });

  it('admission gate uses computeEvidenceHash contract', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'regulatory-interpretation.ts'), 'utf-8'
    );
    // admitEvidence should call computeEvidenceHash, not raw createHash
    const admitSection = content.slice(
      content.indexOf('export async function admitEvidence'),
      content.indexOf('return { admitted: true')
    );
    expect(admitSection).toContain('computeEvidenceHash');
  });

  it('retrieval adapter uses same hashing approach', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'regulatory-retrieval.ts'), 'utf-8'
    );
    // Should hash operativeText directly (same contract)
    expect(content).toContain("createHash('sha256').update(parsed.operativeText)");
  });
});

describe('Legal-review rationale', () => {
  it('model-requested review gets a default reason', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');
    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'Test' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'Test' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Test' }],
      uncertainties: [],
      legalReviewRequired: true,     // Model set this
      legalReviewReason: undefined,   // But no reason
      confidence: 'HIGH' as const,
    };
    const result = enforceNoUnsupportedLegalConclusions(output);
    expect(output.legalReviewRequired).toBe(true);
    expect(output.legalReviewReason).toBeDefined();
    expect(output.legalReviewReason).toContain('Model flagged');
    expect(result.downgrades).toContain('Added missing legalReviewReason for model-requested review');
  });

  it('safety-gate-enforced review preserves its own reason', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');
    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'This is legally binding' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'Test' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Test' }],
      uncertainties: [],
      legalReviewRequired: false,
      confidence: 'HIGH' as const,
    };
    enforceNoUnsupportedLegalConclusions(output);
    expect(output.legalReviewRequired).toBe(true);
    expect(output.legalReviewReason).toContain('safety gate');
  });

  it('keyword-detected review preserves its own reason', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');
    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'Test' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'compliance requirements apply' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Test' }],
      uncertainties: [],
      legalReviewRequired: false,
      confidence: 'HIGH' as const,
    };
    enforceNoUnsupportedLegalConclusions(output);
    expect(output.legalReviewRequired).toBe(true);
    expect(output.legalReviewReason).toContain('Legal-adjacent');
  });

  it('existing model reason is not overwritten', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');
    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'Test' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'Test' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Test' }],
      uncertainties: [],
      legalReviewRequired: true,
      legalReviewReason: 'Model-provided specific reason',
      confidence: 'HIGH' as const,
    };
    enforceNoUnsupportedLegalConclusions(output);
    expect(output.legalReviewReason).toBe('Model-provided specific reason');
  });

  it('review not required leaves reason absent', async () => {
    const { enforceNoUnsupportedLegalConclusions } = await import('../regulatory-interpretation.js');
    const output = {
      sourceFacts: [{ category: 'SOURCE_FACT' as const, statement: 'Test' }],
      interpretations: [{ category: 'INTERPRETATION' as const, statement: 'Test' }],
      operationalImplications: [{ category: 'OPERATIONAL_IMPLICATION' as const, statement: 'Test' }],
      uncertainties: [],
      legalReviewRequired: false,
      confidence: 'HIGH' as const,
    };
    enforceNoUnsupportedLegalConclusions(output);
    expect(output.legalReviewRequired).toBe(false);
    expect(output.legalReviewReason).toBeUndefined();
  });
});
