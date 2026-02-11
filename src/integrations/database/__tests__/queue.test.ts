import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testData } from './setup.js';

// Mock the client module
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockLte = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('../client.js', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Import after mocking
import { queueAgentTask, getPendingTasks, updateTaskStatus, cancelTask } from '../queue.js';

describe('queue module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mock
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockLte.mockReturnValue({ order: mockOrder });
    mockEq.mockReturnValue({
      single: mockSingle,
      lte: mockLte,
      select: vi.fn().mockReturnValue({ single: mockSingle }),
    });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockSelect.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('queueAgentTask', () => {
    it('should create a queue item with all parameters', async () => {
      const queueItem = testData.queueItem();
      mockSingle.mockResolvedValue({ data: queueItem, error: null });

      const scheduledFor = new Date('2024-01-01T10:00:00Z');
      const result = await queueAgentTask(
        'scout',
        'scan',
        scheduledFor,
        { source: 'sam.gov' },
        'opp-123',
        '1234567890.123'
      );

      expect(mockFrom).toHaveBeenCalledWith('agent_queue');
      expect(mockInsert).toHaveBeenCalledWith({
        agent: 'scout',
        action: 'scan',
        scheduled_for: scheduledFor.toISOString(),
        payload: { source: 'sam.gov' },
        opportunity_id: 'opp-123',
        thread_ts: '1234567890.123',
      });
      expect(result).toEqual(queueItem);
    });

    it('should create a queue item with minimal parameters', async () => {
      const queueItem = testData.queueItem({ payload: {} });
      mockSingle.mockResolvedValue({ data: queueItem, error: null });

      const scheduledFor = new Date('2024-01-01T10:00:00Z');
      const result = await queueAgentTask('analyst', 'research', scheduledFor);

      expect(mockInsert).toHaveBeenCalledWith({
        agent: 'analyst',
        action: 'research',
        scheduled_for: scheduledFor.toISOString(),
        payload: {},
        opportunity_id: undefined,
        thread_ts: undefined,
      });
      expect(result).toEqual(queueItem);
    });

    it('should throw error when insert fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      });

      await expect(queueAgentTask('scout', 'scan', new Date())).rejects.toEqual({
        message: 'Insert failed',
      });
    });
  });

  describe('getPendingTasks', () => {
    it('should return pending tasks scheduled before now', async () => {
      const tasks = [testData.queueItem({ id: 'q1' }), testData.queueItem({ id: 'q2' })];
      mockOrder.mockResolvedValue({ data: tasks, error: null });

      const result = await getPendingTasks();

      expect(mockFrom).toHaveBeenCalledWith('agent_queue');
      expect(mockEq).toHaveBeenCalledWith('status', 'pending');
      expect(mockLte).toHaveBeenCalledWith('scheduled_for', expect.any(String));
      expect(mockOrder).toHaveBeenCalledWith('scheduled_for', { ascending: true });
      expect(result).toEqual(tasks);
    });

    it('should return empty array when no pending tasks', async () => {
      mockOrder.mockResolvedValue({ data: [], error: null });

      const result = await getPendingTasks();

      expect(result).toEqual([]);
    });

    it('should return empty array when data is null', async () => {
      mockOrder.mockResolvedValue({ data: null, error: null });

      const result = await getPendingTasks();

      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      mockOrder.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      await expect(getPendingTasks()).rejects.toEqual({ message: 'Query failed' });
    });
  });

  describe('updateTaskStatus', () => {
    it('should set status to running with started_at', async () => {
      const updatedTask = testData.queueItem({ status: 'running' });
      mockSingle.mockResolvedValue({ data: updatedTask, error: null });

      const result = await updateTaskStatus('queue-123', 'running');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'running',
        started_at: expect.any(String),
      });
      expect(result).toEqual(updatedTask);
    });

    it('should set status to completed with completed_at', async () => {
      const updatedTask = testData.queueItem({ status: 'completed' });
      mockSingle.mockResolvedValue({ data: updatedTask, error: null });

      const result = await updateTaskStatus('queue-123', 'completed');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'completed',
        completed_at: expect.any(String),
      });
      expect(result).toEqual(updatedTask);
    });

    it('should include result when provided for completed status', async () => {
      const updatedTask = testData.queueItem({ status: 'completed', result: { count: 5 } });
      mockSingle.mockResolvedValue({ data: updatedTask, error: null });

      const result = await updateTaskStatus('queue-123', 'completed', { count: 5 });

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'completed',
        completed_at: expect.any(String),
        result: { count: 5 },
      });
      expect(result).toEqual(updatedTask);
    });

    it('should set status to failed with completed_at', async () => {
      const updatedTask = testData.queueItem({ status: 'failed' });
      mockSingle.mockResolvedValue({ data: updatedTask, error: null });

      const result = await updateTaskStatus('queue-123', 'failed', { error: 'Connection timeout' });

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'failed',
        completed_at: expect.any(String),
        result: { error: 'Connection timeout' },
      });
      expect(result).toEqual(updatedTask);
    });

    it('should set status to pending without extra fields', async () => {
      const updatedTask = testData.queueItem({ status: 'pending' });
      mockSingle.mockResolvedValue({ data: updatedTask, error: null });

      const result = await updateTaskStatus('queue-123', 'pending');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'pending',
      });
      expect(result).toEqual(updatedTask);
    });

    it('should throw error when update fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      await expect(updateTaskStatus('queue-123', 'running')).rejects.toEqual({
        message: 'Update failed',
      });
    });
  });

  describe('cancelTask', () => {
    it('should set status to cancelled', async () => {
      const cancelledTask = testData.queueItem({ status: 'cancelled' });
      mockSingle.mockResolvedValue({ data: cancelledTask, error: null });

      const result = await cancelTask('queue-123');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'cancelled',
      });
      expect(result).toEqual(cancelledTask);
    });
  });
});
