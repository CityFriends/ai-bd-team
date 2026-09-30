/**
 * SAM.gov Source Adapter — Federal Discovery
 *
 * Multi-lane discovery strategy:
 *   Lane A: Core NAICS (541511, 541512, 541519, 541611)
 *   Lane B: Broad federal digital-services (title keyword search)
 *   Lane C: Certification discovery (8A, SDVOSB, WOSB set-asides)
 *
 * All lanes use pagination, global deduplication by noticeId,
 * and preserve discovery provenance. ZERO LLM calls.
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
const PAGE_SIZE = 100;
const MAX_PAGES_PER_QUERY = 10; // Safety: max 1000 records per query

/** Discovery lane identifiers for provenance tracking */
export type DiscoveryLane = 'CORE_NAICS' | 'BROAD_FEDERAL' | 'CERTIFICATION' | 'MULTIPLE';

/**
 * Title keywords for broad federal digital-services discovery (Lane B).
 * SAM API `title` does partial matching on title text.
 * Use single high-value terms that appear in FFTC-relevant opportunity titles.
 */
const BROAD_TITLE_KEYWORDS = [
  'modernization',
  'software development',
  'web application',
  'user experience',
  'DevSecOps',
  'agile',
  'digital transformation',
  'Drupal',
];

/** Set-aside codes for certification discovery (Lane C) */
const CERTIFICATION_SET_ASIDES = ['8A', '8AN', 'SDVOSB', 'SDVOSBC', 'SDVOSBS', 'WOSB'];

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}/${date.getFullYear()}`;
}

interface FetchStats {
  lane: string;
  query: string;
  totalRecords: number;
  fetched: number;
  newUnique: number;
  pages: number;
  truncated: boolean;
}

export class SAMSource implements OpportunitySource {
  sourceName = 'sam_gov';
  fetchStats: FetchStats[] = [];

  /**
   * Paginated SAM API fetch. Returns all records up to MAX_PAGES_PER_QUERY pages.
   * Deduplicates against the provided seen set.
   */
  private async fetchPaginated(
    apiKey: string,
    baseParams: Record<string, string>,
    seen: Map<string, string>,
    lane: string
  ): Promise<{ results: RawOpportunity[]; stats: FetchStats }> {
    const results: RawOpportunity[] = [];
    let offset = 0;
    let totalRecords = 0;
    let pages = 0;
    let lastPageIds = new Set<string>();

    const queryDesc = baseParams.ncode
      ? `NAICS:${baseParams.ncode}`
      : baseParams.title
        ? `title:"${baseParams.title}"`
        : baseParams.typeOfSetAside
          ? `setAside:${baseParams.typeOfSetAside}`
          : 'unfiltered';

    while (pages < MAX_PAGES_PER_QUERY) {
      const params = new URLSearchParams({
        api_key: apiKey,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ptype: 'p,r,s,o,k',
        ...baseParams,
      });

      try {
        const response = await fetch(`${SAM_API_URL}?${params}`);
        if (!response.ok) {
          console.error(`[SAMSource] API error [${lane}/${queryDesc}]: ${response.status}`);
          break;
        }

        const data = (await response.json()) as {
          totalRecords?: number;
          opportunitiesData?: unknown[];
        };
        totalRecords = data.totalRecords || 0;
        const pageData = data.opportunitiesData || [];

        if (pageData.length === 0) break;

        // Detect repeated-page anomaly
        const thisPageIds = new Set<string>();
        for (const raw of pageData) {
          const id = ((raw as Record<string, unknown>).noticeId as string) || '';
          if (!id) continue;
          thisPageIds.add(id);
          if (!seen.has(id)) {
            seen.set(id, lane);
            results.push({
              sourceId: id,
              sourceName: 'sam_gov',
              rawPayload: raw as Record<string, unknown>,
            });
          } else if (seen.get(id) !== lane) {
            // Discovered by multiple lanes — update provenance
            seen.set(id, 'MULTIPLE');
          }
        }

        pages++;

        // Detect infinite loop: if this page is identical to last page, stop
        if (lastPageIds.size > 0 && thisPageIds.size === lastPageIds.size) {
          let identical = true;
          for (const id of thisPageIds) {
            if (!lastPageIds.has(id)) {
              identical = false;
              break;
            }
          }
          if (identical) {
            console.error(
              `[SAMSource] Repeated page detected [${lane}/${queryDesc}] at offset=${offset}, stopping`
            );
            break;
          }
        }
        lastPageIds = thisPageIds;

        offset += pageData.length;
        if (offset >= totalRecords) break;
      } catch (err) {
        console.error(`[SAMSource] Fetch error [${lane}/${queryDesc}]:`, err);
        break;
      }
    }

    const stats: FetchStats = {
      lane,
      query: queryDesc,
      totalRecords,
      fetched: offset,
      newUnique: results.length,
      pages,
      truncated: offset < totalRecords,
    };

    return { results, stats };
  }

  async fetchChanges(input: OpportunityFetchInput): Promise<RawOpportunity[]> {
    const apiKey = process.env.SAM_API_KEY;
    if (!apiKey) {
      console.warn('[SAMSource] SAM_API_KEY not configured');
      return [];
    }

    const since = input.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const naicsCodes = input.naicsCodes || ALL_NAICS;
    const dateWindow = {
      postedFrom: formatDate(since),
      postedTo: formatDate(new Date()),
    };

    // Global deduplication: noticeId → discovery lane
    const seen = new Map<string, string>();
    const allResults: RawOpportunity[] = [];
    this.fetchStats = [];

    // ============================================================
    // Lane A: Core NAICS
    // ============================================================
    for (const ncode of naicsCodes) {
      const { results, stats } = await this.fetchPaginated(
        apiKey,
        { ...dateWindow, ncode },
        seen,
        'CORE_NAICS'
      );
      allResults.push(...results);
      this.fetchStats.push(stats);
    }

    // ============================================================
    // Lane B: Broad Federal Digital-Services (title keyword search)
    // ============================================================
    for (const keyword of BROAD_TITLE_KEYWORDS) {
      const { results, stats } = await this.fetchPaginated(
        apiKey,
        { ...dateWindow, title: keyword },
        seen,
        'BROAD_FEDERAL'
      );
      allResults.push(...results);
      this.fetchStats.push(stats);
    }

    // ============================================================
    // Lane C: Certification Discovery (set-aside filtered)
    // ============================================================
    for (const setAside of CERTIFICATION_SET_ASIDES) {
      const { results, stats } = await this.fetchPaginated(
        apiKey,
        { ...dateWindow, typeOfSetAside: setAside },
        seen,
        'CERTIFICATION'
      );
      allResults.push(...results);
      this.fetchStats.push(stats);
    }

    // Log summary
    const laneA = this.fetchStats.filter((s) => s.lane === 'CORE_NAICS');
    const laneB = this.fetchStats.filter((s) => s.lane === 'BROAD_FEDERAL');
    const laneC = this.fetchStats.filter((s) => s.lane === 'CERTIFICATION');
    console.log(
      `[SAMSource] Discovery complete: ` +
        `NAICS=${laneA.reduce((s, x) => s + x.newUnique, 0)} ` +
        `Broad=${laneB.reduce((s, x) => s + x.newUnique, 0)} ` +
        `Cert=${laneC.reduce((s, x) => s + x.newUnique, 0)} ` +
        `Total=${allResults.length} unique (${seen.size} seen)`
    );

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

      estimatedValue: null,
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

      rawHash: '',
      materialHash: '',
    };

    normalized.rawHash = computeRawHash(normalized);
    normalized.materialHash = computeMaterialHash(normalized);

    return normalized;
  }
}
