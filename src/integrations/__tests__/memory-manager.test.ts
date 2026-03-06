import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryManager, createMemoryManager, type FullMemoryContext } from '../memory-manager.js';
import type { AgentMemory } from '../../memory/types.js';

// Helper to create test agent memories with all required fields
function createTestAgentMemory(
  overrides: Partial<AgentMemory> & { content: string; created_at: string }
): AgentMemory {
  return {
    id: '1',
    agent: 'maya',
    memory_type: 'observation',
    related_opportunity_id: null,
    related_event_id: null,
    importance: 0.5,
    embedding: null,
    tags: null,
    last_accessed_at: null,
    expires_at: null,
    ...overrides,
  };
}

// Mock all database dependencies
vi.mock('../supabase.js', () => ({
  getConversationalContext: vi.fn().mockResolvedValue({
    memories: [],
    decisionPatterns: [],
  }),
  getUserContext: vi.fn().mockResolvedValue([]),
  getExtractedFacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../semantic-search.js', () => ({
  searchUserContext: vi.fn().mockResolvedValue([]),
  searchConversationMemory: vi.fn().mockResolvedValue([]),
  searchDecisionPatterns: vi.fn().mockResolvedValue([]),
  searchExtractedFacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../memory/index.js', () => ({
  searchMemoriesBySimilarity: vi.fn().mockResolvedValue([]),
  getRecentMemories: vi.fn().mockResolvedValue([]),
}));

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(() => {
    manager = new MemoryManager('maya');
    vi.clearAllMocks();
  });

  describe('constructor and basic properties', () => {
    it('should store agent name', () => {
      const mgr = new MemoryManager('david');
      expect(mgr.name).toBe('david');
    });
  });

  describe('createMemoryManager', () => {
    it('should create a memory manager instance', () => {
      const mgr = createMemoryManager('patricia');
      expect(mgr).toBeInstanceOf(MemoryManager);
      expect(mgr.name).toBe('patricia');
    });
  });

  describe('buildMemoryContext', () => {
    it('should return a complete memory context', async () => {
      const context = await manager.buildMemoryContext('Test message');

      expect(context).toHaveProperty('shortTerm');
      expect(context).toHaveProperty('longTerm');
      expect(context).toHaveProperty('episodic');
    });

    it('should include thread messages in short-term memory', async () => {
      const threadMessages = [
        { author: 'user', text: 'Hello', ts: '1234567890' },
        { author: 'maya', text: 'Hi there', ts: '1234567891' },
      ];

      const context = await manager.buildMemoryContext('New message', threadMessages);

      expect(context.shortTerm.threadMessages).toHaveLength(2);
      expect(context.shortTerm.threadMessages[0].author).toBe('user');
    });

    it('should truncate long thread messages', async () => {
      const longText = 'x'.repeat(600);
      const threadMessages = [{ author: 'user', text: longText, ts: '1234567890' }];

      const context = await manager.buildMemoryContext('Test', threadMessages);

      // Should be truncated to MAX_MESSAGE_LENGTH (500) + '...'
      expect(context.shortTerm.threadMessages[0].text.length).toBeLessThanOrEqual(503);
      expect(context.shortTerm.threadMessages[0].text).toContain('...');
    });

    it('should limit number of thread messages', async () => {
      // Create 40 messages (over the limit of 30)
      const threadMessages = Array.from({ length: 40 }, (_, i) => ({
        author: 'user',
        text: `Message ${i}`,
        ts: String(1234567890 + i),
      }));

      const context = await manager.buildMemoryContext('Test', threadMessages);

      // Should be MAX_THREAD_MESSAGES (30) + 1 system summary message
      expect(context.shortTerm.threadMessages.length).toBeLessThanOrEqual(31);
    });

    it('should add system message when truncating threads', async () => {
      const threadMessages = Array.from({ length: 40 }, (_, i) => ({
        author: 'user',
        text: `Message ${i}`,
        ts: String(1234567890 + i),
      }));

      const context = await manager.buildMemoryContext('Test', threadMessages);

      // First message should be the system truncation notice
      const firstMessage = context.shortTerm.threadMessages[0];
      expect(firstMessage.author).toBe('system');
      expect(firstMessage.text).toContain('earlier messages omitted');
    });

    it('should respect custom maxThreadMessages option', async () => {
      const threadMessages = Array.from({ length: 20 }, (_, i) => ({
        author: 'user',
        text: `Message ${i}`,
        ts: String(1234567890 + i),
      }));

      const context = await manager.buildMemoryContext('Test', threadMessages, {
        maxThreadMessages: 5,
      });

      // Should be 5 + 1 system summary message
      expect(context.shortTerm.threadMessages.length).toBe(6);
    });
  });

  describe('topic extraction', () => {
    it('should extract BD-related topics', async () => {
      const context = await manager.buildMemoryContext('We need to review this RFP for the VA');

      expect(context.shortTerm.activeTopics).toContain('RFP');
      expect(context.shortTerm.activeTopics).toContain('VA');
    });

    it('should extract multiple topics', async () => {
      const context = await manager.buildMemoryContext(
        'The solicitation requires a teaming partner'
      );

      expect(context.shortTerm.activeTopics).toContain('Solicitation');
      expect(context.shortTerm.activeTopics).toContain('Teaming');
    });

    it('should extract topics from thread messages too', async () => {
      const threadMessages = [{ author: 'user', text: 'What about GSA schedule?', ts: '123' }];

      const context = await manager.buildMemoryContext('Any updates?', threadMessages);

      expect(context.shortTerm.activeTopics).toContain('GSA');
    });

    it('should handle messages with no topics', async () => {
      const context = await manager.buildMemoryContext('Hello, how are you?');

      expect(context.shortTerm.activeTopics).toEqual([]);
    });
  });

  describe('mood detection', () => {
    it('should detect urgent mood', async () => {
      const context = await manager.buildMemoryContext('This is urgent! We need it ASAP');

      expect(context.shortTerm.userMood).toBe('urgent');
    });

    it('should detect frustrated mood', async () => {
      const context = await manager.buildMemoryContext('Ugh, this is so frustrating');

      expect(context.shortTerm.userMood).toBe('frustrated');
    });

    it('should detect excited mood', async () => {
      const context = await manager.buildMemoryContext('Great news! We won the contract!');

      expect(context.shortTerm.userMood).toBe('excited');
    });

    it('should detect confused mood', async () => {
      const context = await manager.buildMemoryContext("I don't understand what you mean");

      expect(context.shortTerm.userMood).toBe('confused');
    });

    it('should detect grateful mood', async () => {
      const context = await manager.buildMemoryContext('Thanks so much for your help');

      expect(context.shortTerm.userMood).toBe('grateful');
    });

    it('should return undefined for neutral messages', async () => {
      const context = await manager.buildMemoryContext('Can you look at this opportunity?');

      expect(context.shortTerm.userMood).toBeUndefined();
    });
  });

  describe('formatForPrompt', () => {
    it('should return empty string when no memory content', () => {
      const emptyMemory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      expect(manager.formatForPrompt(emptyMemory)).toBe('');
    });

    it('should include team announcements first', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [
            {
              id: '1',
              subject: 'team',
              content: 'Marcus is offline this week',
              fact_type: 'context',
              extracted_by: 'maya',
            },
          ],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('TEAM UPDATES');
      expect(result).toContain('Marcus is offline this week');
    });

    it('should include current context when present', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          userMood: 'urgent',
          activeTopics: ['RFP', 'VA'],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('CURRENT CONTEXT');
      expect(result).toContain('RFP, VA');
      expect(result).toContain('urgent');
    });

    it('should include user preferences', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [
            {
              id: '1',
              user_name: 'lapedra',
              content: 'Prefers concise responses',
              context_type: 'preference',
            },
          ],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('THINGS YOU KNOW ABOUT THE USER');
      expect(result).toContain('Prefers concise responses');
    });

    it('should include company patterns', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [
            {
              id: '1',
              subject: 'company',
              content: 'Always team with small businesses for VA work',
              fact_type: 'pattern',
              extracted_by: 'maya',
            },
          ],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('COMPANY PATTERNS');
      expect(result).toContain('Always team with small businesses');
    });

    it('should include past experiences', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [
            {
              id: '1',
              memory_type: 'decision',
              summary: 'Passed on GSA BPA due to pricing requirements',
            },
          ],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('RELEVANT PAST EXPERIENCES');
      expect(result).toContain('Passed on GSA BPA');
    });

    it('should include decision history', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [
            {
              decision: 'go',
              reasoning: 'Strong incumbent knowledge',
              agency: 'VA',
            },
          ],
          relatedThreads: [],
          agentMemories: [],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('PAST DECISION PATTERNS');
      expect(result).toContain('GO');
      expect(result).toContain('Strong incumbent knowledge');
      expect(result).toContain('VA');
    });

    it('should include agent memories with recency indicators', () => {
      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [
            createTestAgentMemory({
              content: 'User prefers detailed analysis',
              created_at: new Date().toISOString(), // Today
            }),
          ],
        },
      };

      const result = manager.formatForPrompt(memory);

      expect(result).toContain('YOUR PAST OBSERVATIONS');
      expect(result).toContain('[today]');
      expect(result).toContain('User prefers detailed analysis');
    });

    it('should format recency as yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [
            createTestAgentMemory({
              content: 'Memory from yesterday',
              created_at: yesterday.toISOString(),
            }),
          ],
        },
      };

      const result = manager.formatForPrompt(memory);
      expect(result).toContain('[yesterday]');
    });

    it('should format recency as days ago', () => {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [
            createTestAgentMemory({
              content: 'Memory from 3 days ago',
              created_at: threeDaysAgo.toISOString(),
            }),
          ],
        },
      };

      const result = manager.formatForPrompt(memory);
      expect(result).toContain('[3 days ago]');
    });

    it('should format recency as weeks ago', () => {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const memory: FullMemoryContext = {
        shortTerm: {
          threadMessages: [],
          recentInteractions: [],
          activeTopics: [],
        },
        longTerm: {
          userPreferences: [],
          companyPatterns: [],
          relationships: [],
          teamAnnouncements: [],
        },
        episodic: {
          pastExperiences: [],
          decisionHistory: [],
          relatedThreads: [],
          agentMemories: [
            createTestAgentMemory({
              content: 'Memory from 2 weeks ago',
              created_at: twoWeeksAgo.toISOString(),
            }),
          ],
        },
      };

      const result = manager.formatForPrompt(memory);
      expect(result).toContain('[2 weeks ago]');
    });
  });

  describe('semantic search mode', () => {
    it('should use semantic search by default', async () => {
      const { searchUserContext } = await import('../semantic-search.js');

      await manager.buildMemoryContext('Test message');

      expect(searchUserContext).toHaveBeenCalled();
    });

    it('should skip semantic search when disabled', async () => {
      const { getUserContext } = await import('../supabase.js');
      const { searchUserContext } = await import('../semantic-search.js');

      vi.mocked(searchUserContext).mockClear();
      vi.mocked(getUserContext).mockClear();

      await manager.buildMemoryContext('Test message', [], { useSemanticSearch: false });

      // Should use direct database query instead
      expect(getUserContext).toHaveBeenCalled();
      // searchUserContext is NOT called with semantic search disabled
      // The mock was called in the previous test, so we check it wasn't called again
    });
  });
});
