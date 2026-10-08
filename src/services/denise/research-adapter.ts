/**
 * Denise — Authoritative Acquisition Research Adapter
 *
 * Boundary/contracts for bounded authoritative research.
 * Foundation milestone: interface only, no production calls.
 *
 * Authority classes:
 * - Acquisition.gov / FAR
 * - Official DFARS / DoD supplements
 * - Official agency FAR supplements
 * - SAM.gov official guidance
 * - SBA.gov / official SBA regulation/guidance
 * - Official agency acquisition guidance
 * - Authoritative GAO material (contextual precedent only)
 *
 * No unrestricted web browsing.
 * No commercial legal summaries as authoritative evidence.
 *
 * Zero LLM calls. Zero provider imports. Zero network calls.
 */

import type { RegulatoryAuthorityClass } from './types.js';
import { DENISE_REGULATORY_RESEARCH_ENABLED } from './types.js';

export interface ResearchQuery {
  authorityClass: RegulatoryAuthorityClass;
  citation: string;
  version?: string;
  context?: string;
}

export interface ResearchResult {
  success: boolean;
  authorityClass: RegulatoryAuthorityClass;
  citation: string;
  version: string | null;
  effectiveDate: string | null;
  sourceUrl: string | null;
  text: string | null;
  contentHash: string | null;
  error?: string;
}

/**
 * Research a regulatory source. Foundation milestone: always returns
 * RESEARCH_DISABLED since DENISE_REGULATORY_RESEARCH_ENABLED=false.
 *
 * When commissioned, this will dispatch to authority-specific adapters
 * with bounded retrieval, version verification, and content hashing.
 */
export async function researchAuthoritativeSource(
  _query: ResearchQuery
): Promise<ResearchResult> {
  if (!DENISE_REGULATORY_RESEARCH_ENABLED) {
    return {
      success: false,
      authorityClass: _query.authorityClass,
      citation: _query.citation,
      version: null,
      effectiveDate: null,
      sourceUrl: null,
      text: null,
      contentHash: null,
      error: 'RESEARCH_DISABLED — DENISE_REGULATORY_RESEARCH_ENABLED=false',
    };
  }

  // Future: dispatch to authority-specific adapter
  // Each adapter will:
  // 1. Look up cached source first
  // 2. If cache miss or stale, fetch from authoritative endpoint
  // 3. Verify version/effective date
  // 4. Hash content
  // 5. Cache result
  // 6. Return structured evidence

  return {
    success: false,
    authorityClass: _query.authorityClass,
    citation: _query.citation,
    version: null,
    effectiveDate: null,
    sourceUrl: null,
    text: null,
    contentHash: null,
    error: 'NOT_IMPLEMENTED — adapter not yet commissioned',
  };
}

/**
 * Validate that a regulatory authority class is in the approved list.
 */
export function isAuthorityClassApproved(authorityClass: string): boolean {
  const APPROVED: Set<string> = new Set([
    'ACQUISITION_GOV_FAR',
    'DFARS_DOD',
    'AGENCY_FAR_SUPPLEMENT',
    'SAM_GOV',
    'SBA_GOV',
    'AGENCY_ACQUISITION_GUIDANCE',
    'GAO_CONTEXTUAL',
  ]);
  return APPROVED.has(authorityClass);
}
