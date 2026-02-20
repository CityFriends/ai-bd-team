// Event Processor - Polling processor for handling events
import { claimEvents, completeEvent, publishChainEvent } from './eventBus.js';
import { EventType, ClaimedEvent } from './eventTypes.js';
import type { LiveAgentName } from '../live/types.js';

// ============================================================
// Types
// ============================================================
export interface EventHandlerContext {
  event: ClaimedEvent;
  agent: LiveAgentName;
  publishChainEvent: (
    eventType: EventType,
    payload: Record<string, unknown>,
    priority?: number,
    targetAgent?: LiveAgentName
  ) => Promise<{ success: boolean; eventId?: string; error?: string }>;
}

export type EventHandler = (context: EventHandlerContext) => Promise<EventHandlerResult>;

export interface EventHandlerResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
  // Optional: events to publish after completion
  chainEvents?: Array<{
    eventType: EventType;
    payload: Record<string, unknown>;
    priority?: number;
  }>;
}

export interface EventProcessorConfig {
  agent: LiveAgentName;
  pollIntervalMs?: number; // Default: 5000 (5 seconds)
  claimLimit?: number; // Default: 5 events per poll
  handlers: Map<EventType, EventHandler>;
  onError?: (error: Error, event?: ClaimedEvent) => void;
  onEventProcessed?: (event: ClaimedEvent, result: EventHandlerResult) => void;
}

// ============================================================
// Event Processor Class
// ============================================================
export class EventProcessor {
  private readonly agent: LiveAgentName;
  private readonly pollIntervalMs: number;
  private readonly claimLimit: number;
  private readonly handlers: Map<EventType, EventHandler>;
  private readonly onError?: (error: Error, event?: ClaimedEvent) => void;
  private readonly onEventProcessed?: (event: ClaimedEvent, result: EventHandlerResult) => void;

  private isRunning: boolean = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private processingCount: number = 0;

  constructor(config: EventProcessorConfig) {
    this.agent = config.agent;
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    this.claimLimit = config.claimLimit ?? 5;
    this.handlers = config.handlers;
    this.onError = config.onError;
    this.onEventProcessed = config.onEventProcessed;
  }

  /**
   * Start the event processor
   */
  start(): void {
    if (this.isRunning) {
      console.log(`[EventProcessor:${this.agent}] Already running`);
      return;
    }

    this.isRunning = true;
    console.log(
      `[EventProcessor:${this.agent}] Starting (poll interval: ${this.pollIntervalMs}ms)`
    );
    this.poll();
  }

  /**
   * Stop the event processor
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    console.log(
      `[EventProcessor:${this.agent}] Stopped (${this.processingCount} events still processing)`
    );
  }

  /**
   * Check if processor is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get count of events currently being processed
   */
  getProcessingCount(): number {
    return this.processingCount;
  }

  /**
   * Register an event handler
   */
  registerHandler(eventType: EventType, handler: EventHandler): void {
    this.handlers.set(eventType, handler);
  }

  /**
   * Unregister an event handler
   */
  unregisterHandler(eventType: EventType): void {
    this.handlers.delete(eventType);
  }

  /**
   * Main poll loop
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Claim events for this agent
      const events = await claimEvents(this.agent, this.claimLimit);

      // Process events concurrently (but with a limit)
      if (events.length > 0) {
        await Promise.all(events.map((event) => this.processEvent(event)));
      }
    } catch (err) {
      console.error(`[EventProcessor:${this.agent}] Poll error:`, err);
      if (this.onError && err instanceof Error) {
        this.onError(err);
      }
    }

    // Schedule next poll
    if (this.isRunning) {
      this.pollTimeout = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }

  /**
   * Process a single event
   */
  private async processEvent(event: ClaimedEvent): Promise<void> {
    this.processingCount++;

    const eventType = event.event_type as EventType;
    const handler = this.handlers.get(eventType);

    if (!handler) {
      console.warn(`[EventProcessor:${this.agent}] No handler for event type: ${eventType}`);
      await completeEvent({
        eventId: event.id,
        success: false,
        error: `No handler registered for event type: ${eventType}`,
      });
      this.processingCount--;
      return;
    }

    try {
      // Create handler context
      const context: EventHandlerContext = {
        event,
        agent: this.agent,
        publishChainEvent: async (type, payload, priority, targetAgent) => {
          return publishChainEvent(type, this.agent, payload, event, priority, targetAgent);
        },
      };

      // Execute handler
      const startTime = Date.now();
      const result = await handler(context);
      const duration = Date.now() - startTime;

      // Complete the event
      await completeEvent({
        eventId: event.id,
        success: result.success,
        result: result.result,
        error: result.error,
      });

      // Publish any chain events
      if (result.chainEvents && result.chainEvents.length > 0) {
        for (const chainEvent of result.chainEvents) {
          await publishChainEvent(
            chainEvent.eventType,
            this.agent,
            chainEvent.payload,
            event,
            chainEvent.priority
          );
        }
      }

      // Callback
      if (this.onEventProcessed) {
        this.onEventProcessed(event, result);
      }

      console.log(
        `[EventProcessor:${this.agent}] Processed ${eventType} (${duration}ms, success: ${result.success})`
      );
    } catch (err) {
      console.error(`[EventProcessor:${this.agent}] Handler error for ${eventType}:`, err);

      // Mark as failed
      await completeEvent({
        eventId: event.id,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });

      // Callback
      if (this.onError && err instanceof Error) {
        this.onError(err, event);
      }
    } finally {
      this.processingCount--;
    }
  }
}

// ============================================================
// Factory Function
// ============================================================
export function createEventProcessor(
  agent: LiveAgentName,
  handlers: Map<EventType, EventHandler>,
  options?: {
    pollIntervalMs?: number;
    claimLimit?: number;
    onError?: (error: Error, event?: ClaimedEvent) => void;
    onEventProcessed?: (event: ClaimedEvent, result: EventHandlerResult) => void;
  }
): EventProcessor {
  return new EventProcessor({
    agent,
    handlers,
    ...options,
  });
}

// ============================================================
// Handler Builder Helpers
// ============================================================

/**
 * Create a simple handler that transforms an event into chain events
 */
export function createTransformHandler(
  transform: (event: ClaimedEvent) => Array<{
    eventType: EventType;
    payload: Record<string, unknown>;
    priority?: number;
  }> | null
): EventHandler {
  return async (context) => {
    const chainEvents = transform(context.event);

    if (chainEvents === null) {
      return { success: false, error: 'Transform returned null' };
    }

    return {
      success: true,
      chainEvents,
    };
  };
}

/**
 * Create a handler that logs and passes through
 */
export function createLogHandler(logPrefix: string): EventHandler {
  return async (context) => {
    console.log(
      `${logPrefix} Received ${context.event.event_type} from ${context.event.source_agent}`
    );
    return { success: true };
  };
}

/**
 * Combine multiple handlers into one (runs sequentially)
 */
export function combineHandlers(...handlers: EventHandler[]): EventHandler {
  return async (context) => {
    const chainEvents: Array<{
      eventType: EventType;
      payload: Record<string, unknown>;
      priority?: number;
    }> = [];

    for (const handler of handlers) {
      const result = await handler(context);

      if (!result.success) {
        return result;
      }

      if (result.chainEvents) {
        chainEvents.push(...result.chainEvents);
      }
    }

    return {
      success: true,
      chainEvents: chainEvents.length > 0 ? chainEvents : undefined,
    };
  };
}

/**
 * Create a handler with timeout
 */
export function withTimeout(handler: EventHandler, timeoutMs: number): EventHandler {
  return async (context) => {
    return Promise.race([
      handler(context),
      new Promise<EventHandlerResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Handler timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  };
}

/**
 * Create a handler with retry logic
 */
export function withRetry(
  handler: EventHandler,
  maxRetries: number,
  delayMs: number = 1000
): EventHandler {
  return async (context) => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await handler(context);
        if (result.success) {
          return result;
        }
        lastError = new Error(result.error || 'Handler returned failure');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Max retries exceeded',
    };
  };
}
