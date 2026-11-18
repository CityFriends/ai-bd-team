/**
 * Tests for Conversation Context Manager
 *
 * Verifies thread-aware conversation state for HR bot follow-ups.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateContextKey,
  ConversationStore,
  formatConversationForPrompt,
  MAX_CONVERSATION_TURNS,
  MAX_CONTEXT_AGE_MS,
  MAX_ANSWER_LENGTH,
  MAX_QUESTION_LENGTH,
  resetConversationStore,
  getConversationStore,
  type ConversationTurn,
} from '../slack/conversation-context.js';

describe('generateContextKey', () => {
  it('creates composite key from components', () => {
    const key = generateContextKey('W123', 'C456', '1234567890.000001', 'U789');
    expect(key).toBe('W123:C456:1234567890.000001:U789');
  });

  it('rejects empty workspace ID', () => {
    expect(() => generateContextKey('', 'C456', '1234567890.000001', 'U789')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects empty channel ID', () => {
    expect(() => generateContextKey('W123', '', '1234567890.000001', 'U789')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects empty thread timestamp', () => {
    expect(() => generateContextKey('W123', 'C456', '', 'U789')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects empty user ID', () => {
    expect(() => generateContextKey('W123', 'C456', '1234567890.000001', '')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects workspace ID containing colon (key injection)', () => {
    expect(() => generateContextKey('W123:injected', 'C456', '1234567890.000001', 'U789')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects channel ID containing colon', () => {
    expect(() => generateContextKey('W123', 'C456:injected', '1234567890.000001', 'U789')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects thread timestamp containing colon', () => {
    expect(() => generateContextKey('W123', 'C456', '123:456', 'U789')).toThrow(
      'Invalid context key components'
    );
  });

  it('rejects user ID containing colon', () => {
    expect(() => generateContextKey('W123', 'C456', '1234567890.000001', 'U789:admin')).toThrow(
      'Invalid context key components'
    );
  });
});

describe('ConversationStore', () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  afterEach(() => {
    store.destroy();
  });

  const baseInput = {
    workspaceId: 'W123',
    channelId: 'C456',
    threadTs: '1234567890.000001',
    userId: 'U789',
  };

  describe('addTurn', () => {
    it('creates new context on first turn', () => {
      store.addTurn({
        ...baseInput,
        question: 'How many PTO days do I get?',
        answer: 'You get 20 PTO days per year.',
      });

      const context = store.getContext(baseInput);
      expect(context).not.toBeNull();
      expect(context).toHaveLength(1);
      expect(context![0].question).toBe('How many PTO days do I get?');
      expect(context![0].answer).toBe('You get 20 PTO days per year.');
    });

    it('appends to existing context', () => {
      store.addTurn({
        ...baseInput,
        question: 'How many PTO days do I get?',
        answer: 'You get 20 PTO days per year.',
      });
      store.addTurn({
        ...baseInput,
        question: 'Can I carry them over?',
        answer: 'Yes, up to 5 days can be carried over.',
      });

      const context = store.getContext(baseInput);
      expect(context).toHaveLength(2);
      expect(context![1].question).toBe('Can I carry them over?');
    });

    it('records topic if provided', () => {
      store.addTurn({
        ...baseInput,
        question: 'How many PTO days do I get?',
        answer: 'You get 20 PTO days per year.',
        topic: 'pto',
      });

      const context = store.getContext(baseInput);
      expect(context![0].topic).toBe('pto');
    });

    it('truncates long answers', () => {
      const longAnswer = 'A'.repeat(MAX_ANSWER_LENGTH + 100);
      store.addTurn({
        ...baseInput,
        question: 'What is the policy?',
        answer: longAnswer,
      });

      const context = store.getContext(baseInput);
      expect(context![0].answer.length).toBe(MAX_ANSWER_LENGTH + 3); // +3 for '...'
      expect(context![0].answer.endsWith('...')).toBe(true);
    });

    it('truncates long questions', () => {
      const longQuestion = 'Q'.repeat(MAX_QUESTION_LENGTH + 100);
      store.addTurn({
        ...baseInput,
        question: longQuestion,
        answer: 'Answer',
      });

      const context = store.getContext(baseInput);
      expect(context![0].question.length).toBe(MAX_QUESTION_LENGTH + 3);
      expect(context![0].question.endsWith('...')).toBe(true);
    });

    it('enforces MAX_CONVERSATION_TURNS limit', () => {
      // Add more than MAX_CONVERSATION_TURNS
      for (let i = 0; i < MAX_CONVERSATION_TURNS + 5; i++) {
        store.addTurn({
          ...baseInput,
          question: `Question ${i}`,
          answer: `Answer ${i}`,
        });
      }

      // maxTurns in getContext defaults to 5, so get all
      const context = store.getContext(baseInput, MAX_CONVERSATION_TURNS);
      expect(context).toHaveLength(MAX_CONVERSATION_TURNS);
      // Oldest turns should be removed
      expect(context![0].question).toBe('Question 5');
      expect(context![MAX_CONVERSATION_TURNS - 1].question).toBe(
        `Question ${MAX_CONVERSATION_TURNS + 4}`
      );
    });
  });

  describe('getContext', () => {
    it('returns null for nonexistent context', () => {
      const context = store.getContext(baseInput);
      expect(context).toBeNull();
    });

    it('respects maxTurns parameter', () => {
      for (let i = 0; i < 8; i++) {
        store.addTurn({
          ...baseInput,
          question: `Question ${i}`,
          answer: `Answer ${i}`,
        });
      }

      const context = store.getContext(baseInput, 3);
      expect(context).toHaveLength(3);
      // Should return most recent turns
      expect(context![0].question).toBe('Question 5');
      expect(context![2].question).toBe('Question 7');
    });

    it('defaults to 5 turns', () => {
      for (let i = 0; i < 8; i++) {
        store.addTurn({
          ...baseInput,
          question: `Question ${i}`,
          answer: `Answer ${i}`,
        });
      }

      const context = store.getContext(baseInput);
      expect(context).toHaveLength(5);
    });

    it('returns null for expired context', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      store.addTurn({
        ...baseInput,
        question: 'Question',
        answer: 'Answer',
      });

      // Advance time past MAX_CONTEXT_AGE_MS
      vi.setSystemTime(now + MAX_CONTEXT_AGE_MS + 1);

      const context = store.getContext(baseInput);
      expect(context).toBeNull();

      vi.useRealTimers();
    });

    it('returns null if user ID does not match', () => {
      store.addTurn({
        ...baseInput,
        question: 'Question',
        answer: 'Answer',
      });

      // Different user
      const context = store.getContext({
        ...baseInput,
        userId: 'U_DIFFERENT',
      });
      expect(context).toBeNull();
    });
  });

  describe('context isolation', () => {
    it('isolates by workspace', () => {
      store.addTurn({
        ...baseInput,
        workspaceId: 'W_ALPHA',
        question: 'Alpha question',
        answer: 'Alpha answer',
      });
      store.addTurn({
        ...baseInput,
        workspaceId: 'W_BETA',
        question: 'Beta question',
        answer: 'Beta answer',
      });

      const alphaContext = store.getContext({ ...baseInput, workspaceId: 'W_ALPHA' });
      const betaContext = store.getContext({ ...baseInput, workspaceId: 'W_BETA' });

      expect(alphaContext![0].question).toBe('Alpha question');
      expect(betaContext![0].question).toBe('Beta question');
    });

    it('isolates by channel', () => {
      store.addTurn({
        ...baseInput,
        channelId: 'C_ONE',
        question: 'Channel one',
        answer: 'Answer one',
      });
      store.addTurn({
        ...baseInput,
        channelId: 'C_TWO',
        question: 'Channel two',
        answer: 'Answer two',
      });

      const oneContext = store.getContext({ ...baseInput, channelId: 'C_ONE' });
      const twoContext = store.getContext({ ...baseInput, channelId: 'C_TWO' });

      expect(oneContext![0].question).toBe('Channel one');
      expect(twoContext![0].question).toBe('Channel two');
    });

    it('isolates by thread', () => {
      store.addTurn({
        ...baseInput,
        threadTs: '1111111111.000001',
        question: 'Thread A',
        answer: 'Answer A',
      });
      store.addTurn({
        ...baseInput,
        threadTs: '2222222222.000002',
        question: 'Thread B',
        answer: 'Answer B',
      });

      const aContext = store.getContext({ ...baseInput, threadTs: '1111111111.000001' });
      const bContext = store.getContext({ ...baseInput, threadTs: '2222222222.000002' });

      expect(aContext![0].question).toBe('Thread A');
      expect(bContext![0].question).toBe('Thread B');
    });

    it('isolates by user within same thread', () => {
      store.addTurn({
        ...baseInput,
        userId: 'U_ALICE',
        question: 'Alice question',
        answer: 'Answer for Alice',
      });
      store.addTurn({
        ...baseInput,
        userId: 'U_BOB',
        question: 'Bob question',
        answer: 'Answer for Bob',
      });

      const aliceContext = store.getContext({ ...baseInput, userId: 'U_ALICE' });
      const bobContext = store.getContext({ ...baseInput, userId: 'U_BOB' });

      expect(aliceContext![0].question).toBe('Alice question');
      expect(bobContext![0].question).toBe('Bob question');
    });
  });

  describe('hasContext', () => {
    it('returns false for no context', () => {
      expect(store.hasContext(baseInput)).toBe(false);
    });

    it('returns true after adding a turn', () => {
      store.addTurn({
        ...baseInput,
        question: 'Question',
        answer: 'Answer',
      });
      expect(store.hasContext(baseInput)).toBe(true);
    });
  });

  describe('clearContext', () => {
    it('removes context for specified conversation', () => {
      store.addTurn({
        ...baseInput,
        question: 'Question',
        answer: 'Answer',
      });
      expect(store.hasContext(baseInput)).toBe(true);

      store.clearContext(baseInput);
      expect(store.hasContext(baseInput)).toBe(false);
    });

    it('does not affect other conversations', () => {
      const otherThread = { ...baseInput, threadTs: '9999999999.000001' };

      store.addTurn({
        ...baseInput,
        question: 'Question A',
        answer: 'Answer A',
      });
      store.addTurn({
        ...otherThread,
        question: 'Question B',
        answer: 'Answer B',
      });

      store.clearContext(baseInput);

      expect(store.hasContext(baseInput)).toBe(false);
      expect(store.hasContext(otherThread)).toBe(true);
    });
  });

  describe('cleanupExpired', () => {
    it('removes expired contexts', () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      // Add old context
      store.addTurn({
        ...baseInput,
        threadTs: '1111111111.000001',
        question: 'Old',
        answer: 'Old answer',
      });

      // Advance time
      vi.setSystemTime(now + MAX_CONTEXT_AGE_MS + 1);

      // Add new context
      store.addTurn({
        ...baseInput,
        threadTs: '2222222222.000002',
        question: 'New',
        answer: 'New answer',
      });

      const removed = store.cleanupExpired();
      expect(removed).toBe(1);

      expect(store.hasContext({ ...baseInput, threadTs: '1111111111.000001' })).toBe(false);
      expect(store.hasContext({ ...baseInput, threadTs: '2222222222.000002' })).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('getStats', () => {
    it('returns zero stats for empty store', () => {
      const stats = store.getStats();
      expect(stats.activeContexts).toBe(0);
      expect(stats.totalTurns).toBe(0);
    });

    it('tracks active contexts and total turns', () => {
      store.addTurn({
        ...baseInput,
        threadTs: '1111111111.000001',
        question: 'Q1',
        answer: 'A1',
      });
      store.addTurn({
        ...baseInput,
        threadTs: '1111111111.000001',
        question: 'Q2',
        answer: 'A2',
      });
      store.addTurn({
        ...baseInput,
        threadTs: '2222222222.000002',
        question: 'Q3',
        answer: 'A3',
      });

      const stats = store.getStats();
      expect(stats.activeContexts).toBe(2);
      expect(stats.totalTurns).toBe(3);
    });
  });
});

describe('formatConversationForPrompt', () => {
  it('returns empty string for empty turns', () => {
    expect(formatConversationForPrompt([])).toBe('');
  });

  it('formats single turn', () => {
    const turns: ConversationTurn[] = [
      {
        timestamp: Date.now(),
        question: 'How many PTO days?',
        answer: 'You get 20 days.',
      },
    ];

    const formatted = formatConversationForPrompt(turns);
    expect(formatted).toContain('Turn 1:');
    expect(formatted).toContain('Employee: How many PTO days?');
    expect(formatted).toContain('Assistant: You get 20 days.');
  });

  it('formats multiple turns in order', () => {
    const turns: ConversationTurn[] = [
      { timestamp: 1, question: 'First question', answer: 'First answer' },
      { timestamp: 2, question: 'Second question', answer: 'Second answer' },
      { timestamp: 3, question: 'Third question', answer: 'Third answer' },
    ];

    const formatted = formatConversationForPrompt(turns);
    expect(formatted).toContain('Turn 1:');
    expect(formatted).toContain('Turn 2:');
    expect(formatted).toContain('Turn 3:');
    expect(formatted.indexOf('First')).toBeLessThan(formatted.indexOf('Second'));
    expect(formatted.indexOf('Second')).toBeLessThan(formatted.indexOf('Third'));
  });

  it('includes topic hint when present', () => {
    const turns: ConversationTurn[] = [
      {
        timestamp: Date.now(),
        question: 'How many PTO days?',
        answer: 'You get 20 days.',
        topic: 'pto',
      },
    ];

    const formatted = formatConversationForPrompt(turns);
    expect(formatted).toContain('[Topic: pto]');
  });

  it('omits topic hint when not present', () => {
    const turns: ConversationTurn[] = [
      {
        timestamp: Date.now(),
        question: 'How many PTO days?',
        answer: 'You get 20 days.',
      },
    ];

    const formatted = formatConversationForPrompt(turns);
    expect(formatted).not.toContain('[Topic:');
  });
});

describe('singleton store', () => {
  afterEach(() => {
    resetConversationStore();
  });

  it('returns same instance on multiple calls', () => {
    const store1 = getConversationStore();
    const store2 = getConversationStore();
    expect(store1).toBe(store2);
  });

  it('creates new instance after reset', () => {
    const store1 = getConversationStore();
    resetConversationStore();
    const store2 = getConversationStore();
    expect(store1).not.toBe(store2);
  });

  it('reset clears all data', () => {
    const store = getConversationStore();
    store.addTurn({
      workspaceId: 'W1',
      channelId: 'C1',
      threadTs: '123',
      userId: 'U1',
      question: 'Q',
      answer: 'A',
    });
    expect(store.getStats().activeContexts).toBe(1);

    resetConversationStore();

    const newStore = getConversationStore();
    expect(newStore.getStats().activeContexts).toBe(0);
  });
});
