/**
 * HR AI Pilot Access Policy — Fail-Closed
 *
 * Controls which Slack users and channels may access the HR AI
 * answer pipeline during the private testing pilot.
 *
 * Security contract:
 *   - Pilot mode defaults to OFF.
 *   - Missing, empty, or malformed configuration denies all access.
 *   - Authorization requires BOTH an approved user ID AND an
 *     approved private channel ID.
 *   - Channel names are descriptive only; authorization uses
 *     immutable Slack channel IDs.
 *   - Employee DMs and public channels are never eligible.
 *   - This module makes no Slack API calls.
 *
 * Future environment variables (not set in production yet):
 *   HR_PILOT_ENABLED        — 'true' to activate pilot mode
 *   HR_PILOT_USER_IDS       — comma-separated Slack user IDs
 *   HR_PILOT_CHANNEL_ID     — single private channel ID
 */

// Slack user/channel ID patterns
const SLACK_USER_ID_RE = /^U[A-Z0-9]{4,}$/;
const SLACK_CHANNEL_ID_RE = /^C[A-Z0-9]{4,}$/;

export interface HRPilotConfig {
  /** Whether pilot mode is active. */
  enabled: boolean;
  /** Approved Slack user IDs. Empty = deny all. */
  approvedUserIds: ReadonlySet<string>;
  /** Approved private test channel ID. Null = deny all channel messages. */
  approvedChannelId: string | null;
}

/**
 * Load pilot configuration from environment variables.
 * Fail-closed: any missing or malformed value disables the pilot.
 */
export function loadPilotConfig(): HRPilotConfig {
  const enabled = process.env.HR_PILOT_ENABLED?.toLowerCase() === 'true';
  if (!enabled) {
    return { enabled: false, approvedUserIds: new Set(), approvedChannelId: null };
  }

  // Parse user IDs
  const rawUsers = process.env.HR_PILOT_USER_IDS || '';
  const userIds = new Set<string>();
  for (const id of rawUsers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (SLACK_USER_ID_RE.test(id)) {
      userIds.add(id);
    }
    // Silently skip malformed IDs — fail closed by having fewer approved users
  }

  // Parse channel ID
  const rawChannel = (process.env.HR_PILOT_CHANNEL_ID || '').trim();
  const approvedChannelId = SLACK_CHANNEL_ID_RE.test(rawChannel) ? rawChannel : null;

  // If no valid users or no valid channel, disable pilot
  if (userIds.size === 0 || !approvedChannelId) {
    return { enabled: false, approvedUserIds: new Set(), approvedChannelId: null };
  }

  return { enabled: true, approvedUserIds: userIds, approvedChannelId };
}

export interface PilotCheckResult {
  allowed: boolean;
  reason:
    | 'pilot_disabled'
    | 'user_not_approved'
    | 'channel_not_approved'
    | 'not_private_channel'
    | 'allowed';
}

/**
 * Check whether a Slack event is eligible for the HR AI pilot.
 *
 * Requires:
 *   - Pilot mode enabled with valid configuration.
 *   - Sender is in the approved user list.
 *   - Channel matches the approved private test channel ID.
 *   - Channel type indicates a private channel ('group' in Slack events).
 *
 * Pure function. No Slack API calls.
 */
export function checkPilotAccess(
  config: HRPilotConfig,
  slackUserId: string,
  channelId: string,
  channelType: string
): PilotCheckResult {
  if (!config.enabled) {
    return { allowed: false, reason: 'pilot_disabled' };
  }

  if (!config.approvedUserIds.has(slackUserId)) {
    return { allowed: false, reason: 'user_not_approved' };
  }

  // Slack private channels have channel_type 'group'
  // Public channels have 'channel', DMs have 'im', group DMs have 'mpim'
  if (channelType !== 'group') {
    return { allowed: false, reason: 'not_private_channel' };
  }

  if (channelId !== config.approvedChannelId) {
    return { allowed: false, reason: 'channel_not_approved' };
  }

  return { allowed: true, reason: 'allowed' };
}
