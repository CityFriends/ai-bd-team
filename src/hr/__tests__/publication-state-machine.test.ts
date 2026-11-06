/**
 * Publication State Machine Tests
 */
import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  resolveInitialStatus,
  resolveContentUpdate,
  resolveArchival,
  resolveOwnerApproval,
  resolveOwnerRejection,
} from '../notion/publication-state-machine.js';
import type { PublicationDecision, PublicationStatus } from '../notion/publication-types.js';

function decision(disposition: string, category: string = 'routine_employee_safe'): PublicationDecision {
  return { disposition: disposition as any, category: category as any, reasons: ['test'] };
}

describe('isValidTransition', () => {
  it('allows pending → auto_approved', () => {
    expect(isValidTransition('pending', 'auto_approved')).toBe(true);
  });
  it('allows pending → awaiting_review', () => {
    expect(isValidTransition('pending', 'awaiting_review')).toBe(true);
  });
  it('allows approved → suspended', () => {
    expect(isValidTransition('approved', 'suspended')).toBe(true);
  });
  it('allows suspended → awaiting_review', () => {
    expect(isValidTransition('suspended', 'awaiting_review')).toBe(true);
  });
  it('disallows archived → anything', () => {
    expect(isValidTransition('archived', 'pending')).toBe(false);
    expect(isValidTransition('archived', 'approved')).toBe(false);
  });
  it('disallows pending → approved (must go through review)', () => {
    expect(isValidTransition('pending', 'approved')).toBe(false);
  });
});

describe('resolveInitialStatus', () => {
  it('auto_publish → auto_approved', () => {
    const t = resolveInitialStatus(decision('auto_publish'));
    expect(t.from).toBe('pending');
    expect(t.to).toBe('auto_approved');
  });

  it('owner_review → awaiting_review', () => {
    const t = resolveInitialStatus(decision('owner_review', 'sensitive_policy'));
    expect(t.to).toBe('awaiting_review');
  });

  it('quarantine → quarantined', () => {
    const t = resolveInitialStatus(decision('quarantine', 'unknown'));
    expect(t.to).toBe('quarantined');
  });

  it('exclude → excluded', () => {
    const t = resolveInitialStatus(decision('exclude', 'confidential'));
    expect(t.to).toBe('excluded');
  });
});

describe('resolveContentUpdate', () => {
  it('no hash change → no transition', () => {
    expect(resolveContentUpdate('approved', decision('auto_publish'), false)).toBeNull();
  });

  it('approved routine content changed → auto_approved', () => {
    const t = resolveContentUpdate('approved', decision('auto_publish'), true);
    expect(t?.from).toBe('approved');
    expect(t?.to).toBe('auto_approved');
  });

  it('approved sensitive content changed → suspended', () => {
    const t = resolveContentUpdate('approved', decision('owner_review', 'sensitive_policy'), true);
    expect(t?.to).toBe('suspended');
  });

  it('auto_approved content changed to sensitive → suspended', () => {
    const t = resolveContentUpdate('auto_approved', decision('owner_review', 'sensitive_policy'), true);
    expect(t?.to).toBe('suspended');
  });

  it('any status changed to confidential → excluded', () => {
    const t = resolveContentUpdate('approved', decision('exclude', 'confidential'), true);
    expect(t?.to).toBe('excluded');
  });

  it('archived stays archived', () => {
    expect(resolveContentUpdate('archived', decision('auto_publish'), true)).toBeNull();
  });

  it('suspended with new routine content → auto_approved', () => {
    const t = resolveContentUpdate('suspended', decision('auto_publish'), true);
    expect(t?.to).toBe('auto_approved');
  });

  it('suspended with new sensitive content → awaiting_review', () => {
    const t = resolveContentUpdate('suspended', decision('owner_review', 'sensitive_policy'), true);
    expect(t?.to).toBe('awaiting_review');
  });

  it('pending page reclassified → follows initial status logic', () => {
    const t = resolveContentUpdate('pending', decision('auto_publish'), true);
    expect(t?.to).toBe('auto_approved');
  });
});

describe('resolveArchival', () => {
  it('archives from any non-archived state', () => {
    const states: PublicationStatus[] = ['pending', 'auto_approved', 'approved', 'suspended', 'quarantined', 'excluded'];
    for (const s of states) {
      const t = resolveArchival(s);
      expect(t?.to).toBe('archived');
    }
  });

  it('already archived → no-op', () => {
    expect(resolveArchival('archived')).toBeNull();
  });
});

describe('resolveOwnerApproval', () => {
  it('approves from awaiting_review', () => {
    const t = resolveOwnerApproval('awaiting_review', 'hash123');
    expect(t?.to).toBe('approved');
    expect(t?.contentHash).toBe('hash123');
  });

  it('approves from suspended', () => {
    const t = resolveOwnerApproval('suspended', 'hash456');
    expect(t?.to).toBe('approved');
  });

  it('rejects approval from other states', () => {
    expect(resolveOwnerApproval('pending', 'hash')).toBeNull();
    expect(resolveOwnerApproval('approved', 'hash')).toBeNull();
    expect(resolveOwnerApproval('excluded', 'hash')).toBeNull();
  });
});

describe('resolveOwnerRejection', () => {
  it('quarantines from awaiting_review', () => {
    const t = resolveOwnerRejection('awaiting_review');
    expect(t?.to).toBe('quarantined');
  });

  it('rejects from other states', () => {
    expect(resolveOwnerRejection('approved')).toBeNull();
    expect(resolveOwnerRejection('suspended')).toBeNull();
  });
});

// ── C8X-105B.1 State Machine Hardening ────────────────────

describe('resolveContentUpdate — sensitive hardening (C8X-105B.1)', () => {
  it('suspended + sensitive content → awaiting_review (not auto_approved)', () => {
    const t = resolveContentUpdate('suspended', decision('owner_review', 'sensitive_policy'), true);
    expect(t?.to).toBe('awaiting_review');
  });

  it('suspended + routine content → auto_approved (correct for genuinely routine)', () => {
    const t = resolveContentUpdate('suspended', decision('auto_publish', 'routine_employee_safe'), true);
    expect(t?.to).toBe('auto_approved');
  });

  it('suspended + auto_publish but non-routine category → awaiting_review', () => {
    // This catches the edge case where auto_publish comes from prior approval
    // but the category is not routine_employee_safe
    const nonRoutineAutoPublish: PublicationDecision = {
      disposition: 'auto_publish',
      category: 'sensitive_policy' as any, // hypothetical mismatch
      reasons: ['test'],
    };
    const t = resolveContentUpdate('suspended', nonRoutineAutoPublish, true);
    expect(t?.to).toBe('awaiting_review');
  });

  it('approved sensitive content changed → suspended', () => {
    const t = resolveContentUpdate('approved', decision('owner_review', 'sensitive_policy'), true);
    expect(t?.to).toBe('suspended');
  });

  it('auto_approved content reclassified as sensitive → suspended', () => {
    const t = resolveContentUpdate('auto_approved', decision('owner_review', 'salary_band'), true);
    expect(t?.to).toBe('suspended');
  });
});
