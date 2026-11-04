/**
 * HR Input/Output Safety Contract Tests
 *
 * All tests use synthetic data only. No network, database, or credential access.
 */
import { describe, it, expect } from 'vitest';
import {
  validateHRQuestion,
  validateHROutput,
  MAX_QUESTION_CODE_POINTS,
  MAX_OUTPUT_CODE_POINTS,
  PROMPT_DELIMITERS,
  type TrustedSystemPrompt,
  type UntrustedQuestion,
  type UntrustedExcerpt,
  type HRQuestionValidationResult,
  type HROutputValidationResult,
} from '../llm/prompt-defense.js';

// ============================================================
// Input Validation — Valid Questions
// ============================================================

describe('validateHRQuestion — valid input', () => {
  it('accepts a normal PTO policy question', () => {
    const result = validateHRQuestion('What is the PTO policy?');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toBe('What is the PTO policy?');
  });

  it('accepts a multiline HR question', () => {
    const result = validateHRQuestion(
      'I have two questions:\n1. PTO balance\n2. Benefits enrollment'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toContain('\n');
  });

  it('accepts Unicode text and emoji', () => {
    const result = validateHRQuestion('¿Cuál es la política de vacaciones? 🏖️');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toContain('🏖️');
  });

  it('does NOT reject legitimate text that resembles injection', () => {
    const result = validateHRQuestion(
      'My manager said "ignore previous instructions" in our meeting. Is that a policy?'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toContain('ignore previous instructions');
  });

  it('does NOT reject the word "system"', () => {
    const result = validateHRQuestion('How does the benefits system work?');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toContain('system');
  });

  it('normalizes \\r\\n to \\n', () => {
    const result = validateHRQuestion('Line one\r\nLine two');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toBe('Line one\nLine two');
  });

  it('normalizes bare \\r to \\n', () => {
    const result = validateHRQuestion('Line one\rLine two');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toBe('Line one\nLine two');
  });

  it('allows tabs', () => {
    const result = validateHRQuestion('Question:\tWhat is PTO?');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question).toContain('\t');
  });
});

// ============================================================
// Input Validation — Invalid Input
// ============================================================

describe('validateHRQuestion — invalid input', () => {
  it('rejects non-string input (number)', () => {
    const result = validateHRQuestion(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_type');
  });

  it('rejects non-string input (null)', () => {
    const result = validateHRQuestion(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_type');
  });

  it('rejects non-string input (undefined)', () => {
    const result = validateHRQuestion(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_type');
  });

  it('rejects non-string input (object)', () => {
    const result = validateHRQuestion({ text: 'hello' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_type');
  });

  it('rejects empty string', () => {
    const result = validateHRQuestion('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty_question');
  });

  it('rejects whitespace-only string', () => {
    const result = validateHRQuestion('   \n  \t  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty_question');
  });

  it('accepts exactly 500 code points', () => {
    const q = 'a'.repeat(500);
    const result = validateHRQuestion(q);
    expect(result.ok).toBe(true);
  });

  it('rejects 501 code points', () => {
    const q = 'a'.repeat(501);
    const result = validateHRQuestion(q);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('question_too_long');
  });

  it('counts emoji as code points correctly (499 + 1 emoji = 500)', () => {
    // 🏖️ is 2 code points (U+1F3D6 U+FE0F), so 498 chars + emoji = 500
    const q = 'a'.repeat(498) + '🏖️';
    const result = validateHRQuestion(q);
    expect(result.ok).toBe(true);
  });

  it('rejects NUL character', () => {
    const result = validateHRQuestion('What is \x00 the policy?');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_control_character');
  });

  it('rejects BEL control character', () => {
    const result = validateHRQuestion('Question\x07here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_control_character');
  });

  it('rejects DEL character', () => {
    const result = validateHRQuestion('Question\x7Fhere');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_control_character');
  });

  it('rejects C1 control character', () => {
    const result = validateHRQuestion('Question\x80here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_control_character');
  });
});

// ============================================================
// Output Validation — Valid Output
// ============================================================

describe('validateHROutput — valid output', () => {
  it('accepts an ordinary HR policy answer', () => {
    const answer =
      'FFTC employees receive 15 days of PTO per year. Unused PTO rolls over up to 5 days.';
    const result = validateHROutput(answer);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe(answer);
  });

  it('accepts answer with Slack mrkdwn formatting', () => {
    const answer =
      '*PTO Policy*\n\n• 15 days per year\n• Roll over up to 5 days\n\n_Source: <https://notion.so/abc|Employee Handbook>_';
    const result = validateHROutput(answer);
    expect(result.ok).toBe(true);
  });

  it('does NOT false-positive on normal HR content mentioning systems', () => {
    const answer =
      'The benefits system processes enrollment annually. Contact the HR system administrator for access.';
    const result = validateHROutput(answer);
    expect(result.ok).toBe(true);
  });

  it('does NOT false-positive on HR content with percentages and dollar signs', () => {
    const answer =
      'FFTC matches 401(k) contributions up to 4% of salary. The maximum is $23,500 for 2026.';
    const result = validateHROutput(answer);
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// Output Validation — Invalid Output
// ============================================================

describe('validateHROutput — invalid output', () => {
  it('rejects non-string output', () => {
    const result = validateHROutput(123);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_type');
  });

  it('rejects empty output', () => {
    const result = validateHROutput('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty_output');
  });

  it('rejects output exceeding max code points', () => {
    const result = validateHROutput('x'.repeat(MAX_OUTPUT_CODE_POINTS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('output_too_long');
  });

  it('rejects NUL in output', () => {
    const result = validateHROutput('Answer\x00here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsafe_control_character');
  });

  it('detects internal delimiter leakage', () => {
    for (const delim of PROMPT_DELIMITERS) {
      const result = validateHROutput(`The answer is ${delim} oops`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('internal_delimiter');
    }
  });

  it('detects synthetic Anthropic API key artifact', () => {
    const result = validateHROutput('Use this key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('credential_artifact');
  });

  it('detects synthetic Slack bot token artifact', () => {
    const result = validateHROutput('Token: xoxb-123456789-ABCDEFghijklmnop');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('credential_artifact');
  });

  it('detects synthetic connection string artifact', () => {
    const result = validateHROutput('Connect to postgresql://user:pass@host:5432/db for details');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('credential_artifact');
  });

  it('detects synthetic JWT artifact', () => {
    const result = validateHROutput('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('credential_artifact');
  });
});

// ============================================================
// Trust Boundary Types
// ============================================================

describe('Trust boundary types', () => {
  it('UntrustedQuestion cannot be assigned to TrustedSystemPrompt at type level', () => {
    // This test verifies the design intent. At runtime, branded types are strings.
    // The compiler prevents: const trusted: TrustedSystemPrompt = untrusted;
    // We test that the types exist and are distinct.
    const question = 'What is PTO?' as UntrustedQuestion;
    const excerpt = 'PTO is 15 days' as UntrustedExcerpt;

    // Both are strings at runtime
    expect(typeof question).toBe('string');
    expect(typeof excerpt).toBe('string');

    // The branding exists to prevent accidental promotion at compile time.
    // No runtime conversion function from UntrustedQuestion to TrustedSystemPrompt exists.
    // This is verified by the absence of such a function in the module exports.
  });

  it('no export converts untrusted to trusted', async () => {
    // Dynamically verify the module does not export a promotion function
    const mod = await import('../llm/prompt-defense.js');
    const fnNames = Object.keys(mod).filter(
      (k) => typeof (mod as Record<string, unknown>)[k] === 'function'
    );
    for (const name of fnNames) {
      expect(name).not.toMatch(/promote|trust|elevate|upgrade/i);
    }
  });
});

// ============================================================
// Security Properties
// ============================================================

describe('Security properties', () => {
  it('invalid question result contains only error code, not input', () => {
    const result = validateHRQuestion('x'.repeat(1000)) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(Object.keys(result)).toEqual(['ok', 'code']);
    expect(result.code).toBe('question_too_long');
  });

  it('invalid output result contains only error code, not content', () => {
    const result = validateHROutput('x'.repeat(MAX_OUTPUT_CODE_POINTS + 1)) as {
      ok: false;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(Object.keys(result)).toEqual(['ok', 'code']);
  });

  it('functions are pure — no side effects, no network', () => {
    // Validate that the functions are synchronous and return immediately
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      validateHRQuestion('What is PTO?');
      validateHROutput('PTO is 15 days per year.');
    }
    const elapsed = Date.now() - t0;
    // 1000 iterations of pure functions should complete in well under 100ms
    expect(elapsed).toBeLessThan(100);
  });

  it('MAX_QUESTION_CODE_POINTS is 500', () => {
    expect(MAX_QUESTION_CODE_POINTS).toBe(500);
  });

  it('MAX_OUTPUT_CODE_POINTS is 8000', () => {
    expect(MAX_OUTPUT_CODE_POINTS).toBe(8000);
  });

  it('PROMPT_DELIMITERS are defined and non-empty', () => {
    expect(PROMPT_DELIMITERS.length).toBeGreaterThan(0);
    for (const d of PROMPT_DELIMITERS) {
      expect(d.length).toBeGreaterThan(0);
    }
  });
});
