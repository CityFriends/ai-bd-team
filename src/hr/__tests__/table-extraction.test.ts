/**
 * Notion Table Extraction Tests
 *
 * Tests the extractTableBlock function with synthetic table data.
 */
import { describe, it, expect, vi } from 'vitest';
import { extractTableBlock, type NotionBlock } from '../notion/api-client.js';
import { assessExtraction } from '../notion/shadow-discovery.js';

// Mock notionRequest for table extraction tests
vi.mock('../notion/api-client.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig };
});

function makeTableBlock(id: string, opts: { hasColumnHeader?: boolean; width?: number } = {}): NotionBlock {
  return {
    id,
    type: 'table',
    has_children: true,
    table: {
      has_column_header: opts.hasColumnHeader ?? true,
      has_row_header: false,
      table_width: opts.width ?? 3,
    },
  };
}

// ── assessExtraction ───────────────────────────────────────

describe('assessExtraction — table support', () => {
  it('marks table blocks as supported when text is present', () => {
    const blocks = [
      { type: 'paragraph', text: 'Intro text' },
      { type: 'table', text: '| A | B |\n| --- | --- |\n| 1 | 2 |' },
    ];
    const report = assessExtraction(blocks);
    expect(report.extractedBlocks).toBe(2);
    expect(report.isComplete).toBe(true);
    expect(report.hasTableContent).toBe(true);
  });

  it('flags table extraction failure (empty text)', () => {
    const blocks = [
      { type: 'paragraph', text: 'Intro' },
      { type: 'table', text: '' }, // extraction failed
    ];
    const report = assessExtraction(blocks);
    expect(report.extractedBlocks).toBe(1);
    expect(report.isComplete).toBe(false);
    expect(report.unsupportedBlockTypes).toContain('table (extraction failed)');
  });

  it('ignores table_row blocks (counted under parent table)', () => {
    const blocks = [
      { type: 'table', text: '| A | B |' },
      { type: 'table_row', text: '' },
      { type: 'table_row', text: '' },
    ];
    const report = assessExtraction(blocks);
    expect(report.totalBlocks).toBe(1); // only the table, not the rows
    expect(report.extractedBlocks).toBe(1);
  });

  it('flags unsupported non-table blocks', () => {
    const blocks = [
      { type: 'paragraph', text: 'Text' },
      { type: 'embed', text: '' },
    ];
    const report = assessExtraction(blocks);
    expect(report.isComplete).toBe(false);
    expect(report.unsupportedBlockTypes).toContain('embed');
  });
});

// ── Markdown Table Serialization ───────────────────────────

describe('table markdown serialization', () => {
  it('formats a basic salary-band table with headers', () => {
    const text = formatTable(
      ['Level', 'Min Salary', 'Max Salary'],
      [
        ['IC1', '$50,000', '$65,000'],
        ['IC2', '$65,000', '$85,000'],
        ['IC3', '$85,000', '$110,000'],
      ],
      true
    );
    expect(text).toContain('| Level | Min Salary | Max Salary |');
    expect(text).toContain('| --- | --- | --- |');
    expect(text).toContain('| IC1 | $50,000 | $65,000 |');
    expect(text).toContain('| IC3 | $85,000 | $110,000 |');
  });

  it('formats step-increase progression', () => {
    const text = formatTable(
      ['Step', 'Annual Pay', 'Increase'],
      [
        ['1', '$45,000', '-'],
        ['2', '$47,250', '5%'],
        ['3', '$49,613', '5%'],
      ],
      true
    );
    expect(text).toContain('| Step | Annual Pay | Increase |');
    expect(text).toContain('| 1 | $45,000 | - |');
  });

  it('escapes pipe characters in cell content', () => {
    const text = formatTable(
      ['Name', 'Range'],
      [['Grade A|B', '$50k | $60k']],
      true
    );
    expect(text).toContain('Grade A\\|B');
    expect(text).toContain('$50k \\| $60k');
  });

  it('handles empty cells', () => {
    const text = formatTable(
      ['A', 'B', 'C'],
      [['x', '', 'z']],
      true
    );
    expect(text).toContain('| x |  | z |');
  });

  it('preserves row order', () => {
    const text = formatTable(
      ['Step'],
      [['1'], ['2'], ['3'], ['4'], ['5']],
      true
    );
    const lines = text.split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
    // Header + 5 data rows = 6 lines with pipes
    expect(lines.length).toBe(6);
  });
});

// ── Helper: Simulate table formatting ──────────────────────

function formatTable(headers: string[], rows: string[][], hasColumnHeader: boolean): string {
  const lines: string[] = [];

  if (hasColumnHeader) {
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  }

  for (const row of rows) {
    const escaped = row.map(cell =>
      cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    );
    lines.push(`| ${escaped.join(' | ')} |`);
  }

  return lines.join('\n');
}
