/**
 * Jodie Safety Invariants
 *
 * Static analysis tests verifying Jodie's deterministic proposal
 * foundation follows all safety constraints. No database required.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const JODIE_DIR = path.resolve(import.meta.dirname, '..');

function getJodieSourceFiles(): string[] {
  return fs.readdirSync(JODIE_DIR)
    .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
    .map(f => path.join(JODIE_DIR, f));
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('Jodie Safety Invariants', () => {
  it('INV-01: no direct Anthropic/OpenAI imports', () => {
    for (const file of getJodieSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain("from '@anthropic-ai/sdk'");
      expect(content).not.toContain("from 'openai'");
      expect(content).not.toContain("require('anthropic')");
      expect(content).not.toContain("require('openai')");
    }
  });

  it('INV-02: no LLM gateway imports in deterministic files (reasoning.ts is authorized)', () => {
    for (const file of getJodieSourceFiles()) {
      if (file.endsWith('reasoning.ts')) continue; // authorized reasoning layer
      const content = readFile(file);
      expect(content).not.toContain("from '../../llm-gateway");
      expect(content).not.toContain("from '../llm-gateway");
      expect(content).not.toContain("gateway.complete");
    }
  });

  it('INV-03: no G2X imports', () => {
    for (const file of getJodieSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain("from '../../g2x");
      expect(content).not.toContain("from '../g2x");
    }
  });

  it('INV-04: no external outreach', () => {
    for (const file of getJodieSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain('nodemailer');
      expect(content).not.toContain('sendEmail');
      expect(content).not.toContain('twilio');
    }
  });

  it('INV-05: no Slack posting utilities in service files', () => {
    for (const file of getJodieSourceFiles()) {
      const content = readFile(file);
      expect(content).not.toContain("from '../../integrations/slack");
      expect(content).not.toContain('postAsAgent');
      expect(content).not.toContain('replyInThread');
    }
  });

  it('INV-06: all writing modules use idempotency keys', () => {
    const writingModules = [
      'compliance-matrix.ts', 'evidence-library.ts', 'section-manager.ts',
      'claim-tracker.ts', 'form-manager.ts', 'readiness-gate.ts',
      'amendment-handler.ts', 'storage.ts',
    ];
    for (const mod of writingModules) {
      const filePath = path.join(JODIE_DIR, mod);
      if (!fs.existsSync(filePath)) continue;
      expect(readFile(filePath)).toContain('idempotency');
    }
  });

  it('INV-07: JODIE_PROVIDER_CALLS = 0', () => {
    const content = readFile(path.join(JODIE_DIR, 'types.ts'));
    expect(content).toContain('JODIE_PROVIDER_CALLS = 0');
  });

  it('INV-08: JODIE_G2X_CALLS = 0', () => {
    const content = readFile(path.join(JODIE_DIR, 'types.ts'));
    expect(content).toContain('JODIE_G2X_CALLS = 0');
  });

  it('INV-09: MAX_AUTONOMOUS_PASSES = 2', () => {
    const content = readFile(path.join(JODIE_DIR, 'types.ts'));
    expect(content).toContain('MAX_AUTONOMOUS_PASSES = 2');
  });

  it('INV-10: feature flags default to false', async () => {
    const { getFeatureFlag, FEATURE_FLAGS } = await import('../../../config/ai-controls.js');
    expect(getFeatureFlag(FEATURE_FLAGS.JODIE_COMPLIANCE_ENABLED)).toBe(false);
    expect(getFeatureFlag(FEATURE_FLAGS.JODIE_DRAFTING_ENABLED)).toBe(false);
    expect(getFeatureFlag(FEATURE_FLAGS.JODIE_DOCUMENT_RENDERING_ENABLED)).toBe(false);
    expect(getFeatureFlag(FEATURE_FLAGS.JODIE_SLACK_ENABLED)).toBe(false);
  });

  it('INV-11: section version immutability in migration', () => {
    const migDir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
    const migFile = fs.readdirSync(migDir).find(f => f.includes('jodie_proposal'));
    expect(migFile).toBeDefined();
    const content = readFile(path.join(migDir, migFile!));
    expect(content).toContain('prevent_section_version_mutation');
    expect(content).toContain('trg_psv_no_update');
    expect(content).toContain('trg_psv_no_delete');
  });

  it('INV-12: RLS on all Jodie proposal tables', () => {
    const migDir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
    const migFile = fs.readdirSync(migDir).find(f => f.includes('jodie_proposal'));
    expect(migFile).toBeDefined();
    const content = readFile(path.join(migDir, migFile!));
    const tables = [
      'proposal_requirements', 'proposal_evidence_items', 'proposal_sections',
      'proposal_section_versions', 'proposal_claims', 'proposal_reviews',
      'proposal_specialist_requests', 'proposal_conflicts', 'proposal_pricing_inputs',
      'proposal_form_mappings', 'proposal_form_values', 'proposal_rendered_artifacts',
      'proposal_file_versions', 'proposal_submission_checklist',
      'proposal_amendment_impacts', 'jodie_observation_windows',
    ];
    for (const table of tables) {
      expect(content).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(content).toContain(`GRANT ALL ON ${table} TO service_role`);
    }
  });

  it('INV-13: no production project ID in Jodie source files', () => {
    const PROD_ID = 'bvgtfadggtgnakrxvuim';
    for (const file of getJodieSourceFiles()) {
      expect(readFile(file)).not.toContain(PROD_ID);
    }
  });

  it('INV-14: canJodieRevise checks lock and pass count', () => {
    const content = readFile(path.join(JODIE_DIR, 'section-manager.ts'));
    expect(content).toContain('locked');
    expect(content).toContain('pass_count');
    expect(content).toContain('MAX_AUTONOMOUS_PASSES');
  });

  it('INV-15: evidence approval gate for past performance and resumes', () => {
    const content = readFile(path.join(JODIE_DIR, 'evidence-library.ts'));
    expect(content).toContain('proposal_usable');
    expect(content).toContain('human_verified');
  });

  it('INV-16: READY_TO_SUBMIT requires compliance, evidence, and production gates', () => {
    const content = readFile(path.join(JODIE_DIR, 'readiness-gate.ts'));
    expect(content).toContain('COMPLIANCE');
    expect(content).toContain('EVIDENCE');
    expect(content).toContain('PRODUCTION');
    expect(content).toContain('UNSUPPORTED');
    expect(content).toContain('stale');
  });

  it('INV-17: MATERIAL_GLOBAL amendment emits reassessment state', () => {
    const content = readFile(path.join(JODIE_DIR, 'amendment-handler.ts'));
    expect(content).toContain('MATERIAL_GLOBAL');
    expect(content).toContain('CAPTURE_REASSESSMENT_REQUIRED');
  });

  it('INV-18: storage bucket is private', () => {
    const content = readFile(path.join(JODIE_DIR, 'storage.ts'));
    expect(content).toContain('proposal-artifacts');
    expect(content).not.toContain('public');
  });

  it('INV-19: observation window defaults to INACTIVE', () => {
    const migDir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
    const migFile = fs.readdirSync(migDir).find(f => f.includes('jodie_proposal'));
    const content = readFile(path.join(migDir, migFile!));
    expect(content).toContain("DEFAULT 'INACTIVE'");
  });

  it('INV-20: proposal_workspaces is reused, not duplicated', () => {
    const migDir = path.resolve(import.meta.dirname, '../../../../supabase/migrations');
    const migFile = fs.readdirSync(migDir).find(f => f.includes('jodie_proposal'));
    const content = readFile(path.join(migDir, migFile!));
    // References proposal_workspaces as FK, does not recreate it
    expect(content).toContain('REFERENCES proposal_workspaces(id)');
    // Count CREATE TABLE statements — should NOT include proposal_workspaces
    const createTables = content.match(/CREATE TABLE IF NOT EXISTS proposal_workspaces/g);
    expect(createTables).toBeNull();
  });
});
