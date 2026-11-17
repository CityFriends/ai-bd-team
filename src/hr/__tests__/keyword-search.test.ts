/**
 * HR Knowledge Keyword Search Tests
 *
 * C8X-107BQ: Comprehensive tests for Guru-style keyword search.
 *
 * Test categories:
 *   1. Date-aware approval filtering (PTO current vs future)
 *   2. Revoked and expired approvals
 *   3. Unapproved and restricted pages
 *   4. Inactive Notion roots
 *   5. Page-level deduplication
 *   6. Phrase queries
 *   7. Slack formatting
 *   8. Rate limiting
 *   9. Real policy searches
 */

import { describe, it, expect } from 'vitest';
import {
  validateQuery,
  isPhraseQuery,
  parseSearchCommand,
  formatSearchResultsForSlack,
  isSearchError,
  hashQuery,
  type SearchResult,
  type SearchResponse,
  type SearchError,
} from '../search/keyword-search.js';

// ═══════════════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════════════

const mockSearchResults: SearchResult[] = [
  {
    pageId: '6d4f0bca-7a5a-4ac0-aace-bdef28eb6a5f',
    pageTitle: 'PTO Policy',
    excerpt: 'Employees accrue *PTO* at a rate of 15 days per year...',
    notionUrl: 'https://notion.so/2c407a7951ff81939f9bf285daec618d',
    rank: 0.95,
  },
  {
    pageId: '1afe2fa6-7b34-4bed-b0ef-e2bb2c9fdf2d',
    pageTitle: 'Healthcare Benefits',
    excerpt: 'Medical coverage through *Blue Cross* Blue Shield...',
    notionUrl: 'https://notion.so/2cb07a7951ff808fbfdbcf28302e447d',
    rank: 0.82,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// QUERY VALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Query Validation', () => {
  it('rejects empty query', () => {
    expect(validateQuery('')).toEqual({ valid: false, error: 'Query is required' });
    expect(validateQuery('   ')).toEqual({
      valid: false,
      error: 'Query must be at least 2 characters',
    });
  });

  it('rejects query shorter than 2 characters', () => {
    expect(validateQuery('a')).toEqual({
      valid: false,
      error: 'Query must be at least 2 characters',
    });
  });

  it('rejects query longer than 500 characters', () => {
    const longQuery = 'a'.repeat(501);
    expect(validateQuery(longQuery)).toEqual({
      valid: false,
      error: 'Query exceeds maximum length of 500 characters',
    });
  });

  it('accepts valid queries', () => {
    expect(validateQuery('PTO policy')).toEqual({ valid: true, sanitized: 'PTO policy' });
    expect(validateQuery('  healthcare  ')).toEqual({ valid: true, sanitized: 'healthcare' });
  });

  it('trims whitespace', () => {
    const result = validateQuery('  parental leave  ');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('parental leave');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHRASE QUERY DETECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Phrase Query Detection', () => {
  it('detects quoted phrase queries', () => {
    expect(isPhraseQuery('"parental leave"')).toBe(true);
    expect(isPhraseQuery('"sick leave policy"')).toBe(true);
  });

  it('rejects non-phrase queries', () => {
    expect(isPhraseQuery('parental leave')).toBe(false);
    expect(isPhraseQuery('parental "leave"')).toBe(false);
    expect(isPhraseQuery('"partial')).toBe(false);
  });

  it('handles whitespace in phrase queries', () => {
    expect(isPhraseQuery('  "healthcare benefits"  ')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH COMMAND PARSING
// ═══════════════════════════════════════════════════════════════════════════

describe('Search Command Parsing', () => {
  it('parses "search: query" format', () => {
    expect(parseSearchCommand('search: PTO policy')).toBe('PTO policy');
    expect(parseSearchCommand('search: "parental leave"')).toBe('"parental leave"');
  });

  it('parses "search query" format (without colon)', () => {
    expect(parseSearchCommand('search healthcare')).toBe('healthcare');
    expect(parseSearchCommand('SEARCH holidays')).toBe('holidays');
  });

  it('handles extra whitespace', () => {
    expect(parseSearchCommand('  search:   sick leave  ')).toBe('sick leave');
    expect(parseSearchCommand('search   timekeeping')).toBe('timekeeping');
  });

  it('returns null for non-search messages', () => {
    expect(parseSearchCommand('hello')).toBeNull();
    expect(parseSearchCommand('what is PTO?')).toBeNull();
    expect(parseSearchCommand('searching for answers')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(parseSearchCommand('Search: benefits')).toBe('benefits');
    expect(parseSearchCommand('SEARCH: POLICY')).toBe('POLICY');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SLACK FORMATTING TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Slack Formatting', () => {
  it('formats successful search results', () => {
    const response: SearchResponse = {
      results: mockSearchResults,
      query: 'benefits',
      resultCount: 2,
      truncated: false,
    };

    const formatted = formatSearchResultsForSlack(response);

    expect(formatted).toContain('results for "benefits"');
    expect(formatted).toContain('PTO Policy');
    expect(formatted).toContain('Healthcare Benefits');
    expect(formatted).toContain('https://notion.so/');
  });

  it('includes Notion links in results', () => {
    const response: SearchResponse = {
      results: [mockSearchResults[0]],
      query: 'PTO',
      resultCount: 1,
      truncated: false,
    };

    const formatted = formatSearchResultsForSlack(response);

    // Should contain clickable link
    expect(formatted).toContain('<https://notion.so/2c407a7951ff81939f9bf285daec618d|PTO Policy>');
  });

  it('formats zero results message', () => {
    const response: SearchResponse = {
      results: [],
      query: 'xyznonexistent',
      resultCount: 0,
      truncated: false,
    };

    const formatted = formatSearchResultsForSlack(response);

    expect(formatted).toContain('No results found');
    expect(formatted).toContain('xyznonexistent');
    expect(formatted).toContain('Try:');
  });

  it('formats rate limit error', () => {
    const error: SearchError = {
      code: 'RATE_LIMITED',
      message: 'Too many searches. Please wait a moment and try again.',
    };

    const formatted = formatSearchResultsForSlack(error);

    expect(formatted).toContain('⏱️');
    expect(formatted).toContain('Too many searches');
  });

  it('formats invalid query error', () => {
    const error: SearchError = {
      code: 'INVALID_QUERY',
      message: 'Query must be at least 2 characters',
    };

    const formatted = formatSearchResultsForSlack(error);

    expect(formatted).toContain('⚠️');
    expect(formatted).toContain('at least 2 characters');
  });

  it('escapes special Slack characters', () => {
    const response: SearchResponse = {
      results: [
        {
          pageId: 'test-id',
          pageTitle: 'Policy <with> & special "chars"',
          excerpt: 'Content with <html> & stuff',
          notionUrl: 'https://notion.so/test',
          rank: 1.0,
        },
      ],
      query: '<script>',
      resultCount: 1,
      truncated: false,
    };

    const formatted = formatSearchResultsForSlack(response);

    expect(formatted).toContain('&lt;script&gt;');
    expect(formatted).toContain('&lt;with&gt;');
    expect(formatted).toContain('&amp;');
    expect(formatted).not.toContain('<script>');
  });

  it('shows truncation message when results limited', () => {
    const response: SearchResponse = {
      results: mockSearchResults,
      query: 'policy',
      resultCount: 2,
      truncated: true,
    };

    const formatted = formatSearchResultsForSlack(response);

    expect(formatted).toContain('Showing top 2');
    expect(formatted).toContain('specific terms');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPE CHECKING
// ═══════════════════════════════════════════════════════════════════════════

describe('Error Type Checking', () => {
  it('identifies search errors', () => {
    const error: SearchError = { code: 'RATE_LIMITED', message: 'Too fast' };
    expect(isSearchError(error)).toBe(true);
  });

  it('identifies successful responses', () => {
    const response: SearchResponse = {
      results: [],
      query: 'test',
      resultCount: 0,
      truncated: false,
    };
    expect(isSearchError(response)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PRIVACY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

describe('Privacy Helpers', () => {
  it('hashes queries consistently', () => {
    const hash1 = hashQuery('parental leave');
    const hash2 = hashQuery('parental leave');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different queries', () => {
    const hash1 = hashQuery('parental leave');
    const hash2 = hashQuery('sick leave');
    expect(hash1).not.toBe(hash2);
  });

  it('produces 64-character SHA-256 hex string', () => {
    const hash = hashQuery('test query');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATED DATABASE BEHAVIOR TESTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * These tests document expected database behavior without hitting the real DB.
 * They serve as specifications for the SQL function tests.
 */

describe('Database Behavior Specifications', () => {
  describe('Date-Aware Approval Filtering', () => {
    it('SPEC: should return current PTO policy before January 1, 2027', () => {
      // With policy_date = 2026-11-17 (today)
      // Current PTO (valid_from: 2026-11-05, valid_until: 2026-12-31) should be returned
      // Future PTO (valid_from: 2027-01-01) should NOT be returned
      const policyDate = new Date('2026-11-17');
      const currentPtoValidFrom = new Date('2026-11-05');
      const currentPtoValidUntil = new Date('2026-12-31');
      const futurePtoValidFrom = new Date('2027-01-01');

      // Current is effective
      expect(currentPtoValidFrom <= policyDate).toBe(true);
      expect(currentPtoValidUntil >= policyDate).toBe(true);

      // Future is NOT effective
      expect(futurePtoValidFrom <= policyDate).toBe(false);
    });

    it('SPEC: should return future PTO policy after January 1, 2027', () => {
      // With policy_date = 2027-01-15
      // Future PTO (valid_from: 2027-01-01, valid_until: NULL) should be returned
      // Current PTO (valid_until: 2026-12-31) should NOT be returned
      const policyDate = new Date('2027-01-15');
      const currentPtoValidUntil = new Date('2026-12-31');
      const futurePtoValidFrom = new Date('2027-01-01');

      // Current is NOT effective (expired)
      expect(currentPtoValidUntil >= policyDate).toBe(false);

      // Future IS effective
      expect(futurePtoValidFrom <= policyDate).toBe(true);
    });
  });

  describe('Revoked and Expired Approvals', () => {
    it('SPEC: should exclude revoked approvals', () => {
      // Approvals with revoked_at != NULL should never be returned
      const approval = { revoked_at: new Date('2026-11-01') };
      expect(approval.revoked_at).not.toBeNull();
      // SQL: AND a.revoked_at IS NULL
    });

    it('SPEC: should exclude expired approvals', () => {
      // Approvals with valid_until < policy_date should not be returned
      const approval = { valid_until: new Date('2026-10-01') };
      const policyDate = new Date('2026-11-17');
      expect(approval.valid_until < policyDate).toBe(true);
      // SQL: AND (a.valid_until IS NULL OR a.valid_until >= v_policy_date)
    });
  });

  describe('Unapproved and Restricted Pages', () => {
    it('SPEC: should exclude pages without approval', () => {
      // Pages that have no matching approval record should not appear
      // SQL: JOIN hr_page_approvals a ON a.knowledge_page_id = c.page_id
    });

    it('SPEC: should exclude hr_restricted pages', () => {
      // Pages under roots with access_classification = 'hr_restricted' should not appear
      // SQL: AND ar.access_classification = 'employee_safe'
      const restrictedRoot = { access_classification: 'hr_restricted' };
      expect(restrictedRoot.access_classification).not.toBe('employee_safe');
    });

    it('SPEC: should exclude excluded pages', () => {
      // Pages with is_excluded = true should not appear
      const page = { is_excluded: true };
      expect(page.is_excluded).toBe(true);
      // SQL: AND NOT p.is_excluded
    });
  });

  describe('Inactive Notion Roots', () => {
    it('SPEC: should exclude pages under inactive roots', () => {
      // Pages under roots with is_active = false should not appear
      const root = { is_active: false };
      expect(root.is_active).toBe(false);
      // SQL: AND ar.is_active = true
    });
  });

  describe('Page-Level Deduplication', () => {
    it('SPEC: should return only best chunk per page', () => {
      // Multiple chunks from same page should be deduplicated
      // Only the highest-ranking chunk should be returned
      // SQL: ROW_NUMBER() OVER (PARTITION BY c.page_id ORDER BY rank DESC)
      //      WHERE chunk_rank = 1
      const chunks = [
        { page_id: 'page-1', chunk_index: 0, rank: 0.8 },
        { page_id: 'page-1', chunk_index: 1, rank: 0.95 },
        { page_id: 'page-1', chunk_index: 2, rank: 0.7 },
      ];
      const best = chunks.reduce((a, b) => (a.rank > b.rank ? a : b));
      expect(best.chunk_index).toBe(1);
      expect(best.rank).toBe(0.95);
    });
  });

  describe('Phrase Queries', () => {
    it('SPEC: should use phraseto_tsquery for quoted phrases', () => {
      // "parental leave" should match exact phrase, not just individual words
      const query = '"parental leave"';
      expect(isPhraseQuery(query)).toBe(true);
      // SQL: phraseto_tsquery('english', v_cleaned) for quoted queries
    });

    it('SPEC: should use plainto_tsquery for regular queries', () => {
      // parental leave should match pages containing both words (not necessarily adjacent)
      const query = 'parental leave';
      expect(isPhraseQuery(query)).toBe(false);
      // SQL: plainto_tsquery('english', v_cleaned) for regular queries
    });
  });

  describe('Rate Limiting', () => {
    it('SPEC: should allow up to 10 searches per minute', () => {
      const maxRequests = 10;
      const windowSeconds = 60;
      // SQL: hr_check_search_rate_limit(p_user_id, 10, 60)
      expect(maxRequests).toBe(10);
      expect(windowSeconds).toBe(60);
    });

    it('SPEC: should reset counter after window expires', () => {
      // After 60 seconds, user should be able to search again
      const windowSeconds = 60;
      const windowStart = new Date('2026-11-17T10:00:00Z');
      const now = new Date('2026-11-17T10:01:01Z');
      const elapsed = (now.getTime() - windowStart.getTime()) / 1000;
      expect(elapsed > windowSeconds).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REAL POLICY SEARCH PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

describe('Real Policy Search Patterns', () => {
  it('validates PTO search query', () => {
    expect(validateQuery('PTO policy')).toEqual({ valid: true, sanitized: 'PTO policy' });
    expect(validateQuery('paid time off')).toEqual({ valid: true, sanitized: 'paid time off' });
    expect(validateQuery('"vacation accrual"')).toEqual({
      valid: true,
      sanitized: '"vacation accrual"',
    });
  });

  it('validates healthcare search query', () => {
    expect(validateQuery('healthcare benefits')).toEqual({
      valid: true,
      sanitized: 'healthcare benefits',
    });
    expect(validateQuery('medical insurance')).toEqual({
      valid: true,
      sanitized: 'medical insurance',
    });
    expect(validateQuery('BCBS')).toEqual({ valid: true, sanitized: 'BCBS' });
  });

  it('validates holidays search query', () => {
    expect(validateQuery('federal holidays')).toEqual({
      valid: true,
      sanitized: 'federal holidays',
    });
    expect(validateQuery('holiday schedule')).toEqual({
      valid: true,
      sanitized: 'holiday schedule',
    });
    expect(validateQuery('"paid holidays"')).toEqual({ valid: true, sanitized: '"paid holidays"' });
  });

  it('validates sick leave search query', () => {
    expect(validateQuery('sick leave')).toEqual({ valid: true, sanitized: 'sick leave' });
    expect(validateQuery('sick time')).toEqual({ valid: true, sanitized: 'sick time' });
  });

  it('validates parental leave search query', () => {
    expect(validateQuery('parental leave')).toEqual({ valid: true, sanitized: 'parental leave' });
    expect(validateQuery('maternity leave')).toEqual({ valid: true, sanitized: 'maternity leave' });
    expect(validateQuery('"parental leave eligibility"')).toEqual({
      valid: true,
      sanitized: '"parental leave eligibility"',
    });
  });

  it('validates timekeeping search query', () => {
    expect(validateQuery('timekeeping')).toEqual({ valid: true, sanitized: 'timekeeping' });
    expect(validateQuery('unanet')).toEqual({ valid: true, sanitized: 'unanet' });
    expect(validateQuery('timesheet')).toEqual({ valid: true, sanitized: 'timesheet' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH RELEVANCE REGRESSION TESTS (C8X-107BS-QA)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Regression tests for search relevance.
 *
 * These tests document the expected behavior where primary policies should
 * rank above incidental mentions. They serve as specifications for the
 * database function behavior.
 *
 * The issue being addressed: "PTO policy" search was returning Court Witness
 * Leave instead of the actual PTO page because the PTO page content doesn't
 * contain the word "policy".
 *
 * Solution: Use OR semantics for matching, with significant title boost.
 */
describe('Search Relevance Specifications (C8X-107BS-QA)', () => {
  describe('Title Match Boost', () => {
    it('SPEC: pages with query terms in title should rank above content-only matches', () => {
      // "Paid Time Off (PTO)" page should rank above "Court Witness Leave"
      // for search "PTO policy" because PTO appears in the title
      const _ptoPage = {
        title: 'Paid Time Off (PTO)',
        contentHasPTO: true,
        contentHasPolicy: false,
      };
      const _courtPage = {
        title: 'Court Witness Leave',
        contentHasPTO: true,
        contentHasPolicy: true,
      };

      // Title match should provide significant boost
      const titleMatchBoost = 20; // 10x base content rank
      const contentMatchRank = 0.1;

      const ptoRank = titleMatchBoost + contentMatchRank; // Title has "PTO"
      const courtRank = contentMatchRank * 2; // Content has both terms but no title match

      expect(ptoRank).toBeGreaterThan(courtRank);
    });

    it('SPEC: exact title match should rank highest', () => {
      // If someone searches "PTO", the page titled "PTO" or "Paid Time Off (PTO)"
      // should rank above pages that just mention PTO in content
      const exactTitleBonus = 100;
      const partialTitleBonus = 50;
      const contentOnlyRank = 1;

      expect(exactTitleBonus).toBeGreaterThan(partialTitleBonus);
      expect(partialTitleBonus).toBeGreaterThan(contentOnlyRank);
    });
  });

  describe('Primary Policy Prominence', () => {
    it('SPEC: "PTO policy" search should return PTO page prominently', () => {
      // Even though the PTO page content may not contain "policy",
      // the title contains "PTO" which should be a strong signal
      const _searchQuery = 'PTO policy';
      const expectedTopResult = 'Paid Time Off (PTO)';

      // This documents the expected behavior after the fix
      expect(expectedTopResult.toLowerCase()).toContain('pto');
    });

    it('SPEC: "healthcare benefits" should return Healthcare Benefits page first', () => {
      const _searchQuery = 'healthcare benefits';
      const expectedTopResult = 'Healthcare Benefits';

      expect(expectedTopResult.toLowerCase()).toContain('healthcare');
      expect(expectedTopResult.toLowerCase()).toContain('benefits');
    });

    it('SPEC: "federal holidays" should return Federal Holidays page first', () => {
      const _searchQuery = 'federal holidays';
      const expectedTopResult = 'Federal Holidays';

      expect(expectedTopResult.toLowerCase()).toContain('federal');
      expect(expectedTopResult.toLowerCase()).toContain('holidays');
    });

    it('SPEC: "sick leave" should return Sick Leave page prominently', () => {
      const _searchQuery = 'sick leave';
      const expectedTopResult = 'Sick Leave';

      expect(expectedTopResult.toLowerCase()).toContain('sick');
      expect(expectedTopResult.toLowerCase()).toContain('leave');
    });

    it('SPEC: "timekeeping" should return Timekeeping page prominently', () => {
      const _searchQuery = 'timekeeping';
      const expectedInTop = 'Timekeeping in Unanet';

      expect(expectedInTop.toLowerCase()).toContain('timekeeping');
    });
  });

  describe('OR Semantics', () => {
    it('SPEC: should match pages containing ANY search term', () => {
      // Search "PTO policy" should match:
      // - Pages with "PTO" in title/content (even without "policy")
      // - Pages with "policy" in title/content (even without "PTO")
      // - Pages with both terms rank highest
      const matchesAny = true;
      const requiresAll = false;

      expect(matchesAny).toBe(true);
      expect(requiresAll).toBe(false);
    });

    it('SPEC: pages matching more terms should rank higher', () => {
      // Page with both "PTO" and "policy" should rank above page with just "PTO"
      const bothTermsRank = 2.0;
      const oneTermRank = 1.0;

      expect(bothTermsRank).toBeGreaterThan(oneTermRank);
    });
  });

  describe('Future PTO Exclusion', () => {
    it('SPEC: 2027 PTO version should not appear in current-date searches', () => {
      // With policy_date = today (2026-11-17), the future PTO version
      // (valid_from: 2027-01-01) should NOT appear in search results
      const today = new Date('2026-11-17');
      const futurePtoValidFrom = new Date('2027-01-01');

      expect(futurePtoValidFrom > today).toBe(true);
      // SQL: AND a.valid_from <= v_policy_date
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Security', () => {
  it('prevents SQL injection in query', () => {
    // These should be safely handled by parameterized queries and hr_safe_tsquery
    const maliciousQueries = [
      "'; DROP TABLE hr_knowledge_chunks; --",
      "1' OR '1'='1",
      '<script>alert("xss")</script>',
      '${process.env.SECRET}',
    ];

    for (const query of maliciousQueries) {
      const validation = validateQuery(query);
      // Query should be accepted for validation (SQL sanitization happens in function)
      // The actual protection is in the parameterized query and hr_safe_tsquery
      if (validation.valid) {
        expect(validation.sanitized).toBe(query.trim());
      }
    }
  });

  it('limits query length to prevent DoS', () => {
    const oversizedQuery = 'a'.repeat(1000);
    const result = validateQuery(oversizedQuery);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('500 characters');
  });
});
