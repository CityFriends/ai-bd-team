/**
 * HR Block Kit Renderer Tests
 *
 * SYNTHETIC DATA ONLY — fixtures are fictional, not actual FFTC policies.
 */
import { describe, it, expect } from 'vitest';
import {
  renderAnswerAsBlocks,
  renderPipelineResultAsBlocks,
  buildGreeting,
  shouldGreetByName,
  escapeEmployeeName,
  type BlockKitPayload,
  type RenderOptions,
} from '../slack/hr-block-kit-renderer.js';
import type { HRAnswerResult } from '../llm/hr-answer-foundation.js';

// ── Helpers ────────────────────────────────────────────────

function makeResult(
  text: string,
  citations: Array<{ chunkId: string; sourceUrl: string; title?: string }> = []
): HRAnswerResult & { ok: true } {
  return { ok: true, answer: { text, citations } };
}

function countBlockType(payload: BlockKitPayload, type: string): number {
  return payload.blocks.filter((b) => b.type === type).length;
}

function allSectionTexts(payload: BlockKitPayload): string[] {
  return payload.blocks
    .filter((b): b is { type: 'section'; text: { text: string } } => b.type === 'section')
    .map((b) => b.text.text);
}

// ── Fixtures ───────────────────────────────────────────────

const PTO_SHORT = makeResult(
  'FFTC employees receive 18 days of PTO annually, accrued at 6 hours per semi-monthly pay period.',
  [{ chunkId: 'a', sourceUrl: 'https://notion.so/pto#block1', title: 'Paid Time Off (PTO)' }]
);

const PTO_DETAILED = makeResult(
  'FFTC employees receive 18 days of PTO annually, accrued at 6 hours per semi-monthly pay period.\n\n' +
  '• You begin accruing leave on your hire date\n' +
  '• You can rollover up to 240 hours annually\n' +
  '• The maximum PTO balance is 360 hours\n\n' +
  'To request time off, submit a request through Unanet at least two weeks in advance.',
  [
    { chunkId: 'a', sourceUrl: 'https://notion.so/pto#b1', title: 'Paid Time Off (PTO)' },
    { chunkId: 'b', sourceUrl: 'https://notion.so/pto#b2', title: 'Paid Time Off (PTO)' },
  ]
);

const PARENTAL_LEAVE = makeResult(
  'Parental leave includes all caregivers, regardless of gender.\n\n' +
  '*Company Parental Leave*\n• 12 weeks of paid parental leave\n• Available after 12 months of employment\n\n' +
  '*New York Paid Family Leave*\n• Up to 12 weeks at 67% of average weekly wage\n• Funded through employee payroll deductions\n• Must be processed within 30 days\n\n' +
  '*Washington Paid Family and Medical Leave*\n• Up to 12 weeks for family leave\n• Benefits calculated based on state formula\n\n' +
  '*California Paid Family Leave*\n• Up to 8 weeks at approximately 60-70% of wages\n• Administered through EDD',
  [
    { chunkId: 'a', sourceUrl: 'https://notion.so/parental#b1', title: 'Parental Leave' },
    { chunkId: 'b', sourceUrl: 'https://notion.so/parental#b2', title: 'Parental Leave' },
  ]
);

const CYBERSECURITY = makeResult(
  'All employees must follow the company cybersecurity policy.\n\n• Use strong passwords\n• Report suspicious emails immediately\n• Complete annual training',
  [{ chunkId: 'a', sourceUrl: 'https://notion.so/cyber', title: 'Cybersecurity Policy' }]
);

const BENEFITS = makeResult(
  'FFTC offers comprehensive employee benefits including:\n\n• Health insurance\n• Dental and vision plans\n• 401(k) with employer matching\n• Life insurance ($50K)\n• 18 days accrued PTO\n• 12 weeks parental leave\n• 11 federal holidays',
  [
    { chunkId: 'a', sourceUrl: 'https://notion.so/benefits', title: 'Employee Benefits Guide' },
    { chunkId: 'b', sourceUrl: 'https://notion.so/hiring', title: 'Hiring at Friends' },
  ]
);

const SICK_LEAVE = makeResult(
  'Sick leave is accrued at one hour for every 30 hours worked, up to 6 days annually.\n\n• Used for personal illness or medical appointments\n• Notify your manager before start time',
  [{ chunkId: 'a', sourceUrl: 'https://notion.so/sick', title: 'Sick Leave Policy' }]
);

const HARASSMENT = makeResult(
  'The company has zero tolerance for harassment and discrimination.\n\nTo report:\n• Contact HR directly\n• Use the anonymous reporting hotline\n• File a complaint through the employee portal',
  [{ chunkId: 'a', sourceUrl: 'https://notion.so/harassment', title: 'Harassment Prevention Policy' }]
);

const ABSTENTION_RESULT = {
  ok: false as const,
  code: 'no_evidence' as const,
  fallbackMessage: "I couldn't find enough approved HR information to answer that reliably. Please contact your HR team for clarification.",
};

const LONG_SECTION = makeResult(
  Array.from({ length: 50 }, (_, i) =>
    `Section ${i + 1}: Detailed policy paragraph with important information about employee rights and obligations under company policy number ${i + 100}.`
  ).join('\n\n'),
  [{ chunkId: 'a', sourceUrl: 'https://notion.so/long', title: 'Comprehensive Policy Guide' }]
);

const OVERSIZED_PARAGRAPH = makeResult(
  'Policy overview:\n' + Array.from({ length: 100 }, (_, i) => `• Item ${i + 1}: Important policy detail that must not be lost`).join('\n'),
  [{ chunkId: 'a', sourceUrl: 'https://notion.so/big', title: 'Big Policy' }]
);

// ════════════════════════════════════════════════════════════
// Greeting Frequency
// ════════════════════════════════════════════════════════════

describe('shouldGreetByName', () => {
  const ptoTopic = { emoji: '🏖️', label: 'Paid Time Off' };
  const harassmentTopic = { emoji: '⚖️', label: 'Workplace Compliance' };

  it('greets on initial "hi" message', () => {
    expect(shouldGreetByName('Hi, can you help me with PTO?', 'Lapedra', ptoTopic)).toBe(true);
  });

  it('greets on "hello" message', () => {
    expect(shouldGreetByName('Hello! I have a question about leave.', 'Alex', ptoTopic)).toBe(true);
  });

  it('greets on "hey" message', () => {
    expect(shouldGreetByName('Hey, what benefits do we have?', 'Sam', ptoTopic)).toBe(true);
  });

  it('greets on "help" message', () => {
    expect(shouldGreetByName('Can you help me understand parental leave?', 'Jo', ptoTopic)).toBe(true);
  });

  it('does NOT greet on direct policy question', () => {
    expect(shouldGreetByName('How many PTO days do I get?', 'Lapedra', ptoTopic)).toBe(false);
  });

  it('does NOT greet on "What is" question', () => {
    expect(shouldGreetByName('What is our paid time off policy?', 'Lapedra', ptoTopic)).toBe(false);
  });

  it('does NOT greet on sensitive topic', () => {
    expect(shouldGreetByName('Hi, how do I report harassment?', 'Lapedra', harassmentTopic)).toBe(false);
  });

  it('does NOT greet when name is null', () => {
    expect(shouldGreetByName('Hi there!', null, ptoTopic)).toBe(false);
  });
});

describe('buildGreeting', () => {
  it('personalizes when greeting is appropriate', () => {
    const result = buildGreeting('Alex', { emoji: '🏖️', label: 'Paid Time Off' }, 'Hi, what is PTO?');
    expect(result).toContain('Alex');
    expect(result).toContain('Paid Time Off');
  });

  it('returns empty for direct questions', () => {
    const result = buildGreeting('Alex', { emoji: '🏖️', label: 'Paid Time Off' }, 'How many PTO days?');
    expect(result).toBe('');
  });

  it('returns empty when name is null', () => {
    const result = buildGreeting(null, { emoji: '🏖️', label: 'Paid Time Off' }, 'Hi!');
    expect(result).toBe('');
  });
});

// ════════════════════════════════════════════════════════════
// Block Kit Structure
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — structure', () => {
  it('produces valid Block Kit payload with header and sections', () => {
    const payload = renderAnswerAsBlocks(PTO_SHORT);
    expect(payload.blocks.length).toBeGreaterThan(0);
    expect(payload.blocks[0].type).toBe('header');
    expect(countBlockType(payload, 'section')).toBeGreaterThanOrEqual(1);
    expect(payload.text.length).toBeGreaterThan(0);
    expect(payload.truncated).toBe(false);
  });

  it('detects PTO topic from question', () => {
    const payload = renderAnswerAsBlocks(PTO_SHORT, { messageText: 'How many PTO days do I get?' });
    const header = payload.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain('🏖️');
    expect(header.text.text).toContain('Paid Time Off');
  });

  it('detects cybersecurity topic from question', () => {
    const payload = renderAnswerAsBlocks(CYBERSECURITY, { messageText: 'What is our cybersecurity policy?' });
    const header = payload.blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain('🛡️');
  });

  it('does NOT include greeting for direct policy question', () => {
    const payload = renderAnswerAsBlocks(PTO_SHORT, { messageText: 'How many PTO days?' });
    const sections = allSectionTexts(payload);
    expect(sections.some((t) => t.includes('Hey'))).toBe(false);
  });

  it('includes greeting for conversational opener', () => {
    const payload = renderAnswerAsBlocks(PTO_SHORT, {
      employeeName: 'Lapedra',
      messageText: 'Hi, can you help me with PTO?',
    });
    const sections = allSectionTexts(payload);
    expect(sections.some((t) => t.includes('Hey Lapedra!'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// Topic Classification (C8X-104)
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — topic classification', () => {
  function getHeaderText(payload: BlockKitPayload): string {
    return (payload.blocks[0] as { text: { text: string } }).text.text;
  }

  // Benefits questions — must show 💼 even when answer mentions PTO
  it('general benefits question → Employee Benefits header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(BENEFITS, {
      messageText: 'What benefits do we offer?',
    }));
    expect(header).toContain('💼');
    expect(header).toContain('Employee Benefits');
  });

  it('benefits with insurance/retirement/parental → Employee Benefits header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(BENEFITS, {
      messageText: 'What employee benefits does FFTC offer, including health insurance, retirement, and parental leave?',
    }));
    expect(header).toContain('💼');
    expect(header).toContain('Employee Benefits');
  });

  it('benefits answer containing incidental PTO → Employee Benefits (not PTO)', () => {
    // The BENEFITS fixture mentions "18 days accrued PTO" — must not override topic
    const header = getHeaderText(renderAnswerAsBlocks(BENEFITS, {
      messageText: 'What benefits do we offer?',
    }));
    expect(header).not.toContain('🏖️');
    expect(header).toContain('💼');
  });

  // PTO questions — must show 🏖️
  it('PTO accrual question → Paid Time Off header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(PTO_SHORT, {
      messageText: 'How many PTO days do I get?',
    }));
    expect(header).toContain('🏖️');
    expect(header).toContain('Paid Time Off');
  });

  it('PTO rollover question → Paid Time Off header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(PTO_DETAILED, {
      messageText: 'How many PTO days do I get, and can I roll them over?',
    }));
    expect(header).toContain('🏖️');
  });

  // Parental leave — must show 👶 even when answer mentions PTO
  it('parental leave question → Parental Leave header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(PARENTAL_LEAVE, {
      messageText: 'How does parental leave work?',
    }));
    expect(header).toContain('👶');
    expect(header).toContain('Parental Leave');
  });

  it('parental leave answer mentioning PTO → Parental Leave (not PTO)', () => {
    const answerWithPTO = makeResult(
      'Parental leave is 12 weeks. You may also use accrued PTO to extend your leave.',
      [{ chunkId: 'a', sourceUrl: 'https://notion.so/parental', title: 'Parental Leave' }]
    );
    const header = getHeaderText(renderAnswerAsBlocks(answerWithPTO, {
      messageText: 'How does parental leave work?',
    }));
    expect(header).toContain('👶');
    expect(header).not.toContain('🏖️');
  });

  // Sick leave
  it('sick leave question → Sick Leave header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(SICK_LEAVE, {
      messageText: 'How do I report sick leave?',
    }));
    expect(header).toContain('🤒');
  });

  // Cybersecurity
  it('cybersecurity question → Cybersecurity header', () => {
    const header = getHeaderText(renderAnswerAsBlocks(CYBERSECURITY, {
      messageText: 'What is our cybersecurity policy?',
    }));
    expect(header).toContain('🛡️');
  });

  // Ambiguous multi-policy: question mentions multiple topics
  it('ambiguous question with "benefits" and "PTO" → Employee Benefits', () => {
    const header = getHeaderText(renderAnswerAsBlocks(BENEFITS, {
      messageText: 'What benefits and PTO do we offer?',
    }));
    // "benefits" is a broad-topic indicator → overrides specific "PTO" match
    expect(header).toContain('💼');
  });

  // Greeting agrees with header topic
  it('greeting topic matches header for benefits question', () => {
    const payload = renderAnswerAsBlocks(BENEFITS, {
      employeeName: 'Lapedra',
      messageText: 'Hi, what benefits do we offer?',
    });
    const header = getHeaderText(payload);
    expect(header).toContain('Employee Benefits');
    const sections = allSectionTexts(payload);
    const greeting = sections.find((t) => t.includes('Hey Lapedra'));
    if (greeting) {
      expect(greeting).toContain('Employee Benefits');
    }
  });

  // Falls back to citation title when question has no topic keywords
  it('generic question uses citation title for topic', () => {
    const result = makeResult('Here is the policy information.', [
      { chunkId: 'a', sourceUrl: 'https://notion.so/cyber', title: 'Cybersecurity Policy' },
    ]);
    const header = getHeaderText(renderAnswerAsBlocks(result, {
      messageText: 'Tell me about that',
    }));
    expect(header).toContain('🛡️');
  });
});

// ════════════════════════════════════════════════════════════
// State-Specific Preservation
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — state-specific content', () => {
  it('preserves all state provisions', () => {
    const payload = renderAnswerAsBlocks(PARENTAL_LEAVE);
    const allText = allSectionTexts(payload).join(' ');
    expect(allText).toContain('New York');
    expect(allText).toContain('67%');
    expect(allText).toContain('Washington');
    expect(allText).toContain('California');
    expect(allText).toContain('60-70%');
    expect(allText).toContain('12 weeks');
    expect(allText).toContain('12 months');
  });
});

// ════════════════════════════════════════════════════════════
// Citations
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — citations', () => {
  it('deduplicates by page URL', () => {
    const payload = renderAnswerAsBlocks(PTO_DETAILED);
    const sourceSection = allSectionTexts(payload).find((t) => t.includes('Sources'));
    const linkCount = (sourceSection?.match(/• </g) || []).length;
    expect(linkCount).toBe(1);
  });

  it('keeps different pages separate', () => {
    const payload = renderAnswerAsBlocks(BENEFITS);
    const sourceSection = allSectionTexts(payload).find((t) => t.includes('Sources'));
    const linkCount = (sourceSection?.match(/• </g) || []).length;
    expect(linkCount).toBe(2);
  });

  it('strips URL fragments', () => {
    const payload = renderAnswerAsBlocks(PTO_SHORT);
    const sourceSection = allSectionTexts(payload).find((t) => t.includes('Sources'));
    expect(sourceSection).toContain('https://notion.so/pto|');
    expect(sourceSection).not.toContain('#block1');
  });

  it('escapes special chars in titles', () => {
    const result = makeResult('Answer.', [
      { chunkId: 'a', sourceUrl: 'https://notion.so/p', title: 'Q&A <Policy>' },
    ]);
    const payload = renderAnswerAsBlocks(result);
    const sourceSection = allSectionTexts(payload).find((t) => t.includes('Sources'));
    expect(sourceSection).toContain('&amp;');
  });

  it('omits sources for zero citations', () => {
    const result = makeResult('Answer.', []);
    const payload = renderAnswerAsBlocks(result);
    expect(countBlockType(payload, 'divider')).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// Long Answer Preservation
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — long answers', () => {
  it('splits oversized paragraphs into multiple sections', () => {
    const payload = renderAnswerAsBlocks(OVERSIZED_PARAGRAPH);
    // 100 bullet items in one paragraph should split into multiple sections
    expect(countBlockType(payload, 'section')).toBeGreaterThan(2);
    expect(payload.truncated).toBe(false);
  });

  it('marks truncation when content exceeds block limit', () => {
    const payload = renderAnswerAsBlocks(LONG_SECTION);
    expect(payload.blocks.length).toBeLessThanOrEqual(45);
    if (payload.truncated) {
      // Footer should indicate truncation
      const contextBlocks = payload.blocks.filter((b) => b.type === 'context');
      const footerText = JSON.stringify(contextBlocks);
      expect(footerText).toContain('shortened');
    }
  });

  it('preserves policy numbers in long answers', () => {
    const payload = renderAnswerAsBlocks(BENEFITS);
    const allText = allSectionTexts(payload).join(' ');
    expect(allText).toContain('401(k)');
    expect(allText).toContain('$50K');
    expect(allText).toContain('18 days');
  });

  it('plain-text fallback indicates truncation', () => {
    const payload = renderAnswerAsBlocks(LONG_SECTION);
    if (payload.truncated) {
      expect(payload.text.toLowerCase()).toContain('shortened');
    }
  });
});

// ════════════════════════════════════════════════════════════
// Personalization Safety
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — name safety', () => {
  it('escapes mention-like names', () => {
    const payload = renderAnswerAsBlocks(PTO_SHORT, {
      employeeName: '<@U12345>',
      messageText: 'Hi, help with PTO?',
    });
    const sections = allSectionTexts(payload);
    const greeting = sections.find((t) => t.includes('Hey'));
    expect(greeting).not.toContain('<@U12345>');
  });

  it('escapes HTML-like chars', () => {
    const name = escapeEmployeeName('Alice & Bob <script>');
    expect(name).toContain('&amp;');
    expect(name).toContain('&lt;');
  });
});

// ════════════════════════════════════════════════════════════
// Slack Safety
// ════════════════════════════════════════════════════════════

describe('renderAnswerAsBlocks — Slack safety', () => {
  it('neutralizes @channel', () => {
    const result = makeResult('Contact <!channel> for help.', []);
    const payload = renderAnswerAsBlocks(result);
    const allText = allSectionTexts(payload).join(' ');
    expect(allText).not.toContain('<!channel>');
  });

  it('enforces max block count', () => {
    const payload = renderAnswerAsBlocks(LONG_SECTION);
    expect(payload.blocks.length).toBeLessThanOrEqual(45);
  });
});

// ════════════════════════════════════════════════════════════
// Failure Rendering
// ════════════════════════════════════════════════════════════

describe('renderPipelineResultAsBlocks — failure', () => {
  it('renders abstention', () => {
    const payload = renderPipelineResultAsBlocks(ABSTENTION_RESULT);
    expect(payload.text).toContain("couldn't find enough");
    expect(payload.truncated).toBe(false);
  });

  it('never includes employee name in failure', () => {
    const payload = renderPipelineResultAsBlocks(ABSTENTION_RESULT, { employeeName: 'Lapedra' });
    const allText = allSectionTexts(payload).join(' ');
    expect(allText).not.toContain('Lapedra');
  });
});

// ════════════════════════════════════════════════════════════
// 12-Fixture Acceptance
// ════════════════════════════════════════════════════════════

describe('12-fixture acceptance', () => {
  const fixtures: Array<{ name: string; result: any; opts?: RenderOptions }> = [
    { name: 'PTO short', result: PTO_SHORT },
    { name: 'PTO detailed', result: PTO_DETAILED },
    { name: 'Parental leave with states', result: PARENTAL_LEAVE },
    { name: 'Benefits long', result: BENEFITS },
    { name: 'Long policy (many sections)', result: LONG_SECTION },
    { name: 'Oversized paragraph', result: OVERSIZED_PARAGRAPH },
    { name: 'Harassment (sensitive)', result: HARASSMENT },
    { name: 'Greeting with name', result: PTO_SHORT, opts: { employeeName: 'Lapedra', messageText: 'Hi, help me with PTO?' } },
    { name: 'Direct question (no greeting)', result: PTO_SHORT, opts: { messageText: 'How many PTO days?' } },
    { name: 'Name lookup failure', result: PTO_SHORT, opts: { employeeName: null } },
    { name: 'Zero citations', result: makeResult('Answer.', []) },
    { name: 'Abstention', result: ABSTENTION_RESULT },
  ];

  it.each(fixtures)('$name generates valid Block Kit', ({ result, opts }) => {
    const payload = result.ok === false
      ? renderPipelineResultAsBlocks(result, opts)
      : renderAnswerAsBlocks(result, opts);

    expect(payload.blocks.length).toBeGreaterThan(0);
    expect(payload.blocks.length).toBeLessThanOrEqual(45);
    expect(payload.text.length).toBeGreaterThan(0);
    expect(typeof payload.truncated).toBe('boolean');

    for (const block of payload.blocks) {
      expect(block.type).toBeDefined();
    }

    const allText = JSON.stringify(payload);
    expect(allText).not.toContain('<script');
    expect(allText).not.toContain('<!channel>');
  });
});
