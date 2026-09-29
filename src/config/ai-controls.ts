/**
 * Global AI Control — Milestone 1A Emergency Containment
 *
 * Provides a single system-level mechanism to answer: isAIEnabled(): boolean
 *
 * Fail-closed design:
 *  - Environment variable AI_SYSTEM_ENABLED=false always wins (absolute override)
 *  - Database lookup failure → DISABLED
 *  - Missing/invalid configuration → DISABLED
 *  - No long-lived positive cache (re-checks database each call, with short negative cache)
 */

import { getSupabase } from '../integrations/supabase.js';

// ============================================================
// Feature flag defaults — all amplification features OFF
// ============================================================
export const FEATURE_FLAGS = {
  /** Global AI execution */
  AI_SYSTEM_ENABLED: 'AI_SYSTEM_ENABLED',
  /** Autonomous scheduled AI jobs */
  ENABLE_AUTONOMOUS_AI: 'ENABLE_AUTONOMOUS_AI',
  /** "hey team" fan-out triggering all agents */
  ENABLE_TEAM_FANOUT: 'ENABLE_TEAM_FANOUT',
  /** Automatic LLM-based memory extraction after each response */
  ENABLE_MEMORY_EXTRACTION: 'ENABLE_MEMORY_EXTRACTION',
  /** Automatic LLM-based fact extraction after each response */
  ENABLE_FACT_EXTRACTION: 'ENABLE_FACT_EXTRACTION',
  /** One-voice multi-agent synthesis */
  ENABLE_ONE_VOICE: 'ENABLE_ONE_VOICE',
  /** David news team-reaction LLM calls */
  ENABLE_NEWS_REACTIONS: 'ENABLE_NEWS_REACTIONS',
  /** Deterministic source collection (no LLM — can run while AI is disabled) */
  ENABLE_SOURCE_COLLECTION: 'ENABLE_SOURCE_COLLECTION',
  /** Maya Slack projection (Stage C). Fail closed if missing. */
  MAYA_SLACK_PROJECTION_ENABLED: 'MAYA_SLACK_PROJECTION_ENABLED',
} as const;

/** Default values for all feature flags — ALL OFF for safety */
const FLAG_DEFAULTS: Record<string, boolean> = {
  [FEATURE_FLAGS.AI_SYSTEM_ENABLED]: false,
  [FEATURE_FLAGS.ENABLE_AUTONOMOUS_AI]: false,
  [FEATURE_FLAGS.ENABLE_TEAM_FANOUT]: false,
  [FEATURE_FLAGS.ENABLE_MEMORY_EXTRACTION]: false,
  [FEATURE_FLAGS.ENABLE_FACT_EXTRACTION]: false,
  [FEATURE_FLAGS.ENABLE_ONE_VOICE]: false,
  [FEATURE_FLAGS.ENABLE_NEWS_REACTIONS]: false,
  [FEATURE_FLAGS.ENABLE_SOURCE_COLLECTION]: false,
  [FEATURE_FLAGS.MAYA_SLACK_PROJECTION_ENABLED]: false,
};

// Short negative cache to avoid hammering DB on repeated disabled checks
let lastDbCheckTime = 0;
let lastDbResult: boolean | null = null;
const NEGATIVE_CACHE_MS = 5_000; // 5 seconds

/**
 * Check if AI execution is enabled.
 *
 * Dual authorization: AI may execute ONLY when BOTH are explicitly true:
 *  1. Environment: AI_SYSTEM_ENABLED=true (deployment authorization)
 *  2. Database: system_controls.ai_enabled=true (runtime authorization)
 *
 * Truth table:
 *  ENV=false,   DB=false    → DISABLED
 *  ENV=false,   DB=true     → DISABLED
 *  ENV=true,    DB=false    → DISABLED
 *  ENV=true,    DB=true     → ENABLED
 *  ENV=missing, DB=any      → DISABLED
 *  ENV=any,     DB=error    → DISABLED
 *
 * Does NOT use a long-lived positive cache. Prefers correctness over availability.
 */
export async function isAIEnabled(): Promise<boolean> {
  // 1. Environment authorization — must be explicitly 'true'
  //    Missing or any other value = DISABLED (fail closed)
  const envValue = process.env.AI_SYSTEM_ENABLED;
  if (envValue === undefined || envValue.toLowerCase() !== 'true') {
    return false;
  }

  // Environment says 'true' — still need DB confirmation (dual authorization)

  // 2. Database authorization — check with short negative cache
  const now = Date.now();
  if (lastDbResult === false && now - lastDbCheckTime < NEGATIVE_CACHE_MS) {
    return false;
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('system_controls')
      .select('value')
      .eq('key', 'ai_enabled')
      .single();

    if (error || !data) {
      // DB failure → fail closed
      lastDbResult = false;
      lastDbCheckTime = now;
      return false;
    }

    const dbEnabled = data.value === true;
    lastDbResult = dbEnabled;
    lastDbCheckTime = now;
    return dbEnabled;
  } catch {
    // Any exception → fail closed
    lastDbResult = false;
    lastDbCheckTime = now;
    return false;
  }
}

/**
 * Read a feature flag from environment variable.
 * Returns the default (false) if not set or invalid.
 */
export function getFeatureFlag(flag: string): boolean {
  const envValue = process.env[flag];
  if (envValue === undefined) {
    return FLAG_DEFAULTS[flag] ?? false;
  }
  return envValue.toLowerCase() === 'true';
}

/**
 * Check if team fan-out is enabled
 */
export function isTeamFanoutEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_TEAM_FANOUT);
}

/**
 * Check if automatic memory extraction is enabled
 */
export function isMemoryExtractionEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_MEMORY_EXTRACTION);
}

/**
 * Check if automatic fact extraction is enabled
 */
export function isFactExtractionEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_FACT_EXTRACTION);
}

/**
 * Check if one-voice synthesis is enabled
 */
export function isOneVoiceEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_ONE_VOICE);
}

/**
 * Check if David's news team reactions are enabled
 */
export function isNewsReactionsEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_NEWS_REACTIONS);
}

/**
 * Check if deterministic source collection is enabled.
 * This is independent of AI — collectors make ZERO LLM calls.
 */
export function isSourceCollectionEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_SOURCE_COLLECTION);
}

/**
 * Check if autonomous AI (scheduled jobs) is enabled
 */
export function isAutonomousAIEnabled(): boolean {
  return getFeatureFlag(FEATURE_FLAGS.ENABLE_AUTONOMOUS_AI);
}

/**
 * Get a summary of all AI control states for status reporting
 */
export async function getAIControlStatus(): Promise<Record<string, string>> {
  let aiEnabled: boolean;
  try {
    aiEnabled = await isAIEnabled();
  } catch {
    aiEnabled = false;
  }

  return {
    'AI execution': aiEnabled ? 'ENABLED' : 'DISABLED',
    'Autonomous AI': isAutonomousAIEnabled() ? 'ENABLED' : 'DISABLED',
    'Team fan-out': isTeamFanoutEnabled() ? 'ENABLED' : 'DISABLED',
    'Memory extraction': isMemoryExtractionEnabled() ? 'ENABLED' : 'DISABLED',
    'Fact extraction': isFactExtractionEnabled() ? 'ENABLED' : 'DISABLED',
    'One-voice': isOneVoiceEnabled() ? 'ENABLED' : 'DISABLED',
    'News reactions': isNewsReactionsEnabled() ? 'ENABLED' : 'DISABLED',
    'Source collection': isSourceCollectionEnabled() ? 'ENABLED' : 'DISABLED',
    'Maya Slack projection': getFeatureFlag(FEATURE_FLAGS.MAYA_SLACK_PROJECTION_ENABLED)
      ? 'ENABLED'
      : 'DISABLED',
  };
}

/**
 * Reset internal cache — for testing only
 */
export function _resetCache(): void {
  lastDbCheckTime = 0;
  lastDbResult = null;
}
