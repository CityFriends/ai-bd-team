/**
 * Environment Identity and Safety Guards
 *
 * Prevents commissioning/test mutations from executing against
 * production databases. Fail closed: if environment cannot be
 * confirmed as commissioning, mutations are denied.
 *
 * INVARIANT: If commissioning credentials are unavailable,
 * commissioning work STOPS. There is NEVER automatic fallback
 * to production. No environment variable override can bypass
 * the production block.
 */

/** Known Supabase project IDs */
export const KNOWN_PROJECTS = {
  PRODUCTION: 'bvgtfadggtgnakrxvuim',
  COMMISSIONING: 'nnwddilewgbsmyouatzu',
} as const;

export type EnvironmentRole = 'production' | 'commissioning' | 'unknown';

/**
 * Determine the environment role from the current Supabase URL.
 */
export function getEnvironmentRole(): EnvironmentRole {
  const url = process.env.SUPABASE_URL || '';
  const projectId = url.match(/https:\/\/(\w+)\./)?.[1];

  if (projectId === KNOWN_PROJECTS.PRODUCTION) return 'production';
  if (projectId === KNOWN_PROJECTS.COMMISSIONING) return 'commissioning';
  return 'unknown';
}

/**
 * Get the Supabase project ID from the current URL.
 */
export function getProjectId(): string | null {
  const url = process.env.SUPABASE_URL || '';
  return url.match(/https:\/\/(\w+)\./)?.[1] || null;
}

/**
 * Assert that the current environment is the commissioning database.
 * HARD FAIL on production or unknown — no override exists.
 *
 * Use this guard before any commissioning-specific mutation:
 * - applying test migrations
 * - running destructive commissioning experiments
 * - seeding test data for commissioning
 * - running DB-mutating integration tests
 */
export function assertCommissioningEnvironment(): void {
  const role = getEnvironmentRole();
  const projectId = getProjectId();

  if (role !== 'commissioning') {
    const reason =
      role === 'production'
        ? `connected to PRODUCTION database (${projectId})`
        : `connected to unknown database (${projectId || 'none'})`;
    throw new Error(
      `SAFETY: Commissioning operation blocked — ${reason}. ` +
        `Only the commissioning project (${KNOWN_PROJECTS.COMMISSIONING}) is allowed. ` +
        `No override exists for this check.`
    );
  }
}

/**
 * Assert that DB-mutating integration tests are NOT targeting production.
 * Call this in integration test bootstrap before any database writes.
 *
 * Allowed targets:
 * - commissioning project
 * - any non-production, non-unknown project (future test DBs)
 *
 * Blocked:
 * - production project (HARD FAIL, no override)
 */
export function assertIntegrationTestEnvironment(): void {
  const role = getEnvironmentRole();
  const projectId = getProjectId();

  if (role === 'production') {
    throw new Error(
      `SAFETY: Integration tests blocked — connected to PRODUCTION database (${projectId}). ` +
        `DB-mutating integration tests must target the commissioning project ` +
        `(${KNOWN_PROJECTS.COMMISSIONING}) or a dedicated test database. ` +
        `No override exists for this check.`
    );
  }
}
