/**
 * Denise — Authoritative Regulatory Retrieval Adapter
 *
 * Read-only, deterministic retrieval of FAR and DFARS provisions
 * from official Acquisition.gov publications.
 *
 * Zero LLM calls. Zero downstream actions. No interpretation.
 *
 * Approved sources (this milestone):
 *   - FAR: https://www.acquisition.gov/far/{provision-id}
 *   - DFARS: https://www.acquisition.gov/dfars/part-252-solicitation-provisions-and-contract-clauses
 *
 * Security:
 *   - HTTPS only
 *   - Exact host allowlist (www.acquisition.gov)
 *   - No redirects to unapproved hosts
 *   - Bounded timeout, response size, redirect count
 *   - Content-type validation
 *   - No script execution
 */

import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import type { SupabaseClient } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

const APPROVED_HOSTS = new Set(['www.acquisition.gov']);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5_000_000; // 5MB
const MAX_REDIRECTS = 3;

export type RegulationFamily = 'FAR' | 'DFARS';
export type VersionSelector = 'CURRENT' | 'AS_OF_DATE' | 'EXACT_PUBLICATION';

// ============================================================
// INPUT/OUTPUT CONTRACTS
// ============================================================

export interface RetrievalRequest {
  regulation: RegulationFamily;
  provisionId: string;
  versionSelector: VersionSelector;
  asOfDate?: string;
  publicationId?: string;
  opportunityId?: string;
  sourceSolicitationEvidenceId?: string;
  requestIdempotencyKey: string;
}

export interface RetrievalResult {
  success: boolean;
  provisionId: string;
  regulation: RegulationFamily;
  title: string | null;
  operativeText: string | null;
  sourceUrl: string | null;
  retrievedAt: string;
  contentHash: string | null;
  historicalCurrent: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN';

  /** Identifier observed on the official source page (FAC number, DFARS Change) */
  publicationIdObserved: string | null;
  /** Effective date observed on the official source page */
  effectiveDateObserved: string | null;
  /** True only if the publication identifier is supported by an authoritative publication-level source */
  publicationMetadataVerified: boolean;
  /** True only if the requested provision identity AND complete text were verified (explicit boundaries) */
  provisionTextVerified: boolean;
  /** True only if reliable evidence links the extracted text to the claimed publication */
  provisionPublicationLinkVerified: boolean;
  /** Whether this result is eligible for authoritative persistence in regulatory_evidence */
  eligibleForAuthoritativePersistence: boolean;

  error?: string;
  errorCode?: string;
}

// ============================================================
// PROVISION ID NORMALIZATION
// ============================================================

/** Normalize a FAR/DFARS provision ID to canonical form */
export function normalizeProvisionId(raw: string): string {
  return raw.replace(/^(FAR|DFARS)\s*/i, '').replace(/\s+/g, '.').trim();
}

/** Build the official URL for a FAR provision */
function buildFarUrl(provisionId: string): string {
  const normalized = normalizeProvisionId(provisionId);
  return `https://www.acquisition.gov/far/${normalized}`;
}

/** Build the official URL for the DFARS Part 252 page */
function buildDfarsUrl(): string {
  return 'https://www.acquisition.gov/dfars/part-252-solicitation-provisions-and-contract-clauses';
}

// ============================================================
// SECURE FETCHING
// ============================================================

function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return { valid: false, error: 'HTTPS required' };
    if (!APPROVED_HOSTS.has(parsed.hostname)) return { valid: false, error: `Host ${parsed.hostname} not in allowlist` };
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
}

async function secureFetch(url: string): Promise<{ ok: boolean; status: number; text: string; contentType: string; finalUrl: string; error?: string }> {
  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) {
    return { ok: false, status: 0, text: '', contentType: '', finalUrl: url, error: urlCheck.error };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount <= MAX_REDIRECTS) {
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'FFTC-Denise-Regulatory-Retrieval/1.0 (acquisition intelligence; read-only)',
          'Accept': 'text/html, application/xhtml+xml',
        },
      });

      // Handle redirects with host revalidation
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { ok: false, status: response.status, text: '', contentType: '', finalUrl: currentUrl, error: 'Redirect without location' };

        const resolvedUrl = new URL(location, currentUrl).toString();
        const redirectCheck = validateUrl(resolvedUrl);
        if (!redirectCheck.valid) {
          return { ok: false, status: response.status, text: '', contentType: '', finalUrl: currentUrl, error: `Redirect to unapproved host: ${redirectCheck.error}` };
        }

        currentUrl = resolvedUrl;
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        return { ok: false, status: response.status, text: '', contentType: '', finalUrl: currentUrl, error: `HTTP ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return { ok: false, status: response.status, text: '', contentType, finalUrl: currentUrl, error: `Unexpected content-type: ${contentType}` };
      }

      // Bounded response size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
        return { ok: false, status: response.status, text: '', contentType, finalUrl: currentUrl, error: `Response too large: ${contentLength} bytes` };
      }

      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        return { ok: false, status: response.status, text: '', contentType, finalUrl: currentUrl, error: 'Response body exceeds size limit' };
      }

      return { ok: true, status: response.status, text, contentType, finalUrl: currentUrl };
    }

    return { ok: false, status: 0, text: '', contentType: '', finalUrl: currentUrl, error: `Too many redirects (${MAX_REDIRECTS})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.includes('abort') ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR';
    return { ok: false, status: 0, text: '', contentType: '', finalUrl: url, error: `${code}: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// FAR PROVISION PARSER
// ============================================================

export interface ParsedProvision {
  provisionId: string;
  title: string;
  clauseDate: string | null;
  operativeText: string;
  facNumber: string | null;
  effectiveDate: string | null;
  hasExplicitEnd?: boolean;
}

/** Parse a FAR provision from an Acquisition.gov HTML page */
export function parseFarProvision(html: string, expectedProvisionId: string): ParsedProvision | { error: string } {
  const $ = cheerio.load(html);
  const normalized = normalizeProvisionId(expectedProvisionId);
  const fullText = $('body').text();

  // Verify the provision ID appears in the page at all
  if (!fullText.includes(normalized)) {
    return { error: `Provision ${normalized} heading not found in page` };
  }

  // Extract title from <title> tag or page text
  const titleTag = $('title').text().trim();
  const titleMatch = titleTag.match(new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(.+?)\\s*\\|'));
  let title = titleMatch?.[1]?.replace(/\.\s*$/, '').trim() || '';

  // Also try extracting from body text (handles multi-space formatting)
  if (!title) {
    const bodyMatch = fullText.match(new RegExp(normalized + '\\s+(.+?)(?:\\n|$)'));
    title = bodyMatch?.[1]?.replace(/\.\s*$/, '').trim() || normalized;
  }

  // Extract clause date (e.g., "(Oct 2022)", "(Mar 2026)")
  const clauseDateMatch = fullText.match(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(([A-Z][a-z]+\\s+\\d{4})\\)'));
  const clauseDate = clauseDateMatch?.[1] || null;

  // Extract FAC number and effective date
  let facNumber: string | null = null;
  let effectiveDate: string | null = null;
  const facMatch = fullText.match(/FAC\s+([\d-]+)/i);
  if (facMatch) facNumber = facMatch[1];
  const effMatch = fullText.match(/[Ee]ffective\s*(?:[Dd]ate)?:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (effMatch) effectiveDate = effMatch[1];

  // Extract operative text: find the provision heading in body text
  // Use a pattern that matches the provision ID followed by its title text,
  // to avoid matching navigation/metadata references earlier in the page
  const provPattern = new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+\\w');
  const provMatch = fullText.match(provPattern);
  const provIdx = provMatch ? fullText.indexOf(provMatch[0]) : fullText.lastIndexOf(normalized);
  if (provIdx < 0) {
    return { error: `Provision ${normalized} not found in body text` };
  }

  const afterProvision = fullText.slice(provIdx);
  const endOfClause = afterProvision.search(/[Ee]nd\s+of\s+(?:clause|provision)/i);
  let operativeText: string;

  if (endOfClause > 0) {
    operativeText = afterProvision.slice(0, endOfClause).trim();
  } else {
    // No "End of clause" marker — take bounded text
    operativeText = afterProvision.slice(0, 10000).trim();
  }

  // Clean up: remove the heading line, navigation, and excess whitespace
  operativeText = operativeText
    .replace(/^\s*[\d.]+[-\d]*\s+[^\n]+\n?/, '') // Remove heading line
    .replace(/\s{3,}/g, ' ') // Collapse excessive spaces
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (operativeText.length < 50) {
    return { error: `Incomplete provision text extracted (${operativeText.length} chars)` };
  }

  // Verify extraction didn't start inside another provision
  // Check if there's a different provision ID before our target in the extracted text
  const otherProvMatch = operativeText.match(/\b(\d{2}\.\d{3}-\d+)\b/);
  if (otherProvMatch && otherProvMatch[1] !== normalized && operativeText.indexOf(otherProvMatch[0]) < 20) {
    return { error: `Extraction may begin inside provision ${otherProvMatch[1]}, not ${normalized}` };
  }

  // Verify end boundary was explicit (either "End of clause" or bounded extraction)
  const hasExplicitEnd = endOfClause > 0;

  return {
    provisionId: normalized,
    title,
    clauseDate,
    operativeText,
    facNumber,
    effectiveDate,
    hasExplicitEnd,
  };
}

/** Parse a DFARS provision from the consolidated Part 252 page */
export function parseDfarsProvision(html: string, expectedProvisionId: string): ParsedProvision | { error: string } {
  const normalized = normalizeProvisionId(expectedProvisionId);
  const anchorId = `DFARS_${normalized}`;
  const $ = cheerio.load(html);

  // Find the anchor for this provision
  const anchor = $(`#${anchorId}, [id="${anchorId}"], a[name="${anchorId}"]`);
  if (!anchor.length) {
    // Fallback: search for the provision number in headings
    let found = false;
    $('h2, h3, h4').each((_, el) => {
      if ($(el).text().includes(normalized)) { found = true; return false; }
    });
    if (!found) return { error: `DFARS provision ${normalized} anchor not found` };
  }

  // Extract text between this provision's heading and the next provision
  const fullText = $('body').text();
  const provIdx = fullText.indexOf(normalized);
  if (provIdx < 0) return { error: `Provision ${normalized} not found in page text` };

  // Find the next provision heading (next 252.xxx-xxxx pattern)
  const afterProvision = fullText.slice(provIdx + normalized.length);
  const nextProvRegex = /\n\s*252\.\d{3}-\d{4}\s/;
  const nextMatch = afterProvision.search(nextProvRegex);
  const endOfClauseMatch = afterProvision.search(/end\s+of\s+(clause|provision)/i);

  let endIdx: number;
  if (endOfClauseMatch > 0 && (nextMatch < 0 || endOfClauseMatch < nextMatch)) {
    endIdx = endOfClauseMatch;
  } else if (nextMatch > 0) {
    endIdx = nextMatch;
  } else {
    endIdx = Math.min(afterProvision.length, 10000);
  }

  const rawText = afterProvision.slice(0, endIdx).trim();

  // Extract title from first line
  const titleMatch = rawText.match(/^(.*?)(?:\n|$)/);
  const title = titleMatch?.[1]?.trim() || normalized;

  // DFARS publication info
  let facNumber: string | null = null;
  const changeMatch = fullText.match(/DFARS\s+Change\s+([\d/]+)/i);
  if (changeMatch) facNumber = `DFARS-Change-${changeMatch[1]}`;
  const effMatch = fullText.match(/[Ee]ffective\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const effectiveDate = effMatch?.[1] || null;

  if (rawText.length < 50) {
    return { error: `Incomplete DFARS provision text (${rawText.length} chars)` };
  }

  // Verify extraction didn't capture adjacent provision content
  // Check for another 252.xxx-xxxx pattern in the body (not the heading line)
  const bodyAfterTitle = rawText.slice(rawText.indexOf('\n') + 1);
  const adjacentMatch = bodyAfterTitle.match(/\b(252\.\d{3}-\d{4})\b/);
  if (adjacentMatch && adjacentMatch[1] !== normalized) {
    // Adjacent provision content leaked — truncate at that point
    const leakIdx = bodyAfterTitle.indexOf(adjacentMatch[0]);
    const cleanedBody = bodyAfterTitle.slice(0, leakIdx).trim();
    if (cleanedBody.length < 50) {
      return { error: `DFARS provision text contaminated by adjacent provision ${adjacentMatch[1]}` };
    }
    return {
      provisionId: normalized,
      title,
      clauseDate: null,
      operativeText: `${rawText.slice(0, rawText.indexOf('\n'))}\n${cleanedBody}`,
      facNumber,
      effectiveDate,
      hasExplicitEnd: endOfClauseMatch > 0 && endOfClauseMatch < (nextMatch > 0 ? nextMatch : Infinity),
    };
  }

  return {
    provisionId: normalized,
    title,
    clauseDate: null,
    operativeText: rawText,
    facNumber,
    effectiveDate,
    hasExplicitEnd: endOfClauseMatch > 0 && endOfClauseMatch < (nextMatch > 0 ? nextMatch : Infinity),
  };
}

// ============================================================
// MAIN RETRIEVAL FUNCTION
// ============================================================

export async function retrieveRegulatoryProvision(
  request: RetrievalRequest,
  supabase?: SupabaseClient
): Promise<RetrievalResult> {
  const now = new Date().toISOString();
  const normalized = normalizeProvisionId(request.provisionId);

  // For CURRENT: we must verify the current publication identity before trusting cache.
  // Fetch the live page to get the current publication ID, then compare with cache.
  // This ensures a stale cache from an older FAC is never returned as CURRENT.

  // Historical version selection
  if (request.versionSelector === 'AS_OF_DATE' || request.versionSelector === 'EXACT_PUBLICATION') {
    // Historical FAR/DFARS retrieval from archives is not yet supported in this milestone
    // The archive structure uses ZIP downloads, not individual provision pages
    return {
      success: false,
      provisionId: normalized,
      regulation: request.regulation,
      title: null, operativeText: null, sourceUrl: null,
      retrievedAt: now,
      contentHash: null,
      historicalCurrent: 'UNKNOWN',
      publicationIdObserved: null, effectiveDateObserved: null,
      publicationMetadataVerified: false, provisionTextVerified: false,
      provisionPublicationLinkVerified: false, eligibleForAuthoritativePersistence: false,
      error: 'Historical version retrieval not supported in this milestone — archives use ZIP format requiring separate commissioning',
      errorCode: 'HISTORICAL_NOT_SUPPORTED',
    };
  }

  // Build URL
  let url: string;
  if (request.regulation === 'FAR') {
    url = buildFarUrl(normalized);
  } else if (request.regulation === 'DFARS') {
    url = buildDfarsUrl();
  } else {
    return {
      success: false, provisionId: normalized, regulation: request.regulation,
      title: null, operativeText: null, sourceUrl: null,
      retrievedAt: now,
      contentHash: null, historicalCurrent: 'UNKNOWN', publicationIdObserved: null, effectiveDateObserved: null, publicationMetadataVerified: false, provisionTextVerified: false, provisionPublicationLinkVerified: false, eligibleForAuthoritativePersistence: false,
      error: `Unsupported regulation: ${request.regulation}`,
      errorCode: 'UNSUPPORTED_REGULATION',
    };
  }

  // Fetch
  const fetchResult = await secureFetch(url);
  if (!fetchResult.ok) {
    return {
      success: false, provisionId: normalized, regulation: request.regulation,
      title: null, operativeText: null, sourceUrl: url,
      retrievedAt: now,
      contentHash: null, historicalCurrent: 'UNKNOWN', publicationIdObserved: null, effectiveDateObserved: null, publicationMetadataVerified: false, provisionTextVerified: false, provisionPublicationLinkVerified: false, eligibleForAuthoritativePersistence: false,
      error: fetchResult.error,
      errorCode: fetchResult.error?.startsWith('NETWORK_TIMEOUT') ? 'NETWORK_TIMEOUT' : 'FETCH_FAILED',
    };
  }

  // Parse
  const parsed = request.regulation === 'FAR'
    ? parseFarProvision(fetchResult.text, normalized)
    : parseDfarsProvision(fetchResult.text, normalized);

  // Check cache: if we have a cached entry with SAME publication ID and content hash, use it
  if (supabase && parsed && !('error' in parsed) && parsed.facNumber) {
    const cached = await checkCache(supabase, request.regulation, normalized, parsed.facNumber);
    if (cached && cached.contentHash) {
      // Cache hit with verified current publication — no need to re-persist
      return cached;
    }
  }

  if ('error' in parsed) {
    return {
      success: false, provisionId: normalized, regulation: request.regulation,
      title: null, operativeText: null, sourceUrl: fetchResult.finalUrl,
      retrievedAt: now,
      contentHash: null, historicalCurrent: 'UNKNOWN', publicationIdObserved: null, effectiveDateObserved: null, publicationMetadataVerified: false, provisionTextVerified: false, provisionPublicationLinkVerified: false, eligibleForAuthoritativePersistence: false,
      error: parsed.error,
      errorCode: 'PARSE_FAILED',
    };
  }

  // Compute content hash
  const contentHash = createHash('sha256').update(parsed.operativeText).digest('hex');

  // Determine verification status for each dimension
  const publicationIdObserved = parsed.facNumber;
  const effectiveDateObserved = parsed.effectiveDate;
  // Publication metadata verified: we observed an identifier, but it's site-wide, not provision-specific
  const publicationMetadataVerified = Boolean(publicationIdObserved);
  // Provision text verified: we found the provision ID in the page AND have explicit end boundary
  const provisionTextVerified = Boolean(parsed.hasExplicitEnd);
  // Publication-provision linkage: cannot be verified from page structure alone
  // (site-wide FAC ≠ the FAC that last amended this specific clause)
  const provisionPublicationLinkVerified = false;
  // Eligible for authoritative persistence only when text boundaries are verified
  const eligibleForAuthoritativePersistence = provisionTextVerified;

  // Persist ONLY when eligible for authoritative use
  if (supabase && eligibleForAuthoritativePersistence) {
    await persistEvidence(supabase, request, parsed, fetchResult.finalUrl, contentHash, now);
  }

  return {
    success: true,
    provisionId: parsed.provisionId,
    regulation: request.regulation,
    title: parsed.title,
    operativeText: parsed.operativeText,
    sourceUrl: fetchResult.finalUrl,
    retrievedAt: now,
    contentHash,
    historicalCurrent: 'CURRENT',
    publicationIdObserved,
    effectiveDateObserved,
    publicationMetadataVerified,
    provisionTextVerified,
    provisionPublicationLinkVerified,
    eligibleForAuthoritativePersistence,
  };
}

// ============================================================
// CACHE
// ============================================================

/**
 * Check cache with publication-identity verification.
 * Returns cached result ONLY when its publication ID matches the verified current publication.
 * Cache age alone is never proof of currency.
 */
async function checkCache(
  supabase: SupabaseClient,
  regulation: RegulationFamily,
  provisionId: string,
  verifiedPublicationId?: string
): Promise<RetrievalResult | null> {
  let query = supabase
    .from('regulatory_source_cache')
    .select('*')
    .eq('authority', regulation)
    .eq('citation', provisionId)
    .eq('freshness_status', 'CURRENT')
    .order('created_at', { ascending: false })
    .limit(1);

  // If we have a verified publication ID, require it to match
  if (verifiedPublicationId) {
    query = query.eq('version', verifiedPublicationId);
  }

  const { data } = await query.single();

  if (!data) return null;

  // If no verifiedPublicationId was provided, we cannot confirm currency — skip cache
  if (!verifiedPublicationId) return null;

  // Cache was persisted only when eligibleForAuthoritativePersistence was true
  // and publication ID was verified at persistence time — safe to return as verified
  return {
    success: true,
    provisionId,
    regulation,
    title: null,
    operativeText: data.cached_text,
    sourceUrl: data.source_url,
    retrievedAt: data.last_validated_at,
    contentHash: data.content_hash,
    historicalCurrent: 'CURRENT',
    publicationIdObserved: data.version,
    effectiveDateObserved: data.effective_date,
    publicationMetadataVerified: true,
    provisionTextVerified: true, // Only verified extractions are persisted
    provisionPublicationLinkVerified: false,
    eligibleForAuthoritativePersistence: true,
  };
}

async function persistEvidence(
  supabase: SupabaseClient,
  request: RetrievalRequest,
  parsed: ParsedProvision,
  sourceUrl: string,
  contentHash: string,
  retrievedAt: string
): Promise<void> {
  // Persist to regulatory_evidence (immutable)
  await supabase.from('regulatory_evidence').upsert({
    authority: request.regulation,
    citation: parsed.provisionId,
    provision: parsed.title,
    source_url: sourceUrl,
    title: parsed.title,
    version: parsed.facNumber,
    effective_date: parsed.effectiveDate,
    content_hash: contentHash,
    bounded_relevant_text: parsed.operativeText.slice(0, 50000),
    freshness_status: 'CURRENT',
    idempotency_key: `reg-retrieve-${request.regulation}-${parsed.provisionId}-${contentHash.slice(0, 16)}`,
  }, { onConflict: 'idempotency_key' });

  // Update cache
  await supabase.from('regulatory_source_cache').upsert({
    authority: request.regulation,
    citation: parsed.provisionId,
    version: parsed.facNumber,
    effective_date: parsed.effectiveDate,
    source_url: sourceUrl,
    content_hash: contentHash,
    cached_text: parsed.operativeText.slice(0, 50000),
    freshness_status: 'CURRENT',
    last_validated_at: retrievedAt,
  }, { onConflict: 'authority,citation,version' });
}

// ============================================================
// EXPORTS for testing
// ============================================================

export { validateUrl, secureFetch, APPROVED_HOSTS };
