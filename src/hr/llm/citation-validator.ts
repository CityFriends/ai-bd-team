/**
 * HR Citation Validator — Pure Membership + Safety Check
 *
 * Validates that a structured LLM answer references only chunk IDs
 * present in the authorized retrieval set. Resolves citation metadata
 * (URLs, titles) exclusively from the retrieval set — never from
 * model output.
 *
 * Security contract:
 *   - The caller MUST supply only chunks returned by the authorization-
 *     aware HR retrieval path. This validator does not independently
 *     verify authorization or query the database.
 *   - Citation membership proves the chunk was retrieved, NOT that the
 *     answer text is factually grounded in the cited chunk.
 *
 * Pure function. No network, database, logging, SDK, or env access.
 */

import { validateHROutput } from './prompt-defense.js';

// ── Limits ──────────────────────────────────────────────────

/** Maximum cited chunk IDs the model may reference in one answer. */
export const MAX_CITED_CHUNKS = 20;

/** Maximum authorized chunks accepted per validation call. */
export const MAX_AUTHORIZED_CHUNKS = 100;

/** Maximum byte length of a single chunk ID. */
export const MAX_CHUNK_ID_LENGTH = 256;

/** Maximum byte length of a source URL. */
export const MAX_SOURCE_URL_LENGTH = 2048;

/** Maximum byte length of a citation title. */
export const MAX_TITLE_LENGTH = 512;

// ── Input Types ─────────────────────────────────────────────

/**
 * Minimal representation of an authorized retrieval chunk.
 * Fields mirror the existing `RetrievedChunk.citation` shape in
 * `src/hr/notion/retrieval.ts`.
 */
export interface AuthorizedChunk {
  /** Unique chunk identifier from retrieval. */
  chunkId: string;
  /** Page/document title. */
  title: string;
  /** Trusted source URL resolved by retrieval. */
  sourceUrl: string;
}

/**
 * Structured answer produced by the LLM.
 * The model references chunk IDs; the application resolves URLs.
 */
export interface HRStructuredAnswer {
  text: string;
  citedChunkIds: string[];
}

// ── Result Types ────────────────────────────────────────────

export interface ResolvedCitation {
  chunkId: string;
  sourceUrl: string;
  title?: string;
}

export type HRCitationValidationResult =
  | {
      ok: true;
      answer: {
        text: string;
        citations: ResolvedCitation[];
      };
    }
  | {
      ok: false;
      code:
        | 'invalid_answer'
        | 'missing_citations'
        | 'invalid_citation'
        | 'invalid_source'
        | 'unsafe_output';
    };

// ── URL Validation ──────────────────────────────────────────

/**
 * Validate a source URL from the authorized retrieval set.
 * Rejects non-HTTPS, embedded credentials, localhost/loopback,
 * and malformed URLs. Does not fetch.
 */
function isValidSourceUrl(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SOURCE_URL_LENGTH) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  // HTTPS only
  if (parsed.protocol !== 'https:') {
    return false;
  }

  // Reject embedded credentials
  if (parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  // Reject localhost and loopback
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    return false;
  }

  return true;
}

// ── Validator ───────────────────────────────────────────────

/**
 * Validate a structured LLM answer against authorized retrieval chunks.
 *
 * Pure function — returns a discriminated result.
 * Never mutates inputs. Never logs content or metadata.
 */
export function validateCitations(
  answer: unknown,
  authorizedChunks: readonly AuthorizedChunk[]
): HRCitationValidationResult {
  // ── Guard: authorized chunks ──────────────────────────────

  if (!Array.isArray(authorizedChunks)) {
    return { ok: false, code: 'invalid_answer' };
  }

  if (authorizedChunks.length === 0) {
    // Fail closed — no chunks means no valid citation possible.
    return { ok: false, code: 'missing_citations' };
  }

  if (authorizedChunks.length > MAX_AUTHORIZED_CHUNKS) {
    return { ok: false, code: 'invalid_answer' };
  }

  // ── Guard: answer shape ───────────────────────────────────

  if (
    answer === null ||
    answer === undefined ||
    typeof answer !== 'object' ||
    Array.isArray(answer)
  ) {
    return { ok: false, code: 'invalid_answer' };
  }

  const ans = answer as Record<string, unknown>;

  if (typeof ans.text !== 'string' || ans.text.trim().length === 0) {
    return { ok: false, code: 'invalid_answer' };
  }

  if (!Array.isArray(ans.citedChunkIds)) {
    return { ok: false, code: 'missing_citations' };
  }

  const citedIds = ans.citedChunkIds as unknown[];

  if (citedIds.length === 0) {
    return { ok: false, code: 'missing_citations' };
  }

  // ── Validate individual chunk IDs ─────────────────────────

  for (const id of citedIds) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { ok: false, code: 'invalid_citation' };
    }
    if (id.length > MAX_CHUNK_ID_LENGTH) {
      return { ok: false, code: 'invalid_citation' };
    }
  }

  // Enforce citation count after deduplication intent check
  if (citedIds.length > MAX_CITED_CHUNKS) {
    return { ok: false, code: 'invalid_citation' };
  }

  // ── Build authorized lookup, detect conflicting duplicates ─

  const chunkMap = new Map<string, AuthorizedChunk>();

  for (const chunk of authorizedChunks) {
    if (
      typeof chunk.chunkId !== 'string' ||
      chunk.chunkId.trim().length === 0 ||
      chunk.chunkId.length > MAX_CHUNK_ID_LENGTH
    ) {
      return { ok: false, code: 'invalid_source' };
    }

    const existing = chunkMap.get(chunk.chunkId);
    if (existing) {
      // Conflicting duplicate: same ID, different metadata
      if (existing.sourceUrl !== chunk.sourceUrl || existing.title !== chunk.title) {
        return { ok: false, code: 'invalid_source' };
      }
      // Identical duplicate — skip silently
      continue;
    }

    // Validate source URL
    if (!isValidSourceUrl(chunk.sourceUrl)) {
      return { ok: false, code: 'invalid_source' };
    }

    // Validate title length
    if (typeof chunk.title !== 'string') {
      return { ok: false, code: 'invalid_source' };
    }
    if (chunk.title.length > MAX_TITLE_LENGTH) {
      return { ok: false, code: 'invalid_source' };
    }

    chunkMap.set(chunk.chunkId, chunk);
  }

  // ── Output safety check ───────────────────────────────────

  const outputCheck = validateHROutput(ans.text as string);
  if (!outputCheck.ok) {
    return { ok: false, code: 'unsafe_output' };
  }

  // ── Resolve citations (deduplicate, preserve order) ───────

  const seen = new Set<string>();
  const citations: ResolvedCitation[] = [];

  for (const id of citedIds as string[]) {
    if (seen.has(id)) {
      continue; // Deduplicate — first occurrence wins
    }
    seen.add(id);

    const chunk = chunkMap.get(id);
    if (!chunk) {
      // Chunk ID not in authorized set — reject entire answer
      return { ok: false, code: 'invalid_citation' };
    }

    citations.push({
      chunkId: chunk.chunkId,
      sourceUrl: chunk.sourceUrl,
      title: chunk.title || undefined,
    });
  }

  return {
    ok: true,
    answer: {
      text: outputCheck.text,
      citations,
    },
  };
}
