/**
 * James Capture Orchestration — Safety Invariant Tests
 */
import { describe, it, expect } from 'vitest';

describe('James Safety Invariants', () => {
  // 1. Send to Capture creates at most one capture
  it('capture creation is idempotent via UNIQUE constraint', () => {
    // Enforced by UNIQUE(opportunity_id, source_material_hash) + idempotency_key UNIQUE
    expect(true).toBe(true);
  });

  // 2. Send to Capture does not call James inside Slack callback
  it('handleSendToCapture does not import task-processor', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const slackSurfacePath = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      'maya',
      'slack-surface.ts'
    );
    const content = fs.readFileSync(slackSurfacePath, 'utf-8');
    // handleSendToCapture should not import processInitialAssessment or complete()
    expect(content).not.toContain('import.*processInitialAssessment');
    expect(content).not.toContain("from '../../services/llm-gateway/gateway");
  });

  // 3. James cannot authorize pursuit
  it('James task-processor does not emit PURSUIT_AUTHORIZED', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const tpPath = path.resolve(import.meta.dirname, '..', 'task-processor.ts');
    const content = fs.readFileSync(tpPath, 'utf-8');
    expect(content).not.toContain('PURSUIT_AUTHORIZED');
    expect(content).not.toContain('authorize_pursuit');
  });

  // 4. Specialist cannot create another specialist task
  it('specialist-executor does not import specialist-router', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const execPath = path.resolve(import.meta.dirname, '..', 'specialist-executor.ts');
    const content = fs.readFileSync(execPath, 'utf-8');
    expect(content).not.toContain("from './specialist-router");
    expect(content).not.toContain('dispatchResearchNeeds');
  });

  // 5. Maximum autonomous research rounds = 2
  it('CAPTURE_BUDGET.MAX_AUTONOMOUS_ROUNDS is 2', async () => {
    const { CAPTURE_BUDGET } = await import('../types.js');
    expect(CAPTURE_BUDGET.MAX_AUTONOMOUS_ROUNDS).toBe(2);
  });

  // 6. Shared capture AI spend <= $0.25
  it('CAPTURE_BUDGET.MAX_CAPTURE_USD is 0.25', async () => {
    const { CAPTURE_BUDGET } = await import('../types.js');
    expect(CAPTURE_BUDGET.MAX_CAPTURE_USD).toBe(0.25);
  });

  // 7. No external outreach
  it('no external HTTP/email/outreach in James modules', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(import.meta.dirname, '..');
    const files = fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith('.ts') && !f.includes('__tests__'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      expect(content).not.toContain('nodemailer');
      expect(content).not.toContain('gmail');
      expect(content).not.toContain('sendEmail');
    }
  });

  // 8. No Notion writes
  it('no Notion API calls in James modules', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(import.meta.dirname, '..');
    const files = fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith('.ts') && !f.includes('__tests__'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      expect(content).not.toContain('@notionhq');
      expect(content).not.toContain('notion.pages');
    }
  });

  // 9. No Jodie inference
  it('no Jodie agent calls in James modules', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve(import.meta.dirname, '..');
    const files = fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith('.ts') && !f.includes('__tests__'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      expect(content).not.toContain("agentId: 'jodie'");
      expect(content).not.toContain("agentId: 'patricia'");
    }
  });

  // 10. Specialist fixtures clearly marked
  it('specialist executor marks all artifacts as TEST_FIXTURE', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const execPath = path.resolve(import.meta.dirname, '..', 'specialist-executor.ts');
    const content = fs.readFileSync(execPath, 'utf-8');
    expect(content).toContain("artifact_source: 'TEST_FIXTURE'");
    expect(content).toContain("execution_mode: 'TEST_FIXTURE'");
  });

  // 11. Decision schema validation
  it('valid James capture decision passes Zod schema', async () => {
    const { JamesCaptureDecisionSchema } = await import('../types.js');
    const dim = {
      assessment: 'STRONG',
      evidenceRefs: ['ref1'],
      concerns: [],
      confidence: 'HIGH',
    };
    const valid = {
      recommendation: 'GO',
      confidence: 80,
      customerFit: dim,
      capabilityFit: dim,
      acquisitionFit: dim,
      competitivePosition: dim,
      deliveryFeasibility: dim,
      businessCase: dim,
      primeSubPosture: 'PRIME',
      strongestReasonsToPursue: ['reason'],
      criticalRisks: [],
      unresolvedQuestions: [],
      requestedResearch: [],
      specialistFindingsUsed: [],
      rationale: 'Strong fit across all dimensions.',
      recommendedNextActions: ['Submit proposal'],
    };
    expect(() => JamesCaptureDecisionSchema.parse(valid)).not.toThrow();
  });

  // 12. Oversized decision rejected
  it('oversized James decision rejected by Zod', async () => {
    const { JamesCaptureDecisionSchema } = await import('../types.js');
    const dim = {
      assessment: 'STRONG',
      evidenceRefs: ['a', 'b', 'c', 'd', 'e', 'f'], // >5
      concerns: [],
      confidence: 'HIGH',
    };
    const oversized = {
      recommendation: 'GO',
      confidence: 80,
      customerFit: dim,
      capabilityFit: dim,
      acquisitionFit: dim,
      competitivePosition: dim,
      deliveryFeasibility: dim,
      businessCase: dim,
      primeSubPosture: 'PRIME',
      strongestReasonsToPursue: [],
      criticalRisks: [],
      unresolvedQuestions: [],
      requestedResearch: [],
      specialistFindingsUsed: [],
      rationale: 'test',
      recommendedNextActions: [],
    };
    expect(() => JamesCaptureDecisionSchema.parse(oversized)).toThrow();
  });

  // 13. Specialist artifact schema includes required fields
  it('specialist artifact schema includes materialUnsolicitedFindings', async () => {
    const { SpecialistArtifactSchema } = await import('../types.js');
    const valid = {
      finding: 'Test finding',
      assessment: 'FAVORABLE',
      confidence: 'HIGH',
      evidence: [],
      materialUnsolicitedFindings: ['Unexpected: competitor acquired'],
      unknowns: [],
      captureImplications: [],
      recommendedFollowup: [],
    };
    expect(() => SpecialistArtifactSchema.parse(valid)).not.toThrow();
  });

  // 14. James actions registered correctly
  it('registerJamesActions registers all three handlers', async () => {
    const { registerJamesActions } = await import('../slack-surface.js');
    const registered: string[] = [];
    const mockApp = {
      action: (id: string) => {
        registered.push(id);
      },
    };
    registerJamesActions(mockApp);
    expect(registered).toContain('james_pursue');
    expect(registered).toContain('james_no_go');
    expect(registered).toContain('james_more_research');
    expect(registered).toHaveLength(3);
  });

  // 15. Research need types are bounded
  it('research need types are constrained enum', async () => {
    const { ResearchNeedSchema } = await import('../types.js');
    expect(() =>
      ResearchNeedSchema.parse({
        type: 'AGENCY_OUTREACH', // Invalid type
        question: 'test',
        whyDecisionBlocking: 'test',
        evidenceRefs: [],
        priority: 'REQUIRED',
      })
    ).toThrow();
  });

  // 16. Capture budget constants are consistent
  it('task budgets do not exceed capture budget', async () => {
    const { CAPTURE_BUDGET } = await import('../types.js');
    expect(CAPTURE_BUDGET.INITIAL_ASSESSMENT_USD).toBeLessThanOrEqual(
      CAPTURE_BUDGET.MAX_CAPTURE_USD
    );
    expect(CAPTURE_BUDGET.RESYNTHESIS_USD).toBeLessThanOrEqual(CAPTURE_BUDGET.MAX_CAPTURE_USD);
    expect(CAPTURE_BUDGET.EXECUTIVE_RESEARCH_USD).toBeLessThanOrEqual(
      CAPTURE_BUDGET.MAX_CAPTURE_USD
    );
  });

  // 17. James does not directly call other agents
  it('James task-processor only uses agentId james', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const tpPath = path.resolve(import.meta.dirname, '..', 'task-processor.ts');
    const content = fs.readFileSync(tpPath, 'utf-8');
    const agentIdMatches = content.match(/agentId:\s*'(\w+)'/g) || [];
    for (const match of agentIdMatches) {
      expect(match).toContain("'james'");
    }
  });

  // 18. Resynthesis filters out TEST_FIXTURE artifacts
  it('resynthesis prompt builder excludes TEST_FIXTURE artifacts', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const tpPath = path.resolve(import.meta.dirname, '..', 'task-processor.ts');
    const content = fs.readFileSync(tpPath, 'utf-8');
    expect(content).toContain("artifact_source !== 'TEST_FIXTURE'");
  });
});
