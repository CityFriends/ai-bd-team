/**
 * Regression tests for Maya Slack MOSAIC incident (2026-10-20).
 *
 * Covers:
 * - Dismissed opportunity blocks re-posting (changed material hash included)
 * - Dismissal after task creation: task exits safely
 * - Database upsert failure: no Slack post
 * - All three buttons resolve valid briefs
 * - Button fallback via opportunity_id in button value
 * - Terminal states are respected
 * - parseButtonValue handles new format with opportunityId
 * - Non-dismissed opportunity workflows continue to function
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// ============================================================
// parseButtonValue — new format with opportunityId
// ============================================================

describe('parseButtonValue — opportunityId extraction', () => {
  afterEach(() => vi.resetModules());

  it('parses new format: hash:oppId:action', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    const result = parseButtonValue('abcdef1234567890:DA01--VA-27-00015330:research');
    expect(result.materialHash).toBe('abcdef1234567890');
    expect(result.opportunityId).toBe('DA01--VA-27-00015330');
  });

  it('parses legacy format: hash:action (no oppId)', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    const result = parseButtonValue('abcdef1234567890:research');
    expect(result.materialHash).toBe('abcdef1234567890');
    expect(result.opportunityId).toBeUndefined();
  });

  it('parses plain action value', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    const result = parseButtonValue('research');
    expect(result.materialHash).toBeUndefined();
    expect(result.opportunityId).toBeUndefined();
  });

  it('handles undefined', async () => {
    const { parseButtonValue } = await import('../slack-surface.js');
    expect(parseButtonValue(undefined)).toEqual({});
  });
});

// ============================================================
// formatOpportunityBrief — opportunityId in button values
// ============================================================

describe('formatOpportunityBrief — stable opportunityId in buttons', () => {
  afterEach(() => vi.resetModules());

  const baseOpp = {
    title: 'Test',
    agency: 'VA',
    setAside: null,
    naics: null,
    responseDeadline: null,
    sourceUrl: null,
  };

  const baseDecision = {
    recommendation: 'EVALUATE' as const,
    confidence: 80,
    acquisitionNature: 'custom',
    fitReasons: ['fit'],
    concerns: [],
    evidenceUsed: [],
    missingInformation: [],
    researchRequests: [],
    rationale: 'test',
  };

  it('encodes opportunityId in button values when provided', async () => {
    const { formatOpportunityBrief } = await import('../slack-surface.js');
    const { blocks } = formatOpportunityBrief(
      baseOpp,
      baseDecision,
      'hash12345678',
      'DA01--VA-27-00015330'
    );
    const actions = blocks.find((b: { type: string }) => b.type === 'actions');
    for (const btn of actions.elements) {
      expect(btn.value).toContain('hash12345678');
      expect(btn.value).toContain('DA01--VA-27-00015330');
    }
  });

  it('works without opportunityId (backwards compat)', async () => {
    const { formatOpportunityBrief } = await import('../slack-surface.js');
    const { blocks } = formatOpportunityBrief(baseOpp, baseDecision, 'hash12345678');
    const actions = blocks.find((b: { type: string }) => b.type === 'actions');
    expect(actions.elements[0].value).toContain('hash12345678');
    expect(actions.elements[0].value).not.toContain('--');
  });
});

// ============================================================
// postOpportunityBrief — dismissal guard
// ============================================================

describe('postOpportunityBrief — dismissal guard', () => {
  afterEach(() => vi.resetModules());

  function makeMockSupabase(overrides: {
    oppHumanAction?: string | null;
    existingBrief?: { id: string; message_ts: string | null; status: string } | null;
    insertResult?: { id: string } | null;
    insertError?: { message: string } | null;
  }) {
    const { oppHumanAction, existingBrief, insertResult, insertError } = overrides;
    return {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: oppHumanAction !== undefined ? { human_action: oppHumanAction } : null,
                    error: null,
                  }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        if (table === 'slack_opportunity_briefs') {
          return {
            select: () => ({
              eq: (_col: string, _val: string) => ({
                single: () =>
                  Promise.resolve({
                    data: existingBrief || null,
                    error: existingBrief ? null : { code: 'PGRST116' },
                  }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: insertResult || null,
                    error: insertError || null,
                  }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };
  }

  it('blocks Slack post for dismissed opportunity', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    const supabase = makeMockSupabase({ oppHumanAction: 'DISMISSED' });
    const slackClient = { chat: { postMessage: vi.fn() } };

    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'DA01--VA-27-00015330',
      'task-1',
      { title: 'MOSAIC', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 68,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      },
      'newhash12345678'
    );

    expect(result.success).toBe(true);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('blocks Slack post when existing brief is dismissed', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    const supabase = makeMockSupabase({
      oppHumanAction: null,
      existingBrief: { id: 'brief-1', message_ts: '1234.5678', status: 'dismissed' },
    });
    const slackClient = { chat: { postMessage: vi.fn() } };

    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'OPP-1',
      'task-1',
      { title: 'Test', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    expect(result.success).toBe(true);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('blocks Slack post when existing brief is capture_sent', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    const supabase = makeMockSupabase({
      oppHumanAction: null,
      existingBrief: { id: 'brief-1', message_ts: '1234.5678', status: 'capture_sent' },
    });
    const slackClient = { chat: { postMessage: vi.fn() } };

    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'OPP-1',
      'task-1',
      { title: 'Test', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    expect(result.success).toBe(true);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('returns failure when brief insert fails', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    const supabase = makeMockSupabase({
      oppHumanAction: null,
      existingBrief: null,
      insertResult: null,
      insertError: { message: 'unique violation' },
    });
    const slackClient = { chat: { postMessage: vi.fn() } };

    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'OPP-1',
      'task-1',
      { title: 'Test', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    expect(result.success).toBe(false);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });
});

// ============================================================
// Task processor — dismissal after task creation
// ============================================================

describe('processReviewTask — dismissal recheck', () => {
  afterEach(() => vi.resetModules());

  it('skips review when opportunity was dismissed after task creation', async () => {
    // This test verifies that processReviewTask checks human_action
    // before making any LLM calls. We verify by checking that the
    // task status is set to 'skipped'.
    const taskUpdateCalls: Array<{ status: string }> = [];

    // Build a chainable mock that supports arbitrary .eq().eq().select().single() chains
    function chainable(resolveData: unknown, resolveError: unknown = null) {
      const obj: Record<string, unknown> = {};
      const self = () => obj;
      obj.eq = self;
      obj.select = self;
      obj.single = () => Promise.resolve({ data: resolveData, error: resolveError });
      return obj;
    }

    const mockSupabase = {
      rpc: () => Promise.resolve({ data: true, error: null }),
      from: (table: string) => {
        if (table === 'maya_review_tasks') {
          return {
            update: (payload: { status: string }) => {
              taskUpdateCalls.push(payload);
              if (payload.status === 'in_progress') {
                return chainable({
                  id: 'task-1',
                  opportunity_id: 'OPP-DISMISSED',
                  idempotency_key: 'review:OPP-DISMISSED:hash:v1',
                });
              }
              // 'skipped' update — no data needed
              return chainable(null);
            },
            select: () => chainable(null),
          };
        }
        if (table === 'pipeline_opportunities') {
          return {
            select: () =>
              chainable({
                source_id: 'OPP-DISMISSED',
                human_action: 'DISMISSED',
                title: 'Dismissed Opp',
                description: 'test',
              }),
          };
        }
        return {
          select: () => chainable(null),
        };
      },
    };

    const { processReviewTask } = await import('../task-processor.js');
    const result = await processReviewTask(mockSupabase, 'task-1');

    expect(result).toBeNull();
    // Verify task was updated to 'skipped' (second update call after 'in_progress')
    const skippedCall = taskUpdateCalls.find((c) => c.status === 'skipped');
    expect(skippedCall).toBeDefined();
  });
});

// ============================================================
// Solicitation-level dismissal (SAM.gov UUID reuse)
// ============================================================

describe('postOpportunityBrief — solicitation-level dismissal', () => {
  afterEach(() => vi.resetModules());

  it('blocks Slack post when same solicitation dismissed under different source_id', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    // This mock returns human_action=null for the new source_id,
    // but returns a dismissed row when querying by solicitation_number.
    const supabase = {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: (cols: string) => {
              if (cols.includes('human_action') && cols.includes('solicitation_number')) {
                // First call: lookup by source_id — returns non-dismissed with solicitation
                return {
                  eq: () => ({
                    single: () =>
                      Promise.resolve({
                        data: { human_action: null, solicitation_number: '36C10B27Q0061' },
                        error: null,
                      }),
                  }),
                };
              }
              // Solicitation cross-reference — returns a dismissed row
              return {
                eq: (_col: string, val: string) => {
                  if (val === '36C10B27Q0061') {
                    return {
                      eq: () => ({
                        limit: () =>
                          Promise.resolve({
                            data: [{ source_id: 'old-dismissed-uuid' }],
                            error: null,
                          }),
                      }),
                    };
                  }
                  return {
                    eq: () => ({
                      limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                  };
                },
              };
            },
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };

    const slackClient = { chat: { postMessage: vi.fn() } };
    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'new-uuid-for-same-solicitation',
      'task-1',
      { title: 'MOSAIC', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 68,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    expect(result.success).toBe(true);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });
});

// ============================================================
// retrySlackProjection — dismissal guard and terminal states
// ============================================================

describe('retrySlackProjection — hardened', () => {
  afterEach(() => vi.resetModules());

  it('refuses retry for dismissed opportunity', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { retrySlackProjection } = await import('../slack-surface.js');

    const supabase = {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { human_action: 'DISMISSED', solicitation_number: 'SOL1' },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };

    const slackClient = { chat: { postMessage: vi.fn() } };
    const result = await retrySlackProjection(supabase, slackClient, 'C123', 'OPP-1');

    expect(result.success).toBe(false);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('refuses retry for terminal brief states', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { retrySlackProjection } = await import('../slack-surface.js');

    const supabase = {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { human_action: null, solicitation_number: null },
                    error: null,
                  }),
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'slack_opportunity_briefs') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: 'b1', status: 'dismissed', message_ts: '1234.0', projection_attempts: 0 },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };

    const slackClient = { chat: { postMessage: vi.fn() } };
    const result = await retrySlackProjection(supabase, slackClient, 'C123', 'OPP-1');

    expect(result.success).toBe(false);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });
});

// ============================================================
// Concurrency: insert path — unique constraint prevents duplicates
// ============================================================

describe('postOpportunityBrief — concurrency', () => {
  afterEach(() => vi.resetModules());

  it('concurrent insert returns failure when unique constraint rejects', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    const supabase = {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { human_action: null, solicitation_number: null },
                    error: null,
                  }),
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'slack_opportunity_briefs') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  // No existing brief
                  Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  // Simulate unique violation from concurrent insert
                  Promise.resolve({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                  }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };

    const slackClient = { chat: { postMessage: vi.fn() } };
    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'OPP-RACE',
      'task-1',
      { title: 'Race', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    expect(result.success).toBe(false);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('concurrent update path: second worker CAS fails when maya_task_id changed', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    // Chainable mock: supports arbitrary .eq().neq().is().eq().select().single() chains
    function casRejectChain() {
      const obj: Record<string, unknown> = {};
      const self = () => obj;
      obj.eq = self;
      obj.neq = self;
      obj.is = self;
      // CAS fails — another worker already claimed the brief
      obj.select = () => ({
        single: () =>
          Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows matched' } }),
      });
      return obj;
    }

    const supabase = {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { human_action: null, solicitation_number: null },
                    error: null,
                  }),
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'slack_opportunity_briefs') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  // Existing brief: pending, maya_task_id is null (unclaimed)
                  Promise.resolve({
                    data: { id: 'brief-1', message_ts: null, status: 'pending', maya_task_id: null },
                    error: null,
                  }),
              }),
            }),
            // CAS update: .update().eq(id).neq(status).is(maya_task_id, null).select().single()
            update: () => casRejectChain(),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };

    const slackClient = { chat: { postMessage: vi.fn() } };
    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'OPP-RACE',
      'task-1',
      { title: 'Race', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    // Second worker returns early — no duplicate post
    expect(result.success).toBe(true);
    expect(slackClient.chat.postMessage).not.toHaveBeenCalled();
  });
});

// ============================================================
// Recovery: message_ts update failure is detectable
// ============================================================

describe('postOpportunityBrief — recovery', () => {
  afterEach(() => vi.resetModules());

  it('logs CRITICAL when Slack post succeeds but message_ts update fails', async () => {
    process.env.MAYA_SLACK_PROJECTION_ENABLED = 'true';
    const { postOpportunityBrief } = await import('../slack-surface.js');

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const supabase = {
      from: (table: string) => {
        if (table === 'pipeline_opportunities') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: { human_action: null, solicitation_number: null, slack_brief_id: null },
                    error: null,
                  }),
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        if (table === 'slack_opportunity_briefs') {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({ data: { id: 'brief-new' }, error: null }),
              }),
            }),
            update: () => ({
              eq: () =>
                // message_ts update fails
                Promise.resolve({ error: { message: 'connection lost' } }),
            }),
          };
        }
        if (table === 'opportunity_events') {
          return {
            upsert: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'evt-1' }, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
        };
      },
    };

    const slackClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234.5678' }),
      },
    };

    const result = await postOpportunityBrief(
      supabase,
      slackClient,
      'C123',
      'OPP-RECOVER',
      'task-1',
      { title: 'Test', agency: 'VA', setAside: null, naics: null, responseDeadline: null, sourceUrl: null },
      {
        recommendation: 'EVALUATE',
        confidence: 80,
        acquisitionNature: 'services',
        fitReasons: ['fit'],
        concerns: [],
        evidenceUsed: [],
        missingInformation: [],
        researchRequests: [],
        rationale: 'test',
      }
    );

    // Slack post succeeded — returns success with messageTs
    expect(result.success).toBe(true);
    expect(result.messageTs).toBe('1234.5678');
    expect(slackClient.chat.postMessage).toHaveBeenCalledOnce();

    // CRITICAL error was logged for reconciliation
    const criticalCalls = consoleErrorSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('CRITICAL')
    );
    expect(criticalCalls.length).toBeGreaterThan(0);

    consoleErrorSpy.mockRestore();
  });
});
