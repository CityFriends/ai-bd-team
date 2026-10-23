/**
 * HR Authorization
 *
 * Role-based access control for HR operations.
 * M1: Bootstrap authorization from HR_AUTHORIZED_ADMINS env var.
 * Users not in the allowlist cannot access HR administration.
 *
 * Roles:
 *   owner     — Full access to all HR data including compensation
 *   hr_admin  — Employee directory, onboarding, general HR admin
 *   manager   — View assigned employees, approve step increases
 *   employee  — Self-service: own profile, policy questions
 */

export type HRRole = 'owner' | 'hr_admin' | 'manager' | 'employee';

export interface HRAuthContext {
  slackUserId: string;
  roles: HRRole[];
  isAuthorizedAdmin: boolean;
}

export interface HRAuthProvider {
  authorize(slackUserId: string): HRAuthContext;
  isAdmin(slackUserId: string): boolean;
  isOwner(slackUserId: string): boolean;
  hasRole(slackUserId: string, role: HRRole): boolean;
  isKnownEmployee(slackUserId: string): Promise<boolean>;
}

/**
 * Create the M1 authorization provider.
 * Bootstrap from the configured admin allowlist.
 * Database-backed roles will be added in Phase 2.
 */
/**
 * Create the M1 authorization provider.
 * Bootstrap from the configured admin allowlist.
 * Database-backed roles will be added in Phase 2.
 *
 * TRUST BOUNDARY: The isKnownSlackUser callback returns only a boolean,
 * not employee records. This prevents the auth layer from being used
 * to enumerate the employee directory.
 */
export function createHRAuth(
  authorizedAdmins: string[],
  isKnownSlackUser?: (slackUserId: string) => Promise<boolean>
): HRAuthProvider {
  const adminSet = new Set(authorizedAdmins);

  return {
    authorize(slackUserId: string): HRAuthContext {
      const isAdmin = adminSet.has(slackUserId);
      const roles: HRRole[] = isAdmin ? ['owner', 'hr_admin'] : ['employee'];
      return { slackUserId, roles, isAuthorizedAdmin: isAdmin };
    },

    isAdmin(slackUserId: string): boolean {
      return adminSet.has(slackUserId);
    },

    isOwner(slackUserId: string): boolean {
      // M1: all admins are treated as owners
      return adminSet.has(slackUserId);
    },

    hasRole(slackUserId: string, role: HRRole): boolean {
      const ctx = this.authorize(slackUserId);
      return ctx.roles.includes(role);
    },

    async isKnownEmployee(slackUserId: string): Promise<boolean> {
      // Admins are always recognized
      if (adminSet.has(slackUserId)) return true;
      // Minimal identity check — returns boolean, not employee data
      if (isKnownSlackUser) {
        return isKnownSlackUser(slackUserId);
      }
      return false;
    },
  };
}
