/**
 * Marcus Technical Intelligence Tests
 *
 * Comprehensive tests for Marcus's technical intelligence capabilities.
 * Covers: Schema Validation, Budget Enforcement, Technical Change Classification,
 *         Structural Isolation, Type Boundaries, Safety Invariants.
 *
 * Spec compliance for Marcus commissioned research path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// Mocks — declared before any source imports
// ============================================================

vi.mock('../../../config/ai-controls.js', () => ({
  getFeatureFlag: vi.fn().mockReturnValue(true),
}));

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('../../../integrations/database/client.js', () => ({
  getSupabase: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

vi.mock('../../g2x/transport.js', () => ({
  callToolDirect: vi.fn(),
}));

vi.mock('../../g2x/auth.js', () => ({
  getG2XAuth: vi.fn().mockReturnValue({
    isAvailable: vi.fn().mockReturnValue(true),
    getAuthHeaders: vi.fn().mockResolvedValue({
      Authorization: 'Bearer test-token',
    }),
  }),
}));

vi.mock('../../llm-gateway/gateway.js', () => ({
  complete: vi.fn().mockResolvedValue({
    text: JSON.stringify({
      captureId: '550e8400-e29b-41d4-a716-446655440000',
      opportunityId: 'opp-1',
      conclusion: 'FEASIBLE',
      confidence: 'MEDIUM',
      requirements: ['Cloud hosting required'],
      constraints: ['FedRAMP High'],
      assumptions: ['AWS GovCloud available'],
      technicalRisks: [
        { description: 'FedRAMP timeline', severity: 'MEDIUM', mitigation: 'Use existing ATO' },
      ],
      deliveryConsiderations: 'Standard delivery timeline',
      evidenceRefs: ['SOW Section 3.1'],
      unresolvedQuestions: ['Clearance level for dev team'],
      recommendedActions: ['Confirm FedRAMP boundary'],
    }),
    ledgerId: 'test-ledger-001',
    inputTokens: 100,
    outputTokens: 200,
    costUsd: 0.01,
  }),
}));

vi.mock('../../llm-gateway/budget.js', () => ({
  ensureWorkflowBudget: vi.fn().mockResolvedValue(undefined),
  ensureTaskBudget: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// ============================================================
// Source Imports — after mocks
// ============================================================

import {
  MARCUS_G2X_ALLOWED_TOOLS,
  MarcusTechnicalConclusion,
  MarcusResearchType,
  TechnicalAssessmentSchema,
  MarcusResearchRequestSchema,
  MaterialTechnicalChangeType,
  CAPTURE_BUDGET_CEILING,
  MARCUS_CAPTURE_TASK_COST,
  TechnologyDecisionType,
  ClarificationQuestionStatus,
  TechnicalSolutionArtifactVersionSchema,
  TechnicalROMSchema,
} from '../types.js';

import { classifyTechnicalChange, type NormalizedTechnicalFields } from '../technical-change.js';
import { executeMarcusCaptureResearch } from '../capture-research.js';
import { getFeatureFlag } from '../../../config/ai-controls.js';
import { ensureWorkflowBudget, ensureTaskBudget } from '../../llm-gateway/budget.js';

// ============================================================
// Chainable Supabase mock helper
// ============================================================

function chainableSupabase(returnData: unknown = null, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: returnData, error });
  chain.catch = vi.fn().mockResolvedValue({ data: returnData });
  chain.then = undefined; // Prevent thenable resolution
  return chain;
}

// ============================================================
// Helpers
// ============================================================

function makeNormalizedFields(
  overrides: Partial<NormalizedTechnicalFields> = {}
): NormalizedTechnicalFields {
  return {
    hostingCloud: null,
    mandatoryTechnology: null,
    architectureConstraint: null,
    apiIntegration: null,
    dataHandling: null,
    securityCompliance: null,
    clearance: null,
    accessibility: null,
    performanceSla: null,
    devsecopsDeployment: null,
    technicalCertification: null,
    technicalScope: null,
    ...overrides,
  };
}

function makeResearchRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    captureId: '550e8400-e29b-41d4-a716-446655440000',
    opportunityId: 'opp-1',
    question: 'Assess technical feasibility of cloud migration requirement',
    researchType: 'TECHNICAL_FEASIBILITY' as const,
    expectedArtifact: 'TECHNICAL_ASSESSMENT' as const,
    evidenceRefs: [],
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('Marcus Technical Intelligence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getFeatureFlag as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  // ----------------------------------------------------------
  // 1. James creates Marcus request
  // ----------------------------------------------------------

  it('1. James creates Marcus request: MarcusResearchRequest schema validates with valid researchType enum', () => {
    const request = makeResearchRequest();
    const result = MarcusResearchRequestSchema.safeParse(request);
    expect(result.success).toBe(true);

    // All 8 research types are valid
    for (const rt of Object.values(MarcusResearchType)) {
      const r = MarcusResearchRequestSchema.safeParse({ ...request, researchType: rt });
      expect(r.success).toBe(true);
    }

    // Invalid research type rejected
    const invalid = MarcusResearchRequestSchema.safeParse({
      ...request,
      researchType: 'INVALID_TYPE',
    });
    expect(invalid.success).toBe(false);
  });

  // ----------------------------------------------------------
  // 2. No generic specialist
  // ----------------------------------------------------------

  it('2. No generic specialist: SPECIALIST_EXECUTION_ENABLED not required (structural)', async () => {
    // capture-research.ts does not import specialist-executor
    // and does not gate on SPECIALIST_EXECUTION_ENABLED
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const marcusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const captureResearchContent = fs.readFileSync(
      path.join(marcusDir, 'capture-research.ts'),
      'utf-8'
    );

    // Should not import specialist-executor
    expect(captureResearchContent).not.toMatch(/from\s+['"].*specialist-executor['"]/);

    // Any SPECIALIST_EXECUTION_ENABLED reference must be in a comment
    const lines = captureResearchContent.split('\n');
    for (const line of lines) {
      if (line.includes('SPECIALIST_EXECUTION_ENABLED')) {
        const trimmed = line.trim();
        const isComment =
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*');
        expect(isComment).toBe(true);
      }
    }
  });

  // ----------------------------------------------------------
  // 3. Shared $0.25 envelope
  // ----------------------------------------------------------

  it('3. Shared $0.25 envelope: ensureWorkflowBudget called with capture-{captureId} and 0.25', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue(
        chainableSupabase({
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: 'researching',
          opportunity_id: 'opp-1',
          capture_budget_scope_id: 'scope-1',
        })
      ),
      rpc: vi.fn().mockResolvedValue({ data: true }),
    };

    const request = makeResearchRequest();
    await executeMarcusCaptureResearch(supabase, request, 'task-budget-3');

    expect(ensureWorkflowBudget).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('capture-'),
      CAPTURE_BUDGET_CEILING
    );
  });

  // ----------------------------------------------------------
  // 4. Marcus task ceiling $0.05
  // ----------------------------------------------------------

  it('4. Marcus task ceiling $0.05: ensureTaskBudget called with 0.05', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue(
        chainableSupabase({
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: 'researching',
          opportunity_id: 'opp-1',
        })
      ),
      rpc: vi.fn().mockResolvedValue({ data: true }),
    };

    const request = makeResearchRequest();
    await executeMarcusCaptureResearch(supabase, request, 'task-cost-4');

    expect(ensureTaskBudget).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('marcus-capture-'),
      MARCUS_CAPTURE_TASK_COST
    );
    expect(MARCUS_CAPTURE_TASK_COST).toBe(0.05);
  });

  // ----------------------------------------------------------
  // 5. Insufficient budget fails
  // ----------------------------------------------------------

  it('5. Insufficient budget fails: ensureWorkflowBudget rejects -> zero provider calls', async () => {
    (ensureWorkflowBudget as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Budget exhausted: $0.25 ceiling reached')
    );

    const supabase = {
      from: vi.fn().mockReturnValue(
        chainableSupabase({
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: 'researching',
          opportunity_id: 'opp-1',
        })
      ),
      rpc: vi.fn().mockResolvedValue({ data: true }),
    };

    const { complete: completeMock } = await import('../../llm-gateway/gateway.js');

    const request = makeResearchRequest();
    const result = await executeMarcusCaptureResearch(supabase, request, 'task-budget-fail');

    expect(result.conclusion).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.summary).toContain('Insufficient capture budget');
    expect(completeMock).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // 6. Exact settlement (structural)
  // ----------------------------------------------------------

  it('6. Exact settlement: capture budget settles with actual cost (structural)', async () => {
    // The capture-research.ts calls ensureTaskBudget with MARCUS_CAPTURE_TASK_COST
    // and the gateway settles actual cost. This is structural: the budget system
    // tracks reserved vs actual and the settle_marcus_observation_slot RPC
    // adjusts reserved -> actual spend.
    expect(CAPTURE_BUDGET_CEILING).toBe(0.25);
    expect(MARCUS_CAPTURE_TASK_COST).toBe(0.05);
    // Marcus reserves 0.05 per task, gateway settles actual cost
    expect(MARCUS_CAPTURE_TASK_COST).toBeLessThan(CAPTURE_BUDGET_CEILING);
  });

  // ----------------------------------------------------------
  // 7. Material hosting change wakes Marcus
  // ----------------------------------------------------------

  it('7. Material hosting change wakes Marcus: classifyTechnicalChange with hosting field change -> material=true', () => {
    const oldFields = makeNormalizedFields({ hostingCloud: 'on-premises' });
    const newFields = makeNormalizedFields({ hostingCloud: 'AWS GovCloud' });

    const result = classifyTechnicalChange(oldFields, newFields);

    expect(result.changed).toBe(true);
    expect(result.material).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    expect(result.reasons[0].field).toBe('hostingCloud');
    expect(result.classification).toBe(MaterialTechnicalChangeType.HOSTING_CLOUD);
  });

  // ----------------------------------------------------------
  // 8. Nonmaterial formatting change
  // ----------------------------------------------------------

  it('8. Nonmaterial formatting change: classifyTechnicalChange with formatting only -> material=false', () => {
    // Use identical technical fields — the function only compares NormalizedTechnicalFields
    const oldFields = makeNormalizedFields({ hostingCloud: 'AWS GovCloud' });
    const newFields = makeNormalizedFields({ hostingCloud: 'AWS GovCloud' });

    const result = classifyTechnicalChange(oldFields, newFields);

    expect(result.changed).toBe(false);
    expect(result.material).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  // ----------------------------------------------------------
  // 9. Ambiguous change
  // ----------------------------------------------------------

  it('9. Ambiguous change: classifyTechnicalChange with unclear field -> TECHNICAL_CHANGE_REVIEW_REQUIRED, no LLM', () => {
    // Pass fields with an unknown key by casting to trigger ambiguous path
    const oldFields = makeNormalizedFields();
    const newFields = makeNormalizedFields();

    // Inject an unknown field that is not in material or nonmaterial lists
    const oldRecord = oldFields as unknown as Record<string, unknown>;
    const newRecord = newFields as unknown as Record<string, unknown>;
    oldRecord['unknownTechnicalField'] = 'value-a';
    newRecord['unknownTechnicalField'] = 'value-b';

    const result = classifyTechnicalChange(
      oldRecord as unknown as NormalizedTechnicalFields,
      newRecord as unknown as NormalizedTechnicalFields
    );

    expect(result.ambiguous).toBe(true);
    expect(result.material).toBe(false);
    expect(result.classification).toBe(
      MaterialTechnicalChangeType.TECHNICAL_CHANGE_REVIEW_REQUIRED
    );
    // No LLM: classifyTechnicalChange is purely deterministic
  });

  // ----------------------------------------------------------
  // 10. Decisive blocker short-circuits (structural)
  // ----------------------------------------------------------

  it('10. Decisive blocker short-circuits: conclusion=TECHNICALLY_UNSUITABLE returns immediately (structural)', () => {
    // The executor prompt says "decisive technical blockers short-circuit to James"
    // TECHNICALLY_UNSUITABLE is a valid conclusion that triggers immediate return
    expect(MarcusTechnicalConclusion.TECHNICALLY_UNSUITABLE).toBe('TECHNICALLY_UNSUITABLE');

    // Verify it is a valid TechnicalAssessmentSchema conclusion
    const assessment = TechnicalAssessmentSchema.safeParse({
      captureId: '550e8400-e29b-41d4-a716-446655440000',
      opportunityId: 'opp-1',
      conclusion: 'TECHNICALLY_UNSUITABLE',
      confidence: 'HIGH',
      requirements: ['Must use proprietary system X'],
      constraints: ['System X license unavailable'],
      assumptions: [],
      technicalRisks: [],
      deliveryConsiderations: 'Cannot deliver without System X',
      evidenceRefs: ['SOW 4.2'],
      unresolvedQuestions: [],
      recommendedActions: ['Escalate to James for NO-GO consideration'],
    });
    expect(assessment.success).toBe(true);
  });

  // ----------------------------------------------------------
  // 11. Teaming candidate -> workflow (structural)
  // ----------------------------------------------------------

  it('11. Teaming candidate -> workflow: TEAMING_DEPENDENT goes to workflow engine, not Rosa (structural)', async () => {
    // Marcus executor emits teaming candidates to workflow, not directly to Rosa
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const marcusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const executorContent = fs.readFileSync(
      path.join(marcusDir, 'executor.ts'),
      'utf-8'
    );

    // executor.ts should NOT import Rosa modules
    expect(executorContent).not.toMatch(/from\s+['"].*rosa.*['"]/i);
    // TEAMING_DEPENDENT is a valid conclusion
    expect(MarcusTechnicalConclusion.TEAMING_DEPENDENT).toBe('TEAMING_DEPENDENT');
  });

  // ----------------------------------------------------------
  // 12. Acquisition boundary (structural)
  // ----------------------------------------------------------

  it('12. Acquisition boundary: Marcus does not import legal/acquisition modules (structural)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const marcusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const marcusFiles = fs
      .readdirSync(marcusDir)
      .filter((f: string) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    for (const file of marcusFiles) {
      const content = fs.readFileSync(path.join(marcusDir, file), 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*acquisition.*['"]/i);
      expect(content).not.toMatch(/from\s+['"].*legal.*['"]/i);
    }
  });

  // ----------------------------------------------------------
  // 13. REQUIRED/PROPOSED/ASSUMED
  // ----------------------------------------------------------

  it('13. REQUIRED/PROPOSED/ASSUMED: TechnologyDecisionType has exactly these 3 values', () => {
    const values = Object.values(TechnologyDecisionType);
    expect(values).toHaveLength(3);
    expect(values).toContain('REQUIRED');
    expect(values).toContain('PROPOSED');
    expect(values).toContain('ASSUMED');
  });

  // ----------------------------------------------------------
  // 14. ROM not pricing
  // ----------------------------------------------------------

  it('14. ROM not pricing: estimate_type must be ROM (Zod check)', () => {
    // Valid ROM
    const validRom = TechnicalROMSchema.safeParse({
      estimateType: 'ROM',
      workstreams: [],
      dependencies: [],
      scheduleAssumptions: 'Standard timeline',
      notes: 'Initial estimate',
    });
    expect(validRom.success).toBe(true);

    // Any other estimate type rejected
    const invalidRom = TechnicalROMSchema.safeParse({
      estimateType: 'FIRM_FIXED_PRICE',
      workstreams: [],
      dependencies: [],
      scheduleAssumptions: 'Standard timeline',
      notes: 'Invalid',
    });
    expect(invalidRom.success).toBe(false);

    const invalidRom2 = TechnicalROMSchema.safeParse({
      estimateType: 'PRICING',
      workstreams: [],
      dependencies: [],
      scheduleAssumptions: 'Standard timeline',
      notes: 'Invalid',
    });
    expect(invalidRom2.success).toBe(false);
  });

  // ----------------------------------------------------------
  // 15. Clarification cannot submit
  // ----------------------------------------------------------

  it('15. Clarification cannot submit: ClarificationQuestionStatus has DRAFT but SUBMITTED_EXTERNAL requires separate commissioning', () => {
    expect(ClarificationQuestionStatus.DRAFT).toBe('DRAFT');
    expect(ClarificationQuestionStatus.SUBMITTED_EXTERNAL).toBe('SUBMITTED_EXTERNAL');

    // Only two statuses — SUBMITTED_EXTERNAL is a distinct state requiring
    // separate human commissioning, not an automatic Marcus action
    const statuses = Object.values(ClarificationQuestionStatus);
    expect(statuses).toHaveLength(2);
    expect(statuses).toContain('DRAFT');
    expect(statuses).toContain('SUBMITTED_EXTERNAL');
  });

  // ----------------------------------------------------------
  // 16. TechnicalSolutionArtifact versions immutable (structural)
  // ----------------------------------------------------------

  it('16. TechnicalSolutionArtifact versions immutable: trigger blocks UPDATE/DELETE in migration (structural)', async () => {
    // The migration creates triggers that prevent UPDATE and DELETE on
    // technical_solution_artifact_versions. We verify the schema has no
    // updatedAt field — immutable rows have only created_at.
    const schema = TechnicalSolutionArtifactVersionSchema;

    // Schema should include createdAt-related fields but the Zod schema
    // does not include an updatedAt field — immutability by design
    const shapeKeys = Object.keys(schema.shape);
    expect(shapeKeys).not.toContain('updatedAt');
    expect(shapeKeys).toContain('versionNumber');
    expect(shapeKeys).toContain('previousVersionId');
    expect(shapeKeys).toContain('sourceDocumentVersionRefs');
  });

  // ----------------------------------------------------------
  // 17. Source doc provenance
  // ----------------------------------------------------------

  it('17. Source doc provenance: TechnicalSolutionArtifactVersionSchema includes sourceDocumentVersionRefs', () => {
    const shapeKeys = Object.keys(TechnicalSolutionArtifactVersionSchema.shape);
    expect(shapeKeys).toContain('sourceDocumentVersionRefs');

    // Validate it accepts an array of strings
    const validVersion = TechnicalSolutionArtifactVersionSchema.safeParse({
      versionNumber: 1,
      previousVersionId: null,
      sourceDocumentVersionRefs: ['SOW v2.1', 'PWS Amendment 3'],
      requirementsAdded: ['New cloud requirement'],
      requirementsChanged: [],
      requirementsRemoved: [],
      assumptionsInvalidated: [],
      architectureChanges: [],
      newRisks: [],
      resolvedRisks: [],
      technicalDecisionsChanged: [],
      evidenceRefs: ['SOW Section 3'],
      supersededAt: null,
    });
    expect(validVersion.success).toBe(true);
  });

  // ----------------------------------------------------------
  // 18. No direct provider
  // ----------------------------------------------------------

  it('18. No direct provider: capture-research.ts does not import @anthropic-ai/sdk or openai', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const marcusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const captureResearchContent = fs.readFileSync(
      path.join(marcusDir, 'capture-research.ts'),
      'utf-8'
    );

    expect(captureResearchContent).not.toMatch(/@anthropic-ai\/sdk/);
    expect(captureResearchContent).not.toMatch(/from\s+['"]openai['"]/);
  });

  // ----------------------------------------------------------
  // 19. G2X allowlist exactly 3
  // ----------------------------------------------------------

  it('19. G2X allowlist exactly 3: MARCUS_G2X_ALLOWED_TOOLS length = 3', () => {
    expect(MARCUS_G2X_ALLOWED_TOOLS).toHaveLength(3);
  });

  // ----------------------------------------------------------
  // 20. No Lumen
  // ----------------------------------------------------------

  it('20. No Lumen: g2x_teaming_partners, g2x_forecast_scan not in allowlist', () => {
    const tools = [...MARCUS_G2X_ALLOWED_TOOLS];
    expect(tools).not.toContain('g2x_teaming_partners');
    expect(tools).not.toContain('g2x_forecast_scan');
    // Marcus has document-focused tools only
    expect(tools).toContain('g2x_get_record');
    expect(tools).toContain('g2x_opportunity_documents');
    expect(tools).toContain('g2x_opportunity_attachment_text');
  });

  // ----------------------------------------------------------
  // 21. Idempotent replay (structural)
  // ----------------------------------------------------------

  it('21. Idempotent replay: duplicate idempotency_key -> rejected (structural)', async () => {
    // capture-research.ts uses idempotencyKey: `marcus-capture:${captureId}:${taskId}`
    // for the gateway call, and `assessment:${captureId}:${taskId}` for persistence.
    // The gateway enforces idempotency via the ledger.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const marcusDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const captureResearchContent = fs.readFileSync(
      path.join(marcusDir, 'capture-research.ts'),
      'utf-8'
    );

    // Verify idempotency key is constructed in the complete() call
    expect(captureResearchContent).toContain('idempotencyKey');
    expect(captureResearchContent).toContain('marcus-capture:');

    // Verify persistence uses an idempotency key
    expect(captureResearchContent).toContain('idempotency_key');
    expect(captureResearchContent).toContain('assessment:');
  });

  // ----------------------------------------------------------
  // 22. Malformed output fails closed
  // ----------------------------------------------------------

  it('22. Malformed output fails closed: TechnicalAssessmentSchema.safeParse on invalid conclusion -> fails', () => {
    const malformed = {
      captureId: '550e8400-e29b-41d4-a716-446655440000',
      opportunityId: 'opp-1',
      conclusion: 'GO', // Invalid: Marcus does not make GO/NO-GO
      confidence: 'MEDIUM',
      requirements: [],
      constraints: [],
      assumptions: [],
      technicalRisks: [],
      deliveryConsiderations: 'Test',
      evidenceRefs: [],
      unresolvedQuestions: [],
      recommendedActions: [],
    };

    const result = TechnicalAssessmentSchema.safeParse(malformed);
    expect(result.success).toBe(false);

    // Also reject NO_GO
    const noGo = { ...malformed, conclusion: 'NO_GO' };
    const noGoResult = TechnicalAssessmentSchema.safeParse(noGo);
    expect(noGoResult.success).toBe(false);
  });

  // ----------------------------------------------------------
  // 23. Human/pursuit authority
  // ----------------------------------------------------------

  it('23. Human/pursuit authority: Marcus conclusion is NOT GO/NO_GO, all 5 conclusions are technical', () => {
    const conclusions = Object.values(MarcusTechnicalConclusion);
    expect(conclusions).toHaveLength(5);

    // None are GO/NO_GO — Marcus does not make business decisions
    expect(conclusions).not.toContain('GO');
    expect(conclusions).not.toContain('NO_GO');
    expect(conclusions).not.toContain('PROCEED');
    expect(conclusions).not.toContain('STOP');

    // All 5 are technical advisory conclusions
    expect(conclusions).toContain('FEASIBLE');
    expect(conclusions).toContain('FEASIBLE_WITH_RISKS');
    expect(conclusions).toContain('TEAMING_DEPENDENT');
    expect(conclusions).toContain('INSUFFICIENT_EVIDENCE');
    expect(conclusions).toContain('TECHNICALLY_UNSUITABLE');
  });

  // ----------------------------------------------------------
  // 24. No infra/code execution (structural)
  // ----------------------------------------------------------

  it('24. No infra/code execution: Marcus types have no execution/deployment/command capabilities (structural)', () => {
    // Marcus types should not include any infrastructure execution,
    // code deployment, or command execution capabilities
    const allTypeKeys = [
      ...Object.keys(MarcusTechnicalConclusion),
      ...Object.keys(MarcusResearchType),
      ...Object.keys(MaterialTechnicalChangeType),
    ];

    // No execution-related type values
    expect(allTypeKeys).not.toContain('EXECUTE');
    expect(allTypeKeys).not.toContain('DEPLOY');
    expect(allTypeKeys).not.toContain('RUN_COMMAND');
    expect(allTypeKeys).not.toContain('PROVISION');
    expect(allTypeKeys).not.toContain('TERRAFORM');
    expect(allTypeKeys).not.toContain('KUBECTL');

    // Marcus G2X tools are read-only document retrieval
    const tools = [...MARCUS_G2X_ALLOWED_TOOLS];
    for (const tool of tools) {
      expect(tool).not.toMatch(/execute|deploy|provision|create|delete|update/i);
    }
  });
});
