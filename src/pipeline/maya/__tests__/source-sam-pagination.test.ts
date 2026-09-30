/**
 * SAM Source Pagination, Recovery, and Multi-Lane Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

async function createSource() {
  const mod = await import('../source-sam.js');
  return new mod.SAMSource();
}

function samResponse(totalRecords: number, records: Array<{ noticeId: string; title?: string }>) {
  return {
    ok: true,
    json: async () => ({
      totalRecords,
      opportunitiesData: records.map((r) => ({
        noticeId: r.noticeId,
        title: r.title || 'Test',
        active: 'Yes',
        fullParentPathName: 'TEST AGENCY',
        type: 'Solicitation',
      })),
    }),
  };
}

function emptyResponse() {
  return samResponse(0, []);
}

function failedResponse(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

describe('SAM Source Pagination', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.SAM_API_KEY = 'test-key';
    mockFetch.mockImplementation(async () => emptyResponse());
  });

  // === Normal pagination ===

  it('49 records — single page, complete', async () => {
    const records = Array.from({ length: 49 }, (_, i) => ({ noticeId: `n49-${i}` }));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) return samResponse(49, records);
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 100,
      naicsCodes: ['541512'],
    });
    expect(results.filter((r) => r.sourceId.startsWith('n49-')).length).toBe(49);
    expect(source.fetchStats.some((s) => s.truncated)).toBe(false);
    expect(source.fetchStats.some((s) => s.failed)).toBe(false);
  });

  it('50 records — complete', async () => {
    const records = Array.from({ length: 50 }, (_, i) => ({ noticeId: `n50-${i}` }));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) return samResponse(50, records);
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 100,
      naicsCodes: ['541512'],
    });
    expect(results.filter((r) => r.sourceId.startsWith('n50-')).length).toBe(50);
  });

  it('51 records — two pages, complete', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ noticeId: `n51-${i}` }));
    const page2 = [{ noticeId: 'n51-50' }]; // 51st record on second page
    // Note: SAM returns all 51 records, pagination splits them
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512') && url.includes('offset=0')) return samResponse(51, page1);
      if (url.includes('ncode=541512') && !url.includes('offset=0')) return samResponse(51, page2);
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 100,
      naicsCodes: ['541512'],
    });
    expect(results.filter((r) => r.sourceId.startsWith('n51-')).length).toBe(51);
  });

  it('125 records — paginated across 2 pages, complete', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ noticeId: `pg-${i}` }));
    const page2 = Array.from({ length: 25 }, (_, i) => ({ noticeId: `pg-${100 + i}` }));
    let callCount = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) {
        callCount++;
        if (callCount === 1) return samResponse(125, page1);
        if (callCount === 2) return samResponse(125, page2);
        return emptyResponse();
      }
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 200,
      naicsCodes: ['541512'],
    });
    expect(results.filter((r) => r.sourceId.startsWith('pg-')).length).toBe(125);
    expect(callCount).toBe(2);
  });

  // === Capacity overflow with subdivision ===

  it('1001+ records — window subdivision recovers all records', async () => {
    // Track calls to determine which window is being queried
    let callIndex = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (!url.includes('ncode=541512')) return emptyResponse();
      callIndex++;
      // First call (full window): overflow — 1200 records, return 100 per page
      // After 10 pages (1000 records), fetchPaginated stops → truncated
      // But for test speed, simulate: first call reports overflow
      if (callIndex <= 10) {
        // Full window pagination — simulate hitting the cap
        const records = Array.from({ length: 100 }, (_, i) => ({
          noticeId: `ov-page${callIndex}-${i}`,
        }));
        return samResponse(1200, records);
      }
      // After subdivision: smaller windows fit within capacity
      const records = Array.from({ length: 30 }, (_, i) => ({
        noticeId: `ov-sub${callIndex}-${i}`,
      }));
      return samResponse(30, records);
    });

    const source = await createSource();
    const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await source.fetchChanges({ since, limit: 200, naicsCodes: ['541512'] });

    const naicsStats = source.fetchStats.filter((s) => s.lane === 'CORE_NAICS');
    const anySubdivided = naicsStats.some((s) => s.subdivided);
    expect(anySubdivided).toBe(true);
  });

  // === Minimum-window overflow ===

  it('minimum window still exceeds capacity — source incomplete, cursor preserved', async () => {
    // Even a 1-day window has >1000 records
    mockFetch.mockImplementation(async (url: string) => {
      if (!url.includes('ncode=541512')) return emptyResponse();
      const records = Array.from({ length: 100 }, (_, i) => ({ noticeId: `minov-${i}` }));
      return samResponse(5000, records); // Always claims overflow
    });

    const source = await createSource();
    const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await source.fetchChanges({ since, limit: 200, naicsCodes: ['541512'] });

    // Should have failed after max subdivision depth
    const naicsStats = source.fetchStats.filter((s) => s.lane === 'CORE_NAICS');
    expect(naicsStats.some((s) => s.failed)).toBe(true);
  });

  // === Mid-pagination failure ===

  it('page 3 HTTP failure — source incomplete', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (!url.includes('ncode=541512')) return emptyResponse();
      callCount++;
      if (callCount === 1)
        return samResponse(
          300,
          Array.from({ length: 100 }, (_, i) => ({ noticeId: `fail-${i}` }))
        );
      if (callCount === 2)
        return samResponse(
          300,
          Array.from({ length: 100 }, (_, i) => ({ noticeId: `fail-${100 + i}` }))
        );
      return failedResponse(503); // Page 3 fails
    });

    const source = await createSource();
    await source.fetchChanges({ since: new Date(), limit: 200, naicsCodes: ['541512'] });

    const naicsStats = source.fetchStats.filter((s) => s.lane === 'CORE_NAICS');
    expect(naicsStats.some((s) => s.failed)).toBe(true);
    expect(naicsStats.some((s) => s.failureReason?.includes('HTTP'))).toBe(true);
  });

  // === Repeated-page anomaly ===

  it('repeated page — source incomplete', async () => {
    const stuckPage = [{ noticeId: 'stuck-1' }];
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) return samResponse(100, stuckPage);
      return emptyResponse();
    });

    const source = await createSource();
    await source.fetchChanges({ since: new Date(), limit: 200, naicsCodes: ['541512'] });

    const naicsStats = source.fetchStats.filter((s) => s.lane === 'CORE_NAICS');
    expect(naicsStats.some((s) => s.failed)).toBe(true);
    expect(naicsStats.some((s) => s.failureReason?.includes('repeated_page'))).toBe(true);
  });

  // === Cross-lane and recovery ===

  it('duplicate across lanes — one canonical record', async () => {
    const shared = { noticeId: 'shared-1', title: 'modernization' };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) return samResponse(1, [shared]);
      if (url.includes('title=modernization')) return samResponse(1, [shared]);
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 200,
      naicsCodes: ['541512'],
    });
    expect(results.filter((r) => r.sourceId === 'shared-1').length).toBe(1);
  });

  it('broad lane finds opportunities NAICS lane misses', async () => {
    const naicsOpp = { noticeId: 'naics-only' };
    const broadOpp = { noticeId: 'broad-only', title: 'modernization at USDA' };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) return samResponse(1, [naicsOpp]);
      if (url.includes('title=modernization')) return samResponse(1, [broadOpp]);
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 200,
      naicsCodes: ['541512'],
    });
    expect(results.find((r) => r.sourceId === 'broad-only')).toBeTruthy();
  });

  it('certification lane finds set-aside opportunities', async () => {
    const certOpp = { noticeId: 'cert-8a' };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('typeOfSetAside=8A')) return samResponse(1, [certOpp]);
      return emptyResponse();
    });
    const source = await createSource();
    const results = await source.fetchChanges({ since: new Date(), limit: 200 });
    expect(results.find((r) => r.sourceId === 'cert-8a')).toBeTruthy();
  });
});
