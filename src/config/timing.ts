/**
 * Timing Configuration
 *
 * Centralizes time-related constants used across the codebase.
 * All values are in milliseconds unless otherwise noted.
 */

// ============================================================
// EXPIRATION TIMES
// ============================================================

/** How long an opportunity stays "fresh" before needing re-analysis (24 hours) */
export const OPPORTUNITY_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** How long to cache research results (4 hours) */
export const RESEARCH_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/** How long to cache semantic search embeddings (1 hour) */
export const EMBEDDING_CACHE_TTL_MS = 60 * 60 * 1000;

/** Default message claim expiration (5 minutes) */
export const MESSAGE_CLAIM_TTL_MS = 5 * 60 * 1000;

/** How long handoffs stay pending (30 minutes) */
export const HANDOFF_EXPIRY_MS = 30 * 60 * 1000;

// ============================================================
// POLL INTERVALS
// ============================================================

/** Event processor polling interval (10 seconds) */
export const EVENT_POLL_INTERVAL_MS = 10 * 1000;

/** Workflow processor check interval (30 seconds) */
export const WORKFLOW_POLL_INTERVAL_MS = 30 * 1000;

/** Health check interval (60 seconds) */
export const HEALTH_CHECK_INTERVAL_MS = 60 * 1000;

// ============================================================
// RATE LIMITING
// ============================================================

/** Minimum delay between Slack API calls (200ms) */
export const SLACK_API_MIN_DELAY_MS = 200;

/** Delay between SAM.gov API calls (1 second) */
export const SAM_API_DELAY_MS = 1000;

/** Delay between Claude API calls (500ms) */
export const CLAUDE_API_DELAY_MS = 500;

// ============================================================
// TIMEOUTS
// ============================================================

/** Default HTTP request timeout (30 seconds) */
export const HTTP_TIMEOUT_MS = 30 * 1000;

/** Long-running operation timeout (5 minutes) */
export const LONG_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

/** Agent response timeout (2 minutes) */
export const AGENT_RESPONSE_TIMEOUT_MS = 2 * 60 * 1000;

// ============================================================
// BATCH SETTINGS
// ============================================================

/** How long to batch notifications before sending (3 seconds) */
export const NOTIFICATION_BATCH_DELAY_MS = 3 * 1000;

/** Maximum notifications per batch */
export const NOTIFICATION_BATCH_MAX_SIZE = 10;

// ============================================================
// SCHEDULE-RELATED (in hours/minutes for readability)
// ============================================================

/** Scanner run frequency in hours */
export const SCANNER_INTERVAL_HOURS = 6;

/** Weekly digest day (0 = Sunday, 1 = Monday, etc.) */
export const WEEKLY_DIGEST_DAY = 1; // Monday

/** Daily standup hour (24-hour format) */
export const DAILY_STANDUP_HOUR = 9;

// ============================================================
// HELPERS
// ============================================================

/** Convert hours to milliseconds */
export function hoursToMs(hours: number): number {
  return hours * 60 * 60 * 1000;
}

/** Convert minutes to milliseconds */
export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/** Convert seconds to milliseconds */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}
