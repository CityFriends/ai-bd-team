import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testData } from './setup.js';

// Mock the client module before importing the module under test
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('../client.js', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Import after mocking
import {
  createOpportunity,
  getOpportunity,
  getOpportunityBySamId,
  updateOpportunity,
  getOpportunitiesByStatus,
  getActiveOpportunities,
  setOpportunityDecision,
} from '../opportunities.js';

describe('opportunities module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mock
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockReturnValue({ data: [], error: null });
    mockIn.mockReturnValue({ order: mockOrder });
    mockEq.mockReturnValue({ single: mockSingle, order: mockOrder });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockInsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockSelect.mockReturnValue({ eq: mockEq, in: mockIn, single: mockSingle });
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createOpportunity', () => {
    it('should create an opportunity and return it', async () => {
      const newOpp = testData.opportunity();
      mockSingle.mockResolvedValue({ data: newOpp, error: null });

      const result = await createOpportunity({
        title: 'Test Opportunity',
        agency: 'Test Agency',
      });

      expect(mockFrom).toHaveBeenCalledWith('opportunities');
      expect(mockInsert).toHaveBeenCalled();
      expect(result).toEqual(newOpp);
    });

    it('should throw error when insert fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed', code: '23505' },
      });

      await expect(createOpportunity({ title: 'Test' })).rejects.toEqual({
        message: 'Insert failed',
        code: '23505',
      });
    });
  });

  describe('getOpportunity', () => {
    it('should return opportunity when found', async () => {
      const opp = testData.opportunity();
      mockSingle.mockResolvedValue({ data: opp, error: null });

      const result = await getOpportunity('opp-123');

      expect(mockFrom).toHaveBeenCalledWith('opportunities');
      expect(mockSelect).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('id', 'opp-123');
      expect(result).toEqual(opp);
    });

    it('should return null when not found (PGRST116)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await getOpportunity('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw error for other errors', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'Permission denied' },
      });

      await expect(getOpportunity('opp-123')).rejects.toEqual({
        code: '42501',
        message: 'Permission denied',
      });
    });
  });

  describe('getOpportunityBySamId', () => {
    it('should return opportunity when found by SAM ID', async () => {
      const opp = testData.opportunity({ sam_id: 'SAM-789' });
      mockSingle.mockResolvedValue({ data: opp, error: null });

      const result = await getOpportunityBySamId('SAM-789');

      expect(mockEq).toHaveBeenCalledWith('sam_id', 'SAM-789');
      expect(result).toEqual(opp);
    });

    it('should return null when not found', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await getOpportunityBySamId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateOpportunity', () => {
    it('should update opportunity with timestamp', async () => {
      const updatedOpp = testData.opportunity({ title: 'Updated Title' });
      mockSingle.mockResolvedValue({ data: updatedOpp, error: null });

      // Setup the chain for update
      const mockSelectAfterUpdate = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEqAfterUpdate = vi.fn().mockReturnValue({ select: mockSelectAfterUpdate });
      mockUpdate.mockReturnValue({ eq: mockEqAfterUpdate });

      const result = await updateOpportunity('opp-123', { title: 'Updated Title' });

      expect(mockFrom).toHaveBeenCalledWith('opportunities');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated Title',
          updated_at: expect.any(String),
        })
      );
      expect(result).toEqual(updatedOpp);
    });

    it('should throw error when update fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      const mockSelectAfterUpdate = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEqAfterUpdate = vi.fn().mockReturnValue({ select: mockSelectAfterUpdate });
      mockUpdate.mockReturnValue({ eq: mockEqAfterUpdate });

      await expect(updateOpportunity('opp-123', { title: 'Test' })).rejects.toEqual({
        message: 'Update failed',
      });
    });
  });

  describe('getOpportunitiesByStatus', () => {
    it('should return opportunities filtered by status', async () => {
      const opps = [
        testData.opportunity({ status: 'new' }),
        testData.opportunity({ id: 'opp-456', status: 'new' }),
      ];
      mockOrder.mockReturnValue({ data: opps, error: null });

      const result = await getOpportunitiesByStatus('new');

      expect(mockFrom).toHaveBeenCalledWith('opportunities');
      expect(mockEq).toHaveBeenCalledWith('status', 'new');
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toEqual(opps);
    });

    it('should return empty array when no matches', async () => {
      mockOrder.mockReturnValue({ data: [], error: null });

      const result = await getOpportunitiesByStatus('passed');

      expect(result).toEqual([]);
    });
  });

  describe('getActiveOpportunities', () => {
    it('should return opportunities in active statuses', async () => {
      const opps = [testData.opportunity({ status: 'new' })];
      mockOrder.mockReturnValue({ data: opps, error: null });

      const result = await getActiveOpportunities();

      expect(mockIn).toHaveBeenCalledWith('status', ['new', 'researching', 'pursuing']);
      expect(mockOrder).toHaveBeenCalledWith('due_date', { ascending: true });
      expect(result).toEqual(opps);
    });
  });

  describe('setOpportunityDecision', () => {
    it('should set GO decision and update status to pursuing', async () => {
      const updatedOpp = testData.opportunity({ status: 'pursuing', decision: 'go' });
      mockSingle.mockResolvedValue({ data: updatedOpp, error: null });

      const mockSelectAfterUpdate = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEqAfterUpdate = vi.fn().mockReturnValue({ select: mockSelectAfterUpdate });
      mockUpdate.mockReturnValue({ eq: mockEqAfterUpdate });

      const result = await setOpportunityDecision('opp-123', 'go');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'go',
          status: 'pursuing',
          decision_date: expect.any(String),
        })
      );
      expect(result).toEqual(updatedOpp);
    });

    it('should set NO_GO decision and update status to passed', async () => {
      const updatedOpp = testData.opportunity({ status: 'passed', decision: 'no_go' });
      mockSingle.mockResolvedValue({ data: updatedOpp, error: null });

      const mockSelectAfterUpdate = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEqAfterUpdate = vi.fn().mockReturnValue({ select: mockSelectAfterUpdate });
      mockUpdate.mockReturnValue({ eq: mockEqAfterUpdate });

      const result = await setOpportunityDecision('opp-123', 'no_go');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'no_go',
          status: 'passed',
        })
      );
      expect(result).toEqual(updatedOpp);
    });

    it('should set PENDING decision and update status to researching', async () => {
      const updatedOpp = testData.opportunity({ status: 'researching', decision: 'pending' });
      mockSingle.mockResolvedValue({ data: updatedOpp, error: null });

      const mockSelectAfterUpdate = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEqAfterUpdate = vi.fn().mockReturnValue({ select: mockSelectAfterUpdate });
      mockUpdate.mockReturnValue({ eq: mockEqAfterUpdate });

      const result = await setOpportunityDecision('opp-123', 'pending');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'pending',
          status: 'researching',
        })
      );
      expect(result).toEqual(updatedOpp);
    });
  });
});
