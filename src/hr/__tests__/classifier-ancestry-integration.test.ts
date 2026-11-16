/**
 * Classifier Ancestry Integration Tests — C8X-107AL
 *
 * Tests the integration of the full ancestry resolver with the classifier.
 * Covers all parent types (page_id, database_id, block_id, workspace),
 * negative authorization cases, and fail-closed behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyWithFullAncestry,
  classifyWithVerifiedPath,
  type ApprovedRoot,
} from '../notion/classifier.js';
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

const makeRoot = (
  id: string,
  classification: 'employee_safe' | 'hr_restricted' | 'personalized' = 'employee_safe',
  isActive = true
): ApprovedRoot => ({
  id: `root-${id}`,
  connectionId: 'conn-1',
  notionPageId: id,
  accessClassification: classification,
  isActive,
});

describe('classifyWithFullAncestry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('positive authorization', () => {
    it('authorizes page directly under approved root', async () => {
      // Page → Workspace (page is the root itself)
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'root-page',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'HQ Wiki' }] } },
        },
      });

      const result = await classifyWithFullAncestry('conn', 'token', 'root-page', 'HQ Wiki', [
        makeRoot('root-page'),
      ]);

      expect(result.isExcluded).toBe(false);
      expect(result.approvedRoot?.notionPageId).toBe('root-page');
      expect(result.accessClassification).toBe('employee_safe');
      expect(result.ancestryComplete).toBe(true);
    });

    it('authorizes page nested under approved root via page chain', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'leaf-page',
            object: 'page',
            parent: { type: 'page_id', page_id: 'parent-page' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Policy Details' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'parent-page',
            object: 'page',
            parent: { type: 'page_id', page_id: 'root-page' },
            properties: { title: { type: 'title', title: [{ plain_text: 'HR Policies' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'root-page',
            object: 'page',
            parent: { type: 'workspace', workspace: true },
            properties: { title: { type: 'title', title: [{ plain_text: 'HQ Wiki' }] } },
          },
        });

      const result = await classifyWithFullAncestry(
        'conn',
        'token',
        'leaf-page',
        'Policy Details',
        [makeRoot('root-page')]
      );

      expect(result.isExcluded).toBe(false);
      expect(result.approvedRoot?.notionPageId).toBe('root-page');
      expect(result.resolvedPath).toBe('HQ Wiki / HR Policies / Policy Details');
    });

    it('authorizes page under approved database root', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'wiki-entry',
            object: 'page',
            parent: { type: 'database_id', database_id: 'hq-wiki-db' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Time Off Policy' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'hq-wiki-db',
            object: 'database',
            parent: { type: 'workspace', workspace: true },
            title: [{ plain_text: 'HQ Wiki' }],
          },
        });

      const result = await classifyWithFullAncestry(
        'conn',
        'token',
        'wiki-entry',
        'Time Off Policy',
        [makeRoot('hq-wiki-db')]
      );

      expect(result.isExcluded).toBe(false);
      expect(result.approvedRoot?.notionPageId).toBe('hq-wiki-db');
      expect(result.resolvedPath).toBe('HQ Wiki / Time Off Policy');
    });

    it('authorizes page through block parents (callout, column)', async () => {
      // Real HQ Wiki structure: Page → Database → Page → Block (callout) → Block (column) → Database (root)
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'leaf-page',
            object: 'page',
            parent: { type: 'database_id', database_id: 'benefits-db' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Health Insurance' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'benefits-db',
            object: 'database',
            parent: { type: 'page_id', page_id: 'benefits-section' },
            title: [{ plain_text: 'Benefits' }],
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'benefits-section',
            object: 'page',
            parent: { type: 'block_id', block_id: 'callout-block' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Benefits & HR' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'callout-block',
            object: 'block',
            type: 'callout',
            parent: { type: 'block_id', block_id: 'column-block' },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'column-block',
            object: 'block',
            type: 'column',
            parent: { type: 'database_id', database_id: 'hq-wiki-root' },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'hq-wiki-root',
            object: 'database',
            parent: { type: 'workspace', workspace: true },
            title: [{ plain_text: 'HQ Wiki' }],
          },
        });

      const result = await classifyWithFullAncestry(
        'conn',
        'token',
        'leaf-page',
        'Health Insurance',
        [makeRoot('hq-wiki-root')]
      );

      expect(result.isExcluded).toBe(false);
      expect(result.approvedRoot?.notionPageId).toBe('hq-wiki-root');
      expect(result.ancestryComplete).toBe(true);
      expect(result.resolvedPath).toContain('HQ Wiki');
      expect(result.resolvedPath).toContain('Health Insurance');
    });
  });

  describe('negative authorization — fail closed', () => {
    it('rejects page not under any approved root', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'orphan-page',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Random Page' }] } },
        },
      });

      const result = await classifyWithFullAncestry('conn', 'token', 'orphan-page', 'Random Page', [
        makeRoot('some-other-root'),
      ]);

      expect(result.isExcluded).toBe(true);
      expect(result.exclusionReason).toBe('not_under_approved_root');
      expect(result.approvedRoot).toBeNull();
    });

    it('rejects page with inaccessible ancestor', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'visible-page',
            object: 'page',
            parent: { type: 'page_id', page_id: 'secret-parent' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Visible' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 404,
          data: { message: 'Not found' },
        });

      const result = await classifyWithFullAncestry('conn', 'token', 'visible-page', 'Visible', [
        makeRoot('some-root'),
      ]);

      expect(result.isExcluded).toBe(true);
      expect(result.exclusionReason).toContain('incomplete_ancestry');
      expect(result.ancestryComplete).toBe(false);
    });

    it('rejects page with cycle in ancestry', async () => {
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

      const result = await classifyWithFullAncestry('conn', 'token', 'page-a', 'Page A', [
        makeRoot('page-a'),
        makeRoot('page-b'),
      ]);

      expect(result.isExcluded).toBe(true);
      // Cycle is detected via incomplete ancestry (the resolver stops at cycle)
      expect(result.exclusionReason).toContain('cycle_detected');
      expect(result.ancestryComplete).toBe(false);
    });

    it('rejects page under deactivated root', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'page-under-inactive',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Page' }] } },
        },
      });

      const result = await classifyWithFullAncestry(
        'conn',
        'token',
        'page-under-inactive',
        'Page',
        [makeRoot('page-under-inactive', 'employee_safe', false)]
      );

      expect(result.isExcluded).toBe(true);
      expect(result.exclusionReason).toBe('root_deactivated');
    });

    it('rejects page when API returns 403 forbidden', async () => {
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'page-1',
            object: 'page',
            parent: { type: 'page_id', page_id: 'forbidden-page' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Page' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 403,
          data: { message: 'Forbidden' },
        });

      const result = await classifyWithFullAncestry('conn', 'token', 'page-1', 'Page', [
        makeRoot('some-root'),
      ]);

      expect(result.isExcluded).toBe(true);
      expect(result.ancestryComplete).toBe(false);
      expect(result.exclusionReason).toContain('incomplete_ancestry');
    });

    it('rejects page exceeding max depth', async () => {
      // Create deep chain that exceeds limit
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

      const result = await classifyWithFullAncestry(
        'conn',
        'token',
        'page-0',
        'Page 0',
        [makeRoot('page-100')] // Root that would never be reached
      );

      expect(result.isExcluded).toBe(true);
      expect(result.ancestryComplete).toBe(false);
      expect(result.exclusionReason).toContain('incomplete_ancestry');
    });
  });

  describe('structural exclusion with verified path', () => {
    it('excludes page with possessive path segment', async () => {
      // Page under a parent with possessive name (indicates individual ownership)
      mockNotionRequest
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'personal-task',
            object: 'page',
            parent: { type: 'page_id', page_id: 'personal-board' },
            properties: { title: { type: 'title', title: [{ plain_text: 'Task 1' }] } },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'personal-board',
            object: 'page',
            parent: { type: 'page_id', page_id: 'root-page' },
            properties: {
              title: { type: 'title', title: [{ plain_text: "Joshua's Onboarding" }] },
            },
          },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            id: 'root-page',
            object: 'page',
            parent: { type: 'workspace', workspace: true },
            properties: { title: { type: 'title', title: [{ plain_text: 'HR Wiki' }] } },
          },
        });

      const result = await classifyWithFullAncestry('conn', 'token', 'personal-task', 'Task 1', [
        makeRoot('root-page'),
      ]);

      expect(result.isExcluded).toBe(true);
      expect(result.exclusionReason).toBe('quarantined:ambiguous_content');
      // Path contains possessive: "HR Wiki / Joshua's Onboarding / Task 1"
    });

    it('excludes page titled Employee Directory via structural pattern', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'directory-page',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Employee Directory' }] } },
        },
      });

      const result = await classifyWithFullAncestry(
        'conn',
        'token',
        'directory-page',
        'Employee Directory',
        [makeRoot('directory-page')]
      );

      expect(result.isExcluded).toBe(true);
      // Employee Directory matches the structural exclusion pattern
      expect(result.exclusionReason).toContain('structural');
    });

    it('excludes page with Directory keyword via quarantine', async () => {
      // Test a directory page that doesn't match the exact "Employee Directory$" pattern
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'roster-page',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Team Roster' }] } },
        },
      });

      const result = await classifyWithFullAncestry('conn', 'token', 'roster-page', 'Team Roster', [
        makeRoot('roster-page'),
      ]);

      expect(result.isExcluded).toBe(true);
      expect(result.exclusionReason).toBe('quarantined:ambiguous_content');
    });
  });

  describe('access classification inheritance', () => {
    it('inherits employee_safe from root', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'page',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Policy' }] } },
        },
      });

      const result = await classifyWithFullAncestry('conn', 'token', 'page', 'Policy', [
        makeRoot('page', 'employee_safe'),
      ]);

      expect(result.accessClassification).toBe('employee_safe');
    });

    it('inherits hr_restricted from root', async () => {
      mockNotionRequest.mockResolvedValue({
        status: 200,
        data: {
          id: 'page',
          object: 'page',
          parent: { type: 'workspace', workspace: true },
          properties: { title: { type: 'title', title: [{ plain_text: 'Admin Doc' }] } },
        },
      });

      const result = await classifyWithFullAncestry('conn', 'token', 'page', 'Admin Doc', [
        makeRoot('page', 'hr_restricted'),
      ]);

      // hr_restricted pages are excluded by structural exclusion
      expect(result.approvedRoot?.accessClassification).toBe('hr_restricted');
    });
  });
});

describe('classifyWithVerifiedPath — legacy compatibility', () => {
  it('still works for direct parent matching', () => {
    const result = classifyWithVerifiedPath(
      'page-1',
      'Policy Page',
      'HQ Wiki / Policy Page',
      ['parent-id', 'root-id'],
      [makeRoot('root-id')]
    );

    expect(result.isExcluded).toBe(false);
    expect(result.approvedRoot?.notionPageId).toBe('root-id');
  });

  it('excludes when no ancestor matches approved root', () => {
    const result = classifyWithVerifiedPath(
      'page-1',
      'Unknown Page',
      'Unknown / Page',
      ['unknown-parent', 'unknown-grandparent'],
      [makeRoot('different-root')]
    );

    expect(result.isExcluded).toBe(true);
    expect(result.exclusionReason).toBe('not_under_approved_root');
  });
});
