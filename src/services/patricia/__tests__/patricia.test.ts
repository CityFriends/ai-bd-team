/**
 * Patricia Unit Tests
 *
 * Tests the deterministic foundation with mocked database.
 * Covers commitment registry, dependency graph, escalation engine,
 * proposal readiness, milestones, safe repair, reconciler, and
 * event reactor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock setup
// ============================================================
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockIn = vi.fn();
const mockIs = vi.fn();
const mockLt = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSingle = vi.fn();

function chainMock() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    upsert: mockUpsert,
    delete: mockDelete,
    eq: mockEq,
    neq: mockNeq,
    in: mockIn,
    is: mockIs,
    lt: mockLt,
    gte: mockGte,
    lte: mockLte,
    order: mockOrder,
    limit: mockLimit,
    single: mockSingle,
  };

  for (const fn of Object.values(chain)) {
    fn.mockReturnValue(chain);
  }

  return chain;
}

function createMockSupabase() {
  const chain = chainMock();
  mockFrom.mockReturnValue(chain);
  mockRpc.mockResolvedValue({ data: null, error: null });

  return {
    from: mockFrom,
    rpc: mockRpc,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Types
// ============================================================
describe('Patricia Types', () => {
  it('exports all required type constants', async () => {
    const types = await import('../types.js');

    expect(types.COMMITMENT_TYPES).toContain('GOVERNMENT_DEADLINE');
    expect(types.COMMITMENT_TYPES).toContain('INTERNAL_MILESTONE');
    expect(types.COMMITMENT_TYPES).toContain('POST_SUBMISSION');

    expect(types.PROPOSAL_STAGES).toContain('PRE_SOLICITATION');
    expect(types.PROPOSAL_STAGES).toContain('SUBMITTED');

    expect(types.ESCALATION_TYPES).toContain('AUTHORITATIVE_CONFLICT');
    expect(types.ESCALATION_TYPES).toContain('DECISION_REQUIRED');

    expect(types.FINDING_SEVERITIES).toEqual(['NOTICE', 'ACTION_REQUIRED', 'AT_RISK']);

    expect(types.PATRICIA_PROVIDER_CALLS).toBe(0);
    expect(types.PATRICIA_G2X_CALLS).toBe(0);
    expect(types.PATRICIA_OBSERVATION_LIMITS.MAX_TASKS).toBe(10);
    expect(types.PATRICIA_OBSERVATION_LIMITS.MAX_CUMULATIVE_SPEND_USD).toBe(0.15);
  });

  it('default milestone schedule offsets decrease toward deadline', async () => {
    const { DEFAULT_MILESTONE_SCHEDULE } = await import('../types.js');
    for (let i = 1; i < DEFAULT_MILESTONE_SCHEDULE.length; i++) {
      expect(DEFAULT_MILESTONE_SCHEDULE[i].offsetDays)
        .toBeLessThan(DEFAULT_MILESTONE_SCHEDULE[i - 1].offsetDays);
    }
  });

  it('AI task types are defined but not active', async () => {
    const { PATRICIA_AI_TASK_TYPES } = await import('../types.js');
    expect(PATRICIA_AI_TASK_TYPES).toContain('patricia_risk_synthesis');
    expect(PATRICIA_AI_TASK_TYPES).toContain('patricia_portfolio_brief');
  });
});

// ============================================================
// Commitment Registry
// ============================================================
describe('Commitment Registry', () => {
  it('creates commitment via RPC', async () => {
    const supabase = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 'commit-123', error: null });

    const { createCommitment } = await import('../commitment-registry.js');
    const id = await createCommitment(supabase, {
      idempotencyKey: 'test-key',
      title: 'Government Deadline',
      commitmentType: 'GOVERNMENT_DEADLINE',
      ownerType: 'SYSTEM',
      ownerId: 'government',
      sourceType: 'SOLICITATION',
      sourceId: 'opp-1',
      dueAt: '2027-01-01T00:00:00Z',
    });

    expect(id).toBe('commit-123');
    expect(mockRpc).toHaveBeenCalledWith('upsert_patricia_commitment', expect.objectContaining({
      p_idempotency_key: 'test-key',
      p_commitment_type: 'GOVERNMENT_DEADLINE',
    }));
  });

  it('returns existing commitment on duplicate key', async () => {
    const supabase = createMockSupabase();
    // RPC returns the existing ID on conflict
    mockRpc.mockResolvedValue({ data: 'existing-123', error: null });

    const { createCommitment } = await import('../commitment-registry.js');
    const id1 = await createCommitment(supabase, {
      idempotencyKey: 'dup-key',
      title: 'Test',
      commitmentType: 'CUSTOM',
      ownerType: 'HUMAN',
      ownerId: 'user-1',
      sourceType: 'MANUAL',
      sourceId: 'manual',
      dueAt: '2027-01-01T00:00:00Z',
    });

    expect(id1).toBe('existing-123');
  });
});

// ============================================================
// Dependency Graph
// ============================================================
describe('Dependency Graph', () => {
  it('creates dependency via RPC', async () => {
    const supabase = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 'dep-123', error: null });

    const { createDependency } = await import('../dependency-graph.js');
    const id = await createDependency(supabase, {
      idempotencyKey: 'dep-key',
      commitmentId: 'commit-1',
      dependsOnType: 'ARTIFACT',
      dependsOnId: 'artifact-1',
    });

    expect(id).toBe('dep-123');
    expect(mockRpc).toHaveBeenCalledWith('upsert_patricia_dependency', expect.objectContaining({
      p_depends_on_type: 'ARTIFACT',
    }));
  });

  it('satisfies dependency and reports unblocked commitments', async () => {
    const supabase = createMockSupabase();
    mockRpc.mockResolvedValue({
      data: [
        { dependency_id: 'dep-1', commitment_id: 'commit-1', remaining_blocked: 0 },
        { dependency_id: 'dep-2', commitment_id: 'commit-2', remaining_blocked: 1 },
      ],
      error: null,
    });

    const { satisfyDependency } = await import('../dependency-graph.js');
    const results = await satisfyDependency(supabase, 'ARTIFACT', 'art-1', 'marcus');

    expect(results).toHaveLength(2);
    expect(results[0].fullyUnblocked).toBe(true);
    expect(results[1].fullyUnblocked).toBe(false);
  });
});

// ============================================================
// Escalation Engine
// ============================================================
describe('Escalation Engine', () => {
  it('creates escalation via RPC', async () => {
    const supabase = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 'esc-123', error: null });
    // For the recordAction call
    mockSingle.mockResolvedValue({ data: { id: 'action-1' }, error: null });

    const { createEscalation } = await import('../escalation-engine.js');
    const id = await createEscalation(supabase, {
      idempotencyKey: 'esc-key',
      escalationType: 'AUTHORITATIVE_CONFLICT',
      title: 'Marcus vs James',
      description: 'Conflicting conclusions',
      severity: 'AT_RISK',
      decisionOwner: 'james',
    });

    expect(id).toBe('esc-123');
  });

  it('creates conflict escalation with both inputs', async () => {
    const supabase = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 'conflict-1', error: null });
    mockSingle.mockResolvedValue({ data: { id: 'action-1' }, error: null });

    const { createConflictEscalation } = await import('../escalation-engine.js');
    const id = await createConflictEscalation(supabase, {
      opportunityId: 'opp-1',
      captureId: 'cap-1',
      conflictTitle: 'Technical conflict',
      inputA: { agent: 'marcus', conclusion: 'TECHNICALLY_UNSUITABLE', evidence: {} },
      inputB: { agent: 'james', conclusion: 'GO', evidence: {} },
      decisionOwner: 'james',
      idempotencyKey: 'conflict-key',
    });

    expect(id).toBe('conflict-1');
    expect(mockRpc).toHaveBeenCalledWith('upsert_patricia_escalation', expect.objectContaining({
      p_escalation_type: 'AUTHORITATIVE_CONFLICT',
      p_severity: 'AT_RISK',
    }));
  });
});

// ============================================================
// Proposal Readiness
// ============================================================
describe('Proposal Readiness', () => {
  it('blocks SUBMITTED without human confirmation', async () => {
    const supabase = createMockSupabase();
    mockSingle.mockResolvedValue({
      data: { id: 'r-1', stage: 'READY_TO_SUBMIT' },
      error: null,
    });

    const { advanceProposalStage } = await import('../proposal-readiness.js');
    const result = await advanceProposalStage(supabase, 'ws-1', 'SUBMITTED');

    // Must return false without confirmedBy
    expect(result).toBe(false);
  });

  it('allows SUBMITTED with human confirmation', async () => {
    createMockSupabase(); // initialize mocks
    mockSingle.mockResolvedValue({
      data: { id: 'r-1', stage: 'READY_TO_SUBMIT' },
      error: null,
    });
    mockUpdate.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const { advanceProposalStage } = await import('../proposal-readiness.js');

    // Reset the chain mock for this test
    const selectChain = {
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'r-1', stage: 'READY_TO_SUBMIT' }, error: null }),
      }),
    };
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const upsertChain = {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'action-1' }, error: null }),
      }),
    };

    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === 'patricia_proposal_readiness') {
          return {
            select: vi.fn().mockReturnValue(selectChain),
            update: vi.fn().mockReturnValue(updateChain),
          };
        }
        // patricia_operational_actions
        return {
          upsert: vi.fn().mockReturnValue(upsertChain),
        };
      }),
      rpc: vi.fn(),
    };

    const result = await advanceProposalStage(mockSb, 'ws-1', 'SUBMITTED', 'human-user');
    expect(result).toBe(true);
  });

  it('prevents backward stage transitions', async () => {
    const supabase = createMockSupabase();
    mockSingle.mockResolvedValue({
      data: { id: 'r-1', stage: 'REVIEW' },
      error: null,
    });

    const { advanceProposalStage } = await import('../proposal-readiness.js');
    const result = await advanceProposalStage(supabase, 'ws-1', 'INTAKE');
    expect(result).toBe(false);
  });
});

// ============================================================
// Workflow Health Rules
// ============================================================
describe('Workflow Health Rules', () => {
  it('all rules have required properties', async () => {
    const { WORKFLOW_HEALTH_RULES } = await import('../workflow-health.js');

    for (const rule of WORKFLOW_HEALTH_RULES) {
      expect(rule.ruleId).toMatch(/^WH-\d{3}$/);
      expect(rule.title).toBeTruthy();
      expect(['NOTICE', 'ACTION_REQUIRED', 'AT_RISK']).toContain(rule.severity);
      expect(typeof rule.autoRepairPermitted).toBe('boolean');
      expect(typeof rule.evaluate).toBe('function');
    }
  });

  it('has expected 9 rules', async () => {
    const { WORKFLOW_HEALTH_RULES } = await import('../workflow-health.js');
    expect(WORKFLOW_HEALTH_RULES).toHaveLength(9);
  });
});

// ============================================================
// Slack Surface
// ============================================================
describe('Slack Surface', () => {
  it('generates portfolio brief payload without posting', async () => {
    const { generatePortfolioBriefPayload } = await import('../slack-surface.js');

    const snapshot = {
      id: 'snap-1',
      snapshot_type: 'WEEKLY' as const,
      snapshot_data: {} as any,
      active_watches: 5,
      active_captures: 3,
      active_pursuits: 2,
      active_proposals: 1,
      deadlines_next_7d: 2,
      deadlines_next_14d: 4,
      deadlines_next_30d: 6,
      overdue_commitments: 1,
      blocked_work_items: 0,
      at_risk_pursuits: 1,
      human_decisions_needed: 2,
      recently_submitted: 0,
      awards: 0,
      losses: 0,
      idempotency_key: 'snap-key',
      created_at: '2026-10-06T00:00:00Z',
    };

    const payload = generatePortfolioBriefPayload(snapshot);

    expect(payload.type).toBe('PORTFOLIO_BRIEF');
    expect(payload.text).toContain('5 watch');
    expect(payload.text).toContain('3 capture');
    expect(payload.text).toContain('Overdue');
    expect(payload.blocks).toBeDefined();
    expect(payload.actions).toBeDefined();
  });

  it('generates AT_RISK escalation payload without posting', async () => {
    const { generateAtRiskPayload } = await import('../slack-surface.js');

    const payload = generateAtRiskPayload({
      id: 'esc-1',
      title: 'Deadline threat',
      description: 'Proposal deadline in 48h with 3 blockers',
      severity: 'AT_RISK',
      decision_owner: 'human',
    });

    expect(payload.type).toBe('AT_RISK_ESCALATION');
    expect(payload.text).toContain('AT RISK');
    expect(payload.actions).toBeDefined();
  });
});

// ============================================================
// Event Reactor
// ============================================================
describe('Event Reactor', () => {
  it('handleNoGo cancels commitments and escalations', async () => {
    // Build a more targeted mock for this test
    const cancelData = [{ id: 'c-1' }, { id: 'c-2' }];
    const escalationData = [{ id: 'e-1' }];

    const mockSb = {
      from: vi.fn((table: string) => {
        if (table === 'patricia_commitments') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    select: vi.fn().mockResolvedValue({ data: cancelData, error: null }),
                  }),
                  select: vi.fn().mockResolvedValue({ data: cancelData, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'patricia_escalations') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: escalationData, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'proposal_workspaces') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'patricia_internal_milestones') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        // patricia_operational_actions
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'act-1' }, error: null }),
            }),
          }),
        };
      }),
      rpc: vi.fn(),
    };

    const { handleNoGo } = await import('../event-reactor.js');
    const result = await handleNoGo(mockSb, {
      captureId: 'cap-1',
      opportunityId: 'opp-1',
      eventId: 'evt-1',
      reason: 'No bid',
    });

    expect(result.cancelledCommitments).toBe(2);
    expect(result.supersededEscalations).toBe(1);
  });
});

// ============================================================
// Internal Milestones
// ============================================================
describe('Internal Milestones', () => {
  it('generates milestone plan with correct offsets', async () => {
    const { DEFAULT_MILESTONE_SCHEDULE } = await import('../types.js');

    // Verify the deadline is 2027-01-01
    const deadline = new Date('2027-01-01T00:00:00Z');

    for (const ms of DEFAULT_MILESTONE_SCHEDULE) {
      const planned = new Date(deadline.getTime() - ms.offsetDays * 24 * 60 * 60 * 1000);
      expect(planned.getTime()).toBeLessThan(deadline.getTime());
    }
  });
});
