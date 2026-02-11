import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testData } from './setup.js';

// Mock the client module
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockNot = vi.fn();
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
import {
  createOpportunityWorkflow,
  getWorkflowByNoticeId,
  updateOpportunityWorkflow,
  getWorkflowsNeedingAction,
  getWorkflowsByStage,
  getWorkflowsAwaitingHuman,
  recordStageTransition,
  recordDecisionOutcome,
  getRecommendationAccuracy,
} from '../workflow.js';

describe('workflow module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mock
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockLte.mockReturnValue({ not: mockNot, order: mockOrder });
    mockNot.mockReturnValue({ order: mockOrder, neq: mockNeq });
    mockNeq.mockReturnValue({ order: mockOrder });
    mockEq.mockReturnValue({
      single: mockSingle,
      order: mockOrder,
      select: vi.fn().mockReturnValue({ single: mockSingle }),
    });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({ single: mockSingle }),
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      lte: mockLte,
      not: mockNot,
      single: mockSingle,
    });
    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createOpportunityWorkflow', () => {
    it('should create a workflow with timestamps', async () => {
      const workflow = testData.workflow();
      mockSingle.mockResolvedValue({ data: workflow, error: null });

      const result = await createOpportunityWorkflow({
        notice_id: 'notice-456',
        title: 'Test Workflow',
        stage: 'found',
      });

      expect(mockFrom).toHaveBeenCalledWith('opportunity_workflow');
      expect(mockInsert).toHaveBeenCalledWith({
        notice_id: 'notice-456',
        title: 'Test Workflow',
        stage: 'found',
        created_at: expect.any(String),
        updated_at: expect.any(String),
        stage_entered_at: expect.any(String),
      });
      expect(result).toEqual(workflow);
    });

    it('should return null when insert fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      });

      const result = await createOpportunityWorkflow({
        notice_id: 'notice-456',
        title: 'Test',
        stage: 'found',
      });

      expect(result).toBeNull();
    });

    it('should return null on exception', async () => {
      mockInsert.mockImplementation(() => {
        throw new Error('Connection error');
      });

      const result = await createOpportunityWorkflow({
        notice_id: 'notice-456',
        title: 'Test',
        stage: 'found',
      });

      expect(result).toBeNull();
    });
  });

  describe('getWorkflowByNoticeId', () => {
    it('should return workflow when found', async () => {
      const workflow = testData.workflow();
      mockSingle.mockResolvedValue({ data: workflow, error: null });

      const result = await getWorkflowByNoticeId('notice-456');

      expect(mockFrom).toHaveBeenCalledWith('opportunity_workflow');
      expect(mockEq).toHaveBeenCalledWith('notice_id', 'notice-456');
      expect(result).toEqual(workflow);
    });

    it('should return null when not found', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await getWorkflowByNoticeId('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on exception', async () => {
      mockSelect.mockImplementation(() => {
        throw new Error('Connection error');
      });

      const result = await getWorkflowByNoticeId('notice-456');

      expect(result).toBeNull();
    });
  });

  describe('updateOpportunityWorkflow', () => {
    it('should update workflow with updated_at', async () => {
      const updatedWorkflow = testData.workflow({ stage: 'researching' });
      mockSingle.mockResolvedValue({ data: updatedWorkflow, error: null });

      const result = await updateOpportunityWorkflow('notice-456', {
        agent_responsible: 'david',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        agent_responsible: 'david',
        updated_at: expect.any(String),
      });
      expect(result).toEqual(updatedWorkflow);
    });

    it('should update stage_entered_at when stage changes', async () => {
      const updatedWorkflow = testData.workflow({ stage: 'researching' });
      mockSingle.mockResolvedValue({ data: updatedWorkflow, error: null });

      const result = await updateOpportunityWorkflow('notice-456', {
        stage: 'researching',
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        stage: 'researching',
        updated_at: expect.any(String),
        stage_entered_at: expect.any(String),
      });
      expect(result).toEqual(updatedWorkflow);
    });

    it('should return null when update fails', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      const result = await updateOpportunityWorkflow('notice-456', {
        stage: 'researching',
      });

      expect(result).toBeNull();
    });
  });

  describe('getWorkflowsNeedingAction', () => {
    it('should return workflows where auto_action_at has passed', async () => {
      const workflows = [
        testData.workflow({ stage: 'found' }),
        testData.workflow({ id: 'w2', stage: 'researching' }),
      ];
      mockOrder.mockResolvedValue({ data: workflows, error: null });

      const result = await getWorkflowsNeedingAction();

      expect(mockLte).toHaveBeenCalledWith('auto_action_at', expect.any(String));
      expect(mockNot).toHaveBeenCalledWith('stage', 'in', '("pursuing","passed","decision")');
      expect(result).toEqual(workflows);
    });

    it('should return empty array when no workflows need action', async () => {
      mockOrder.mockResolvedValue({ data: [], error: null });

      const result = await getWorkflowsNeedingAction();

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockOrder.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await getWorkflowsNeedingAction();

      expect(result).toEqual([]);
    });
  });

  describe('getWorkflowsByStage', () => {
    it('should return workflows filtered by stage', async () => {
      const workflows = [testData.workflow({ stage: 'researching' })];
      mockOrder.mockResolvedValue({ data: workflows, error: null });

      const result = await getWorkflowsByStage('researching');

      expect(mockEq).toHaveBeenCalledWith('stage', 'researching');
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(result).toEqual(workflows);
    });

    it('should return empty array when no matches', async () => {
      mockOrder.mockResolvedValue({ data: null, error: null });

      const result = await getWorkflowsByStage('passed');

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockOrder.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await getWorkflowsByStage('found');

      expect(result).toEqual([]);
    });
  });

  describe('getWorkflowsAwaitingHuman', () => {
    it('should return workflows awaiting human input', async () => {
      const workflows = [testData.workflow({ awaiting_input_from: 'lapedra' })];
      mockOrder.mockResolvedValue({ data: workflows, error: null });

      const result = await getWorkflowsAwaitingHuman();

      expect(mockNot).toHaveBeenCalledWith('awaiting_input_from', 'is', null);
      expect(mockNeq).toHaveBeenCalledWith('awaiting_input_from', 'auto');
      expect(result).toEqual(workflows);
    });

    it('should return empty array when none awaiting', async () => {
      mockOrder.mockResolvedValue({ data: [], error: null });

      const result = await getWorkflowsAwaitingHuman();

      expect(result).toEqual([]);
    });
  });

  describe('recordStageTransition', () => {
    it('should record stage transition history', async () => {
      mockInsert.mockResolvedValue({ data: null, error: null });

      await recordStageTransition(
        'workflow-123',
        'found',
        'researching',
        'david',
        'Initial research'
      );

      expect(mockFrom).toHaveBeenCalledWith('workflow_stage_history');
      expect(mockInsert).toHaveBeenCalledWith({
        workflow_id: 'workflow-123',
        from_stage: 'found',
        to_stage: 'researching',
        triggered_by: 'david',
        trigger_reason: 'Initial research',
        created_at: expect.any(String),
      });
    });

    it('should handle null from_stage for initial creation', async () => {
      mockInsert.mockResolvedValue({ data: null, error: null });

      await recordStageTransition('workflow-123', null, 'found', 'maya');

      expect(mockInsert).toHaveBeenCalledWith({
        workflow_id: 'workflow-123',
        from_stage: null,
        to_stage: 'found',
        triggered_by: 'maya',
        trigger_reason: undefined,
        created_at: expect.any(String),
      });
    });

    it('should not throw on error', async () => {
      mockInsert.mockImplementation(() => {
        throw new Error('Insert failed');
      });

      // Should not throw
      await expect(
        recordStageTransition('workflow-123', 'found', 'researching', 'david')
      ).resolves.toBeUndefined();
    });
  });

  describe('recordDecisionOutcome', () => {
    it('should record decision outcome', async () => {
      mockInsert.mockResolvedValue({ data: null, error: null });

      await recordDecisionOutcome({
        notice_id: 'notice-123',
        opportunity_title: 'Test Opp',
        james_recommendation: 'GO',
        human_decision: 'go',
        outcome: 'won',
      });

      expect(mockFrom).toHaveBeenCalledWith('decision_outcomes');
      expect(mockInsert).toHaveBeenCalledWith({
        notice_id: 'notice-123',
        opportunity_title: 'Test Opp',
        james_recommendation: 'GO',
        human_decision: 'go',
        outcome: 'won',
        created_at: expect.any(String),
      });
    });

    it('should not throw on error', async () => {
      mockInsert.mockImplementation(() => {
        throw new Error('Insert failed');
      });

      await expect(recordDecisionOutcome({ notice_id: 'test' })).resolves.toBeUndefined();
    });
  });

  describe('getRecommendationAccuracy', () => {
    it('should calculate accuracy stats from outcomes', async () => {
      const outcomes = [
        { james_recommendation: 'GO', human_decision: 'go', outcome: 'won' },
        { james_recommendation: 'GO', human_decision: 'go', outcome: 'lost' },
        { james_recommendation: 'GO', human_decision: 'go', outcome: 'won' },
        { james_recommendation: 'PASS', human_decision: 'pass', outcome: 'no_bid' },
        { james_recommendation: 'PASS', human_decision: 'go', outcome: 'lost' },
      ];
      mockNot.mockResolvedValue({ data: outcomes, error: null });

      const result = await getRecommendationAccuracy();

      expect(result).toEqual({
        goRecommendations: { total: 3, won: 2, lost: 1 },
        passRecommendations: { total: 2, correct: 1 },
      });
    });

    it('should return empty stats when no data', async () => {
      mockNot.mockResolvedValue({ data: [], error: null });

      const result = await getRecommendationAccuracy();

      expect(result).toEqual({
        goRecommendations: { total: 0, won: 0, lost: 0 },
        passRecommendations: { total: 0, correct: 0 },
      });
    });

    it('should return empty stats on error', async () => {
      mockNot.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await getRecommendationAccuracy();

      expect(result).toEqual({
        goRecommendations: { total: 0, won: 0, lost: 0 },
        passRecommendations: { total: 0, correct: 0 },
      });
    });
  });
});
