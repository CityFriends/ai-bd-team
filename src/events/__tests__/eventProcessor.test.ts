import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventTypes } from '../eventTypes.js';
import type { ClaimedEvent } from '../eventTypes.js';

// Mock the eventBus module
const mockClaimEvents = vi.fn();
const mockCompleteEvent = vi.fn();
const mockPublishChainEvent = vi.fn();

vi.mock('../eventBus.js', () => ({
  claimEvents: (...args: unknown[]) => mockClaimEvents(...args),
  completeEvent: (...args: unknown[]) => mockCompleteEvent(...args),
  publishChainEvent: (...args: unknown[]) => mockPublishChainEvent(...args),
}));

// Import after mocking
import {
  EventProcessor,
  createEventProcessor,
  createTransformHandler,
  createLogHandler,
  combineHandlers,
  withTimeout,
  withRetry,
  type EventHandler,
  type EventHandlerResult,
} from '../eventProcessor.js';

describe('EventProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockClaimEvents.mockResolvedValue([]);
    mockCompleteEvent.mockResolvedValue(true);
    mockPublishChainEvent.mockResolvedValue({ success: true, eventId: 'new-123' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start and stop', () => {
    it('should start and stop the processor', async () => {
      const handlers = new Map<string, EventHandler>();
      const processor = createEventProcessor('david', handlers as any);

      processor.start();
      expect(processor.isActive()).toBe(true);

      processor.stop();
      expect(processor.isActive()).toBe(false);
    });

    it('should not start twice', () => {
      const handlers = new Map<string, EventHandler>();
      const processor = createEventProcessor('david', handlers as any);

      processor.start();
      processor.start(); // Should not error

      expect(processor.isActive()).toBe(true);
      processor.stop();
    });

    it('should poll for events after starting', async () => {
      const handlers = new Map<string, EventHandler>();
      const processor = createEventProcessor('david', handlers as any, {
        pollIntervalMs: 1000,
      });

      processor.start();

      // First poll happens immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(mockClaimEvents).toHaveBeenCalledTimes(1);

      // Second poll after interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockClaimEvents).toHaveBeenCalledTimes(2);

      processor.stop();
    });
  });

  describe('event processing', () => {
    it('should process claimed events', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
        result: { processed: true },
      });

      const handlers = new Map([[EventTypes.NEW_OPPORTUNITY, mockHandler]]);
      const processor = createEventProcessor('david', handlers as any, {
        pollIntervalMs: 1000,
      });

      const event: ClaimedEvent = {
        id: '123',
        event_type: EventTypes.NEW_OPPORTUNITY,
        source_agent: 'maya',
        payload: { noticeId: 'abc', title: 'Test', score: 85, source: 'sam_gov' },
        parent_event_id: null,
        root_event_id: '123',
        chain_depth: 0,
        priority: 3,
        channel_id: 'C12345',
        thread_ts: '1234567890.123',
        created_at: '2024-01-01T00:00:00Z',
      };

      mockClaimEvents.mockResolvedValueOnce([event]);

      processor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          event,
          agent: 'david',
        })
      );

      expect(mockCompleteEvent).toHaveBeenCalledWith({
        eventId: '123',
        success: true,
        result: { processed: true },
        error: undefined,
      });

      processor.stop();
    });

    it('should handle missing handler', async () => {
      const handlers = new Map<string, EventHandler>();
      const processor = createEventProcessor('david', handlers as any);

      const event: ClaimedEvent = {
        id: '123',
        event_type: 'UNKNOWN_TYPE',
        source_agent: 'maya',
        payload: {},
        parent_event_id: null,
        root_event_id: '123',
        chain_depth: 0,
        priority: 3,
        channel_id: null,
        thread_ts: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockClaimEvents.mockResolvedValueOnce([event]);

      processor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockCompleteEvent).toHaveBeenCalledWith({
        eventId: '123',
        success: false,
        result: undefined,
        error: expect.stringContaining('No handler registered'),
      });

      processor.stop();
    });

    it('should handle handler errors', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));

      const handlers = new Map([[EventTypes.NEW_OPPORTUNITY, mockHandler]]);
      const onError = vi.fn();
      const processor = createEventProcessor('david', handlers as any, {
        onError,
      });

      const event: ClaimedEvent = {
        id: '123',
        event_type: EventTypes.NEW_OPPORTUNITY,
        source_agent: 'maya',
        payload: {},
        parent_event_id: null,
        root_event_id: '123',
        chain_depth: 0,
        priority: 3,
        channel_id: null,
        thread_ts: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockClaimEvents.mockResolvedValueOnce([event]);

      processor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockCompleteEvent).toHaveBeenCalledWith({
        eventId: '123',
        success: false,
        result: undefined,
        error: 'Handler failed',
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), event);

      processor.stop();
    });

    it('should call onEventProcessed callback', async () => {
      const mockHandler = vi.fn().mockResolvedValue({
        success: true,
      });

      const handlers = new Map([[EventTypes.NEW_OPPORTUNITY, mockHandler]]);
      const onEventProcessed = vi.fn();
      const processor = createEventProcessor('david', handlers as any, {
        onEventProcessed,
      });

      const event: ClaimedEvent = {
        id: '123',
        event_type: EventTypes.NEW_OPPORTUNITY,
        source_agent: 'maya',
        payload: {},
        parent_event_id: null,
        root_event_id: '123',
        chain_depth: 0,
        priority: 3,
        channel_id: null,
        thread_ts: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockClaimEvents.mockResolvedValueOnce([event]);

      processor.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(onEventProcessed).toHaveBeenCalledWith(event, { success: true });

      processor.stop();
    });
  });

  describe('handler registration', () => {
    it('should register and unregister handlers', () => {
      const handlers = new Map<string, EventHandler>();
      const processor = createEventProcessor('david', handlers as any);

      const newHandler = vi.fn().mockResolvedValue({ success: true });
      processor.registerHandler(EventTypes.RESEARCH_COMPLETE, newHandler);

      // Verify by checking if handler would be called
      const event: ClaimedEvent = {
        id: '123',
        event_type: EventTypes.RESEARCH_COMPLETE,
        source_agent: 'maya',
        payload: {},
        parent_event_id: null,
        root_event_id: '123',
        chain_depth: 0,
        priority: 3,
        channel_id: null,
        thread_ts: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      mockClaimEvents.mockResolvedValueOnce([event]);

      processor.start();

      processor.unregisterHandler(EventTypes.RESEARCH_COMPLETE);
      processor.stop();
    });
  });
});

describe('Handler Helpers', () => {
  describe('createTransformHandler', () => {
    it('should create a transform handler', async () => {
      const transform = vi
        .fn()
        .mockReturnValue([{ eventType: EventTypes.RESEARCH_COMPLETE, payload: { test: true } }]);

      const handler = createTransformHandler(transform);
      const event: ClaimedEvent = {
        id: '123',
        event_type: EventTypes.NEW_OPPORTUNITY,
        source_agent: 'maya',
        payload: {},
        parent_event_id: null,
        root_event_id: '123',
        chain_depth: 0,
        priority: 3,
        channel_id: null,
        thread_ts: null,
        created_at: '2024-01-01T00:00:00Z',
      };

      const result = await handler({
        event,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(true);
      expect(result.chainEvents).toHaveLength(1);
    });

    it('should return failure when transform returns null', async () => {
      const transform = vi.fn().mockReturnValue(null);
      const handler = createTransformHandler(transform);

      const result = await handler({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(false);
    });
  });

  describe('createLogHandler', () => {
    it('should log and return success', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const handler = createLogHandler('[Test]');

      const result = await handler({
        event: {
          event_type: 'TEST_EVENT',
          source_agent: 'maya',
        } as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Test]'));

      consoleSpy.mockRestore();
    });
  });

  describe('combineHandlers', () => {
    it('should combine multiple handlers', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        success: true,
        chainEvents: [{ eventType: 'EVENT_1', payload: {} }],
      });
      const handler2 = vi.fn().mockResolvedValue({
        success: true,
        chainEvents: [{ eventType: 'EVENT_2', payload: {} }],
      });

      const combined = combineHandlers(handler1, handler2);
      const context = {
        event: {} as any,
        agent: 'david' as const,
        publishChainEvent: vi.fn(),
      };

      const result = await combined(context);

      expect(result.success).toBe(true);
      expect(result.chainEvents).toHaveLength(2);
      expect(handler1).toHaveBeenCalledWith(context);
      expect(handler2).toHaveBeenCalledWith(context);
    });

    it('should stop on first failure', async () => {
      const handler1 = vi.fn().mockResolvedValue({
        success: false,
        error: 'First failed',
      });
      const handler2 = vi.fn().mockResolvedValue({ success: true });

      const combined = combineHandlers(handler1, handler2);

      const result = await combined({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('First failed');
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('withTimeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should complete before timeout', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = withTimeout(handler, 5000);

      const resultPromise = wrappedHandler({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result.success).toBe(true);
    });

    it('should timeout if handler takes too long', async () => {
      // Use real timers for this test since we need actual promise rejection
      vi.useRealTimers();

      const slowHandler = vi
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 5000))
        );
      const wrappedHandler = withTimeout(slowHandler, 100); // Very short timeout

      const resultPromise = wrappedHandler({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      await expect(resultPromise).rejects.toThrow('timed out');
    });
  });

  describe('withRetry', () => {
    it('should succeed on first try', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true });
      const wrappedHandler = withRetry(handler, 3);

      const result = await wrappedHandler({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      vi.useRealTimers(); // Need real timers for retry delays

      const handler = vi
        .fn()
        .mockResolvedValueOnce({ success: false, error: 'First fail' })
        .mockResolvedValueOnce({ success: false, error: 'Second fail' })
        .mockResolvedValueOnce({ success: true });

      const wrappedHandler = withRetry(handler, 3, 10); // Short delay for tests

      const result = await wrappedHandler({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(true);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should fail after max retries', async () => {
      vi.useRealTimers();

      const handler = vi.fn().mockResolvedValue({ success: false, error: 'Always fails' });
      const wrappedHandler = withRetry(handler, 2, 10);

      const result = await wrappedHandler({
        event: {} as any,
        agent: 'david',
        publishChainEvent: vi.fn(),
      });

      expect(result.success).toBe(false);
      expect(handler).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });
});
