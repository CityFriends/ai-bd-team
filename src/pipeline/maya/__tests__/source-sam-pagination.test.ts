/**
 * SAM Source Pagination and Multi-Lane Tests
 *
 * Tests pagination logic, deduplication, and discovery provenance
 * using mocked SAM API responses. No network calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic import to ensure fetch mock is in place
async function createSource() {
  // Clear module cache to get fresh SAMSource with mocked fetch
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

describe('SAM Source Pagination', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.SAM_API_KEY = 'test-key';
    // Default: all queries return empty unless specifically mocked
    mockFetch.mockImplementation(async () => {
      return emptyResponse();
    });
  });

  it('49 records in one NAICS — single page, no pagination needed', async () => {
    const records = Array.from({ length: 49 }, (_, i) => ({
      noticeId: `id-${i}`,
    }));
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

    // Should have all 49 records from NAICS + whatever broad/cert lanes find (all empty)
    const naicsResults = results.filter((r) => r.sourceId.startsWith('id-'));
    expect(naicsResults.length).toBe(49);
  });

  it('125 records — paginated across 2 pages', async () => {
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

    const pgResults = results.filter((r) => r.sourceId.startsWith('pg-'));
    expect(pgResults.length).toBe(125);
    expect(callCount).toBe(2);
  });

  it('duplicate across lanes — one canonical record', async () => {
    const sharedOpp = { noticeId: 'shared-1', title: 'digital modernization' };

    mockFetch.mockImplementation(async (url: string) => {
      // Found in NAICS lane
      if (url.includes('ncode=541512')) return samResponse(1, [sharedOpp]);
      // Also found in title keyword lane
      if (url.includes('title=digital+modernization')) return samResponse(1, [sharedOpp]);
      return emptyResponse();
    });

    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 200,
      naicsCodes: ['541512'],
    });

    const shared = results.filter((r) => r.sourceId === 'shared-1');
    expect(shared.length).toBe(1);
  });

  it('repeated identical page — stops safely without infinite loop', async () => {
    const stuckPage = [{ noticeId: 'stuck-1' }];
    let callCount = 0;

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('ncode=541512')) {
        callCount++;
        // Always return same page with totalRecords=100 (pretending there are more)
        return samResponse(100, stuckPage);
      }
      return emptyResponse();
    });

    const source = await createSource();
    const results = await source.fetchChanges({
      since: new Date(),
      limit: 200,
      naicsCodes: ['541512'],
    });

    // Should detect repeated page and stop, not loop 10 times
    expect(callCount).toBeLessThanOrEqual(3); // first page + one repeat → stop
    const stuckResults = results.filter((r) => r.sourceId === 'stuck-1');
    expect(stuckResults.length).toBe(1);
  });

  it('broad federal lane finds opportunities NAICS lane misses', async () => {
    const naicsOpp = { noticeId: 'naics-found', title: 'IT Services' };
    const broadOpp = { noticeId: 'broad-found', title: 'modernization program for USDA' };

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

    expect(results.find((r) => r.sourceId === 'naics-found')).toBeTruthy();
    expect(results.find((r) => r.sourceId === 'broad-found')).toBeTruthy();
  });

  it('certification lane finds set-aside opportunities', async () => {
    const certOpp = { noticeId: 'cert-8a', title: 'Web Development' };

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('typeOfSetAside=8A')) return samResponse(1, [certOpp]);
      return emptyResponse();
    });

    const source = await createSource();
    const results = await source.fetchChanges({ since: new Date(), limit: 200 });

    expect(results.find((r) => r.sourceId === 'cert-8a')).toBeTruthy();
  });
});
