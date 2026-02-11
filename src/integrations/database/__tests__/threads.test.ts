import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testData } from './setup.js';

// Mock the client module
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('../client.js', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Import after mocking
import {
  createThread,
  getThreadBySlackTs,
  updateThread,
  saveThreadSummary,
  getThreadSummary,
} from '../threads.js';

describe('threads module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mock
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockEq.mockReturnValue({
      single: mockSingle,
      select: vi.fn().mockReturnValue({ single: mockSingle }),
    });
    mockUpsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      upsert: mockUpsert,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createThread', () => {
    it('should create a thread and return it', async () => {
      const thread = testData.thread();
      mockSingle.mockResolvedValue({ data: thread, error: null });

      const result = await createThread({
        slack_thread_ts: '1234567890.123456',
        channel_id: 'C12345',
        topic: 'Test Thread',
      });

      expect(mockFrom).toHaveBeenCalledWith('conversation_threads');
      expect(mockInsert).toHaveBeenCalledWith({
        slack_thread_ts: '1234567890.123456',
        channel_id: 'C12345',
        topic: 'Test Thread',
      });
      expect(result).toEqual(thread);
    });

    it('should throw error when insert fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      });

      await expect(createThread({ slack_thread_ts: '123' })).rejects.toEqual({
        message: 'Insert failed',
      });
    });
  });

  describe('getThreadBySlackTs', () => {
    it('should return thread when found', async () => {
      const thread = testData.thread();
      mockSingle.mockResolvedValue({ data: thread, error: null });

      const result = await getThreadBySlackTs('1234567890.123456');

      expect(mockFrom).toHaveBeenCalledWith('conversation_threads');
      expect(mockEq).toHaveBeenCalledWith('slack_thread_ts', '1234567890.123456');
      expect(result).toEqual(thread);
    });

    it('should return null when not found (PGRST116)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await getThreadBySlackTs('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error for other errors', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'Permission denied' },
      });

      await expect(getThreadBySlackTs('123')).rejects.toEqual({
        code: '42501',
        message: 'Permission denied',
      });
    });
  });

  describe('updateThread', () => {
    it('should update thread with updated_at', async () => {
      const updatedThread = testData.thread({ topic: 'Updated Topic' });
      mockSingle.mockResolvedValue({ data: updatedThread, error: null });

      const result = await updateThread('thread-123', { topic: 'Updated Topic' });

      expect(mockFrom).toHaveBeenCalledWith('conversation_threads');
      expect(mockUpdate).toHaveBeenCalledWith({
        topic: 'Updated Topic',
        updated_at: expect.any(String),
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'thread-123');
      expect(result).toEqual(updatedThread);
    });

    it('should throw error when update fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      await expect(updateThread('thread-123', { topic: 'Test' })).rejects.toEqual({
        message: 'Update failed',
      });
    });
  });

  describe('saveThreadSummary', () => {
    it('should upsert thread summary with updated_at', async () => {
      const summary = testData.threadSummary();
      mockSingle.mockResolvedValue({ data: summary, error: null });

      const result = await saveThreadSummary({
        thread_ts: '1234567890.123456',
        channel_id: 'C12345',
        summary: 'Test summary',
        message_count: 5,
        participants: ['U12345', 'U67890'],
        key_topics: ['opportunity'],
      });

      expect(mockFrom).toHaveBeenCalledWith('thread_summaries');
      expect(mockUpsert).toHaveBeenCalledWith(
        {
          thread_ts: '1234567890.123456',
          channel_id: 'C12345',
          summary: 'Test summary',
          message_count: 5,
          participants: ['U12345', 'U67890'],
          key_topics: ['opportunity'],
          updated_at: expect.any(String),
        },
        { onConflict: 'thread_ts' }
      );
      expect(result).toEqual(summary);
    });

    it('should include embedding when provided', async () => {
      const summary = testData.threadSummary();
      mockSingle.mockResolvedValue({ data: summary, error: null });

      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      await saveThreadSummary(
        {
          thread_ts: '123',
          summary: 'Test',
          message_count: 1,
        },
        embedding
      );

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          embedding: '[0.1,0.2,0.3,0.4,0.5]',
        }),
        expect.any(Object)
      );
    });

    it('should return null on error', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Upsert failed' },
      });

      const result = await saveThreadSummary({
        thread_ts: '123',
        summary: 'Test',
        message_count: 1,
      });

      expect(result).toBeNull();
    });

    it('should return null on exception', async () => {
      mockUpsert.mockImplementation(() => {
        throw new Error('Connection error');
      });

      const result = await saveThreadSummary({
        thread_ts: '123',
        summary: 'Test',
        message_count: 1,
      });

      expect(result).toBeNull();
    });
  });

  describe('getThreadSummary', () => {
    it('should return thread summary when found', async () => {
      const summary = testData.threadSummary();
      mockSingle.mockResolvedValue({ data: summary, error: null });

      const result = await getThreadSummary('1234567890.123456');

      expect(mockFrom).toHaveBeenCalledWith('thread_summaries');
      expect(mockEq).toHaveBeenCalledWith('thread_ts', '1234567890.123456');
      expect(result).toEqual(summary);
    });

    it('should return null when not found', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await getThreadSummary('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on exception', async () => {
      mockSelect.mockImplementation(() => {
        throw new Error('Connection error');
      });

      const result = await getThreadSummary('123');

      expect(result).toBeNull();
    });
  });
});
