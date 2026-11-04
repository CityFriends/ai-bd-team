/**
 * HR LLM Client — Isolated Anthropic Interface
 *
 * Dependency-injected client for HR policy answer generation.
 * Uses only HR-specific credentials (HR_ANTHROPIC_API_KEY).
 * Never falls back to BD keys, models, or gateway modules.
 *
 * Both HR_AI_ENABLED and HR_LLM_ENABLED must be 'true' for any
 * transport call. When either is disabled, the client returns
 * { ok: false, code: 'disabled' } without inspecting credentials
 * or constructing an SDK client.
 *
 * Successful output validation does NOT mean an answer is factually
 * grounded, authorized, or safe to send to Slack. Citation validation
 * and retrieval-grounding checks are separate responsibilities.
 */

import { validateHROutput } from './prompt-defense.js';

// ── Configuration ───────────────────────────────────────────

/** Default model for HR answer generation. No BD fallback. */
export const HR_DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/** Maximum output tokens per request. */
export const HR_MAX_OUTPUT_TOKENS = 1024;

/** Hard request timeout in milliseconds. */
export const HR_REQUEST_TIMEOUT_MS = 20_000;

// ── Interfaces ──────────────────────────────────────────────

export interface HRLLMRequest {
  systemPrompt: string;
  userContent: string;
}

export type HRLLMResult =
  | { ok: true; text: string }
  | {
      ok: false;
      code:
        | 'disabled'
        | 'configuration_error'
        | 'invalid_request'
        | 'timeout'
        | 'rate_limited'
        | 'provider_error'
        | 'invalid_response';
    };

/**
 * Transport interface for the Anthropic messages API.
 * Tests inject a fake; production supplies the real SDK.
 */
export interface HRLLMTransport {
  createMessage(
    params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    },
    options: {
      timeout: number;
      signal: AbortSignal;
    }
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
}

export interface HRLLMClientConfig {
  transport: HRLLMTransport;
  /** Override timeout for testing. Defaults to HR_REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
}

// ── Runtime Feature Gates ───────────────────────────────────

function isHRAIEnabled(): boolean {
  return process.env.HR_AI_ENABLED?.toLowerCase() === 'true';
}

function isHRLLMEnabled(): boolean {
  return process.env.HR_LLM_ENABLED?.toLowerCase() === 'true';
}

// ── Error Classification ────────────────────────────────────

function classifyError(err: unknown): HRLLMResult {
  if (err instanceof Error) {
    // Check for abort/timeout — the SDK throws APIConnectionTimeoutError
    // or APIUserAbortError when the signal fires or timeout is exceeded.
    if (
      err.name === 'APIConnectionTimeoutError' ||
      err.name === 'APIUserAbortError' ||
      err.name === 'AbortError'
    ) {
      return { ok: false, code: 'timeout' };
    }
    if (err.name === 'RateLimitError') {
      return { ok: false, code: 'rate_limited' };
    }
    // All other SDK/provider errors
    if (
      err.name === 'APIError' ||
      err.name === 'APIConnectionError' ||
      err.name === 'AuthenticationError' ||
      err.name === 'BadRequestError' ||
      err.name === 'InternalServerError' ||
      err.name === 'NotFoundError' ||
      err.name === 'ConflictError'
    ) {
      return { ok: false, code: 'provider_error' };
    }
  }
  // Unknown exception — sanitize to generic provider error
  return { ok: false, code: 'provider_error' };
}

// ── Client ──────────────────────────────────────────────────

/**
 * Create an HR LLM client with an injected transport.
 *
 * The transport is stored but never called unless both feature gates
 * pass at invocation time. This means tests can inject a spy transport
 * and verify it receives zero calls when gates are disabled.
 */
export function createHRLLMClient(config: HRLLMClientConfig) {
  const { transport, timeoutMs = HR_REQUEST_TIMEOUT_MS } = config;

  return {
    /**
     * Send a request to the Anthropic API via the injected transport.
     *
     * Gates checked at invocation time:
     *   1. HR_AI_ENABLED must be 'true'
     *   2. HR_LLM_ENABLED must be 'true'
     *
     * On success, output is validated via validateHROutput().
     * Invalid output returns { ok: false, code: 'invalid_response' }.
     */
    async complete(request: HRLLMRequest): Promise<HRLLMResult> {
      // Gate 1: HR AI must be enabled
      if (!isHRAIEnabled()) {
        return { ok: false, code: 'disabled' };
      }

      // Gate 2: HR LLM must be enabled
      if (!isHRLLMEnabled()) {
        return { ok: false, code: 'disabled' };
      }

      // Validate request shape
      if (
        !request ||
        typeof request.systemPrompt !== 'string' ||
        request.systemPrompt.length === 0 ||
        typeof request.userContent !== 'string' ||
        request.userContent.length === 0
      ) {
        return { ok: false, code: 'invalid_request' };
      }

      // Create abort controller for timeout cancellation
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await transport.createMessage(
          {
            model: HR_DEFAULT_MODEL,
            max_tokens: HR_MAX_OUTPUT_TOKENS,
            system: request.systemPrompt,
            messages: [{ role: 'user', content: request.userContent }],
          },
          {
            timeout: timeoutMs,
            signal: controller.signal,
          }
        );

        // Extract text from response
        const textBlock = response?.content?.find(
          (block) => block.type === 'text' && typeof block.text === 'string'
        );

        if (!textBlock?.text) {
          return { ok: false, code: 'invalid_response' };
        }

        // Validate output through safety contracts
        const validation = validateHROutput(textBlock.text);
        if (!validation.ok) {
          return { ok: false, code: 'invalid_response' };
        }

        return { ok: true, text: validation.text };
      } catch (err) {
        return classifyError(err);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
