/**
 * Slack Channel Configuration
 *
 * Centralizes Slack channel IDs to avoid duplication across files.
 * All channel IDs come from environment variables.
 */

/**
 * Get the main BD team channel ID
 * This is the primary channel where agents communicate
 */
export function getMainChannelId(): string {
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!channelId) {
    throw new Error('Missing SLACK_CHANNEL_ID environment variable');
  }
  return channelId;
}

/**
 * Get channel ID with fallback (for optional channel usage)
 * Returns null if channel is not configured
 */
export function getOptionalChannelId(envVar: string): string | null {
  return process.env[envVar] || null;
}

/**
 * Channel configuration type for agent-specific channels
 */
export interface ChannelConfig {
  /** Main BD team channel */
  main: string;
  /** Optional alerts channel */
  alerts?: string;
  /** Optional debug/logging channel */
  debug?: string;
}

/**
 * Get full channel configuration
 */
export function getChannelConfig(): ChannelConfig {
  return {
    main: getMainChannelId(),
    alerts: getOptionalChannelId('SLACK_ALERTS_CHANNEL_ID') ?? undefined,
    debug: getOptionalChannelId('SLACK_DEBUG_CHANNEL_ID') ?? undefined,
  };
}
