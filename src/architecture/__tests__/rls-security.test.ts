/**
 * RLS Security Regression Tests
 *
 * Prevents future migrations from introducing exposed tables without RLS.
 * Tests migration SQL files to ensure all application tables enable RLS.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', '..', 'supabase', 'migrations');

// Read all migration files
function getMigrationFiles(): Array<{ name: string; content: string }> {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((name) => ({
    name,
    content: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf-8'),
  }));
}

// Extract CREATE TABLE statements from SQL
function extractTableNames(sql: string): string[] {
  const matches = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi);
  return [...matches].map((m) => m[1]);
}

describe('RLS Security: All Application Tables', () => {
  const migrations = getMigrationFiles();

  it('every migration that creates tables also enables RLS', () => {
    const violations: string[] = [];

    for (const { name, content } of migrations) {
      const tables = extractTableNames(content);
      for (const table of tables) {
        // Check if this migration enables RLS for this table
        const rlsPattern = new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        );
        if (!rlsPattern.test(content)) {
          violations.push(`${name}: table '${table}' created without ENABLE ROW LEVEL SECURITY`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('commissioned migrations (2026-09+) create service_role policies for all tables', () => {
    // Legacy migrations (pre-2026-09) predate the current RLS architecture
    // and are not required to have service_role policies
    const commissionedMigrations = migrations.filter((m) =>
      m.name >= '20260928'
    );
    const violations: string[] = [];

    for (const { name, content } of commissionedMigrations) {
      const tables = extractTableNames(content);
      for (const table of tables) {
        const policyPattern = new RegExp(
          `CREATE\\s+POLICY.*ON\\s+${table}.*TO\\s+service_role`,
          'is'
        );
        if (!policyPattern.test(content)) {
          violations.push(`${name}: table '${table}' has no service_role policy`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('RLS Security: Credential Tables', () => {
  it('external_integration_credentials has RLS in migration', () => {
    const migration = getMigrationFiles().find((f) =>
      f.name.includes('external_credentials')
    );
    expect(migration).toBeDefined();
    expect(migration!.content).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration!.content).toContain('service_role');
  });

  it('external_integration_credentials has no anon policy in migration', () => {
    const migration = getMigrationFiles().find((f) =>
      f.name.includes('external_credentials')
    );
    expect(migration!.content).not.toMatch(/TO\s+anon/i);
  });
});

describe('RLS Security: System Controls', () => {
  it('system_controls has RLS in migration', () => {
    const migration = getMigrationFiles().find((f) =>
      f.name.includes('system_controls')
    );
    expect(migration).toBeDefined();
    expect(migration!.content).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('system_controls has service_role policy', () => {
    const migration = getMigrationFiles().find((f) =>
      f.name.includes('system_controls')
    );
    expect(migration!.content).toContain('service_role');
  });
});

describe('RLS Security: No Broad Anonymous Policies', () => {
  it('no migration creates a policy for anon role', () => {
    const violations: string[] = [];

    for (const { name, content } of getMigrationFiles()) {
      if (/CREATE\s+POLICY.*TO\s+anon/i.test(content)) {
        violations.push(`${name}: creates a policy for anon role`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no migration creates a policy for authenticated role', () => {
    const violations: string[] = [];

    for (const { name, content } of getMigrationFiles()) {
      if (/CREATE\s+POLICY.*TO\s+authenticated/i.test(content)) {
        violations.push(`${name}: creates a policy for authenticated role`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('RLS Security: Agent-Specific Tables', () => {
  const agentMigrations = [
    { agent: 'Maya', pattern: 'maya_production' },
    { agent: 'James', pattern: 'james_capture' },
    { agent: 'David', pattern: 'david_intelligence' },
    { agent: 'Rosa', pattern: 'rosa_intelligence' },
    { agent: 'Marcus', pattern: 'marcus_intelligence' },
    { agent: 'G2X Research', pattern: 'g2x_research' },
    { agent: 'G2X Credentials', pattern: 'external_credentials' },
    { agent: 'G2X Enrichment', pattern: 'g2x_enrichment' },
  ];

  for (const { agent, pattern } of agentMigrations) {
    it(`${agent} migration enables RLS on all tables`, () => {
      const migration = getMigrationFiles().find((f) => f.name.includes(pattern));
      if (!migration) return; // Migration may not exist yet

      const tables = extractTableNames(migration.content);
      for (const table of tables) {
        const hasRLS = new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
          'i'
        ).test(migration.content);

        expect(hasRLS).toBe(true);
      }
    });
  }
});
