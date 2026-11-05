/**
 * Keyword Extractor Tests
 *
 * Verifies that natural-language employee questions produce
 * useful search terms for ILIKE retrieval.
 */
import { describe, it, expect } from 'vitest';
import { extractSearchTerms, extractSearchTermsWithSource } from '../llm/keyword-extractor.js';

describe('extractSearchTerms', () => {
  // ── Natural Language Questions ──────────────────────────────

  it('extracts "paid time off" from a full question', () => {
    const terms = extractSearchTerms('What is our paid time off policy?');
    expect(terms).toContain('paid time off');
  });

  it('expands PTO synonyms', () => {
    const terms = extractSearchTerms('How many PTO days do I get?');
    expect(terms).toContain('paid time off');
    expect(terms).toContain('vacation');
  });

  it('handles work from home question', () => {
    const terms = extractSearchTerms('Can I work from home on Fridays?');
    expect(terms).toContain('work from home');
    expect(terms).toContain('remote work');
  });

  it('handles health insurance', () => {
    const terms = extractSearchTerms('What health insurance options do we have?');
    expect(terms).toContain('health insurance');
    expect(terms).toContain('medical');
  });

  it('handles 401k', () => {
    const terms = extractSearchTerms('Does the company match 401k?');
    expect(terms).toContain('retirement');
  });

  it('handles sick leave', () => {
    const terms = extractSearchTerms('How many sick days do I have?');
    expect(terms).toContain('sick day');
    expect(terms).toContain('medical leave');
  });

  it('handles parental leave', () => {
    const terms = extractSearchTerms('What is the parental leave policy?');
    expect(terms).toContain('parental leave');
    expect(terms).toContain('maternity');
  });

  // ── Direct Keywords ─────────────────────────────────────────

  it('passes through direct keyword', () => {
    const terms = extractSearchTerms('paid time off');
    expect(terms).toContain('paid time off');
  });

  it('returns at least one term for simple queries', () => {
    const terms = extractSearchTerms('holiday');
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms).toContain('holiday');
  });

  // ── Contextual Stop Words ──────────────────────────────────

  it('excludes "work" as standalone (broad) but keeps in phrases', () => {
    expect(extractSearchTerms('How does parental leave work?')).not.toContain('work');
    expect(extractSearchTerms('Can I work from home?')).toContain('work from home');
  });

  it('excludes "offer" as standalone', () => {
    expect(extractSearchTerms('What benefits do we offer?')).not.toContain('offer');
  });

  it('excludes "report" as standalone', () => {
    expect(extractSearchTerms('How do I report sick leave?')).not.toContain('report');
    expect(extractSearchTerms('How do I report harassment?')).not.toContain('report');
  });

  it('excludes "policy" as standalone', () => {
    expect(extractSearchTerms('What is our paid time off policy?')).not.toContain('policy');
  });

  // ── Timekeeping Synonyms ───────────────────────────────────

  it('expands timekeeping synonyms from "record hours"', () => {
    const terms = extractSearchTerms('How do I record my hours?');
    expect(terms).toContain('timekeeping');
    expect(terms).toContain('timesheet');
  });

  it('expands from "timesheet"', () => {
    const terms = extractSearchTerms('Where do I submit my timesheet?');
    expect(terms).toContain('timekeeping');
    expect(terms).toContain('time tracking');
  });

  // ── Cybersecurity Synonyms ─────────────────────────────────

  it('expands cybersecurity synonyms', () => {
    const terms = extractSearchTerms('What is our cybersecurity policy?');
    expect(terms).toContain('information security');
    expect(terms).toContain('it security');
  });

  it('expands from "IT security"', () => {
    const terms = extractSearchTerms('Where is the IT security policy?');
    expect(terms).toContain('cybersecurity');
  });

  // ── Edge Cases ──────────────────────────────────────────────

  it('removes stop words', () => {
    const terms = extractSearchTerms('What is the policy for me?');
    expect(terms).not.toContain('what');
    expect(terms).not.toContain('is');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('for');
    expect(terms).not.toContain('me');
  });

  it('returns empty for pure stop words', () => {
    const terms = extractSearchTerms('what is the?');
    expect(terms).toHaveLength(0);
  });

  it('caps results at 6 terms', () => {
    const terms = extractSearchTerms(
      'Tell me about PTO vacation sick leave health insurance 401k retirement benefits'
    );
    expect(terms.length).toBeLessThanOrEqual(6);
  });

  it('deduplicates terms', () => {
    const terms = extractSearchTerms('PTO PTO PTO');
    const unique = new Set(terms);
    expect(terms.length).toBe(unique.size);
  });

  // ── Source Metadata ────────────────────────────────────────

  it('tags multi-word phrases as "phrase"', () => {
    const terms = extractSearchTermsWithSource('What is our paid time off policy?');
    const phrase = terms.find((t) => t.text === 'paid time off');
    expect(phrase?.source).toBe('phrase');
  });

  it('tags synonym expansions as "synonym"', () => {
    const terms = extractSearchTermsWithSource('What is our paid time off policy?');
    const synonym = terms.find((t) => t.text === 'pto');
    expect(synonym?.source).toBe('synonym');
  });

  it('tags standalone words as "keyword"', () => {
    const terms = extractSearchTermsWithSource('How many PTO days do I get?');
    const kw = terms.find((t) => t.text === 'days');
    expect(kw?.source).toBe('keyword');
  });

  // ── Representative Employee Questions ───────────────────────

  it.each([
    ['How do I request time off?', 'time off'],
    ['When is the next company holiday?', 'holiday'],
    ['What is the dress code?', 'dress code'],
    ['How do I submit an expense report?', 'expense'],
    ['What is the bereavement leave policy?', 'bereavement leave'],
    ['Do we get jury duty leave?', 'jury duty'],
    ['How does performance review work?', 'performance review'],
  ])('question "%s" includes term "%s"', (question, expectedTerm) => {
    const terms = extractSearchTerms(question);
    expect(terms).toContain(expectedTerm);
  });
});
