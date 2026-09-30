/**
 * SAM.gov Source Adapter — Federal Discovery
 *
 * Multi-lane discovery with pagination, date-window subdivision,
 * and deterministic recovery. ZERO LLM calls.
 *
 * Lanes:
 *   A: Core NAICS (541511, 541512, 541519, 541611)
 *   B: Broad federal digital-services (title keyword search)
 *   C: Certification discovery (8A, SDVOSB, WOSB set-asides)
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
const MAX_SUBDIVISION_DEPTH = 4; // Minimum window: ~1 day from a 16-day range

export type DiscoveryLane = 'CORE_NAICS' | 'BROAD_FEDERAL' | 'CERTIFICATION' | 'MULTIPLE';

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

const CERTIFICATION_SET_ASIDES = ['8A', '8AN', 'SDVOSB', 'SDVOSBC', 'SDVOSBS', 'WOSB'];

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}/${date.getFullYear()}`;
}

export interface FetchStats {
  lane: string;
  query: string;
  totalRecords: number;
  fetched: number;
  newUnique: number;
  pages: number;
  truncated: boolean;
  failed: boolean;
  subdivided: boolean;
  failureReason?: string;
}

export class SAMSource implements OpportunitySource {
  sourceName = 'sam_gov';
  fetchStats: FetchStats[] = [];

  /**
   * Paginated SAM API fetch for a single date window.
   * Returns results and completeness status.
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
    let failed = false;
    let failureReason: string | undefined;
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
          failed = true;
          failureReason = `HTTP ${response.status}`;
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
            seen.set(id, 'MULTIPLE');
          }
        }

        pages++;

        // Detect repeated-page anomaly
        if (lastPageIds.size > 0 && thisPageIds.size === lastPageIds.size) {
          let identical = true;
          for (const id of thisPageIds) {
            if (!lastPageIds.has(id)) {
              identical = false;
              break;
            }
          }
          if (identical) {
            failed = true;
            failureReason = 'repeated_page';
            console.error(`[SAMSource] Repeated page [${lane}/${queryDesc}] offset=${offset}`);
            break;
          }
        }
        lastPageIds = thisPageIds;

        offset += pageData.length;
        if (offset >= totalRecords) break;
      } catch (err) {
        failed = true;
        failureReason = `fetch_error: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[SAMSource] Fetch error [${lane}/${queryDesc}]:`, err);
        break;
      }
    }

    const truncated = !failed && offset < totalRecords;
    return {
      results,
      stats: {
        lane,
        query: queryDesc,
        totalRecords,
        fetched: offset,
        newUnique: results.length,
        pages,
        truncated,
        failed,
        subdivided: false,
        failureReason,
      },
    };
  }

  /**
   * Fetch with date-window subdivision when capacity is exceeded.
   * If a query exceeds MAX_PAGES_PER_QUERY * PAGE_SIZE records,
   * splits the date range and retries each half.
   */
  private async fetchWithRecovery(
    apiKey: string,
    filterParams: Record<string, string>,
    postedFrom: Date,
    postedTo: Date,
    seen: Map<string, string>,
    lane: string,
    depth = 0
  ): Promise<{ results: RawOpportunity[]; stats: FetchStats[] }> {
    const dateParams = {
      ...filterParams,
      postedFrom: formatDate(postedFrom),
      postedTo: formatDate(postedTo),
    };

    const { results, stats } = await this.fetchPaginated(apiKey, dateParams, seen, lane);

    // If failed (HTTP error, repeated page), mark incomplete — no subdivision
    if (stats.failed) {
      return { results, stats: [stats] };
    }

    // If complete (not truncated), done
    if (!stats.truncated) {
      return { results, stats: [stats] };
    }

    // Truncated — attempt date-window subdivision
    if (depth >= MAX_SUBDIVISION_DEPTH) {
      // Cannot subdivide further — minimum window exceeded capacity
      const msg =
        `Minimum window overflow [${lane}/${stats.query}]: ` +
        `${formatDate(postedFrom)}-${formatDate(postedTo)} has ${stats.totalRecords} records, ` +
        `fetched ${stats.fetched}, limit ${MAX_PAGES_PER_QUERY * PAGE_SIZE}`;
      console.error(`[SAMSource] ${msg}`);
      stats.failureReason = msg;
      stats.failed = true;
      return { results, stats: [stats] };
    }

    // Split date range at midpoint
    const midMs = postedFrom.getTime() + (postedTo.getTime() - postedFrom.getTime()) / 2;
    const mid = new Date(midMs);
    // Ensure non-degenerate split (at least 1 day apart)
    if (
      mid.toDateString() === postedFrom.toDateString() ||
      mid.toDateString() === postedTo.toDateString()
    ) {
      stats.failureReason = `Cannot subdivide 1-day window: ${formatDate(postedFrom)}`;
      stats.failed = true;
      return { results, stats: [stats] };
    }

    console.log(
      `[SAMSource] Subdividing [${lane}/${stats.query}]: ${formatDate(postedFrom)}-${formatDate(postedTo)} (${stats.totalRecords} records) at depth ${depth + 1}`
    );

    // Use inclusive boundaries: first half up to mid, second half from mid to end
    // SAM date filters are inclusive on both ends, so mid appears in both halves.
    // Cross-window duplicates handled by global noticeId dedup.
    const firstHalf = await this.fetchWithRecovery(
      apiKey,
      filterParams,
      postedFrom,
      mid,
      seen,
      lane,
      depth + 1
    );
    const secondHalf = await this.fetchWithRecovery(
      apiKey,
      filterParams,
      mid,
      postedTo,
      seen,
      lane,
      depth + 1
    );

    const allResults = [...firstHalf.results, ...secondHalf.results];
    const allStats = [...firstHalf.stats, ...secondHalf.stats];

    // Mark all stats as subdivided
    for (const s of allStats) s.subdivided = true;

    return { results: allResults, stats: allStats };
  }

  async fetchChanges(input: OpportunityFetchInput): Promise<RawOpportunity[]> {
    const apiKey = process.env.SAM_API_KEY;
    if (!apiKey) {
      console.warn('[SAMSource] SAM_API_KEY not configured');
      return [];
    }

    const since = input.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const naicsCodes = input.naicsCodes || ALL_NAICS;

    const seen = new Map<string, string>();
    const allResults: RawOpportunity[] = [];
    this.fetchStats = [];

    // Lane A: Core NAICS
    for (const ncode of naicsCodes) {
      const { results, stats } = await this.fetchWithRecovery(
        apiKey,
        { ncode },
        since,
        now,
        seen,
        'CORE_NAICS'
      );
      allResults.push(...results);
      this.fetchStats.push(...stats);
    }

    // Lane B: Broad Federal Digital-Services
    for (const keyword of BROAD_TITLE_KEYWORDS) {
      const { results, stats } = await this.fetchWithRecovery(
        apiKey,
        { title: keyword },
        since,
        now,
        seen,
        'BROAD_FEDERAL'
      );
      allResults.push(...results);
      this.fetchStats.push(...stats);
    }

    // Lane C: Certification Discovery
    for (const setAside of CERTIFICATION_SET_ASIDES) {
      const { results, stats } = await this.fetchWithRecovery(
        apiKey,
        { typeOfSetAside: setAside },
        since,
        now,
        seen,
        'CERTIFICATION'
      );
      allResults.push(...results);
      this.fetchStats.push(...stats);
    }

    const laneA = this.fetchStats.filter((s) => s.lane === 'CORE_NAICS');
    const laneB = this.fetchStats.filter((s) => s.lane === 'BROAD_FEDERAL');
    const laneC = this.fetchStats.filter((s) => s.lane === 'CERTIFICATION');
    const anyFailed = this.fetchStats.some((s) => s.failed);
    const anyTruncated = this.fetchStats.some((s) => s.truncated);
    console.log(
      `[SAMSource] Discovery complete: ` +
        `NAICS=${laneA.reduce((s, x) => s + x.newUnique, 0)} ` +
        `Broad=${laneB.reduce((s, x) => s + x.newUnique, 0)} ` +
        `Cert=${laneC.reduce((s, x) => s + x.newUnique, 0)} ` +
        `Total=${allResults.length} unique` +
        (anyFailed ? ' [INCOMPLETE: failures detected]' : '') +
        (anyTruncated ? ' [INCOMPLETE: truncated queries]' : '')
    );

    return allResults;
  }

  normalize(raw: RawOpportunity): NormalizedOpportunity {
    const p = raw.rawPayload;

    const fullPath = (p.fullParentPathName as string) || '';
    const pathParts = fullPath.split('.').map((s) => s.trim());
    const agency = pathParts[0] || null;
    const subAgency = pathParts[1] || null;
    const office = pathParts[2] || null;

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
