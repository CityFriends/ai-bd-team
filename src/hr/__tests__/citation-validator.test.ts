/**
 * HR Citation Validator Tests
 *
 * All tests use synthetic data only. No network, database, credential,
 * or SDK access. Pure-function validation against in-memory structures.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCitations,
  MAX_CITED_CHUNKS,
  MAX_AUTHORIZED_CHUNKS,
  MAX_CHUNK_ID_LENGTH,
  MAX_SOURCE_URL_LENGTH,
  MAX_TITLE_LENGTH,
  type AuthorizedChunk,
  type HRStructuredAnswer,
  type HRCitationValidationResult,
  type ResolvedCitation,
} from '../llm/citation-validator.js';
import { PROMPT_DELIMITERS } from '../llm/prompt-defense.js';

// ── Helpers ─────────────────────────────────────────────────

function makeChunk(overrides: Partial<AuthorizedChunk> & { chunkId: string }): AuthorizedChunk {
  return {
    title: 'PTO Policy',
    sourceUrl: 'https://notion.so/pto-policy-abc123',
    ...overrides,
  };
}

function makeAnswer(overrides?: Partial<HRStructuredAnswer>): HRStructuredAnswer {
  return {
    text: 'FFTC employees receive 15 days of PTO per year.',
    citedChunkIds: ['chunk-1'],
    ...overrides,
  };
}

const defaultChunks: AuthorizedChunk[] = [
  makeChunk({ chunkId: 'chunk-1' }),
];

// ============================================================
// 1. Valid Single Citation
// ============================================================

describe('validateCitations — valid answers', () => {
  it('1. accepts a valid single citation', () => {
    const result = validateCitations(makeAnswer(), defaultChunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.text).toBe('FFTC employees receive 15 days of PTO per year.');
      expect(result.answer.citations).toHaveLength(1);
      expect(result.answer.citations[0].chunkId).toBe('chunk-1');
      expect(result.answer.citations[0].sourceUrl).toBe('https://notion.so/pto-policy-abc123');
      expect(result.answer.citations[0].title).toBe('PTO Policy');
    }
  });

  // 2. Valid Multiple Citations
  it('2. accepts valid multiple citations', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1' }),
      makeChunk({ chunkId: 'chunk-2', title: 'Benefits', sourceUrl: 'https://notion.so/benefits-def456' }),
    ];
    const answer = makeAnswer({ citedChunkIds: ['chunk-1', 'chunk-2'] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations).toHaveLength(2);
      expect(result.answer.citations[0].chunkId).toBe('chunk-1');
      expect(result.answer.citations[1].chunkId).toBe('chunk-2');
    }
  });

  // 3. Repeated Model Citation IDs Deduplicated
  it('3. deduplicates repeated citation IDs preserving first occurrence', () => {
    const answer = makeAnswer({ citedChunkIds: ['chunk-1', 'chunk-1', 'chunk-1'] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations).toHaveLength(1);
      expect(result.answer.citations[0].chunkId).toBe('chunk-1');
    }
  });

  // 4. Citation Order Preserved
  it('4. preserves citation order from model output', () => {
    const chunks = [
      makeChunk({ chunkId: 'a' }),
      makeChunk({ chunkId: 'b', sourceUrl: 'https://notion.so/b' }),
      makeChunk({ chunkId: 'c', sourceUrl: 'https://notion.so/c' }),
    ];
    const answer = makeAnswer({ citedChunkIds: ['c', 'a', 'b'] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations.map((c) => c.chunkId)).toEqual(['c', 'a', 'b']);
    }
  });

  // 28. Normal HR Policy Titles Accepted
  it('28. accepts normal HR policy titles', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1', title: 'FFTC Employee Handbook — PTO & Leave Policy (2026)' }),
    ];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].title).toBe('FFTC Employee Handbook — PTO & Leave Policy (2026)');
    }
  });

  it('accepts chunk with empty title (returned as undefined)', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', title: '' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].title).toBeUndefined();
    }
  });

  it('accepts non-Notion HTTPS URLs', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://docs.company.com/policies/pto' }),
    ];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].sourceUrl).toBe('https://docs.company.com/policies/pto');
    }
  });
});

// ============================================================
// Rejection Tests
// ============================================================

describe('validateCitations — rejected answers', () => {
  // 5. Unknown Chunk ID Rejected
  it('5. rejects unknown chunk ID', () => {
    const answer = makeAnswer({ citedChunkIds: ['unknown-id'] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  // 6. Missing Citation Array Rejected
  it('6. rejects missing citation array', () => {
    const result = validateCitations({ text: 'Hello' }, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_citations');
  });

  // 7. Empty Citation Array Rejected
  it('7. rejects empty citation array', () => {
    const answer = makeAnswer({ citedChunkIds: [] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_citations');
  });

  // 8. Null Answer Rejected
  it('8. rejects null answer', () => {
    const result = validateCitations(null, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  // 9. Non-Object Answer Rejected
  it('9. rejects non-object answer (string)', () => {
    const result = validateCitations('just a string', defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  it('9b. rejects non-object answer (number)', () => {
    const result = validateCitations(42, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  it('9c. rejects non-object answer (array)', () => {
    const result = validateCitations(['text', 'chunk-1'], defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  it('9d. rejects undefined answer', () => {
    const result = validateCitations(undefined, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  // 10. Empty Answer Text Rejected
  it('10. rejects empty answer text', () => {
    const answer = makeAnswer({ text: '' });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  it('10b. rejects whitespace-only answer text', () => {
    const answer = makeAnswer({ text: '   \n  ' });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  // 11. Malformed Citation ID Rejected
  it('11. rejects malformed citation ID (empty string)', () => {
    const answer = makeAnswer({ citedChunkIds: [''] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('11b. rejects non-string citation ID', () => {
    const answer = { text: 'Answer', citedChunkIds: [123] };
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('11c. rejects whitespace-only citation ID', () => {
    const answer = makeAnswer({ citedChunkIds: ['   '] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  // 12. No Authorized Retrieval Chunks Rejected
  it('12. rejects when no authorized chunks provided', () => {
    const result = validateCitations(makeAnswer(), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_citations');
  });

  // 13. Malformed Source URL Rejected
  it('13. rejects malformed source URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'not-a-url' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  // 14. HTTP Source URL Rejected
  it('14. rejects HTTP source URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'http://notion.so/page' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  // 15. javascript: URL Rejected
  it('15. rejects javascript: URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'javascript:alert(1)' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  // 16. URL with Embedded Credentials Rejected
  it('16. rejects URL with embedded credentials', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://user:pass@notion.so/page' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  // 17. Localhost or Loopback Source Rejected
  it('17a. rejects localhost URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://localhost/page' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('17b. rejects 127.0.0.1 URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://127.0.0.1/page' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('17c. rejects IPv6 loopback URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://[::1]/page' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('17d. rejects 0.0.0.0 URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://0.0.0.0/page' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  // 18. Conflicting Duplicate Authorized Chunk IDs Rejected
  it('18. rejects conflicting duplicate chunk IDs in authorized set', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://notion.so/page-a' }),
      makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://notion.so/page-b' }),
    ];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('18b. allows identical duplicate chunk IDs in authorized set', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1' }),
      makeChunk({ chunkId: 'chunk-1' }), // same metadata
    ];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
  });

  // 19. Model-Supplied URL Cannot Override Retrieved URL
  it('19. model-supplied URL cannot override retrieved URL', () => {
    // The answer shape has no URL field — URLs come only from authorized chunks.
    // Verify that extra properties on the answer do not leak into the result.
    const answer = {
      text: 'PTO is 15 days.',
      citedChunkIds: ['chunk-1'],
      sourceUrl: 'https://evil.com/override', // should be ignored
    };
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].sourceUrl).toBe('https://notion.so/pto-policy-abc123');
      // The evil URL must not appear anywhere in the result
      expect(JSON.stringify(result)).not.toContain('evil.com');
    }
  });

  // 20. Internal Prompt Delimiter in Answer Rejected
  it('20. rejects answer containing internal prompt delimiter', () => {
    for (const delim of PROMPT_DELIMITERS) {
      const answer = makeAnswer({ text: `The policy is ${delim} leaked` });
      const result = validateCitations(answer, defaultChunks);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('unsafe_output');
    }
  });

  // 21. Synthetic Credential Artifact in Answer Rejected
  it('21. rejects answer containing credential artifact', () => {
    const answer = makeAnswer({ text: 'Use key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA for access' });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_output');
  });

  it('21b. rejects answer containing connection string', () => {
    const answer = makeAnswer({ text: 'Connect to postgresql://user:pass@host:5432/db' });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_output');
  });

  // 22. Rejected Results Do Not Echo Input Text or Source Metadata
  it('22. rejected result contains only ok and code', () => {
    const answer = makeAnswer({ citedChunkIds: ['nonexistent'] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const keys = Object.keys(result);
      expect(keys).toEqual(['ok', 'code']);
      expect(JSON.stringify(result)).not.toContain('FFTC');
      expect(JSON.stringify(result)).not.toContain('nonexistent');
      expect(JSON.stringify(result)).not.toContain('notion.so');
    }
  });

  it('22b. null answer error does not echo null', () => {
    const result = validateCitations(null, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result)).toEqual(['ok', 'code']);
    }
  });
});

// ============================================================
// Limit Enforcement
// ============================================================

describe('validateCitations — limits', () => {
  // 23. Excessive Citation Count Rejected
  it('23. rejects excessive citation count', () => {
    const ids = Array.from({ length: MAX_CITED_CHUNKS + 1 }, (_, i) => `chunk-${i}`);
    const chunks = ids.map((id) => makeChunk({ chunkId: id, sourceUrl: `https://notion.so/${id}` }));
    const answer = makeAnswer({ citedChunkIds: ids });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('23b. accepts exactly MAX_CITED_CHUNKS citations', () => {
    const ids = Array.from({ length: MAX_CITED_CHUNKS }, (_, i) => `chunk-${i}`);
    const chunks = ids.map((id) => makeChunk({ chunkId: id, sourceUrl: `https://notion.so/${id}` }));
    const answer = makeAnswer({ citedChunkIds: ids });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations).toHaveLength(MAX_CITED_CHUNKS);
    }
  });

  // 24. Excessive Authorized Chunk Count Rejected
  it('24. rejects excessive authorized chunk count', () => {
    const chunks = Array.from({ length: MAX_AUTHORIZED_CHUNKS + 1 }, (_, i) =>
      makeChunk({ chunkId: `chunk-${i}`, sourceUrl: `https://notion.so/${i}` }),
    );
    const answer = makeAnswer({ citedChunkIds: ['chunk-0'] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  it('24b. accepts exactly MAX_AUTHORIZED_CHUNKS chunks', () => {
    const chunks = Array.from({ length: MAX_AUTHORIZED_CHUNKS }, (_, i) =>
      makeChunk({ chunkId: `chunk-${i}`, sourceUrl: `https://notion.so/${i}` }),
    );
    const answer = makeAnswer({ citedChunkIds: ['chunk-0'] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
  });

  // 25. Excessive Chunk ID Length Rejected
  it('25. rejects excessive chunk ID length', () => {
    const longId = 'x'.repeat(MAX_CHUNK_ID_LENGTH + 1);
    const answer = makeAnswer({ citedChunkIds: [longId] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('25b. accepts chunk ID at exactly MAX_CHUNK_ID_LENGTH', () => {
    const exactId = 'x'.repeat(MAX_CHUNK_ID_LENGTH);
    const chunks = [makeChunk({ chunkId: exactId })];
    const answer = makeAnswer({ citedChunkIds: [exactId] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
  });

  // 26. Excessive Source URL Length Rejected
  it('26. rejects excessive source URL length', () => {
    const longUrl = 'https://notion.so/' + 'a'.repeat(MAX_SOURCE_URL_LENGTH);
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: longUrl })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  // 27. Excessive Title Length Handled Safely
  it('27. rejects excessive title length', () => {
    const longTitle = 'T'.repeat(MAX_TITLE_LENGTH + 1);
    const chunks = [makeChunk({ chunkId: 'chunk-1', title: longTitle })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('27b. accepts title at exactly MAX_TITLE_LENGTH', () => {
    const exactTitle = 'T'.repeat(MAX_TITLE_LENGTH);
    const chunks = [makeChunk({ chunkId: 'chunk-1', title: exactTitle })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// Pure-Function & Security Properties
// ============================================================

describe('validateCitations — pure-function behavior', () => {
  // 29. No Mutation of Supplied Objects
  it('29. does not mutate supplied answer or chunks', () => {
    const answer = makeAnswer({ citedChunkIds: ['chunk-1', 'chunk-1'] });
    const chunks = [makeChunk({ chunkId: 'chunk-1' })];

    const answerSnapshot = JSON.stringify(answer);
    const chunksSnapshot = JSON.stringify(chunks);

    validateCitations(answer, chunks);

    expect(JSON.stringify(answer)).toBe(answerSnapshot);
    expect(JSON.stringify(chunks)).toBe(chunksSnapshot);
  });

  // 30. No Database, Network, Logging, or SDK Calls
  it('30. completes synchronously and fast (pure function)', () => {
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      validateCitations(makeAnswer(), defaultChunks);
    }
    const elapsed = Date.now() - t0;
    // 1000 iterations of a pure function should be well under 100ms
    expect(elapsed).toBeLessThan(200);
  });

  it('returns a new result object each call', () => {
    const r1 = validateCitations(makeAnswer(), defaultChunks);
    const r2 = validateCitations(makeAnswer(), defaultChunks);
    expect(r1).not.toBe(r2);
    expect(r1).toEqual(r2);
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe('validateCitations — edge cases', () => {
  it('rejects non-array authorized chunks', () => {
    const result = validateCitations(makeAnswer(), 'not-an-array' as unknown as AuthorizedChunk[]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_answer');
  });

  it('rejects data: URL scheme', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'data:text/html,<h1>hi</h1>' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('rejects ftp: URL scheme', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'ftp://files.example.com/doc' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('rejects file: URL scheme', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'file:///etc/passwd' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('rejects authorized chunk with non-string title', () => {
    const chunks = [{ chunkId: 'chunk-1', title: 42, sourceUrl: 'https://notion.so/page' }] as unknown as AuthorizedChunk[];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('rejects authorized chunk with empty chunkId', () => {
    const chunks = [makeChunk({ chunkId: '' })];
    const result = validateCitations(makeAnswer({ citedChunkIds: [''] }), chunks);
    expect(result.ok).toBe(false);
  });

  it('rejects authorized chunk with excessively long chunkId', () => {
    const longId = 'z'.repeat(MAX_CHUNK_ID_LENGTH + 1);
    const chunks = [makeChunk({ chunkId: longId })];
    // The cited ID is checked first and rejected before authorized chunk validation
    const result = validateCitations(makeAnswer({ citedChunkIds: [longId] }), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('partial invalid citation rejects entire answer', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1' }),
    ];
    const answer = makeAnswer({ citedChunkIds: ['chunk-1', 'chunk-missing'] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('handles Notion deep-link URLs with fragment', () => {
    const chunks = [
      makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://notion.so/pto-policy-abc123#block-def456' }),
    ];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].sourceUrl).toContain('#block-def456');
    }
  });

  it('rejects empty source URL', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: '' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_source');
  });

  it('deduplication with mixed valid/invalid yields rejection', () => {
    // First ID valid, second invalid — even though first is dup of second's
    // non-existent target, the unknown second ID causes rejection
    const answer = makeAnswer({ citedChunkIds: ['chunk-1', 'nonexistent'] });
    const result = validateCitations(answer, defaultChunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('accepts URL with port number', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://docs.example.com:8443/policy' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
  });

  it('accepts URL with query parameters', () => {
    const chunks = [makeChunk({ chunkId: 'chunk-1', sourceUrl: 'https://notion.so/page?v=abc123' })];
    const result = validateCitations(makeAnswer(), chunks);
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// UUID-Format Chunk ID Integration (C8X-57)
// ============================================================

describe('validateCitations — UUID chunk IDs', () => {
  it('UUID1. accepts realistic UUID-formatted chunk IDs', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const chunks = [makeChunk({ chunkId: uuid })];
    const answer = makeAnswer({ citedChunkIds: [uuid] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].chunkId).toBe(uuid);
    }
  });

  it('UUID2. multiple UUID citations in deterministic order', () => {
    const id1 = 'aaaaaaaa-1111-2222-3333-444444444444';
    const id2 = 'bbbbbbbb-5555-6666-7777-888888888888';
    const id3 = 'cccccccc-9999-aaaa-bbbb-cccccccccccc';
    const chunks = [
      makeChunk({ chunkId: id1, sourceUrl: 'https://notion.so/a' }),
      makeChunk({ chunkId: id2, sourceUrl: 'https://notion.so/b' }),
      makeChunk({ chunkId: id3, sourceUrl: 'https://notion.so/c' }),
    ];
    const answer = makeAnswer({ citedChunkIds: [id3, id1, id2] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations.map((c) => c.chunkId)).toEqual([id3, id1, id2]);
    }
  });

  it('UUID3. unknown UUID citation rejected', () => {
    const knownId = '550e8400-e29b-41d4-a716-446655440000';
    const unknownId = 'deadbeef-dead-beef-dead-beefdeadbeef';
    const chunks = [makeChunk({ chunkId: knownId })];
    const answer = makeAnswer({ citedChunkIds: [unknownId] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_citation');
  });

  it('UUID4. Notion deep-link URLs matching retrieval URL construction', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    // URL shape matches buildCitation: pageUrl#blockIdWithoutDashes
    const chunks = [makeChunk({
      chunkId: uuid,
      title: 'PTO Policy',
      sourceUrl: 'https://notion.so/pto-policy-abc123def456#block789ghi',
    })];
    const answer = makeAnswer({ citedChunkIds: [uuid] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.citations[0].sourceUrl).toContain('#block789ghi');
      expect(result.answer.citations[0].title).toBe('PTO Policy');
    }
  });

  it('UUID5. answer text at MAX_OUTPUT boundary accepted', () => {
    const uuid = '22222222-3333-4444-5555-666666666666';
    const chunks = [makeChunk({ chunkId: uuid })];
    // MAX_OUTPUT_CODE_POINTS is 8000 (from prompt-defense.ts)
    const longText = 'A'.repeat(8000);
    const answer = makeAnswer({ text: longText, citedChunkIds: [uuid] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.text).toHaveLength(8000);
    }
  });

  it('UUID5b. answer text exceeding MAX_OUTPUT boundary rejected', () => {
    const uuid = '33333333-4444-5555-6666-777777777777';
    const chunks = [makeChunk({ chunkId: uuid })];
    const overText = 'A'.repeat(8001);
    const answer = makeAnswer({ text: overText, citedChunkIds: [uuid] });
    const result = validateCitations(answer, chunks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_output');
  });
});
