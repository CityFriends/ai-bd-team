/**
 * HR Input and Output Safety Contracts
 *
 * Pure validation functions for employee questions and generated responses.
 * No network, database, SDK, or environment-variable access.
 *
 * These checks are defense in depth — they reduce risk but do not
 * prevent all prompt injection or data leakage on their own.
 *
 * Trust model:
 *   - System instructions are trusted (authored by developers).
 *   - Employee questions are untrusted (arbitrary user input).
 *   - Retrieved knowledge excerpts are untrusted (synced from Notion).
 *   Retrieved content must never be promoted to system instructions,
 *   regardless of its apparent formatting or authority claims.
 */

// ── Limits ──────────────────────────────────────────────────

/** Maximum employee question length in Unicode code points. */
export const MAX_QUESTION_CODE_POINTS = 500;

/** Maximum generated output length in Unicode code points. */
export const MAX_OUTPUT_CODE_POINTS = 8000;

/**
 * Internal delimiters used to separate prompt sections.
 * If these appear in generated output, the model may have leaked
 * prompt structure. Defined here so both assembly and validation
 * use the same strings.
 */
export const PROMPT_DELIMITERS = [
  '---HR_SYSTEM_INSTRUCTIONS---',
  '---HR_POLICY_EXCERPTS---',
  '---EMPLOYEE_QUESTION---',
] as const;

// ── Trust Boundary Types ────────────────────────────────────

/**
 * Trusted application instructions authored by developers.
 * Branded type — cannot be created from arbitrary strings at the type level.
 * Runtime enforcement is the caller's responsibility.
 */
export type TrustedSystemPrompt = string & { readonly __brand: 'TrustedSystemPrompt' };

/**
 * Untrusted employee question. Always treat as adversarial input.
 */
export type UntrustedQuestion = string & { readonly __brand: 'UntrustedQuestion' };

/**
 * Untrusted retrieved knowledge excerpt from Notion.
 * Even if the content looks like instructions or system prompts,
 * it must never be promoted to TrustedSystemPrompt.
 */
export type UntrustedExcerpt = string & { readonly __brand: 'UntrustedExcerpt' };

// ── Input Validation ────────────────────────────────────────

export type HRQuestionValidationResult =
  | { ok: true; question: string }
  | {
      ok: false;
      code: 'invalid_type' | 'empty_question' | 'question_too_long' | 'unsafe_control_character';
    };

// Unsafe control characters: C0 controls except \t (\x09), \n (\x0a), \r (\x0d).
// Also rejects DEL (\x7f) and C1 controls (\x80-\x9f).
const UNSAFE_CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;

/**
 * Validate and normalize an employee's HR question.
 *
 * Accepts only strings. Normalizes line endings to \n.
 * Rejects empty, oversized, or control-character-laden input.
 * Does not remove phrases that merely resemble prompt injection —
 * that would alter the employee's intended meaning.
 */
export function validateHRQuestion(input: unknown): HRQuestionValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, code: 'invalid_type' };
  }

  if (UNSAFE_CONTROL_RE.test(input)) {
    return { ok: false, code: 'unsafe_control_character' };
  }

  // Normalize line endings: \r\n and \r → \n
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (normalized.trim().length === 0) {
    return { ok: false, code: 'empty_question' };
  }

  // Count Unicode code points (handles surrogate pairs correctly)
  if ([...normalized].length > MAX_QUESTION_CODE_POINTS) {
    return { ok: false, code: 'question_too_long' };
  }

  return { ok: true, question: normalized };
}

// ── Output Validation ───────────────────────────────────────

export type HROutputValidationResult =
  | { ok: true; text: string }
  | {
      ok: false;
      code:
        | 'invalid_type'
        | 'empty_output'
        | 'output_too_long'
        | 'unsafe_control_character'
        | 'internal_delimiter'
        | 'credential_artifact';
    };

// Conservative credential patterns — intentionally narrow to avoid
// false positives on normal HR content. These detect obvious artifacts,
// not all possible secrets.
const CREDENTIAL_PATTERNS = [
  /\bsk-ant-api\w{2}-[A-Za-z0-9_-]{20,}/, // Anthropic API key prefix
  /\bxoxb-[0-9]+-[A-Za-z0-9]+/, // Slack bot token
  /\bxapp-[0-9]+-[A-Za-z0-9]+/, // Slack app token
  /\beyJhbGciOi[A-Za-z0-9_-]{20,}/, // JWT (base64 "alg":"...)
  /\bpostgresql:\/\/[^\s]{10,}/, // Connection string
];

/**
 * Validate generated output before sending to an employee.
 *
 * Rejects empty, oversized, control-character, delimiter-leaking,
 * or credential-containing responses. Returns only error codes,
 * never the rejected content.
 */
export function validateHROutput(input: unknown): HROutputValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, code: 'invalid_type' };
  }

  if (input.length === 0) {
    return { ok: false, code: 'empty_output' };
  }

  if (UNSAFE_CONTROL_RE.test(input)) {
    return { ok: false, code: 'unsafe_control_character' };
  }

  if ([...input].length > MAX_OUTPUT_CODE_POINTS) {
    return { ok: false, code: 'output_too_long' };
  }

  for (const delimiter of PROMPT_DELIMITERS) {
    if (input.includes(delimiter)) {
      return { ok: false, code: 'internal_delimiter' };
    }
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(input)) {
      return { ok: false, code: 'credential_artifact' };
    }
  }

  return { ok: true, text: input };
}
