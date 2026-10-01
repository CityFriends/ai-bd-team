/**
 * Model Lifecycle Tests
 */
import { describe, it, expect } from 'vitest';
import { checkModelLifecycle, MODEL_LIFECYCLE } from '../model-lifecycle.js';

describe('Model Lifecycle Controls', () => {
  it('warns at 30 days from retirement boundary', () => {
    // Haiku 4.5 boundary is Oct 15, 2026
    // If today is ~Oct 1, that's ~14 days
    const warnings = checkModelLifecycle(['claude-haiku-4-5-20251001']);
    // Should produce a warning since boundary is within 30 days
    const haiku = warnings.find((w) => w.includes('claude-haiku-4-5-20251001'));
    expect(haiku).toBeTruthy();
  });

  it('does NOT auto-switch models', () => {
    const warnings = checkModelLifecycle(['claude-haiku-4-5-20251001']);
    // Warnings are informational only — no "switching to" or "migrated" language
    for (const w of warnings) {
      expect(w).not.toContain('switching');
      expect(w).not.toContain('migrated');
      expect(w).not.toContain('auto');
    }
  });

  it('reports unknown models', () => {
    const warnings = checkModelLifecycle(['unknown-model-xyz']);
    expect(warnings.some((w) => w.includes('UNKNOWN'))).toBe(true);
  });

  it('commissioned Haiku 4.5 has lifecycle entry', () => {
    const entry = MODEL_LIFECYCLE.find((e) => e.modelId === 'claude-haiku-4-5-20251001');
    expect(entry).toBeTruthy();
    expect(entry?.lifecycleState).toBe('active');
    expect(entry?.retirementBoundary).toBe('2026-10-15');
  });

  it('Sonnet 4.6 has lifecycle entry for future use', () => {
    const entry = MODEL_LIFECYCLE.find((e) => e.modelId === 'claude-sonnet-4-6');
    expect(entry).toBeTruthy();
    expect(entry?.lifecycleState).toBe('active');
  });

  it('lifecycle check never modifies model entries', () => {
    const before = JSON.stringify(MODEL_LIFECYCLE);
    checkModelLifecycle(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6']);
    const after = JSON.stringify(MODEL_LIFECYCLE);
    expect(before).toBe(after);
  });
});
