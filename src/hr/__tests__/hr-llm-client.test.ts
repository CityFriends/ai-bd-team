/**
 * HR LLM Client Tests — Offline, Mocked Transport
 *
 * All tests use a fake transport. No real Anthropic API calls.
 * No credentials, production data, or network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHRLLMClient,
  HR_DEFAULT_MODEL,
  HR_MAX_OUTPUT_TOKENS,
  HR_REQUEST_TIMEOUT_MS,
  type HRLLMTransport,
  type HRLLMRequest,
  type HRLLMResult,
} from '../llm/hr-llm-client.js';
import { PROMPT_DELIMITERS } from '../llm/prompt-defense.js';

// ── Helpers ─────────────────────────────────────────────────

function fakeTransport(response?: { content: Array<{ type: string; text?: string }> }): HRLLMTransport & { createMessage: ReturnType<typeof vi.fn> } {
  return {
    createMessage: vi.fn().mockResolvedValue(response ?? {
      content: [{ type: 'text', text: 'FFTC employees receive 15 days of PTO per year.' }],
    }),
  };
}

function timeoutTransport(): HRLLMTransport & { createMessage: ReturnType<typeof vi.fn> } {
  return {
    createMessage: vi.fn().mockImplementation((_params, options) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          const err = new Error('Request aborted');
          err.name = 'APIConnectionTimeoutError';
          reject(err);
        };
        if (options.signal.aborted) { onAbort(); return; }
        options.signal.addEventListener('abort', onAbort);
      });
    }),
  };
}

function errorTransport(name: string, message = 'error'): HRLLMTransport {
  return {
    createMessage: vi.fn().mockRejectedValue(Object.assign(new Error(message), { name })),
  };
}

const VALID_REQUEST: HRLLMRequest = {
  systemPrompt: 'You are an HR assistant.',
  userContent: 'What is the PTO policy?',
};

// ── Environment Setup ───────────────────────────────────────

const savedAI = process.env.HR_AI_ENABLED;
const savedLLM = process.env.HR_LLM_ENABLED;

beforeEach(() => {
  process.env.HR_AI_ENABLED = 'true';
  process.env.HR_LLM_ENABLED = 'true';
});

afterEach(() => {
  if (savedAI !== undefined) process.env.HR_AI_ENABLED = savedAI;
  else delete process.env.HR_AI_ENABLED;
  if (savedLLM !== undefined) process.env.HR_LLM_ENABLED = savedLLM;
  else delete process.env.HR_LLM_ENABLED;
});

// ============================================================
// Feature Gates
// ============================================================

describe('Feature gates', () => {
  it('1. AI disabled: zero transport calls', async () => {
    process.env.HR_AI_ENABLED = 'false';
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'disabled' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('2. LLM disabled: zero transport calls', async () => {
    process.env.HR_LLM_ENABLED = 'false';
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'disabled' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('3. Both disabled: zero transport calls', async () => {
    process.env.HR_AI_ENABLED = 'false';
    process.env.HR_LLM_ENABLED = 'false';
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'disabled' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('4. Missing AI flag: fail closed', async () => {
    delete process.env.HR_AI_ENABLED;
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'disabled' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('4b. Missing LLM flag: fail closed', async () => {
    delete process.env.HR_LLM_ENABLED;
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'disabled' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('4c. Malformed AI flag: fail closed', async () => {
    process.env.HR_AI_ENABLED = 'yes';
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'disabled' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('5. Flags evaluated at invocation time, not construction', async () => {
    process.env.HR_AI_ENABLED = 'false';
    process.env.HR_LLM_ENABLED = 'false';
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });

    // First call: disabled
    const r1 = await client.complete(VALID_REQUEST);
    expect(r1.ok).toBe(false);

    // Enable flags
    process.env.HR_AI_ENABLED = 'true';
    process.env.HR_LLM_ENABLED = 'true';

    // Second call: enabled
    const r2 = await client.complete(VALID_REQUEST);
    expect(r2.ok).toBe(true);
    expect(t.createMessage).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Request Validation
// ============================================================

describe('Request validation', () => {
  it('6. Missing system prompt: invalid_request', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete({ systemPrompt: '', userContent: 'question' });
    expect(result).toEqual({ ok: false, code: 'invalid_request' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });

  it('6b. Missing user content: invalid_request', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete({ systemPrompt: 'system', userContent: '' });
    expect(result).toEqual({ ok: false, code: 'invalid_request' });
    expect(t.createMessage).not.toHaveBeenCalled();
  });
});

// ============================================================
// Successful Request
// ============================================================

describe('Successful request', () => {
  it('7. Valid synthetic request returns text', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: true, text: 'FFTC employees receive 15 days of PTO per year.' });
  });

  it('8. Output-token limit enforced in transport call', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    await client.complete(VALID_REQUEST);
    expect(t.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: HR_MAX_OUTPUT_TOKENS }),
      expect.any(Object)
    );
  });

  it('8b. Default model used in transport call', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    await client.complete(VALID_REQUEST);
    expect(t.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: HR_DEFAULT_MODEL }),
      expect.any(Object)
    );
  });

  it('9. Timeout configured in transport call', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    await client.complete(VALID_REQUEST);
    expect(t.createMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ timeout: HR_REQUEST_TIMEOUT_MS })
    );
  });

  it('9b. AbortSignal passed to transport', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    await client.complete(VALID_REQUEST);
    const callArgs = t.createMessage.mock.calls[0][1];
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
  });
});

// ============================================================
// Timeout and Cancellation
// ============================================================

describe('Timeout and cancellation', () => {
  it('10. Timeout cancels the underlying operation', async () => {
    const t = timeoutTransport();
    const client = createHRLLMClient({ transport: t, timeoutMs: 50 });

    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'timeout' });
    expect(t.createMessage).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Error Handling
// ============================================================

describe('Error handling', () => {
  it('11. Rate-limit error mapped to rate_limited', async () => {
    const client = createHRLLMClient({ transport: errorTransport('RateLimitError') });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('12. Provider error mapped to provider_error', async () => {
    const client = createHRLLMClient({ transport: errorTransport('APIError') });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'provider_error' });
  });

  it('12b. Authentication error mapped to provider_error', async () => {
    const client = createHRLLMClient({ transport: errorTransport('AuthenticationError') });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'provider_error' });
  });

  it('13. Unexpected exception sanitized to provider_error', async () => {
    const client = createHRLLMClient({
      transport: { createMessage: vi.fn().mockRejectedValue(new TypeError('unexpected')) },
    });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'provider_error' });
  });

  it('14. Empty response rejected', async () => {
    const client = createHRLLMClient({
      transport: fakeTransport({ content: [] }),
    });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('15. Malformed response (no text field) rejected', async () => {
    const client = createHRLLMClient({
      transport: fakeTransport({ content: [{ type: 'text' }] }),
    });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('15b. Response with only tool_use blocks rejected', async () => {
    const client = createHRLLMClient({
      transport: fakeTransport({ content: [{ type: 'tool_use' }] }),
    });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'invalid_response' });
  });
});

// ============================================================
// Output Safety Integration
// ============================================================

describe('Output safety integration', () => {
  it('16. Internal prompt delimiter in response rejected', async () => {
    const client = createHRLLMClient({
      transport: fakeTransport({
        content: [{ type: 'text', text: `Answer: ${PROMPT_DELIMITERS[0]} leaked` }],
      }),
    });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('17. Synthetic credential artifact in response rejected', async () => {
    const client = createHRLLMClient({
      transport: fakeTransport({
        content: [{ type: 'text', text: 'Use key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
      }),
    });
    const result = await client.complete(VALID_REQUEST);
    expect(result).toEqual({ ok: false, code: 'invalid_response' });
  });
});

// ============================================================
// Credential Isolation
// ============================================================

describe('Credential isolation', () => {
  it('18. No BD credential or model fallback', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    await client.complete(VALID_REQUEST);

    // Model must be HR_DEFAULT_MODEL, never a BD model
    const params = t.createMessage.mock.calls[0][0];
    expect(params.model).toBe(HR_DEFAULT_MODEL);
    expect(params.model).not.toContain('haiku');
  });
});

// ============================================================
// No Logging
// ============================================================

describe('No request/response logging', () => {
  it('19. Console is not called during successful request', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = createHRLLMClient({ transport: fakeTransport() });
    await client.complete(VALID_REQUEST);

    expect(spy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    spy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('19b. Console is not called during error', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = createHRLLMClient({ transport: errorTransport('APIError') });
    await client.complete(VALID_REQUEST);

    expect(spy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    spy.mockRestore();
    errSpy.mockRestore();
  });
});

// ============================================================
// No Real Network
// ============================================================

describe('No real network calls', () => {
  it('20. Transport is the only external call', async () => {
    const t = fakeTransport();
    const client = createHRLLMClient({ transport: t });
    await client.complete(VALID_REQUEST);
    // The only external interaction is the single createMessage call
    expect(t.createMessage).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Constants
// ============================================================

describe('Configuration constants', () => {
  it('HR_DEFAULT_MODEL is set', () => {
    expect(HR_DEFAULT_MODEL).toBeTruthy();
    expect(typeof HR_DEFAULT_MODEL).toBe('string');
  });

  it('HR_MAX_OUTPUT_TOKENS is 1024', () => {
    expect(HR_MAX_OUTPUT_TOKENS).toBe(1024);
  });

  it('HR_REQUEST_TIMEOUT_MS is 20000', () => {
    expect(HR_REQUEST_TIMEOUT_MS).toBe(20_000);
  });
});
