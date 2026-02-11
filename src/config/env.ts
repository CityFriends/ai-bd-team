import { z } from 'zod';

/**
 * Environment variable schema with validation
 * All required env vars are validated at startup
 */
const envSchema = z
  .object({
    // Slack configuration (required for core functionality)
    SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
    SLACK_SIGNING_SECRET: z.string().min(1, 'SLACK_SIGNING_SECRET is required'),
    SLACK_APP_TOKEN: z.string().min(1, 'SLACK_APP_TOKEN is required'),
    SLACK_CHANNEL_ID: z.string().min(1, 'SLACK_CHANNEL_ID is required'),

    // Supabase configuration (required)
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_SERVICE_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),

    // Anthropic AI (required)
    ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),

    // OpenAI for embeddings (optional)
    OPENAI_API_KEY: z.string().optional(),

    // Government APIs (optional but recommended)
    SAM_API_KEY: z.string().optional(),

    // Notion integration (optional)
    NOTION_API_KEY: z.string().optional(),
    NOTION_HUB_PAGE_ID: z.string().optional(),

    // Gmail integration (optional)
    GMAIL_CLIENT_ID: z.string().optional(),
    GMAIL_CLIENT_SECRET: z.string().optional(),
    GMAIL_REFRESH_TOKEN: z.string().optional(),

    // Node environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .refine((data) => data.SUPABASE_SERVICE_KEY || data.SUPABASE_ANON_KEY, {
    message: 'Either SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY must be provided',
    path: ['SUPABASE_SERVICE_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

let validatedEnv: Env | null = null;

/**
 * Validate environment variables at startup
 * Throws with detailed error messages if validation fails
 */
export function validateEnv(): Env {
  if (validatedEnv) {
    return validatedEnv;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map((err) => {
      const path = err.path.join('.');
      return `  - ${path}: ${err.message}`;
    });

    console.error('Environment validation failed:');
    console.error(errors.join('\n'));
    process.exit(1);
  }

  validatedEnv = result.data;
  return validatedEnv;
}

/**
 * Get validated environment variables
 * Must call validateEnv() first during startup
 */
export function getEnv(): Env {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
}

/**
 * Check if optional integrations are configured
 */
export function hasNotionIntegration(): boolean {
  const env = getEnv();
  return Boolean(env.NOTION_API_KEY && env.NOTION_HUB_PAGE_ID);
}

export function hasGmailIntegration(): boolean {
  const env = getEnv();
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

export function hasSamGovIntegration(): boolean {
  return Boolean(getEnv().SAM_API_KEY);
}

export function hasOpenAIIntegration(): boolean {
  return Boolean(getEnv().OPENAI_API_KEY);
}
