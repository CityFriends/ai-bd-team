/**
 * Ancestry Resolver Tests — C8X-107AJ
 *
 * Tests for the enhanced ancestry resolution that handles all Notion parent types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveAncestryChain,
  findApprovedRootInChain,
  ancestryContains,
  type AncestryResult,
} from '../notion/ancestry-resolver.js';
import * as apiClient from '../notion/api-client.js';

// Mock the API client
vi.mock('../notion/api-client.js', async () => {
  const actual = await vi.importActual('../notion/api-client.js');
  return {
    ...actual,
    notionRequest: vi.fn(),
  };
});

const mockNotionRequest = vi.mocked(apiClient.notionRequest);

describe('Ancestry Resolver', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('resolveAncestryChain', () => {
    it('resolves direct page → workspace chain', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'page-1',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Root Page' }] } },
        },
      });

      const result = await resolveAncestryChain('conn', 'token', 'page-1', 'page');

      expect(result.complete).toBe(true);
      expect(result.chain).toHaveLength(1);
      expect(result.chain[0]).toMatchObject({
        id: 'page-1',
        type: 'page',
        title: 'Root Page',
      });
    });

    it('resolves page → page → workspace chain', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-2',
            object: 'page',
            parent: { type: 'page_id', page_id: 'page-1' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Child Page' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-1',
            object: 'page',
            parent: { type: 'workspace', workspace: true },
            properties: { title: { type: 'title', title: [{ plain_text: 'Root Page' }] } },
          },
        });

      const result = await resolveAncestryChain('conn', 'token', 'page-2', 'page');

      expect(result.complete).toBe(true);
      expect(result.chain).toHaveLength(2);
      expect(result.pathString).toBe('Root Page / Child Page');
    });

    it('resolves page → database → workspace chain', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-1',
            object: 'page',
            parent: { type: 'database_id', database_id: 'db-1' },
            properties: { title: { type: 'title', title: [{ plain_text: 'DB Entry' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'db-1',
            object: 'database',
            parent: { type: 'workspace', workspace: true },
            title: [{ plain_text: 'My Database' }],
          },
        });

      const result = await resolveAncestryChain('conn', 'token', 'page-1', 'page');

      expect(result.complete).toBe(true);
      expect(result.chain).toHaveLength(2);
      expect(result.chain[0].type).toBe('database');
      expect(result.chain[1].type).toBe('page');
    });

    it('resolves complex HQ Wiki structure with blocks', async () => {
      // Page → Database → Page → Block → Block → Block → Database (root)
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-leaf',
            object: 'page',
            parent: { type: 'database_id', database_id: 'db-benefits' },
            properties: {
              title: { type: 'title', title: [{ plain_text: 'Additional Insurances' }] },
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'db-benefits',
            object: 'database',
            parent: { type: 'page_id', page_id: 'page-benefits-hr' },
            title: [{ plain_text: 'Benefits & HR' }],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-benefits-hr',
            object: 'page',
            parent: { type: 'block_id', block_id: 'block-callout' },
            properties: {
              title: { type: 'title', title: [{ plain_text: 'Benefits & General HR' }] },
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'block-callout',
            object: 'block',
            type: 'callout',
            parent: { type: 'block_id', block_id: 'block-column' },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'block-column',
            object: 'block',
            type: 'column',
            parent: { type: 'database_id', database_id: 'db-hq-wiki' },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'db-hq-wiki',
            object: 'database',
            parent: { type: 'workspace', workspace: true },
            title: [{ plain_text: 'HQ Wiki' }],
          },
        });

      const result = await resolveAncestryChain('conn', 'token', 'page-leaf', 'page');

      expect(result.complete).toBe(true);
      expect(result.chain).toHaveLength(6);
      expect(result.rootNode?.id).toBe('db-hq-wiki');
      expect(result.ancestorIds).toContain('db-hq-wiki');
      expect(result.pathString).toBe(
        'HQ Wiki / Benefits & General HR / Benefits & HR / Additional Insurances'
      );
    });

    it('detects cycles', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-a',
            object: 'page',
            parent: { type: 'page_id', page_id: 'page-b' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Page A' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-b',
            object: 'page',
            parent: { type: 'page_id', page_id: 'page-a' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Page B' }] } },
          },
        });

      const result = await resolveAncestryChain('conn', 'token', 'page-a', 'page');

      expect(result.complete).toBe(false);
      expect(result.hasCycle).toBe(true);
    });

    it('handles inaccessible ancestors', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-1',
            object: 'page',
            parent: { type: 'page_id', page_id: 'page-secret' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Visible Page' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 404,
          data: { message: 'Not found' },
        });

      const result = await resolveAncestryChain('conn', 'token', 'page-1', 'page');

      expect(result.complete).toBe(false);
      expect(result.incompleteReason).toContain('inaccessible');
    });

    it('respects depth limit', async () => {
      // Create an infinite chain mock
      mockNotionRequest.mockImplementation(async (_conn, _token, _method, path) => {
        const match = path.match(/\/pages\/(page-\d+)/);
        if (match) {
          const num = parseInt(match[1].replace('page-', ''));
          return {
            status: 200,
            data: {
              id: `page-${num}`,
              object: 'page',
              parent: { type: 'page_id', page_id: `page-${num + 1}` },
              properties: { title: { type: 'title', title: [{ plain_text: `Page ${num}` }] } },
            },
          };
        }
        return { status: 404, data: null };
      });

      const result = await resolveAncestryChain('conn', 'token', 'page-0', 'page', 5);

      expect(result.complete).toBe(false);
      expect(result.incompleteReason).toContain('max_depth');
      expect(result.chain.length).toBeLessThanOrEqual(5);
    });

    it('resolves database root correctly', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'db-root',
          object: 'database',
          parent: { type: 'workspace', workspace: true },
          title: [{ plain_text: 'HQ Wiki' }],
        },
      });

      const result = await resolveAncestryChain('conn', 'token', 'db-root', 'database');

      expect(result.complete).toBe(true);
      expect(result.chain).toHaveLength(1);
      expect(result.chain[0].type).toBe('database');
      expect(result.rootNode?.id).toBe('db-root');
    });
  });

  describe('findApprovedRootInChain', () => {
    it('finds root when it exists in chain', () => {
      const ancestry: AncestryResult = {
        chain: [],
        pathString: 'Root / Child',
        ancestorIds: ['root-id', 'child-id'],
        complete: true,
        hasCycle: false,
        rootNode: null,
      };

      const roots = [
        { notionPageId: 'root-id', name: 'Test Root' },
        { notionPageId: 'other-root', name: 'Other Root' },
      ];

      const found = findApprovedRootInChain(ancestry, roots);
      expect(found?.notionPageId).toBe('root-id');
    });

    it('returns null when no root matches', () => {
      const ancestry: AncestryResult = {
        chain: [],
        pathString: 'Unknown / Child',
        ancestorIds: ['unknown-id', 'child-id'],
        complete: true,
        hasCycle: false,
        rootNode: null,
      };

      const roots = [{ notionPageId: 'root-id', name: 'Test Root' }];

      const found = findApprovedRootInChain(ancestry, roots);
      expect(found).toBeNull();
    });
  });

  describe('ancestryContains', () => {
    it('returns true when ID is in ancestry', () => {
      const ancestry: AncestryResult = {
        chain: [],
        pathString: '',
        ancestorIds: ['a', 'b', 'c'],
        complete: true,
        hasCycle: false,
        rootNode: null,
      };

      expect(ancestryContains(ancestry, 'b')).toBe(true);
      expect(ancestryContains(ancestry, 'd')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('handles API errors gracefully', async () => {
      mockNotionRequest.mockRejectedValue(new Error('Network error'));

      const result = await resolveAncestryChain('conn', 'token', 'page-1', 'page');

      expect(result.complete).toBe(false);
      expect(result.incompleteReason).toContain('error');
    });

    it('handles auth errors', async () => {
      mockNotionRequest.mockRejectedValue(new apiClient.NotionAuthError('conn'));

      const result = await resolveAncestryChain('conn', 'token', 'page-1', 'page');

      expect(result.complete).toBe(false);
      expect(result.incompleteReason).toContain('auth_error');
    });
  });
});
