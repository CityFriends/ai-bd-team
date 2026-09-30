/**
 * Environment Safety Guard Tests
 *
 * Proves: commissioning → allowed, production → HARD FAIL,
 * unknown → HARD FAIL, no override can bypass production block.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('Environment Safety Guards', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('identifies production environment', async () => {
    process.env.SUPABASE_URL = 'https://bvgtfadggtgnakrxvuim.supabase.co';
    const { getEnvironmentRole } = await import('../environment.js');
    expect(getEnvironmentRole()).toBe('production');
  });

  it('identifies commissioning environment', async () => {
    process.env.SUPABASE_URL = 'https://nnwddilewgbsmyouatzu.supabase.co';
    const { getEnvironmentRole } = await import('../environment.js');
    expect(getEnvironmentRole()).toBe('commissioning');
  });

  it('identifies unknown environment', async () => {
    process.env.SUPABASE_URL = 'https://xyzunknownproject.supabase.co';
    const { getEnvironmentRole } = await import('../environment.js');
    expect(getEnvironmentRole()).toBe('unknown');
  });

  it('commissioning project → allowed', async () => {
    process.env.SUPABASE_URL = 'https://nnwddilewgbsmyouatzu.supabase.co';
    const { assertCommissioningEnvironment } = await import('../environment.js');
    expect(() => assertCommissioningEnvironment()).not.toThrow();
  });

  it('production project → HARD FAIL (no override possible)', async () => {
    process.env.SUPABASE_URL = 'https://bvgtfadggtgnakrxvuim.supabase.co';
    const { assertCommissioningEnvironment } = await import('../environment.js');
    expect(() => assertCommissioningEnvironment()).toThrow('PRODUCTION');
    expect(() => assertCommissioningEnvironment()).toThrow('No override');
  });

  it('unknown project → HARD FAIL', async () => {
    process.env.SUPABASE_URL = 'https://xyzunknown.supabase.co';
    const { assertCommissioningEnvironment } = await import('../environment.js');
    expect(() => assertCommissioningEnvironment()).toThrow('unknown');
    expect(() => assertCommissioningEnvironment()).toThrow('No override');
  });

  it('setting unrelated env vars cannot override production block', async () => {
    process.env.SUPABASE_URL = 'https://bvgtfadggtgnakrxvuim.supabase.co';
    // Try every plausible override name
    process.env.ALLOW_PRODUCTION_COMMISSIONING = 'true';
    process.env.FORCE_COMMISSIONING = 'true';
    process.env.SKIP_ENV_CHECK = 'true';
    process.env.NODE_ENV = 'test';
    const { assertCommissioningEnvironment } = await import('../environment.js');
    expect(() => assertCommissioningEnvironment()).toThrow('PRODUCTION');
  });

  it('integration test guard blocks production', async () => {
    process.env.SUPABASE_URL = 'https://bvgtfadggtgnakrxvuim.supabase.co';
    const { assertIntegrationTestEnvironment } = await import('../environment.js');
    expect(() => assertIntegrationTestEnvironment()).toThrow('PRODUCTION');
    expect(() => assertIntegrationTestEnvironment()).toThrow('No override');
  });

  it('integration test guard allows commissioning', async () => {
    process.env.SUPABASE_URL = 'https://nnwddilewgbsmyouatzu.supabase.co';
    const { assertIntegrationTestEnvironment } = await import('../environment.js');
    expect(() => assertIntegrationTestEnvironment()).not.toThrow();
  });

  it('integration test guard allows unknown (non-production test DB)', async () => {
    process.env.SUPABASE_URL = 'https://sometestproject.supabase.co';
    const { assertIntegrationTestEnvironment } = await import('../environment.js');
    expect(() => assertIntegrationTestEnvironment()).not.toThrow();
  });
});
