/**
 * HR Environment Configuration
 *
 * All HR secrets use HR_ prefixes. No fallback to BD credentials.
 * Fails closed: missing required credentials prevent startup of the
 * corresponding capability.
 *
 * SECURITY: The BD Supabase project URL is explicitly rejected to prevent
 * accidental cross-service credential sharing.
 */

const BD_SUPABASE_PROJECT_REF = 'bvgtfadggtgnakrxvuim';

export interface HREnvConfig {
  // Database
  supabaseUrl: string;
  supabaseServiceKey: string;

  // Slack (optional when HR_SLACK_ENABLED=false)
  slackEnabled: boolean;
  botToken: string | null;
  appToken: string | null;
  leadershipChannelId: string | null;
  helpChannelId: string | null;
  expectedTeamId: string | null;
  authorizedAdmins: string[];

  // AI (disabled in M1)
  aiEnabled: boolean;
  llmEnabled: boolean;
  anthropicApiKey: string | null;
}

export class HREnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HREnvError';
  }
}

/**
 * Validate and load HR environment configuration.
 * Fails closed on missing required values for enabled capabilities.
 * Rejects BD Supabase project to prevent cross-service credential leakage.
 */
export function loadHREnv(): HREnvConfig {
  const supabaseUrl = process.env.HR_SUPABASE_URL || '';
  const supabaseServiceKey = process.env.HR_SUPABASE_SERVICE_KEY || '';

  // Reject BD Supabase project — HR must use its own dedicated project
  if (supabaseUrl && supabaseUrl.includes(BD_SUPABASE_PROJECT_REF)) {
    throw new HREnvError(
      `HR_SUPABASE_URL points to the BD Supabase project (${BD_SUPABASE_PROJECT_REF}). ` +
        'HR must use a dedicated, separate Supabase project.'
    );
  }

  // Also reject if someone copies the BD service key directly
  if (process.env.HR_SUPABASE_SERVICE_KEY === process.env.SUPABASE_SERVICE_KEY &&
      process.env.SUPABASE_SERVICE_KEY) {
    throw new HREnvError(
      'HR_SUPABASE_SERVICE_KEY matches SUPABASE_SERVICE_KEY. ' +
        'HR must use dedicated credentials from a separate Supabase project.'
    );
  }

  // Database is always required when URL is provided
  if (supabaseUrl && !supabaseServiceKey) {
    throw new HREnvError('HR_SUPABASE_URL is set but HR_SUPABASE_SERVICE_KEY is missing.');
  }

  const slackEnabled = process.env.HR_SLACK_ENABLED?.toLowerCase() === 'true';
  const botToken = process.env.HR_BOT_TOKEN || null;
  const appToken = process.env.HR_APP_TOKEN || null;
  const leadershipChannelId = process.env.HR_LEADERSHIP_CHANNEL_ID || null;
  const helpChannelId = process.env.HR_HELP_CHANNEL_ID || null;

  const expectedTeamId = process.env.HR_EXPECTED_TEAM_ID || null;

  // Slack: fail closed if enabled but missing required tokens or team ID
  if (slackEnabled) {
    if (!botToken) throw new HREnvError('HR_SLACK_ENABLED=true but HR_BOT_TOKEN is missing.');
    if (!appToken) throw new HREnvError('HR_SLACK_ENABLED=true but HR_APP_TOKEN is missing.');
    if (!leadershipChannelId)
      throw new HREnvError('HR_SLACK_ENABLED=true but HR_LEADERSHIP_CHANNEL_ID is missing.');
    if (!helpChannelId)
      throw new HREnvError('HR_SLACK_ENABLED=true but HR_HELP_CHANNEL_ID is missing.');
    if (!expectedTeamId)
      throw new HREnvError('HR_SLACK_ENABLED=true but HR_EXPECTED_TEAM_ID is missing. Required for workspace validation.');
  }

  // Authorized admins — parsed from comma-separated list with Slack user ID validation
  const SLACK_USER_ID_PATTERN = /^U[A-Z0-9]{4,}$/;
  const rawAdmins = process.env.HR_AUTHORIZED_ADMINS || '';
  const parsedEntries = rawAdmins.split(',').map((s) => s.trim()).filter(Boolean);
  const validAdmins: string[] = [];
  const invalidAdmins: string[] = [];

  for (const entry of parsedEntries) {
    if (SLACK_USER_ID_PATTERN.test(entry)) {
      validAdmins.push(entry);
    } else {
      invalidAdmins.push(entry);
    }
  }

  // Diagnostic: report parsing outcome without exposing raw values
  if (rawAdmins) {
    console.log(`[HR Env] HR_AUTHORIZED_ADMINS: ${parsedEntries.length} entries parsed, ${validAdmins.length} valid, ${invalidAdmins.length} rejected`);
  } else {
    console.log('[HR Env] HR_AUTHORIZED_ADMINS: not set');
  }

  // Reject malformed entries rather than silently filtering
  if (invalidAdmins.length > 0) {
    throw new HREnvError(
      `HR_AUTHORIZED_ADMINS contains ${invalidAdmins.length} invalid Slack user ID(s). ` +
        'Valid IDs match the pattern U followed by 4+ alphanumeric characters.'
    );
  }

  const authorizedAdmins = validAdmins;

  const aiEnabled = process.env.HR_AI_ENABLED?.toLowerCase() === 'true';
  const llmEnabled = process.env.HR_LLM_ENABLED?.toLowerCase() === 'true';
  const anthropicApiKey = process.env.HR_ANTHROPIC_API_KEY || null;

  // LLM: fail closed if enabled but missing key
  if (llmEnabled && !anthropicApiKey) {
    throw new HREnvError('HR_LLM_ENABLED=true but HR_ANTHROPIC_API_KEY is missing.');
  }

  return {
    supabaseUrl,
    supabaseServiceKey,
    slackEnabled,
    botToken,
    appToken,
    leadershipChannelId,
    helpChannelId,
    expectedTeamId,
    authorizedAdmins,
    aiEnabled,
    llmEnabled,
    anthropicApiKey,
  };
}
