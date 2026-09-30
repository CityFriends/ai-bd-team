/**
 * SAM.gov Source Adapter
 *
 * Fetches opportunities from SAM.gov and normalizes them
 * into the canonical opportunity model. No LLM calls.
 */

import type {
  OpportunitySource,
  OpportunityFetchInput,
  RawOpportunity,
  NormalizedOpportunity,
} from './types.js';
import { computeRawHash, computeMaterialHash } from './change-detect.js';
import { ALL_NAICS } from './company-profile.js';

const SAM_API_URL = 'https://api.sam.gov/opportunities/v2/search';

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}/${date.getFullYear()}`;
}

export class SAMSource implements OpportunitySource {
  sourceName = 'sam_gov';

  async fetchChanges(input: OpportunityFetchInput): Promise<RawOpportunity[]> {
    const apiKey = process.env.SAM_API_KEY;
    if (!apiKey) {
      console.warn('[SAMSource] SAM_API_KEY not configured');
      return [];
    }

    const since = input.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const naicsCodes = input.naicsCodes || ALL_NAICS;

    // SAM API ncode accepts a single NAICS code only.
    // Fetch per-NAICS to ensure coverage of all relevant codes,
    // then deduplicate by noticeId.
    const perCodeLimit = Math.max(50, Math.floor((input.limit || 100) / naicsCodes.length));
    const seen = new Set<string>();
    const allResults: RawOpportunity[] = [];

    for (const ncode of naicsCodes) {
      const params = new URLSearchParams({
        api_key: apiKey,
        postedFrom: formatDate(since),
        postedTo: formatDate(new Date()),
        limit: String(perCodeLimit),
        ncode,
        ptype: 'p,r,s,o,k',
      });

      try {
        const response = await fetch(`${SAM_API_URL}?${params}`);
        if (!response.ok) {
          console.error(`[SAMSource] API error for NAICS ${ncode}: ${response.status}`);
          continue;
        }

        const data = (await response.json()) as { opportunitiesData?: unknown[] };
        for (const raw of data.opportunitiesData || []) {
          const id = ((raw as Record<string, unknown>).noticeId as string) || '';
          if (id && !seen.has(id)) {
            seen.add(id);
            allResults.push({
              sourceId: id,
              sourceName: 'sam_gov',
              rawPayload: raw as Record<string, unknown>,
            });
          }
        }
      } catch (err) {
        console.error(`[SAMSource] Fetch error for NAICS ${ncode}:`, err);
      }
    }

    return allResults;
  }

  normalize(raw: RawOpportunity): NormalizedOpportunity {
    const p = raw.rawPayload;

    // Parse agency from fullParentPathName (SAM v2 format: "DEPT.AGENCY.OFFICE")
    const fullPath = (p.fullParentPathName as string) || '';
    const pathParts = fullPath.split('.').map((s) => s.trim());
    const agency = pathParts[0] || null;
    const subAgency = pathParts[1] || null;
    const office = pathParts[2] || null;

    // Parse place of performance
    const pop = p.placeOfPerformance as Record<string, unknown> | null;
    let placeOfPerformance: string | null = null;
    if (pop) {
      const parts: string[] = [];
      const city = pop.city as Record<string, string> | null;
      const state = pop.state as Record<string, string> | null;
      if (city?.name && city.name !== '0') parts.push(city.name);
      if (state?.name) parts.push(state.name);
      if (parts.length > 0) placeOfPerformance = parts.join(', ');
    }

    const normalized: NormalizedOpportunity = {
      sourceId: (p.noticeId as string) || raw.sourceId,
      source: 'sam_gov',
      solicitationNumber: (p.solicitationNumber as string) || null,

      title: (p.title as string) || 'Untitled',
      description: (p.description as string) || null,
      synopsis: (p.description as string) || null,

      agency,
      subAgency,
      office,

      noticeType: (p.type as string) || (p.baseType as string) || 'unknown',
      naics: (p.naicsCode as string) || null,
      psc: (p.classificationCode as string) || null,
      setAside: (p.typeOfSetAside as string) || null,
      setAsideDescription: (p.typeOfSetAsideDescription as string) || null,

      postedDate: (p.postedDate as string) || null,
      responseDeadline: (p.responseDeadLine as string) || null,

      estimatedValue: null, // SAM v2 API does not reliably provide this
      placeOfPerformance,
      vehicle: null,

      sourceUrl:
        (p.uiLink as string) ||
        `https://sam.gov/opp/${(p.noticeId as string) || raw.sourceId}/view`,

      attachments: ((p.resourceLinks as string[]) || []).map((url) => ({
        name: url.split('/').pop() || 'attachment',
        url,
      })),

      active: (p.active as string) === 'Yes',
      archived: (p.archiveType as string) === 'archived',
      cancelled: (p.archiveType as string) === 'cancelled',

      rawHash: '', // Will be computed below
      materialHash: '', // Will be computed below
    };

    normalized.rawHash = computeRawHash(normalized);
    normalized.materialHash = computeMaterialHash(normalized);

    return normalized;
  }
}
