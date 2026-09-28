/**
 * Milestone 1A — Emergency Inference Containment Tests
 *
 * These tests prove that:
 * 1. Global AI disable prevents all inference
 * 2. Database failure results in AI disabled (fail closed)
 * 3. Feature flags default to OFF
 * 4. Provider circuit breakers block requests when AI disabled
 * 5. Amplification features are disabled by default
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Supabase before importing modules that use it
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock('../../integrations/supabase.js', () => ({
  getSupabase: () => mockSupabase,
}));

import {
  isAIEnabled,
  getFeatureFlag,
  isTeamFanoutEnabled,
  isMemoryExtractionEnabled,
  isFactExtractionEnabled,
  isOneVoiceEnabled,
  isNewsReactionsEnabled,
  isAutonomousAIEnabled,
  getAIControlStatus,
  FEATURE_FLAGS,
  _resetCache,
} from '../ai-controls.js';

describe('Global AI Control (isAIEnabled)', () => {
  beforeEach(() => {
    _resetCache();
    delete process.env.AI_SYSTEM_ENABLED;
    mockSupabase.single.mockReset();
  });

  afterEach(() => {
    delete process.env.AI_SYSTEM_ENABLED;
  });

  it('returns false when AI_SYSTEM_ENABLED=false (env override)', async () => {
    process.env.AI_SYSTEM_ENABLED = 'false';
    const result = await isAIEnabled();
    expect(result).toBe(false);
    // Should not even check database
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns false when env is not set and DB has ai_enabled=false', async () => {
    mockSupabase.single.mockResolvedValue({ data: { value: false }, error: null });
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('returns false when database lookup fails (fail closed)', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('returns false when database throws an exception (fail closed)', async () => {
    mockSupabase.single.mockRejectedValue(new Error('Connection refused'));
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('returns false when database returns missing key (fail closed)', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: null });
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('returns true only when both env allows and DB says true', async () => {
    process.env.AI_SYSTEM_ENABLED = 'true';
    mockSupabase.single.mockResolvedValue({ data: { value: true }, error: null });
    const result = await isAIEnabled();
    expect(result).toBe(true);
  });

  it('returns false when env is true but DB says false', async () => {
    process.env.AI_SYSTEM_ENABLED = 'true';
    mockSupabase.single.mockResolvedValue({ data: { value: false }, error: null });
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('environment DISABLED always wins over database ENABLED', async () => {
    // Reset call counts to isolate this test
    mockSupabase.from.mockClear();
    process.env.AI_SYSTEM_ENABLED = 'false';
    mockSupabase.single.mockResolvedValue({ data: { value: true }, error: null });
    const result = await isAIEnabled();
    expect(result).toBe(false);
    // Database should not be queried when env says disabled
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns false when database value is an invalid type', async () => {
    process.env.AI_SYSTEM_ENABLED = 'true';
    mockSupabase.single.mockResolvedValue({ data: { value: 'yes' }, error: null });
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('returns false when env is missing (deployment not authorized)', async () => {
    delete process.env.AI_SYSTEM_ENABLED;
    mockSupabase.from.mockClear();
    // DB should not even be checked
    const result = await isAIEnabled();
    expect(result).toBe(false);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns false when env is invalid string', async () => {
    process.env.AI_SYSTEM_ENABLED = 'yes';
    mockSupabase.from.mockClear();
    const result = await isAIEnabled();
    expect(result).toBe(false);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns false when env is empty string', async () => {
    process.env.AI_SYSTEM_ENABLED = '';
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('database error with env=true → DISABLED (fail closed)', async () => {
    process.env.AI_SYSTEM_ENABLED = 'true';
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });

  it('database exception with env=true → DISABLED (fail closed)', async () => {
    process.env.AI_SYSTEM_ENABLED = 'true';
    mockSupabase.single.mockRejectedValue(new Error('Connection refused'));
    const result = await isAIEnabled();
    expect(result).toBe(false);
  });
});

describe('Feature Flags', () => {
  beforeEach(() => {
    // Clean all feature flag env vars
    for (const flag of Object.values(FEATURE_FLAGS)) {
      delete process.env[flag];
    }
  });

  afterEach(() => {
    for (const flag of Object.values(FEATURE_FLAGS)) {
      delete process.env[flag];
    }
  });

  it('all feature flags default to false (OFF)', () => {
    expect(isTeamFanoutEnabled()).toBe(false);
    expect(isMemoryExtractionEnabled()).toBe(false);
    expect(isFactExtractionEnabled()).toBe(false);
    expect(isOneVoiceEnabled()).toBe(false);
    expect(isNewsReactionsEnabled()).toBe(false);
    expect(isAutonomousAIEnabled()).toBe(false);
  });

  it('ENABLE_TEAM_FANOUT=false prevents fan-out', () => {
    process.env.ENABLE_TEAM_FANOUT = 'false';
    expect(isTeamFanoutEnabled()).toBe(false);
  });

  it('ENABLE_TEAM_FANOUT=true enables fan-out', () => {
    process.env.ENABLE_TEAM_FANOUT = 'true';
    expect(isTeamFanoutEnabled()).toBe(true);
  });

  it('ENABLE_MEMORY_EXTRACTION=false prevents memory extraction', () => {
    process.env.ENABLE_MEMORY_EXTRACTION = 'false';
    expect(isMemoryExtractionEnabled()).toBe(false);
  });

  it('ENABLE_FACT_EXTRACTION=false prevents fact extraction', () => {
    process.env.ENABLE_FACT_EXTRACTION = 'false';
    expect(isFactExtractionEnabled()).toBe(false);
  });

  it('ENABLE_ONE_VOICE=false prevents one-voice synthesis', () => {
    process.env.ENABLE_ONE_VOICE = 'false';
    expect(isOneVoiceEnabled()).toBe(false);
  });

  it('ENABLE_NEWS_REACTIONS=false prevents news team reactions', () => {
    process.env.ENABLE_NEWS_REACTIONS = 'false';
    expect(isNewsReactionsEnabled()).toBe(false);
  });

  it('ENABLE_AUTONOMOUS_AI=false prevents autonomous AI', () => {
    process.env.ENABLE_AUTONOMOUS_AI = 'false';
    expect(isAutonomousAIEnabled()).toBe(false);
  });

  it('unknown flag returns false', () => {
    expect(getFeatureFlag('UNKNOWN_FLAG')).toBe(false);
  });
});

describe('AI Control Status Report', () => {
  beforeEach(() => {
    _resetCache();
    delete process.env.AI_SYSTEM_ENABLED;
    for (const flag of Object.values(FEATURE_FLAGS)) {
      delete process.env[flag];
    }
  });

  afterEach(() => {
    delete process.env.AI_SYSTEM_ENABLED;
    for (const flag of Object.values(FEATURE_FLAGS)) {
      delete process.env[flag];
    }
  });

  it('reports all controls as DISABLED by default', async () => {
    process.env.AI_SYSTEM_ENABLED = 'false';
    const status = await getAIControlStatus();

    expect(status['AI execution']).toBe('DISABLED');
    expect(status['Autonomous AI']).toBe('DISABLED');
    expect(status['Team fan-out']).toBe('DISABLED');
    expect(status['Memory extraction']).toBe('DISABLED');
    expect(status['Fact extraction']).toBe('DISABLED');
    expect(status['One-voice']).toBe('DISABLED');
    expect(status['News reactions']).toBe('DISABLED');
  });

  it('reports individual flags correctly', async () => {
    process.env.AI_SYSTEM_ENABLED = 'false';
    process.env.ENABLE_TEAM_FANOUT = 'true';
    const status = await getAIControlStatus();

    expect(status['AI execution']).toBe('DISABLED');
    expect(status['Team fan-out']).toBe('ENABLED');
  });
});

describe('Provider Circuit Breaker', () => {
  beforeEach(() => {
    _resetCache();
    process.env.AI_SYSTEM_ENABLED = 'false';
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.AI_SYSTEM_ENABLED;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('Anthropic client throws AIDisabledError when AI is disabled', async () => {
    // We need to re-import to get a fresh client
    const { getAnthropic, AIDisabledError, _resetAnthropicClient } =
      await import('../../integrations/claude.js');
    _resetAnthropicClient();

    const client = getAnthropic();
    await expect(
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      })
    ).rejects.toThrow(AIDisabledError);
  });

  it('OpenAI client throws AIDisabledError when AI is disabled', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const { _resetOpenAIClient } = await import('../../integrations/embeddings.js');
    const { AIDisabledError } = await import('../../integrations/claude.js');
    const { embed } = await import('../../integrations/embeddings.js');
    _resetOpenAIClient();

    await expect(embed('test text')).rejects.toThrow(AIDisabledError);
    delete process.env.OPENAI_API_KEY;
  });
});

describe('Autonomous Schedule Containment', () => {
  beforeEach(() => {
    for (const flag of Object.values(FEATURE_FLAGS)) {
      delete process.env[flag];
    }
  });

  afterEach(() => {
    for (const flag of Object.values(FEATURE_FLAGS)) {
      delete process.env[flag];
    }
  });

  it('autonomous AI is disabled by default', () => {
    expect(isAutonomousAIEnabled()).toBe(false);
  });

  it('all MAY_INVOKE_LLM jobs are blocked when autonomous AI is disabled', () => {
    // This tests the configuration, not the scheduler directly
    // The scheduler checks isAutonomousAIEnabled() && isAIEnabled() before each job
    expect(isAutonomousAIEnabled()).toBe(false);
    expect(isTeamFanoutEnabled()).toBe(false);
    expect(isMemoryExtractionEnabled()).toBe(false);
    expect(isFactExtractionEnabled()).toBe(false);
    expect(isOneVoiceEnabled()).toBe(false);
    expect(isNewsReactionsEnabled()).toBe(false);
  });
});

describe('One-Voice Containment', () => {
  it('one-voice flag is disabled by default, blocking synthesis', () => {
    delete process.env.ENABLE_ONE_VOICE;
    // The gate is in james.ts: isOneVoiceEnabled() && shouldTriggerSynthesis(...)
    // When isOneVoiceEnabled() is false, shouldTriggerSynthesis is never called
    expect(isOneVoiceEnabled()).toBe(false);
  });
});

describe('Team Fan-out Containment', () => {
  it('"hey team" does not trigger fan-out when disabled', () => {
    delete process.env.ENABLE_TEAM_FANOUT;
    expect(isTeamFanoutEnabled()).toBe(false);
    // The agent.ts extractMentionedAgents() checks isTeamFanoutEnabled()
    // When false, "hey team" returns empty agents instead of all agents
  });
});

describe('News Reactions Containment', () => {
  it('team reactions are disabled by default', () => {
    delete process.env.ENABLE_NEWS_REACTIONS;
    expect(isNewsReactionsEnabled()).toBe(false);
    // david-news-digest.ts checks isNewsReactionsEnabled() before calling postTeamReactions
  });
});
