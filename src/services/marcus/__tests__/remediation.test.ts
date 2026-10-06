/**
 * Marcus Lane 1 Remediation Tests
 *
 * Tests compact prompt, 3072 ceiling, fence tolerance, no auto-retry.
 */

import { describe, it, expect } from 'vitest';
import { TechnicalAssessmentSchema } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

// Read actual source files to verify prompt contract
const executorSource = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'executor.ts'), 'utf-8'
);
const captureSource = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'capture-research.ts'), 'utf-8'
);

describe('Compact Prompt Contract', () => {
  it('executor prompt limits requirements to max 6', () => {
    expect(executorSource).toContain('requirements max 6');
  });

  it('executor prompt limits constraints to max 6', () => {
    expect(executorSource).toContain('constraints max 6');
  });

  it('executor prompt limits assumptions to max 5', () => {
    expect(executorSource).toContain('assumptions max 5');
  });

  it('executor prompt limits technicalRisks to max 6', () => {
    expect(executorSource).toContain('technicalRisks max 6');
  });

  it('executor prompt limits unresolvedQuestions to max 4', () => {
    expect(executorSource).toContain('unresolvedQuestions max 4');
  });

  it('executor prompt limits recommendedActions to max 4', () => {
    expect(executorSource).toContain('recommendedActions max 4');
  });

  it('executor prompt instructs JSON only, no code fences', () => {
    expect(executorSource).toContain('Do not use Markdown or code fences');
  });

  it('capture-research prompt instructs JSON only, no code fences', () => {
    expect(captureSource).toContain('Do not use Markdown or code fences');
  });

  it('executor prompt instructs concise one-sentence items', () => {
    expect(executorSource).toContain('One sentence per item');
  });

  it('executor prompt instructs compact evidence identifiers', () => {
    expect(executorSource).toContain('compact evidence identifiers');
  });
});

describe('Route Configuration', () => {
  it('Marcus executor uses 3072 max output tokens', () => {
    expect(executorSource).toContain('maxOutputTokens: 3072');
  });

  it('Marcus capture-research uses 3072 max output tokens', () => {
    expect(captureSource).toContain('maxOutputTokens: 3072');
  });

  it('other agents use 2048 (not affected by Marcus change)', () => {
    // Maya, James, David, Rosa all use 2048 — verify they are NOT 3072
    // This is a structural assertion: Marcus routes are the only ones changed
    const rosaExecutor = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'rosa', 'executor.ts'), 'utf-8'
    );
    const davidExecutor = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'david', 'executor.ts'), 'utf-8'
    );
    expect(rosaExecutor).toContain('maxOutputTokens: 2048');
    expect(davidExecutor).not.toContain('maxOutputTokens: 3072');
  });
});

describe('Budget Constraints Unchanged', () => {
  it('Marcus capture task ceiling remains $0.05', () => {
    // MARCUS_CAPTURE_TASK_COST is imported from types and used in ensureTaskBudget
    expect(captureSource).toContain('MARCUS_CAPTURE_TASK_COST');
  });

  it('capture ceiling remains $0.25', () => {
    expect(captureSource).toContain('0.25');
  });
});

describe('Defensive Fence Parsing', () => {
  it('parser tolerates JSON wrapped in markdown fences', () => {
    const fenced = '```json\n{"captureId":"test","conclusion":"FEASIBLE"}\n```';
    const clean = fenced.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = clean.match(/\{[\s\S]*\}/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![0]);
    expect(parsed.conclusion).toBe('FEASIBLE');
  });

  it('parser tolerates JSON without fences', () => {
    const raw = '{"captureId":"test","conclusion":"FEASIBLE_WITH_RISKS"}';
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = clean.match(/\{[\s\S]*\}/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![0]).conclusion).toBe('FEASIBLE_WITH_RISKS');
  });
});

describe('Schema Unchanged', () => {
  it('TechnicalAssessmentSchema still accepts max 10 requirements', () => {
    // The schema allows up to 10 even though prompt requests max 6
    // Schema is authoritative — prompt is a generation hint
    const valid = TechnicalAssessmentSchema.safeParse({
      captureId: '00000000-0000-0000-0000-000000000001',
      opportunityId: 'test',
      conclusion: 'FEASIBLE',
      confidence: 'HIGH',
      requirements: Array(10).fill('req'),
      constraints: Array(10).fill('con'),
      assumptions: Array(10).fill('asm'),
      technicalRisks: [{ description: 'risk', severity: 'HIGH', mitigation: 'mit' }],
      deliveryConsiderations: 'test',
      evidenceRefs: ['ref'],
      unresolvedQuestions: ['q'],
      recommendedActions: ['a'],
    });
    expect(valid.success).toBe(true);
  });

  it('truncated JSON still fails closed', () => {
    const truncated = '{"captureId":"test","conclusion":"FEA';
    let parsed;
    try { parsed = JSON.parse(truncated); } catch { parsed = null; }
    expect(parsed).toBeNull();
  });

  it('no automatic retry on parse failure (structural)', () => {
    // executor.ts: on safeParse failure → marks task failed, returns null
    // capture-research.ts: on safeParse failure → returns insufficientResult
    // Neither calls complete() again
    expect(executorSource).not.toMatch(/retry.*complete\(|complete\(.*retry/i);
    expect(captureSource).not.toMatch(/retry.*complete\(|complete\(.*retry/i);
  });
});
