/**
 * Maya Review Reliability Tests
 *
 * Regression tests for:
 * - Oversized researchRequests normalization
 * - Oversized rationale normalization
 * - Individual string truncation
 * - Failed review handling
 * - Schema validation after normalization
 */
import { describe, it, expect } from 'vitest';
import { MayaDecisionSchema } from '../task-processor.js';

/**
 * Simulate the normalization logic from task-processor.ts.
 * This duplicates the normalization for testability since the actual
 * code is embedded in processReviewTask's try block.
 */
function normalizeRawDecision(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...raw };

  if (typeof normalized.rationale === 'string' && (normalized.rationale as string).length > 800) {
    normalized.rationale = (normalized.rationale as string).slice(0, 797) + '...';
  }
  if (Array.isArray(normalized.researchRequests) && normalized.researchRequests.length > 2) {
    normalized.researchRequests = normalized.researchRequests.slice(0, 2);
  }
  if (Array.isArray(normalized.fitReasons) && normalized.fitReasons.length > 3) {
    normalized.fitReasons = normalized.fitReasons.slice(0, 3);
  }
  if (Array.isArray(normalized.concerns) && normalized.concerns.length > 3) {
    normalized.concerns = normalized.concerns.slice(0, 3);
  }
  if (Array.isArray(normalized.evidenceUsed) && normalized.evidenceUsed.length > 5) {
    normalized.evidenceUsed = normalized.evidenceUsed.slice(0, 5);
  }
  if (Array.isArray(normalized.missingInformation) && normalized.missingInformation.length > 3) {
    normalized.missingInformation = normalized.missingInformation.slice(0, 3);
  }
  for (const key of ['fitReasons', 'concerns', 'evidenceUsed', 'missingInformation']) {
    if (Array.isArray(normalized[key])) {
      normalized[key] = (normalized[key] as string[]).map((s) =>
        typeof s === 'string' && s.length > 200 ? s.slice(0, 197) + '...' : s
      );
    }
  }
  if (Array.isArray(normalized.researchRequests)) {
    for (const rr of normalized.researchRequests as any[]) {
      if (rr && typeof rr.reason === 'string' && rr.reason.length > 200) {
        rr.reason = rr.reason.slice(0, 197) + '...';
      }
    }
  }
  if (typeof normalized.acquisitionNature === 'string' && (normalized.acquisitionNature as string).length > 200) {
    normalized.acquisitionNature = (normalized.acquisitionNature as string).slice(0, 197) + '...';
  }

  return normalized;
}

const VALID_BASE = {
  recommendation: 'PASS' as const,
  confidence: 75,
  acquisitionNature: 'Enterprise data integration platform',
  fitReasons: ['VA agency experience'],
  concerns: ['Scope is data engineering'],
  evidenceUsed: ['RFI description text'],
  missingInformation: ['Full PWS not available'],
  researchRequests: [],
  rationale: 'Primary scope is enterprise data integration and API delivery, outside FFTC capabilities.',
};

describe('Maya Review Reliability', () => {
  describe('Normalization', () => {
    it('passes valid response unchanged', () => {
      const normalized = normalizeRawDecision({ ...VALID_BASE });
      const result = MayaDecisionSchema.parse(normalized);
      expect(result.recommendation).toBe('PASS');
      expect(result.rationale).toBe(VALID_BASE.rationale);
    });

    it('truncates rationale exceeding 800 chars', () => {
      const oversized = { ...VALID_BASE, rationale: 'x'.repeat(1200) };
      const normalized = normalizeRawDecision(oversized);
      expect((normalized.rationale as string).length).toBe(800);
      expect((normalized.rationale as string).endsWith('...')).toBe(true);
      // Must still validate
      const result = MayaDecisionSchema.parse(normalized);
      expect(result.rationale.length).toBe(800);
    });

    it('trims researchRequests exceeding max 2', () => {
      const oversized = {
        ...VALID_BASE,
        researchRequests: [
          { type: 'SAM_FOLLOWUP', reason: 'Check for amendments' },
          { type: 'SOLICITATION_DOCUMENT_REVIEW', reason: 'Review PWS' },
          { type: 'SOURCE_REFRESH', reason: 'Refresh data' },
          { type: 'ACQUISITION_CLARIFICATION', reason: 'Clarify type' },
        ],
      };
      const normalized = normalizeRawDecision(oversized);
      expect((normalized.researchRequests as unknown[]).length).toBe(2);
      const result = MayaDecisionSchema.parse(normalized);
      expect(result.researchRequests.length).toBe(2);
      expect(result.researchRequests[0].type).toBe('SAM_FOLLOWUP');
    });

    it('trims fitReasons exceeding max 3', () => {
      const oversized = {
        ...VALID_BASE,
        fitReasons: ['r1', 'r2', 'r3', 'r4', 'r5'],
      };
      const normalized = normalizeRawDecision(oversized);
      expect((normalized.fitReasons as string[]).length).toBe(3);
      MayaDecisionSchema.parse(normalized); // must not throw
    });

    it('truncates individual strings exceeding 200 chars', () => {
      const oversized = {
        ...VALID_BASE,
        fitReasons: ['x'.repeat(300)],
        concerns: ['y'.repeat(250)],
      };
      const normalized = normalizeRawDecision(oversized);
      expect((normalized.fitReasons as string[])[0].length).toBe(200);
      expect((normalized.concerns as string[])[0].length).toBe(200);
      MayaDecisionSchema.parse(normalized);
    });

    it('truncates acquisitionNature exceeding 200 chars', () => {
      const oversized = { ...VALID_BASE, acquisitionNature: 'z'.repeat(400) };
      const normalized = normalizeRawDecision(oversized);
      expect((normalized.acquisitionNature as string).length).toBe(200);
      MayaDecisionSchema.parse(normalized);
    });

    it('truncates research request reason exceeding 200 chars', () => {
      const oversized = {
        ...VALID_BASE,
        researchRequests: [
          { type: 'SAM_FOLLOWUP', reason: 'w'.repeat(500) },
        ],
      };
      const normalized = normalizeRawDecision(oversized);
      expect((normalized.researchRequests as any[])[0].reason.length).toBe(200);
      MayaDecisionSchema.parse(normalized);
    });
  });

  describe('Schema Validation', () => {
    it('rejects invalid recommendation value', () => {
      const invalid = { ...VALID_BASE, recommendation: 'PURSUE' };
      expect(() => MayaDecisionSchema.parse(invalid)).toThrow();
    });

    it('rejects confidence out of range', () => {
      expect(() => MayaDecisionSchema.parse({ ...VALID_BASE, confidence: 150 })).toThrow();
      expect(() => MayaDecisionSchema.parse({ ...VALID_BASE, confidence: -1 })).toThrow();
    });

    it('rejects invalid research request type', () => {
      const invalid = {
        ...VALID_BASE,
        researchRequests: [{ type: 'INVALID_TYPE', reason: 'test' }],
      };
      expect(() => MayaDecisionSchema.parse(invalid)).toThrow();
    });
  });

  describe('Failed Review Safety', () => {
    it('failed task does not produce a recommendation', () => {
      // Simulate the failed path: schema.parse throws, catch block marks failed
      const invalid = { ...VALID_BASE, recommendation: 'INVALID' };
      let decision = null;
      try {
        decision = MayaDecisionSchema.parse(invalid);
      } catch {
        decision = null;
      }
      expect(decision).toBeNull();
    });

    it('normalization handles missing fields gracefully', () => {
      // Model might return partial JSON
      const partial = { recommendation: 'PASS', confidence: 50 };
      const normalized = normalizeRawDecision(partial);
      // This should still fail schema validation (missing required fields)
      // but normalization itself should not throw
      expect(normalized.recommendation).toBe('PASS');
    });
  });

  describe('Idempotency', () => {
    it('processing the same valid response twice produces identical decisions', () => {
      const input = { ...VALID_BASE };
      const r1 = MayaDecisionSchema.parse(normalizeRawDecision({ ...input }));
      const r2 = MayaDecisionSchema.parse(normalizeRawDecision({ ...input }));
      expect(r1).toEqual(r2);
    });
  });
});
