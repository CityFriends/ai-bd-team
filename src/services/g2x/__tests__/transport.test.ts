/**
 * G2X Production Transport Tests
 *
 * Covers:
 * - Authenticated requests via direct HTTP
 * - 401 triggers auto-refresh then retry
 * - Research endpoint enforcement
 * - Rate limiting (429) handling
 * - Network errors return structured failure
 * - No infinite retries
 * - G2X unavailable returns structured status
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock auth adapter
vi.mock('../auth.js', () => {
  const mockAuth = {
    getAuthHeaders: vi.fn(),
    refresh: vi.fn(),
    getAccessToken: vi.fn(),
    isAvailable: vi.fn(),
  };
  return {
    G2XAuthAdapter: vi.fn().mockImplementation(() => mockAuth),
    getG2XAuth: () => mockAuth,
    _resetG2XAuth: vi.fn(),
  };
});

import { discoverToolsDirect, callToolDirect, isG2XAvailable } from '../transport.js';
import { getG2XAuth } from '../auth.js';
import type { G2XFailure } from '../types.js';

describe('discoverToolsDirect', () => {
  const mockAuth = getG2XAuth() as unknown as {
    getAuthHeaders: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockAuth.getAuthHeaders.mockResolvedValue({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns tools on successful discovery', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          tools: [{ name: 'g2x_search_opportunities', description: 'Search', inputSchema: {} }],
        },
      }),
    } as Response);

    const result = await discoverToolsDirect(mockAuth as any);

    expect('tools' in result).toBe(true);
    if ('tools' in result) {
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('g2x_search_opportunities');
    }
  });

  it('returns failure when auth unavailable', async () => {
    mockAuth.getAuthHeaders.mockResolvedValue(null);

    const result = await discoverToolsDirect(mockAuth as any);

    expect('type' in result).toBe(true);
    expect((result as G2XFailure).type).toBe('AUTHENTICATION_FAILURE');
  });

  it('handles 401 with auto-refresh retry', async () => {
    // First call returns 401
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)
      // After refresh, retry succeeds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          result: { tools: [{ name: 'tool1', description: 'T', inputSchema: {} }] },
        }),
      } as Response);

    mockAuth.refresh.mockResolvedValueOnce({
      state: 'AUTHENTICATED',
      session: { accessToken: 'new-token' },
    });

    const result = await discoverToolsDirect(mockAuth as any);

    expect('tools' in result).toBe(true);
    expect(mockAuth.refresh).toHaveBeenCalledTimes(1);
  });

  it('returns failure when refresh fails after 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    mockAuth.refresh.mockResolvedValueOnce({
      state: 'G2X_AUTH_REQUIRED',
      reason: 'Token revoked',
    });

    const result = await discoverToolsDirect(mockAuth as any);

    expect('type' in result).toBe(true);
    expect((result as G2XFailure).type).toBe('AUTHENTICATION_FAILURE');
  });

  it('handles network errors gracefully', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await discoverToolsDirect(mockAuth as any);

    expect('type' in result).toBe(true);
    expect((result as G2XFailure).type).toBe('PROVIDER_UNAVAILABLE');
    expect((result as G2XFailure).message).toContain('ECONNREFUSED');
  });
});

describe('callToolDirect', () => {
  const mockAuth = getG2XAuth() as unknown as {
    getAuthHeaders: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockAuth.getAuthHeaders.mockResolvedValue({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('calls tool and returns response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          content: [{ type: 'text', text: '{"results":[]}' }],
        },
      }),
    } as Response);

    const result = await callToolDirect(mockAuth as any, {
      name: 'g2x_search_opportunities',
      arguments: { query: 'test' },
    });

    expect('content' in result).toBe(true);
  });

  it('handles 429 with Retry-After', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '30' }),
      json: async () => ({}),
    } as Response);

    const result = await callToolDirect(mockAuth as any, {
      name: 'g2x_search_opportunities',
      arguments: { query: 'test' },
    });

    expect('type' in result).toBe(true);
    expect((result as G2XFailure).type).toBe('RATE_LIMITED');
    expect((result as G2XFailure).retryAfterSeconds).toBe(30);
  });

  it('sends correct JSON-RPC format', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { content: [] } }),
    } as Response);

    await callToolDirect(mockAuth as any, {
      name: 'g2x_search_opportunities',
      arguments: { query: 'test' },
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as { body: string }).body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('g2x_search_opportunities');
    expect(body.params.arguments.query).toBe('test');
  });

  it('enforces research endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ result: { content: [] } }),
    } as Response);

    await callToolDirect(mockAuth as any, { name: 'test', arguments: {} });

    // Default endpoint is research-only
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://mcp.g2x.com/mcp/research');
  });
});

describe('isG2XAvailable', () => {
  it('delegates to auth adapter', () => {
    const mockAuth = getG2XAuth() as unknown as {
      isAvailable: ReturnType<typeof vi.fn>;
    };

    mockAuth.isAvailable.mockReturnValue(true);
    expect(isG2XAvailable()).toBe(true);

    mockAuth.isAvailable.mockReturnValue(false);
    expect(isG2XAvailable()).toBe(false);
  });
});
