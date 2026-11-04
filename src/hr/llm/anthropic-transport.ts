/**
 * Anthropic SDK Transport Adapter
 *
 * Adapts the @anthropic-ai/sdk Messages API to the HRLLMTransport
 * interface used by the HR LLM client.
 *
 * Dependency-injected: accepts an Anthropic client instance rather
 * than constructing one. The caller is responsible for providing
 * a properly configured client with the HR-specific API key.
 *
 * No environment variables are read at import time.
 * No credentials are logged.
 * No automatic retries.
 */

import type { HRLLMTransport } from './hr-llm-client.js';

/**
 * Minimal interface for the Anthropic Messages resource.
 * Matches @anthropic-ai/sdk Messages.create() for non-streaming calls.
 * Declared here to avoid coupling the transport interface to the
 * full SDK type surface — tests can provide a simple mock.
 */
export interface AnthropicMessagesClient {
  create(
    body: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    },
    options?: {
      timeout?: number;
      signal?: AbortSignal | null;
    },
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
}

/**
 * Create an HRLLMTransport backed by a real Anthropic SDK client.
 *
 * Usage:
 *   import Anthropic from '@anthropic-ai/sdk';
 *   const client = new Anthropic({ apiKey: process.env.HR_ANTHROPIC_API_KEY });
 *   const transport = createAnthropicTransport(client.messages);
 */
export function createAnthropicTransport(
  messages: AnthropicMessagesClient,
): HRLLMTransport {
  return {
    async createMessage(params, options) {
      const response = await messages.create(
        {
          model: params.model,
          max_tokens: params.max_tokens,
          system: params.system,
          messages: params.messages,
        },
        {
          timeout: options.timeout,
          signal: options.signal,
        },
      );

      return {
        content: (response.content || []).map((block) => ({
          type: block.type,
          text: 'text' in block ? (block.text as string | undefined) : undefined,
        })),
      };
    },
  };
}
