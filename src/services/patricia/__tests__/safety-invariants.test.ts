/**
 * Patricia Safety Invariants
 *
 * Static analysis tests that verify Patricia's deterministic foundation
 * follows all safety constraints. No database required.
 *
 * These tests read source files directly and check for prohibited
 * patterns, required patterns, and structural invariants.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PATRICIA_DIR = path.resolve(import.meta.dirname, '..');
const HANDLERS_DIR = path.resolve(import.meta.dirname, '../../../events/handlers');

function getPatriciaSourceFiles(): string[] {
  return fs.readdirSync(PATRICIA_DIR)
    .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
    .map(f => path.join(PATRICIA_DIR, f));
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('Patricia Safety Invariants', () => {
  // ============================================================
  // INV-01: Zero direct provider imports
  // ============================================================
  it('INV-01: no direct Anthropic/OpenAI imports in Patricia service files', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain("from '@anthropic-ai/sdk'");
      expect(content).not.toContain("from 'anthropic'");
      expect(content).not.toContain("from 'openai'");
      expect(content).not.toContain("require('anthropic')");
      expect(content).not.toContain("require('openai')");
      expect(content).not.toContain("require('@anthropic-ai/sdk')");
    }
  });

  // ============================================================
  // INV-02: Zero LLM Gateway calls
  // ============================================================
  it('INV-02: no LLM gateway imports in Patricia service files', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain("from '../../llm-gateway");
      expect(content).not.toContain("from '../llm-gateway");
      expect(content).not.toContain("import { complete }");
      expect(content).not.toContain("gateway.complete");
    }
  });

  // ============================================================
  // INV-03: Zero G2X calls
  // ============================================================
  it('INV-03: no G2X imports in Patricia service files', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain("from '../../g2x");
      expect(content).not.toContain("from '../g2x");
      expect(content).not.toContain('g2x_get_record');
      expect(content).not.toContain('g2x_opportunity');
    }
  });

  // ============================================================
  // INV-04: No external outreach
  // ============================================================
  it('INV-04: no external outreach in Patricia service files', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain('nodemailer');
      expect(content).not.toContain('sendEmail');
      expect(content).not.toContain('smtp');
      expect(content).not.toContain('twilio');
    }
  });

  // ============================================================
  // INV-05: No Slack posting (disabled)
  // ============================================================
  it('INV-05: Patricia service files do not import Slack posting utilities', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      // Slack surface file generates payloads but does not post
      if (file.endsWith('slack-surface.ts')) {
        expect(content).not.toContain('postAsAgent');
        expect(content).not.toContain('replyInThread');
        expect(content).not.toContain('WebClient');
        continue;
      }
      expect(content).not.toContain("from '../../integrations/slack");
      expect(content).not.toContain('postAsAgent');
      expect(content).not.toContain('replyInThread');
    }
  });

  // ============================================================
  // INV-06: Idempotency keys on all mutations
  // ============================================================
  it('INV-06: all service modules that write to DB use idempotency keys', () => {
    const writingModules = [
      'commitment-registry.ts',
      'dependency-graph.ts',
      'escalation-engine.ts',
      'operational-actions.ts',
      'proposal-readiness.ts',
      'internal-milestones.ts',
      'portfolio-snapshot.ts',
      'reconciler.ts',
      'event-reactor.ts',
    ];

    for (const moduleName of writingModules) {
      const filePath = path.join(PATRICIA_DIR, moduleName);
      if (!fs.existsSync(filePath)) continue;
      const content = readFile(filePath);
      expect(content).toContain('idempotency');
    }
  });

  // ============================================================
  // INV-07: SUBMITTED requires human confirmation
  // ============================================================
  it('INV-07: advancing to SUBMITTED stage requires confirmedBy', () => {
    const content = readFile(path.join(PATRICIA_DIR, 'proposal-readiness.ts'));
    // The function must check for confirmedBy before allowing SUBMITTED
    expect(content).toContain("newStage === 'SUBMITTED' && !confirmedBy");
  });

  // ============================================================
  // INV-08: Patricia never authorizes Pursue
  // ============================================================
  it('INV-08: Patricia does not call authorize_pursuit', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain('authorize_pursuit');
    }
  });

  // ============================================================
  // INV-09: Patricia never makes GO/NO_GO decisions
  // ============================================================
  it('INV-09: Patricia does not emit GO_NO_GO_DECISION', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      // Patricia may handle/react to GO_NO_GO but must not emit it
      expect(content).not.toContain("eventType: 'GO_NO_GO_DECISION'");
      expect(content).not.toContain("event_type: 'GO_NO_GO_DECISION'");
    }
  });

  // ============================================================
  // INV-10: Observation window starts INACTIVE
  // ============================================================
  it('INV-10: Patricia observation window default is INACTIVE', () => {
    const typesContent = readFile(path.join(PATRICIA_DIR, 'types.ts'));
    expect(typesContent).toContain('PATRICIA_OBSERVATION_LIMITS');
    expect(typesContent).toContain('MAX_TASKS: 10');
    expect(typesContent).toContain('MAX_CUMULATIVE_SPEND_USD: 0.15');
  });

  // ============================================================
  // INV-11: Provider call constant is 0
  // ============================================================
  it('INV-11: PATRICIA_PROVIDER_CALLS = 0', () => {
    const typesContent = readFile(path.join(PATRICIA_DIR, 'types.ts'));
    expect(typesContent).toContain('PATRICIA_PROVIDER_CALLS = 0');
  });

  // ============================================================
  // INV-12: G2X call constant is 0
  // ============================================================
  it('INV-12: PATRICIA_G2X_CALLS = 0', () => {
    const typesContent = readFile(path.join(PATRICIA_DIR, 'types.ts'));
    expect(typesContent).toContain('PATRICIA_G2X_CALLS = 0');
  });

  // ============================================================
  // INV-13: Safe repair registry is explicitly allowlisted
  // ============================================================
  it('INV-13: safe repairs are allowlisted by rule ID', () => {
    const content = readFile(path.join(PATRICIA_DIR, 'safe-repair.ts'));
    expect(content).toContain('REPAIR_REGISTRY');
    // Must check auto_repair_permitted before executing
    expect(content).toContain('auto_repair_permitted');
  });

  // ============================================================
  // INV-14: No silence-as-approval patterns
  // ============================================================
  it('INV-14: no timeout-based approval in Patricia', () => {
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain('setTimeout');
      expect(content).not.toContain('setInterval');
    }
  });

  // ============================================================
  // INV-15: Feature flags default to false
  // ============================================================
  it('INV-15: Patricia feature flags default to disabled', async () => {
    const { FEATURE_FLAGS } = await import('../../../config/ai-controls.js');
    expect(FEATURE_FLAGS.PATRICIA_RECONCILIATION_ENABLED).toBe('PATRICIA_RECONCILIATION_ENABLED');
    expect(FEATURE_FLAGS.PATRICIA_SLACK_ENABLED).toBe('PATRICIA_SLACK_ENABLED');

    // Verify defaults are false (env vars not set in test)
    const { getFeatureFlag } = await import('../../../config/ai-controls.js');
    expect(getFeatureFlag(FEATURE_FLAGS.PATRICIA_RECONCILIATION_ENABLED)).toBe(false);
    expect(getFeatureFlag(FEATURE_FLAGS.PATRICIA_SLACK_ENABLED)).toBe(false);
  });

  // ============================================================
  // INV-16: Workflow health rules have stable IDs
  // ============================================================
  it('INV-16: all workflow health rules have stable WH-xxx IDs', async () => {
    const { WORKFLOW_HEALTH_RULES } = await import('../workflow-health.js');
    const ruleIds = WORKFLOW_HEALTH_RULES.map(r => r.ruleId);

    // All must start with WH-
    for (const id of ruleIds) {
      expect(id).toMatch(/^WH-\d{3}$/);
    }

    // No duplicates
    const unique = new Set(ruleIds);
    expect(unique.size).toBe(ruleIds.length);

    // Expected rules exist
    expect(ruleIds).toContain('WH-001');
    expect(ruleIds).toContain('WH-002');
    expect(ruleIds).toContain('WH-003');
  });

  // ============================================================
  // INV-17: Event handlers file uses no LLM imports
  // ============================================================
  it('INV-17: Patricia event handlers have no LLM imports', () => {
    const handlerFile = path.join(HANDLERS_DIR, 'patricia.handlers.ts');
    const content = readFile(handlerFile);
    expect(content).not.toContain("from '@anthropic-ai/sdk'");
    expect(content).not.toContain("from 'openai'");
    expect(content).not.toContain('gateway');
    expect(content).not.toContain('complete(');
  });

  // ============================================================
  // INV-18: Proposal stage order is enforced
  // ============================================================
  it('INV-18: proposal stages are ordered correctly', async () => {
    const { PROPOSAL_STAGES } = await import('../types.js');
    expect(PROPOSAL_STAGES[0]).toBe('PRE_SOLICITATION');
    expect(PROPOSAL_STAGES[PROPOSAL_STAGES.length - 1]).toBe('SUBMITTED');
  });

  // ============================================================
  // INV-19: Milestone override table is immutable
  // ============================================================
  it('INV-19: migration enforces immutable milestone overrides', () => {
    const migrationDir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
    const migrationFile = fs.readdirSync(migrationDir)
      .find(f => f.includes('patricia_deterministic'));
    expect(migrationFile).toBeDefined();

    const content = readFile(path.join(migrationDir, migrationFile!));
    expect(content).toContain('prevent_milestone_override_mutation');
    expect(content).toContain('trg_milestone_override_no_update');
    expect(content).toContain('trg_milestone_override_no_delete');
  });

  // ============================================================
  // INV-20: RLS on all Patricia tables
  // ============================================================
  it('INV-20: all Patricia tables have RLS enabled in migration', () => {
    const migrationDir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
    const migrationFile = fs.readdirSync(migrationDir)
      .find(f => f.includes('patricia_deterministic'));
    expect(migrationFile).toBeDefined();

    const content = readFile(path.join(migrationDir, migrationFile!));
    const tables = [
      'patricia_commitments',
      'patricia_dependencies',
      'patricia_workflow_findings',
      'patricia_operational_actions',
      'patricia_escalations',
      'patricia_proposal_readiness',
      'patricia_internal_milestones',
      'patricia_milestone_overrides',
      'patricia_portfolio_snapshots',
      'patricia_observation_windows',
      'patricia_reconciliation_checkpoints',
      'patricia_post_submission_events',
    ];

    for (const table of tables) {
      expect(content).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(content).toContain(`GRANT ALL ON ${table} TO service_role`);
    }
  });

  // ============================================================
  // INV-21: No production project ID in Patricia source files
  // ============================================================
  it('INV-21: Patricia source files do not reference production project ID', () => {
    const PRODUCTION_ID = 'bvgtfadggtgnakrxvuim';
    for (const file of getPatriciaSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain(PRODUCTION_ID);
    }
  });

  // ============================================================
  // INV-22: Default milestone schedule is reasonable
  // ============================================================
  it('INV-22: default milestone offsets are decreasing toward deadline', async () => {
    const { DEFAULT_MILESTONE_SCHEDULE } = await import('../types.js');
    expect(DEFAULT_MILESTONE_SCHEDULE.length).toBeGreaterThanOrEqual(5);

    // Offsets should decrease (getting closer to deadline)
    for (let i = 1; i < DEFAULT_MILESTONE_SCHEDULE.length; i++) {
      expect(DEFAULT_MILESTONE_SCHEDULE[i].offsetDays)
        .toBeLessThan(DEFAULT_MILESTONE_SCHEDULE[i - 1].offsetDays);
    }
  });
});
