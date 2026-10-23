/**
 * HR Authorization Tests
 */
import { describe, it, expect } from 'vitest';
import { createHRAuth } from '../auth/hr-auth.js';

describe('HR Authorization', () => {
  const auth = createHRAuth(['UADMIN1', 'UADMIN2']);

  it('authorized admin gets owner and hr_admin roles', () => {
    const ctx = auth.authorize('UADMIN1');
    expect(ctx.isAuthorizedAdmin).toBe(true);
    expect(ctx.roles).toContain('owner');
    expect(ctx.roles).toContain('hr_admin');
  });

  it('unknown user gets employee role only', () => {
    const ctx = auth.authorize('UUNKNOWN');
    expect(ctx.isAuthorizedAdmin).toBe(false);
    expect(ctx.roles).toEqual(['employee']);
  });

  it('isAdmin returns true for allowlisted users', () => {
    expect(auth.isAdmin('UADMIN1')).toBe(true);
    expect(auth.isAdmin('UADMIN2')).toBe(true);
  });

  it('isAdmin returns false for non-admin users', () => {
    expect(auth.isAdmin('UEMPLOYEE')).toBe(false);
  });

  it('hasRole checks correctly', () => {
    expect(auth.hasRole('UADMIN1', 'owner')).toBe(true);
    expect(auth.hasRole('UADMIN1', 'employee')).toBe(false);
    expect(auth.hasRole('UEMPLOYEE', 'employee')).toBe(true);
    expect(auth.hasRole('UEMPLOYEE', 'owner')).toBe(false);
  });

  it('isKnownEmployee recognizes admins without DB lookup', async () => {
    expect(await auth.isKnownEmployee('UADMIN1')).toBe(true);
  });

  it('isKnownEmployee fails closed for unknown users without DB', async () => {
    expect(await auth.isKnownEmployee('UUNKNOWN')).toBe(false);
  });

  it('isKnownEmployee uses boolean identity check when provided', async () => {
    const authWithDb = createHRAuth(['UADMIN1'], async (slackId) => {
      return slackId === 'UEMP1';
    });
    expect(await authWithDb.isKnownEmployee('UEMP1')).toBe(true);
    expect(await authWithDb.isKnownEmployee('USTRANGER')).toBe(false);
  });

  it('empty admin list denies all admin access', () => {
    const noAdmins = createHRAuth([]);
    expect(noAdmins.isAdmin('UANYONE')).toBe(false);
    expect(noAdmins.authorize('UANYONE').isAuthorizedAdmin).toBe(false);
  });
});
