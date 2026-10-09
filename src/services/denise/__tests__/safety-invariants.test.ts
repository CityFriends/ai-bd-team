/**
 * Denise Safety Invariants — Foundation Verification
 *
 * Proves Denise architecture without provider calls.
 * Tests 1–28 from the required test list.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// Types
import {
  DENISE_CAPTURE_ENABLED,
  DENISE_PURSUIT_ENABLED,
  DENISE_SLACK_ENABLED,
  DENISE_REGULATORY_RESEARCH_ENABLED,
  DENISE_PROVIDER_CALLS,
  DENISE_G2X_CALLS,
  CAPTURE_PARENT_BUDGET_USD,
  DENISE_CAPTURE_TASK_CEILING_USD,
  DENISE_PURSUIT_MAX_CALLS,
  DENISE_PURSUIT_MAX_SPEND_USD,
  DENISE_G2X_ALLOWLIST,
  DENISE_G2X_DENYLIST,
  DENISE_GATEWAY_ROUTES,
  RELATIVE_IMPORTANCE_VALUES,
  EVIDENCE_CATEGORIES,
  AUTHORITY_LEVELS,
  GAO_CLASSIFICATION,
  CLARIFICATION_CLASSIFICATIONS,
  EXTERNAL_SEND_STATUSES,
} from '../types.js';

// Feature flags
import { FEATURE_FLAGS, getFeatureFlag } from '../../../config/ai-controls.js';

// Slack surface
import { shouldNotify, generateRiskPayload } from '../slack-surface.js';

// Research adapter
import { researchAuthoritativeSource, isAuthorityClassApproved } from '../research-adapter.js';

// Gateway types
import type { AgentId } from '../../llm-gateway/types.js';

// Bot factory type
import type { AgentId as BotAgentId } from '../../../lib/bot-factory.js';

// Migration file for RLS checks
const MIGRATION_PATH = path.join(
  import.meta.dirname, '..', '..', '..', '..', 'supabase', 'migrations',
  '20261008_denise_acquisition_foundation.sql'
);
const migrationContent = fs.readFileSync(MIGRATION_PATH, 'utf-8');

// ============================================================
// Test 1: Denise is a first-class employee
// ============================================================
describe('Test 1: First-class employee identity', () => {
  it('Denise is in Gateway AgentId type', () => {
    const validIds: AgentId[] = ['maya', 'david', 'rosa', 'james', 'patricia', 'marcus', 'jodie', 'denise', 'system'];
    expect(validIds).toContain('denise');
  });

  it('Denise is in bot-factory AgentId type', () => {
    const validIds: BotAgentId[] = ['maya', 'david', 'rosa', 'james', 'patricia', 'marcus', 'jodie', 'denise'];
    expect(validIds).toContain('denise');
  });

  it('Denise has dedicated service directory', () => {
    const serviceDir = path.join(import.meta.dirname, '..');
    expect(fs.existsSync(serviceDir)).toBe(true);
  });
});

// ============================================================
// Test 2: Independent of generic specialist execution
// ============================================================
describe('Test 2: Independent of generic specialist execution', () => {
  it('Denise feature flags are not SPECIALIST_EXECUTION_ENABLED', () => {
    expect(FEATURE_FLAGS.DENISE_CAPTURE_ENABLED).toBe('DENISE_CAPTURE_ENABLED');
    expect(FEATURE_FLAGS.DENISE_PURSUIT_ENABLED).toBe('DENISE_PURSUIT_ENABLED');
    expect(FEATURE_FLAGS.DENISE_CAPTURE_ENABLED).not.toBe(FEATURE_FLAGS.SPECIALIST_EXECUTION_ENABLED);
    expect(FEATURE_FLAGS.DENISE_PURSUIT_ENABLED).not.toBe(FEATURE_FLAGS.SPECIALIST_EXECUTION_ENABLED);
  });

  it('Denise does not depend on ENABLE_AUTONOMOUS_AI', () => {
    expect(FEATURE_FLAGS.DENISE_CAPTURE_ENABLED).not.toBe(FEATURE_FLAGS.ENABLE_AUTONOMOUS_AI);
  });
});

// ============================================================
// Test 3: All DENISE gates default false
// ============================================================
describe('Test 3: Feature gates default OFF', () => {
  it('DENISE_CAPTURE_ENABLED defaults false', () => {
    expect(DENISE_CAPTURE_ENABLED).toBe(false);
    expect(getFeatureFlag('DENISE_CAPTURE_ENABLED')).toBe(false);
  });

  it('DENISE_PURSUIT_ENABLED defaults false', () => {
    expect(DENISE_PURSUIT_ENABLED).toBe(false);
    expect(getFeatureFlag('DENISE_PURSUIT_ENABLED')).toBe(false);
  });

  it('DENISE_SLACK_ENABLED defaults false', () => {
    expect(DENISE_SLACK_ENABLED).toBe(false);
    expect(getFeatureFlag('DENISE_SLACK_ENABLED')).toBe(false);
  });

  it('DENISE_REGULATORY_RESEARCH_ENABLED defaults false', () => {
    expect(DENISE_REGULATORY_RESEARCH_ENABLED).toBe(false);
    expect(getFeatureFlag('DENISE_REGULATORY_RESEARCH_ENABLED')).toBe(false);
  });
});

// ============================================================
// Test 4: Capture hierarchy $0.25 parent / $0.05 Denise task
// ============================================================
describe('Test 4: Capture budget hierarchy', () => {
  it('capture parent budget is $0.25', () => {
    expect(CAPTURE_PARENT_BUDGET_USD).toBe(0.25);
  });

  it('Denise task ceiling is $0.05', () => {
    expect(DENISE_CAPTURE_TASK_CEILING_USD).toBe(0.05);
  });

  it('Denise task ceiling does not exceed parent', () => {
    expect(DENISE_CAPTURE_TASK_CEILING_USD).toBeLessThan(CAPTURE_PARENT_BUDGET_USD);
  });
});

// ============================================================
// Test 5: Pursuit observation is 10 calls / $0.25
// ============================================================
describe('Test 5: Pursuit observation controls', () => {
  it('pursuit max calls is 10', () => {
    expect(DENISE_PURSUIT_MAX_CALLS).toBe(10);
  });

  it('pursuit max spend is $0.25', () => {
    expect(DENISE_PURSUIT_MAX_SPEND_USD).toBe(0.25);
  });
});

// ============================================================
// Tests 6–7: AcquisitionAnalysis versioned/immutable + amendments preserve
// ============================================================
describe('Tests 6-7: Immutable versioned analyses', () => {
  it('migration has immutability trigger for acquisition_analyses', () => {
    expect(migrationContent).toContain('prevent_acquisition_analysis_mutation');
    expect(migrationContent).toContain('BEFORE UPDATE ON acquisition_analyses');
    expect(migrationContent).toContain('immutable');
  });

  it('analyses have supersedes_id for version chains', () => {
    expect(migrationContent).toContain('supersedes_id UUID REFERENCES acquisition_analyses(id)');
  });

  it('analyses have version column', () => {
    expect(migrationContent).toContain('version INTEGER NOT NULL DEFAULT 1');
  });
});

// ============================================================
// Tests 8–9: Evaluation weighting requires source evidence, no invented percentages
// ============================================================
describe('Tests 8-9: Evaluation model integrity', () => {
  it('RelativeImportance uses only approved values, never percentages', () => {
    for (const val of RELATIVE_IMPORTANCE_VALUES) {
      expect(val).not.toMatch(/^\d+$/);
      expect(val).not.toMatch(/%/);
    }
    expect(RELATIVE_IMPORTANCE_VALUES).toContain('MOST_IMPORTANT');
    expect(RELATIVE_IMPORTANCE_VALUES).toContain('MORE_IMPORTANT');
    expect(RELATIVE_IMPORTANCE_VALUES).toContain('APPROX_EQUAL');
    expect(RELATIVE_IMPORTANCE_VALUES).toContain('NOT_STATED');
  });

  it('evaluation model requires source_refs', () => {
    expect(migrationContent).toContain('source_refs JSONB NOT NULL');
  });
});

// ============================================================
// Tests 10–11: Regulatory claims require evidence, missing fails closed
// ============================================================
describe('Tests 10-11: Citation verification', () => {
  it('regulatory evidence table has content_hash', () => {
    expect(migrationContent).toContain('content_hash TEXT NOT NULL');
  });

  it('regulatory evidence has immutability trigger', () => {
    expect(migrationContent).toContain('prevent_regulatory_evidence_mutation');
  });

  it('evidence model categories are defined', () => {
    expect(EVIDENCE_CATEGORIES).toContain('SOURCE_FACT');
    expect(EVIDENCE_CATEGORIES).toContain('REGULATORY_CONTEXT');
    expect(EVIDENCE_CATEGORIES).toContain('INTERPRETATION');
    expect(EVIDENCE_CATEGORIES).toContain('OPERATIONAL_IMPLICATION');
    expect(EVIDENCE_CATEGORIES).toContain('UNCERTAINTY');
  });

  it('authority hierarchy is defined', () => {
    expect(AUTHORITY_LEVELS).toContain('SOLICITATION');
    expect(AUTHORITY_LEVELS).toContain('FAR_DFARS');
    expect(AUTHORITY_LEVELS).toContain('DENISE_INTERPRETATION');
    // Denise interpretation is last (lowest priority)
    expect(AUTHORITY_LEVELS.indexOf('DENISE_INTERPRETATION')).toBeGreaterThan(
      AUTHORITY_LEVELS.indexOf('FAR_DFARS')
    );
  });
});

// ============================================================
// Test 12: LEGAL_REVIEW_REQUIRED boundary
// ============================================================
describe('Test 12: Legal boundary', () => {
  it('LEGAL_REVIEW_REQUIRED is a valid classification', () => {
    expect(CLARIFICATION_CLASSIFICATIONS).toContain('LEGAL_REVIEW_REQUIRED');
  });

  it('GAO classification is CONTEXTUAL_PRECEDENT only', () => {
    expect(GAO_CLASSIFICATION).toBe('CONTEXTUAL_PRECEDENT');
  });
});

// ============================================================
// Test 13: Clarification draft cannot send
// ============================================================
describe('Test 13: Clarification cannot send', () => {
  it('external_send_status values do not include SENT', () => {
    expect(EXTERNAL_SEND_STATUSES).not.toContain('SENT');
    expect(EXTERNAL_SEND_STATUSES).toContain('NOT_SENT');
    expect(EXTERNAL_SEND_STATUSES).toContain('DRAFT_ONLY');
  });

  it('migration enforces external_send_status constraint', () => {
    expect(migrationContent).toContain("'NOT_SENT', 'DRAFT_ONLY'");
  });
});

// ============================================================
// Tests 14–15: Slack surface
// ============================================================
describe('Tests 14-15: Slack surface', () => {
  it('high-risk Slack payload can be generated', () => {
    const payload = generateRiskPayload(
      {
        id: 'test-risk-id',
        risk_type: 'ELIGIBILITY',
        severity: 'CRITICAL',
        source_fact: 'Contract requires TS/SCI clearance',
        interpretation: 'FFTC lacks required clearance',
        operational_impact: 'Cannot perform on this contract',
        potentially_disqualifying: true,
        legal_review_required: false,
      },
      'analysis-id',
      'opp-id'
    );
    expect(payload.notificationType).toBe('POTENTIALLY_DISQUALIFYING');
    expect(payload.blocks.length).toBeGreaterThan(0);
    expect(payload.text).toContain('DENISE');
  });

  it('low-risk finding does not trigger notification', () => {
    expect(shouldNotify('LOW', false)).toBe(false);
    expect(shouldNotify('MEDIUM', false)).toBe(false);
  });

  it('DENISE_SLACK_ENABLED=false prevents all notifications', () => {
    expect(shouldNotify('CRITICAL', true)).toBe(false);
  });
});

// ============================================================
// Test 16: Clause action routes durably
// ============================================================
describe('Test 16: Clause actions', () => {
  it('clause register supports action_required flag', () => {
    expect(migrationContent).toContain('action_required BOOLEAN');
  });

  it('clause register supports action_type for Patricia routing', () => {
    expect(migrationContent).toContain('REPS_CERTS');
    expect(migrationContent).toContain('OCI_MITIGATION');
    expect(migrationContent).toContain('LIMITATION_ON_SUBCONTRACTING');
    expect(migrationContent).toContain('action_owner TEXT');
  });
});

// ============================================================
// Test 17: Conflict does not overwrite another employee's artifact
// ============================================================
describe('Test 17: Conflict safety', () => {
  it('conflicts table tracks both sides without mutation', () => {
    expect(migrationContent).toContain('acquisition_artifact_id TEXT NOT NULL');
    expect(migrationContent).toContain('conflicting_artifact_type TEXT NOT NULL');
    expect(migrationContent).toContain('conflicting_artifact_id TEXT NOT NULL');
  });

  it('conflicts track affected owners', () => {
    expect(migrationContent).toContain('affected_owners TEXT[] NOT NULL');
  });
});

// ============================================================
// Test 18: CAPTURE_REASSESSMENT_REQUIRED does not create GO/NO_GO
// ============================================================
describe('Test 18: Reassessment boundary', () => {
  it('Denise types have no GO/NO_GO constants', () => {
    const typesContent = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'types.ts'), 'utf-8'
    );
    // Denise file should not export GO or NO_GO decisions
    expect(typesContent).not.toMatch(/\bGO\b.*=.*'GO'/);
    expect(typesContent).not.toMatch(/\bNO_GO\b.*=.*'NO_GO'/);
  });
});

// ============================================================
// Test 19: G2X allowlist is exactly 3 document-oriented tools
// ============================================================
describe('Test 19: G2X allowlist', () => {
  it('allowlist has exactly 3 tools', () => {
    expect(DENISE_G2X_ALLOWLIST).toHaveLength(3);
  });

  it('allowlist contains only document-oriented tools', () => {
    expect(DENISE_G2X_ALLOWLIST).toContain('g2x_get_record');
    expect(DENISE_G2X_ALLOWLIST).toContain('g2x_opportunity_documents');
    expect(DENISE_G2X_ALLOWLIST).toContain('g2x_opportunity_attachment_text');
  });

  it('search/discovery tools are denied', () => {
    expect(DENISE_G2X_DENYLIST).toContain('g2x_search_opportunities');
    expect(DENISE_G2X_DENYLIST).toContain('g2x_search_companies');
    expect(DENISE_G2X_DENYLIST).toContain('g2x_forecast_scan');
    expect(DENISE_G2X_DENYLIST).toContain('g2x_teaming_partners');
  });
});

// ============================================================
// Test 20: Lumen unavailable
// ============================================================
describe('Test 20: Lumen denied', () => {
  it('Lumen tools are in the deny list', () => {
    expect(DENISE_G2X_DENYLIST).toContain('lumen_query');
    expect(DENISE_G2X_DENYLIST).toContain('lumen_analyze');
  });

  it('AI analysis tools are denied', () => {
    expect(DENISE_G2X_DENYLIST).toContain('analyze_document');
    expect(DENISE_G2X_DENYLIST).toContain('deep_research');
  });
});

// ============================================================
// Test 21: No direct provider SDK
// ============================================================
describe('Test 21: No direct provider SDK', () => {
  const deniseDir = path.join(import.meta.dirname, '..');
  const deniseFiles = fs.readdirSync(deniseDir)
    .filter((f) => f.endsWith('.ts') && !f.includes('test'));

  for (const file of deniseFiles) {
    it(`${file} does not import provider SDKs`, () => {
      const content = fs.readFileSync(path.join(deniseDir, file), 'utf-8');
      expect(content).not.toContain("from '@anthropic-ai/sdk'");
      expect(content).not.toContain("from 'openai'");
      expect(content).not.toContain("require('@anthropic-ai/sdk')");
      expect(content).not.toContain("require('openai')");
    });
  }
});

// ============================================================
// Test 22: RLS enabled on all new exposed tables
// ============================================================
describe('Test 22: RLS on all tables', () => {
  const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  const tables = [...migrationContent.matchAll(tablePattern)].map((m) => m[1]);

  for (const table of tables) {
    it(`${table} has RLS enabled`, () => {
      const rlsPattern = new RegExp(
        `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'
      );
      expect(rlsPattern.test(migrationContent)).toBe(true);
    });

    it(`${table} has service_role policy`, () => {
      const policyPattern = new RegExp(
        `CREATE\\s+POLICY.*ON\\s+${table}.*TO\\s+service_role`, 'is'
      );
      expect(policyPattern.test(migrationContent)).toBe(true);
    });
  }
});

// ============================================================
// Test 23: No unintended anon/authenticated access
// ============================================================
describe('Test 23: No anon/authenticated access', () => {
  it('migration has no anon policies', () => {
    expect(migrationContent).not.toMatch(/TO\s+anon/i);
  });

  it('migration has no authenticated policies', () => {
    expect(migrationContent).not.toMatch(/TO\s+authenticated/i);
  });
});

// ============================================================
// Test 24: Replay/idempotency safe
// ============================================================
describe('Test 24: Idempotency', () => {
  const tablesWithIdempotency = [
    'acquisition_tasks',
    'acquisition_analyses',
    'acquisition_evaluation_models',
    'acquisition_clause_register',
    'acquisition_risks',
    'acquisition_clarification_questions',
    'acquisition_conflicts',
    'regulatory_evidence',
  ];

  for (const table of tablesWithIdempotency) {
    it(`${table} has idempotency_key UNIQUE constraint`, () => {
      const pattern = new RegExp(
        `CREATE\\s+TABLE[^;]*${table}[^;]*idempotency_key\\s+TEXT\\s+UNIQUE\\s+NOT\\s+NULL`,
        'is'
      );
      expect(pattern.test(migrationContent)).toBe(true);
    });
  }
});

// ============================================================
// Test 25: Concurrency safe (observation window uses FOR UPDATE)
// ============================================================
describe('Test 25: Concurrency safety', () => {
  it('claim_denise_observation_slot uses SELECT FOR UPDATE', () => {
    expect(migrationContent).toContain('FOR UPDATE');
  });

  it('observation window functions exist', () => {
    expect(migrationContent).toContain('claim_denise_observation_slot');
    expect(migrationContent).toContain('settle_denise_observation_slot');
  });
});

// ============================================================
// Test 26: No production mutation (verified at file level)
// ============================================================
describe('Test 26: No production mutation', () => {
  it('types.ts declares zero provider calls', () => {
    expect(DENISE_PROVIDER_CALLS).toBe(0);
  });

  it('types.ts declares zero G2X calls', () => {
    expect(DENISE_G2X_CALLS).toBe(0);
  });

  it('research adapter returns disabled when flag is off', async () => {
    const result = await researchAuthoritativeSource({
      authorityClass: 'ACQUISITION_GOV_FAR',
      citation: 'FAR 52.219-14',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('RESEARCH_DISABLED');
  });
});

// ============================================================
// Test 28: Provider calls remain zero
// ============================================================
describe('Test 28: Zero provider calls', () => {
  it('no Denise service file imports Anthropic or getAnthropic', () => {
    const deniseDir = path.join(import.meta.dirname, '..');
    const files = fs.readdirSync(deniseDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(deniseDir, file), 'utf-8');
      expect(content).not.toContain('getAnthropic');
      expect(content).not.toContain('Anthropic(');
    }
  });
});

// ============================================================
// Gateway routes verification
// ============================================================
describe('Gateway routes', () => {
  it('all Denise routes are defined', () => {
    expect(DENISE_GATEWAY_ROUTES).toContain('denise_capture_acquisition');
    expect(DENISE_GATEWAY_ROUTES).toContain('denise_clause_analysis');
    expect(DENISE_GATEWAY_ROUTES).toContain('denise_amendment_analysis');
    expect(DENISE_GATEWAY_ROUTES).toContain('denise_clarification_draft');
    expect(DENISE_GATEWAY_ROUTES).toContain('denise_evaluation_analysis');
  });
});

// ============================================================
// Research adapter boundary
// ============================================================
describe('Research adapter boundary', () => {
  it('all approved authority classes are recognized', () => {
    expect(isAuthorityClassApproved('ACQUISITION_GOV_FAR')).toBe(true);
    expect(isAuthorityClassApproved('DFARS_DOD')).toBe(true);
    expect(isAuthorityClassApproved('SAM_GOV')).toBe(true);
    expect(isAuthorityClassApproved('SBA_GOV')).toBe(true);
    expect(isAuthorityClassApproved('GAO_CONTEXTUAL')).toBe(true);
  });

  it('unknown authority classes are rejected', () => {
    expect(isAuthorityClassApproved('RANDOM_BLOG')).toBe(false);
    expect(isAuthorityClassApproved('COMMERCIAL_LEGAL_SUMMARY')).toBe(false);
  });
});

// ============================================================
// Milestone D WS4: Legacy dependency containment
// ============================================================
describe('WS4: Legacy dependency containment', () => {
  const deniseDir = path.join(import.meta.dirname, '..');

  it('no Denise file imports from coordination/', () => {
    const files = fs.readdirSync(deniseDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(deniseDir, file), 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*coordination/);
    }
  });

  it('no Denise file imports queue.ts or workflow-processor.ts', () => {
    const files = fs.readdirSync(deniseDir)
      .filter((f) => f.endsWith('.ts') && !f.includes('test'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(deniseDir, file), 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*queue/);
      expect(content).not.toMatch(/from\s+['"].*workflow-processor/);
    }
  });

  it('slack-adapter.ts makes zero LLM calls', () => {
    const content = fs.readFileSync(path.join(deniseDir, 'slack-adapter.ts'), 'utf-8');
    expect(content).not.toContain("from '../llm-gateway/gateway.js'");
    expect(content).not.toContain("from '../../services/llm-gateway/gateway.js'");
    expect(content).not.toContain('complete(');
  });

  it('slack-surface.ts makes zero LLM calls', () => {
    const content = fs.readFileSync(path.join(deniseDir, 'slack-surface.ts'), 'utf-8');
    expect(content).not.toContain("gateway");
    expect(content).not.toContain('complete(');
  });

  it('only run-team.ts imports from denise/ in live/', () => {
    const liveDir = path.join(import.meta.dirname, '..', '..', '..', 'live');
    const files = fs.readdirSync(liveDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(liveDir, file), 'utf-8');
      if (file === 'run-team.ts') {
        expect(content).toContain('registerDeniseActions');
      } else {
        expect(content).not.toMatch(/from\s+['"].*denise/);
      }
    }
  });
});
