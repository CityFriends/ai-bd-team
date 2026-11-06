/**
 * Batch Manifest Tests
 */
import { describe, it, expect } from 'vitest';
import {
  computeManifestDigest,
  createBatchManifest,
  validateBatchManifest,
} from '../notion/batch-manifest.js';
import type { BatchManifestEntry } from '../notion/publication-types.js';

const ENTRY_A: BatchManifestEntry = {
  knowledgePageId: 'aaaa-1111', notionPageId: 'np-a', title: 'Salary Band A', contentHash: 'hash-a',
};
const ENTRY_B: BatchManifestEntry = {
  knowledgePageId: 'bbbb-2222', notionPageId: 'np-b', title: 'Salary Band B', contentHash: 'hash-b',
};
const ENTRY_C: BatchManifestEntry = {
  knowledgePageId: 'cccc-3333', notionPageId: 'np-c', title: 'Step Increases', contentHash: 'hash-c',
};

describe('computeManifestDigest', () => {
  it('produces deterministic digest', () => {
    const d1 = computeManifestDigest([ENTRY_A, ENTRY_B]);
    const d2 = computeManifestDigest([ENTRY_A, ENTRY_B]);
    expect(d1).toBe(d2);
  });

  it('is order-independent (sorted by pageId)', () => {
    const d1 = computeManifestDigest([ENTRY_A, ENTRY_B]);
    const d2 = computeManifestDigest([ENTRY_B, ENTRY_A]);
    expect(d1).toBe(d2);
  });

  it('changes when content hash changes', () => {
    const modified = { ...ENTRY_A, contentHash: 'hash-modified' };
    const d1 = computeManifestDigest([ENTRY_A]);
    const d2 = computeManifestDigest([modified]);
    expect(d1).not.toBe(d2);
  });

  it('is NOT affected by title changes (security-irrelevant)', () => {
    const renamed = { ...ENTRY_A, title: 'Different Title' };
    const d1 = computeManifestDigest([ENTRY_A]);
    const d2 = computeManifestDigest([renamed]);
    expect(d1).toBe(d2); // title is not in the digest
  });
});

describe('createBatchManifest', () => {
  it('creates a valid manifest', () => {
    const m = createBatchManifest([ENTRY_A, ENTRY_B]);
    expect(m.batchId).toBeTruthy();
    expect(m.entries).toHaveLength(2);
    expect(m.manifestDigest).toBeTruthy();
    expect(m.createdAt).toBeTruthy();
  });

  it('throws on duplicate page IDs', () => {
    expect(() => createBatchManifest([ENTRY_A, ENTRY_A])).toThrow('Duplicate');
  });

  it('throws on empty entries', () => {
    expect(() => createBatchManifest([])).toThrow('at least one');
  });
});

describe('validateBatchManifest', () => {
  it('validates when all hashes match', () => {
    const m = createBatchManifest([ENTRY_A, ENTRY_B]);
    const current = new Map([
      ['aaaa-1111', 'hash-a'],
      ['bbbb-2222', 'hash-b'],
    ]);
    const errors = validateBatchManifest(m, current);
    expect(errors).toHaveLength(0);
  });

  it('detects changed page hash', () => {
    const m = createBatchManifest([ENTRY_A, ENTRY_B]);
    const current = new Map([
      ['aaaa-1111', 'hash-CHANGED'],
      ['bbbb-2222', 'hash-b'],
    ]);
    const errors = validateBatchManifest(m, current);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('hash mismatch');
  });

  it('detects missing page', () => {
    const m = createBatchManifest([ENTRY_A, ENTRY_B]);
    const current = new Map([['aaaa-1111', 'hash-a']]);
    const errors = validateBatchManifest(m, current);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not found');
  });

  it('detects null content hash', () => {
    const m = createBatchManifest([ENTRY_A]);
    const current = new Map<string, string | null>([['aaaa-1111', null]]);
    const errors = validateBatchManifest(m, current);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('no content hash');
  });

  it('detects tampered manifest digest', () => {
    const m = createBatchManifest([ENTRY_A]);
    const tampered = { ...m, manifestDigest: 'tampered-digest' };
    const current = new Map([['aaaa-1111', 'hash-a']]);
    const errors = validateBatchManifest(tampered, current);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('digest mismatch');
  });

  it('one changed page invalidates entire batch', () => {
    const m = createBatchManifest([ENTRY_A, ENTRY_B, ENTRY_C]);
    const current = new Map([
      ['aaaa-1111', 'hash-a'],
      ['bbbb-2222', 'hash-CHANGED'],
      ['cccc-3333', 'hash-c'],
    ]);
    const errors = validateBatchManifest(m, current);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('idempotent — validating twice gives same result', () => {
    const m = createBatchManifest([ENTRY_A]);
    const current = new Map([['aaaa-1111', 'hash-a']]);
    expect(validateBatchManifest(m, current)).toEqual(validateBatchManifest(m, current));
  });
});
