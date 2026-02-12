import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventTypes } from '../eventTypes.js';

// Mock the Supabase client
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockOrder = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../integrations/database/client.js', () => ({
  getSupabase: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

// Import after mocking
import {
  publishEvent,
  claimEvents,
  completeEvent,
  getPendingEvents,
  getEventChain,
  expireStaleEvents,
  getEventById,
  getEventsByThread,
} from '../eventBus.js';

describe('eventBus', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mocks
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockEq.mockReturnValue({
      single: mockSingle,
      order: mockOrder,
      eq: mockEq,
    });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockSelect.mockReturnValue({
      eq: mockEq,
      order: mockOrder,
      single: mockSingle,
    });
    mockFrom.mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('publishEvent', () => {
    it('should publish a valid event', async () => {
      const eventId = '123e4567-e89b-12d3-a456-426614174000';
      mockRpc.mockResolvedValue({ data: eventId, error: null });

      const result = await publishEvent({
        eventType: EventTypes.NEW_OPPORTUNITY,
        sourceAgent: 'maya',
        payload: {
          noticeId: 'abc123',
          title: 'Test Opportunity',
          score: 85,
          source: 'sam_gov',
        },
      });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe(eventId);
      expect(mockRpc).toHaveBeenCalledWith(
        'publish_event',
        expect.objectContaining({
          p_event_type: EventTypes.NEW_OPPORTUNITY,
          p_source_agent: 'maya',
          p_payload: expect.any(Object),
        })
      );
    });

    it('should return error for invalid event type', async () => {
      const result = await publishEvent({
        eventType: 'INVALID_TYPE' as any,
        sourceAgent: 'maya',
        payload: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid event type');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('should return error for invalid payload', async () => {
      const result = await publishEvent({
        eventType: EventTypes.NEW_OPPORTUNITY,
        sourceAgent: 'maya',
        payload: {
          noticeId: 'abc123',
          // Missing required fields: title, score, source
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid payload');
    });

    it('should handle database errors', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await publishEvent({
        eventType: EventTypes.NEW_OPPORTUNITY,
        sourceAgent: 'maya',
        payload: {
          noticeId: 'abc123',
          title: 'Test',
          score: 85,
          source: 'sam_gov',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should include optional parameters', async () => {
      const eventId = '123e4567-e89b-12d3-a456-426614174000';
      mockRpc.mockResolvedValue({ data: eventId, error: null });

      const processAfter = new Date('2024-12-01');
      const expiresAt = new Date('2024-12-31');

      await publishEvent({
        eventType: EventTypes.NEW_OPPORTUNITY,
        sourceAgent: 'maya',
        payload: {
          noticeId: 'abc123',
          title: 'Test',
          score: 85,
          source: 'sam_gov',
        },
        targetAgent: 'david',
        priority: 2,
        channelId: 'C12345',
        threadTs: '1234567890.123',
        processAfter,
        expiresAt,
      });

      expect(mockRpc).toHaveBeenCalledWith(
        'publish_event',
        expect.objectContaining({
          p_target_agent: 'david',
          p_priority: 2,
          p_channel_id: 'C12345',
          p_thread_ts: '1234567890.123',
          p_process_after: processAfter.toISOString(),
          p_expires_at: expiresAt.toISOString(),
        })
      );
    });
  });

  describe('claimEvents', () => {
    it('should claim events for an agent', async () => {
      const events = [
        {
          id: '123',
          event_type: 'NEW_OPPORTUNITY',
          source_agent: 'maya',
          payload: {},
          parent_event_id: null,
          root_event_id: '123',
          chain_depth: 0,
          priority: 3,
          channel_id: 'C12345',
          thread_ts: '1234567890.123',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];
      mockRpc.mockResolvedValue({ data: events, error: null });

      const result = await claimEvents('david', 5);

      expect(result).toEqual(events);
      expect(mockRpc).toHaveBeenCalledWith('claim_events', {
        p_agent: 'david',
        p_limit: 5,
      });
    });

    it('should return empty array on error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await claimEvents('david');

      expect(result).toEqual([]);
    });

    it('should use default limit', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await claimEvents('david');

      expect(mockRpc).toHaveBeenCalledWith('claim_events', {
        p_agent: 'david',
        p_limit: 10,
      });
    });
  });

  describe('completeEvent', () => {
    it('should complete an event successfully', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await completeEvent({
        eventId: '123',
        success: true,
        result: { processed: true },
      });

      expect(result).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('complete_event', {
        p_event_id: '123',
        p_success: true,
        p_result: { processed: true },
        p_error: null,
      });
    });

    it('should complete an event with failure', async () => {
      mockRpc.mockResolvedValue({ data: true, error: null });

      const result = await completeEvent({
        eventId: '123',
        success: false,
        error: 'Processing failed',
      });

      expect(result).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('complete_event', {
        p_event_id: '123',
        p_success: false,
        p_result: null,
        p_error: 'Processing failed',
      });
    });

    it('should return false on database error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await completeEvent({
        eventId: '123',
        success: true,
      });

      expect(result).toBe(false);
    });
  });

  describe('getPendingEvents', () => {
    it('should get pending events', async () => {
      const events = [
        { id: '1', event_type: 'NEW_OPPORTUNITY', status: 'pending' },
        { id: '2', event_type: 'RESEARCH_COMPLETE', status: 'claimed' },
      ];
      mockRpc.mockResolvedValue({ data: events, error: null });

      const result = await getPendingEvents();

      expect(result).toEqual(events);
      expect(mockRpc).toHaveBeenCalledWith('get_pending_events', {
        p_event_type: null,
        p_limit: 100,
      });
    });

    it('should filter by event type', async () => {
      mockRpc.mockResolvedValue({ data: [], error: null });

      await getPendingEvents(EventTypes.NEW_OPPORTUNITY, 50);

      expect(mockRpc).toHaveBeenCalledWith('get_pending_events', {
        p_event_type: EventTypes.NEW_OPPORTUNITY,
        p_limit: 50,
      });
    });
  });

  describe('getEventChain', () => {
    it('should get event chain', async () => {
      const chain = [
        { id: '1', event_type: 'NEW_OPPORTUNITY', chain_depth: 0 },
        { id: '2', event_type: 'RESEARCH_COMPLETE', chain_depth: 1 },
        { id: '3', event_type: 'GO_NO_GO_DECISION', chain_depth: 2 },
      ];
      mockRpc.mockResolvedValue({ data: chain, error: null });

      const result = await getEventChain('123');

      expect(result).toEqual(chain);
      expect(mockRpc).toHaveBeenCalledWith('get_event_chain', {
        p_event_id: '123',
      });
    });

    it('should return empty array on error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await getEventChain('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('expireStaleEvents', () => {
    it('should expire stale events', async () => {
      mockRpc.mockResolvedValue({ data: 5, error: null });

      const result = await expireStaleEvents();

      expect(result).toBe(5);
      expect(mockRpc).toHaveBeenCalledWith('expire_stale_events');
    });

    it('should return 0 on error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await expireStaleEvents();

      expect(result).toBe(0);
    });
  });

  describe('getEventById', () => {
    it('should get event by ID', async () => {
      const event = { id: '123', event_type: 'NEW_OPPORTUNITY' };
      mockSingle.mockResolvedValue({ data: event, error: null });

      const result = await getEventById('123');

      expect(result).toEqual(event);
      expect(mockFrom).toHaveBeenCalledWith('agent_events');
      expect(mockEq).toHaveBeenCalledWith('id', '123');
    });

    it('should return null when not found', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await getEventById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getEventsByThread', () => {
    it('should get events by thread', async () => {
      const events = [
        { id: '1', thread_ts: '1234567890.123' },
        { id: '2', thread_ts: '1234567890.123' },
      ];
      mockOrder.mockResolvedValue({ data: events, error: null });

      const result = await getEventsByThread('1234567890.123');

      expect(result).toEqual(events);
      expect(mockEq).toHaveBeenCalledWith('thread_ts', '1234567890.123');
    });

    it('should filter by channel ID if provided', async () => {
      mockOrder.mockResolvedValue({ data: [], error: null });

      await getEventsByThread('1234567890.123', 'C12345');

      // Both eq calls happen in the chain
      expect(mockEq).toHaveBeenCalled();
      // Verify thread_ts filter was applied (first call)
      expect(mockEq.mock.calls[0]).toEqual(['thread_ts', '1234567890.123']);
    });
  });
});
