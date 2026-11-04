/**
 * Anthropic Transport Adapter Tests
 *
 * All tests use mocked SDK clients. No live API calls.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAnthropicTransport,
  type AnthropicMessagesClient,
} from '../llm/anthropic-transport.js';

function mockMessages(response: unknown): AnthropicMessagesClient {
  return { create: vi.fn().mockResolvedValue(response) };
}

function mockMessagesError(err: Error): AnthropicMessagesClient {
  return { create: vi.fn().mockRejectedValue(err) };
}

describe('createAnthropicTransport', () => {
  const defaultParams = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: 'You are an HR assistant.',
    messages: [{ role: 'user' as const, content: 'What is PTO?' }],
  };
  const defaultOptions = {
    timeout: 20000,
    signal: new AbortController().signal,
  };

  it('passes params and options to SDK create()', async () => {
    const msgs = mockMessages({ content: [{ type: 'text', text: 'Answer' }] });
    const transport = createAnthropicTransport(msgs);
    await transport.createMessage(defaultParams, defaultOptions);

    expect(msgs.create).toHaveBeenCalledWith(
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are an HR assistant.',
        messages: [{ role: 'user', content: 'What is PTO?' }],
      },
      {
        timeout: 20000,
        signal: defaultOptions.signal,
      },
    );
  });

  it('extracts text content blocks', async () => {
    const msgs = mockMessages({
      content: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });
    const transport = createAnthropicTransport(msgs);
    const result = await transport.createMessage(defaultParams, defaultOptions);

    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({ type: 'text', text: 'First' });
    expect(result.content[1]).toEqual({ type: 'text', text: 'Second' });
  });

  it('handles tool_use blocks without text', async () => {
    const msgs = mockMessages({
      content: [
        { type: 'tool_use', id: 't1', name: 'fn', input: {} },
      ],
    });
    const transport = createAnthropicTransport(msgs);
    const result = await transport.createMessage(defaultParams, defaultOptions);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('tool_use');
    expect(result.content[0].text).toBeUndefined();
  });

  it('handles empty content array', async () => {
    const msgs = mockMessages({ content: [] });
    const transport = createAnthropicTransport(msgs);
    const result = await transport.createMessage(defaultParams, defaultOptions);
    expect(result.content).toHaveLength(0);
  });

  it('handles missing content', async () => {
    const msgs = mockMessages({});
    const transport = createAnthropicTransport(msgs);
    const result = await transport.createMessage(defaultParams, defaultOptions);
    expect(result.content).toHaveLength(0);
  });

  it('propagates SDK errors', async () => {
    const err = new Error('API error');
    err.name = 'APIError';
    const msgs = mockMessagesError(err);
    const transport = createAnthropicTransport(msgs);
    await expect(transport.createMessage(defaultParams, defaultOptions)).rejects.toThrow('API error');
  });

  it('propagates timeout/abort errors', async () => {
    const err = new Error('Request timed out');
    err.name = 'APIConnectionTimeoutError';
    const msgs = mockMessagesError(err);
    const transport = createAnthropicTransport(msgs);
    await expect(transport.createMessage(defaultParams, defaultOptions)).rejects.toThrow('Request timed out');
  });
});
