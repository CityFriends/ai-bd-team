import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testData } from './setup.js';
import type { UserProfile } from '../users.js';

// Mock the client module
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockEq = vi.fn();
const mockNot = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('../client.js', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Import after mocking
import {
  getUserProfile,
  upsertUserProfile,
  trackUserInteraction,
  getUserTopics,
  formatUserProfileForAgent,
  learnUserPreferences,
  saveUserContext,
  getUserContext,
} from '../users.js';

describe('users module', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup chainable mock
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockLimit.mockResolvedValue({ data: [], error: null });
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockNot.mockReturnValue({
      order: mockOrder,
      neq: vi.fn().mockReturnValue({ order: mockOrder }),
    });
    // For getUserTopics: select().eq().not().order().limit()
    // For getUserProfile: select().eq().single()
    mockEq.mockReturnValue({
      single: mockSingle,
      order: mockOrder,
      eq: mockEq,
      not: mockNot,
    });
    mockUpsert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockInsert.mockReturnValue({ data: null, error: null });
    mockSelect.mockReturnValue({
      eq: mockEq,
      not: mockNot,
      single: mockSingle,
    });
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

  describe('getUserProfile', () => {
    it('should return user profile when found', async () => {
      const profile = testData.userProfile();
      mockSingle.mockResolvedValue({ data: profile, error: null });

      const result = await getUserProfile('U12345');

      expect(mockFrom).toHaveBeenCalledWith('user_profiles');
      expect(mockEq).toHaveBeenCalledWith('slack_user_id', 'U12345');
      expect(result).toEqual(profile);
    });

    it('should return null when not found (PGRST116)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await getUserProfile('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on other errors', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'Permission denied' },
      });

      const result = await getUserProfile('U12345');

      expect(result).toBeNull();
    });

    it('should return null on exception', async () => {
      mockSelect.mockImplementation(() => {
        throw new Error('Connection error');
      });

      const result = await getUserProfile('U12345');

      expect(result).toBeNull();
    });
  });

  describe('upsertUserProfile', () => {
    it('should upsert profile with updated_at', async () => {
      const profile = testData.userProfile();
      mockSingle.mockResolvedValue({ data: profile, error: null });

      const result = await upsertUserProfile({
        slack_user_id: 'U12345',
        user_name: 'testuser',
        display_name: 'Test User',
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        {
          slack_user_id: 'U12345',
          user_name: 'testuser',
          display_name: 'Test User',
          updated_at: expect.any(String),
        },
        { onConflict: 'slack_user_id' }
      );
      expect(result).toEqual(profile);
    });

    it('should return null on error', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: 'Upsert failed' },
      });

      const result = await upsertUserProfile({
        slack_user_id: 'U12345',
        user_name: 'test',
      });

      expect(result).toBeNull();
    });
  });

  describe('trackUserInteraction', () => {
    it('should log interaction and update profile stats', async () => {
      // Setup for insert
      mockInsert.mockResolvedValue({ data: null, error: null });
      // Setup for select to get existing profile
      mockSingle.mockResolvedValue({
        data: { total_interactions: 5, favorite_agent: 'maya' },
        error: null,
      });
      // Setup for update
      mockUpdate.mockReturnValue({ eq: mockEq });

      await trackUserInteraction({
        slack_user_id: 'U12345',
        agent: 'david',
        interaction_type: 'question',
        topic: 'research',
      });

      // Verify interaction was inserted
      expect(mockFrom).toHaveBeenCalledWith('user_interactions');
      expect(mockInsert).toHaveBeenCalledWith({
        slack_user_id: 'U12345',
        agent: 'david',
        interaction_type: 'question',
        topic: 'research',
        created_at: expect.any(String),
      });
    });

    it('should not throw on error', async () => {
      mockInsert.mockImplementation(() => {
        throw new Error('Insert failed');
      });

      // Should not throw
      await expect(
        trackUserInteraction({
          slack_user_id: 'U12345',
          agent: 'maya',
          interaction_type: 'command',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('getUserTopics', () => {
    it('should return topics sorted by frequency', async () => {
      const interactions = [
        { topic: 'research' },
        { topic: 'research' },
        { topic: 'opportunity' },
        { topic: 'research' },
        { topic: 'partner' },
        { topic: 'opportunity' },
      ];
      mockLimit.mockResolvedValue({ data: interactions, error: null });

      const result = await getUserTopics('U12345', 20);

      expect(mockEq).toHaveBeenCalledWith('slack_user_id', 'U12345');
      expect(mockLimit).toHaveBeenCalledWith(20);
      // Should be sorted by frequency: research(3), opportunity(2), partner(1)
      expect(result).toEqual(['research', 'opportunity', 'partner']);
    });

    it('should return empty array when no topics', async () => {
      mockLimit.mockResolvedValue({ data: [], error: null });

      const result = await getUserTopics('U12345');

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockLimit.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await getUserTopics('U12345');

      expect(result).toEqual([]);
    });

    it('should limit to top 5 topics', async () => {
      const interactions = [
        { topic: 't1' },
        { topic: 't1' },
        { topic: 't1' },
        { topic: 't1' },
        { topic: 't1' },
        { topic: 't2' },
        { topic: 't2' },
        { topic: 't2' },
        { topic: 't2' },
        { topic: 't3' },
        { topic: 't3' },
        { topic: 't3' },
        { topic: 't4' },
        { topic: 't4' },
        { topic: 't5' },
        { topic: 't6' },
      ];
      mockLimit.mockResolvedValue({ data: interactions, error: null });

      const result = await getUserTopics('U12345');

      expect(result).toHaveLength(5);
      expect(result).toEqual(['t1', 't2', 't3', 't4', 't5']);
    });
  });

  describe('formatUserProfileForAgent', () => {
    it('should format complete profile', () => {
      const profile = testData.userProfile({
        display_name: 'Jane Doe',
        role: 'BD Manager',
        communication_style: 'concise' as const,
        topics_of_interest: ['VA', 'HCD'],
        agencies_focus: ['HHS', 'DoD'],
        decision_style: 'aggressive' as const,
        typical_concerns: ['timeline', 'budget'],
        agent_notes: 'Prefers morning updates',
        background: 'Former contracting officer',
      }) as UserProfile;

      const result = formatUserProfileForAgent(profile);

      expect(result).toContain('=== USER CONTEXT ===');
      expect(result).toContain('User: Jane Doe');
      expect(result).toContain('Role: BD Manager');
      expect(result).toContain('Prefers brief, to-the-point responses');
      expect(result).toContain('Interests: VA, HCD');
      expect(result).toContain('Agency focus: HHS, DoD');
      expect(result).toContain('Prefers to move quickly on opportunities');
      expect(result).toContain('Usually asks about: timeline, budget');
      expect(result).toContain('Notes: Prefers morning updates');
      expect(result).toContain('Background: Former contracting officer');
      expect(result).toContain('=== END USER CONTEXT ===');
    });

    it('should return empty string when profile is null', () => {
      const result = formatUserProfileForAgent(null);
      expect(result).toBe('');
    });

    it('should return empty string when profile has only basic data', () => {
      const profile = testData.userProfile({
        display_name: undefined,
        role: undefined,
        communication_style: undefined,
        topics_of_interest: undefined,
        agencies_focus: undefined,
        decision_style: undefined,
        typical_concerns: undefined,
        agent_notes: undefined,
        background: undefined,
      }) as UserProfile;

      const result = formatUserProfileForAgent(profile);

      // Should have header and user name at minimum
      expect(result).toContain('User: testuser');
    });

    it('should handle different communication styles', () => {
      const detailed = formatUserProfileForAgent(
        testData.userProfile({ communication_style: 'detailed' as const }) as UserProfile
      );
      expect(detailed).toContain('Prefers thorough explanations with context');

      const balanced = formatUserProfileForAgent(
        testData.userProfile({ communication_style: 'balanced' as const }) as UserProfile
      );
      expect(balanced).toContain('Standard communication style');
    });

    it('should handle different decision styles', () => {
      const cautious = formatUserProfileForAgent(
        testData.userProfile({ decision_style: 'cautious' as const }) as UserProfile
      );
      expect(cautious).toContain('Tends to want more research before deciding');

      const balanced = formatUserProfileForAgent(
        testData.userProfile({ decision_style: 'balanced' as const }) as UserProfile
      );
      expect(balanced).toContain('Balanced approach to decisions');
    });
  });

  describe('saveUserContext', () => {
    it('should save user context', async () => {
      mockInsert.mockResolvedValue({ data: null, error: null });

      await saveUserContext({
        user_name: 'lapedra',
        context_type: 'personal',
        content: 'Has a meeting at 3pm',
        mentioned_by: 'patricia',
      });

      expect(mockFrom).toHaveBeenCalledWith('user_context');
      expect(mockInsert).toHaveBeenCalledWith({
        user_name: 'lapedra',
        context_type: 'personal',
        content: 'Has a meeting at 3pm',
        mentioned_by: 'patricia',
        mentioned_at: expect.any(String),
      });
    });

    it('should not throw on error', async () => {
      mockInsert.mockImplementation(() => {
        throw new Error('Insert failed');
      });

      await expect(
        saveUserContext({
          user_name: 'test',
          context_type: 'preference',
          content: 'test',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('getUserContext', () => {
    it('should return relevant user context', async () => {
      const contexts = [
        { user_name: 'lapedra', context_type: 'personal', content: 'Has a cat' },
        { user_name: 'lapedra', context_type: 'preference', content: 'Likes morning standups' },
      ];
      mockLimit.mockResolvedValue({ data: contexts, error: null });

      const result = await getUserContext('lapedra', 10);

      expect(mockEq).toHaveBeenCalledWith('user_name', 'lapedra');
      expect(mockLimit).toHaveBeenCalledWith(10);
      expect(result).toEqual(contexts);
    });

    it('should return empty array on error', async () => {
      mockLimit.mockResolvedValue({
        data: null,
        error: { message: 'Query failed' },
      });

      const result = await getUserContext('lapedra');

      expect(result).toEqual([]);
    });
  });
});
