/**
 * HR Slack Formatter Tests
 *
 * Verifies citation deduplication, markdown normalization,
 * and mention neutralization.
 */
import { describe, it, expect } from 'vitest';
import { formatAnswerForSlack, formatPipelineResultForSlack } from '../slack/hr-slack-formatter.js';
import type { HRAnswerResult } from '../llm/hr-answer-foundation.js';

function makeResult(
  text: string,
  citations: Array<{ chunkId: string; sourceUrl: string; title?: string }>
): HRAnswerResult & { ok: true } {
  return {
    ok: true,
    answer: { text, citations },
  };
}

// ── Citation Deduplication ──────────────────────────────────

describe('formatAnswerForSlack — citation dedup', () => {
  it('deduplicates citations from same page with different block fragments', () => {
    const result = makeResult('Answer.', [
      { chunkId: 'aaa', sourceUrl: 'https://notion.so/page-1#block1', title: 'PTO Policy' },
      { chunkId: 'bbb', sourceUrl: 'https://notion.so/page-1#block2', title: 'PTO Policy' },
    ]);
    const formatted = formatAnswerForSlack(result);
    // Should only have one source link
    const sourceMatches = formatted.match(/• </g);
    expect(sourceMatches).toHaveLength(1);
    expect(formatted).toContain('PTO Policy');
  });

  it('keeps citations from different pages', () => {
    const result = makeResult('Answer.', [
      { chunkId: 'aaa', sourceUrl: 'https://notion.so/page-1#block1', title: 'PTO Policy' },
      { chunkId: 'bbb', sourceUrl: 'https://notion.so/page-2#block1', title: 'Benefits' },
    ]);
    const formatted = formatAnswerForSlack(result);
    const sourceMatches = formatted.match(/• </g);
    expect(sourceMatches).toHaveLength(2);
  });

  it('uses page-level URL (no fragment) in source links', () => {
    const result = makeResult('Answer.', [
      { chunkId: 'aaa', sourceUrl: 'https://notion.so/page-1#block1', title: 'PTO' },
    ]);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('https://notion.so/page-1|');
    expect(formatted).not.toContain('#block1');
  });
});

// ── Markdown Normalization ─────────────────────────────────

describe('formatAnswerForSlack — markdown normalization', () => {
  it('converts **bold** to Slack *bold*', () => {
    const result = makeResult('You get **15 days** of PTO.', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('*15 days*');
    expect(formatted).not.toContain('**');
  });

  it('strips markdown headings', () => {
    const result = makeResult('## PTO Policy\nYou get 15 days.', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).not.toContain('##');
    expect(formatted).toContain('PTO Policy');
  });

  it('normalizes dash lists to bullet', () => {
    const result = makeResult('Benefits:\n- Health\n- Dental\n- Vision', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('• Health');
    expect(formatted).toContain('• Dental');
    expect(formatted).not.toMatch(/^- /m);
  });

  it('normalizes numbered lists to bullet', () => {
    const result = makeResult('Steps:\n1. Request\n2. Approve\n3. Done', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('• Request');
    expect(formatted).not.toMatch(/^\d+\./m);
  });

  it('handles nested **bold *italic* text** without broken mrkdwn', () => {
    const result = makeResult('You get **15 days of *paid* time off**.', []);
    const formatted = formatAnswerForSlack(result);
    // Inner stars stripped; outer converted to Slack bold
    expect(formatted).toContain('*15 days of paid time off*');
    expect(formatted).not.toContain('**');
  });

  it('preserves Slack *bold* that is already correct', () => {
    const result = makeResult('Contact your *HR team* for help.', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('*HR team*');
  });

  it('normalizes star list markers to bullet', () => {
    const result = makeResult('Options:\n* Health\n* Dental', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('• Health');
    expect(formatted).toContain('• Dental');
  });

  it('preserves policy numbers and wording', () => {
    const result = makeResult('Employees receive **15 days** of PTO and **10 days** of sick leave.', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).toContain('15 days');
    expect(formatted).toContain('10 days');
    expect(formatted).toContain('PTO');
    expect(formatted).toContain('sick leave');
  });
});

// ── Mention Neutralization ─────────────────────────────────

describe('formatAnswerForSlack — mentions', () => {
  it('neutralizes @channel', () => {
    const result = makeResult('Contact <!channel> for help.', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).not.toContain('<!channel>');
  });

  it('neutralizes user mentions', () => {
    const result = makeResult('Ask <@U12345> for help.', []);
    const formatted = formatAnswerForSlack(result);
    expect(formatted).not.toContain('<@U12345>');
  });
});

// ── Pipeline Result Formatting ─────────────────────────────

describe('formatPipelineResultForSlack', () => {
  it('formats success result', () => {
    const result = {
      ok: true as const,
      answer: {
        text: 'PTO is 15 days.',
        citations: [
          { chunkId: 'a', sourceUrl: 'https://notion.so/pto', title: 'PTO' },
        ],
      },
    };
    const formatted = formatPipelineResultForSlack(result);
    expect(formatted).toContain('PTO is 15 days.');
    expect(formatted).toContain('*Sources:*');
  });

  it('returns fallback for failure', () => {
    const result = {
      ok: false as const,
      code: 'retrieval_error' as const,
      fallbackMessage: 'Something went wrong.',
    };
    const formatted = formatPipelineResultForSlack(result);
    expect(formatted).toBe('Something went wrong.');
  });
});
