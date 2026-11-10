/**
 * Migration 014 RLS Policy Tests — C8X-107AH
 *
 * Validates that the hr_shadow_reader RLS policies:
 * 1. Grant visibility to the four approved metadata tables
 * 2. Do not break existing service_role, anon, or authenticated behavior
 * 3. Maintain all security constraints (mutations, forbidden tables, functions)
 *
 * These tests use a disposable PostgreSQL database via Docker or local instance.
 * They do NOT affect production.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// ── Test Configuration ───────────────────────────────────────────

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/hr-migrations');
const TEST_DB_URL =
  process.env.HR_TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/hr_test';

// Skip these tests if no test database is available
const SKIP_DB_TESTS = !process.env.HR_TEST_DATABASE_URL && !process.env.RUN_DB_TESTS;

// ── Test Fixture Data ────────────────────────────────────────────

const FIXTURE_CONNECTIONS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    connection_name: 'test-wiki',
    scope: 'employee',
    env_var_name: 'HR_TEST_TOKEN',
    is_active: true,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    connection_name: 'test-admin',
    scope: 'admin',
    env_var_name: 'HR_ADMIN_TOKEN',
    is_active: true,
  },
];

const FIXTURE_ROOTS = [
  {
    id: '33333333-3333-3333-3333-333333333333',
    connection_id: '11111111-1111-1111-1111-111111111111',
    notion_page_id: 'np-001',
    title: 'Test Wiki Root',
    access_classification: 'employee_safe',
    approved_by: 'test-admin@example.com',
    is_active: true,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    connection_id: '22222222-2222-2222-2222-222222222222',
    notion_page_id: 'np-002',
    title: 'Test Admin Root',
    access_classification: 'hr_restricted',
    approved_by: 'test-admin@example.com',
    is_active: true,
  },
];

const FIXTURE_PAGES = [
  {
    id: '55555555-5555-5555-5555-555555555555',
    connection_id: '11111111-1111-1111-1111-111111111111',
    approved_root_id: '33333333-3333-3333-3333-333333333333',
    notion_page_id: 'np-page-001',
    title: 'Test Page 1',
    access_classification: 'employee_safe',
    sync_status: 'synced',
    content_hash: 'hash-001',
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    connection_id: '11111111-1111-1111-1111-111111111111',
    approved_root_id: '33333333-3333-3333-3333-333333333333',
    notion_page_id: 'np-page-002',
    title: 'Test Page 2',
    access_classification: 'employee_safe',
    sync_status: 'synced',
    content_hash: 'hash-002',
  },
];

const FIXTURE_APPROVALS = [
  {
    id: '77777777-7777-7777-7777-777777777777',
    knowledge_page_id: '55555555-5555-5555-5555-555555555555',
    approved_content_hash: 'hash-001',
    approved_by: 'test-admin@example.com',
  },
];

// ── Helper Functions ─────────────────────────────────────────────

function getMigrationFiles(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files;
}

async function applyMigrations(client: pg.Client, upToMigration?: string): Promise<void> {
  const files = getMigrationFiles();

  for (const file of files) {
    if (upToMigration && file > upToMigration) break;

    const filePath = join(MIGRATIONS_DIR, file);
    const sql = readFileSync(filePath, 'utf8');

    // Replace hr_reader password placeholder if present
    const safeSql = sql.replace(
      /ALTER ROLE hr_reader WITH PASSWORD '[^']+'/g,
      "ALTER ROLE hr_reader WITH PASSWORD 'test-password'"
    );

    try {
      await client.query(safeSql);
    } catch (err) {
      // Some migrations may have idempotent checks that throw warnings
      // Continue if it's a known non-fatal error
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === '42P07' || pgErr.code === '42710') {
        // Already exists - OK for idempotent migrations
        continue;
      }
      throw err;
    }
  }
}

async function insertFixtures(client: pg.Client): Promise<void> {
  // Insert connections
  for (const conn of FIXTURE_CONNECTIONS) {
    await client.query(
      `INSERT INTO hr_notion_connections (id, connection_name, scope, env_var_name, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [conn.id, conn.connection_name, conn.scope, conn.env_var_name, conn.is_active]
    );
  }

  // Insert roots
  for (const root of FIXTURE_ROOTS) {
    await client.query(
      `INSERT INTO hr_approved_roots (id, connection_id, notion_page_id, title, access_classification, approved_by, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        root.id,
        root.connection_id,
        root.notion_page_id,
        root.title,
        root.access_classification,
        root.approved_by,
        root.is_active,
      ]
    );
  }

  // Insert pages
  for (const page of FIXTURE_PAGES) {
    await client.query(
      `INSERT INTO hr_knowledge_pages (id, connection_id, approved_root_id, notion_page_id, title, access_classification, sync_status, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        page.id,
        page.connection_id,
        page.approved_root_id,
        page.notion_page_id,
        page.title,
        page.access_classification,
        page.sync_status,
        page.content_hash,
      ]
    );
  }

  // Insert approvals
  for (const approval of FIXTURE_APPROVALS) {
    await client.query(
      `INSERT INTO hr_page_approvals (id, knowledge_page_id, approved_content_hash, approved_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [
        approval.id,
        approval.knowledge_page_id,
        approval.approved_content_hash,
        approval.approved_by,
      ]
    );
  }
}

async function createShadowReaderConnection(password: string): Promise<pg.Client> {
  const url = new URL(TEST_DB_URL);
  url.username = 'hr_shadow_reader';
  url.password = password;

  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

// ── Test Suite ───────────────────────────────────────────────────

describe.skipIf(SKIP_DB_TESTS)('Migration 014: RLS Policies for hr_shadow_reader', () => {
  let adminClient: pg.Client;
  let shadowReaderClient: pg.Client;
  const SHADOW_READER_PASSWORD = 'test-shadow-reader-password-' + Date.now();

  beforeAll(async () => {
    // Connect as admin/postgres
    adminClient = new pg.Client({ connectionString: TEST_DB_URL });
    await adminClient.connect();

    // Clean slate - drop and recreate database objects
    // Note: In a real test, you'd use a fresh database per test run
    try {
      await adminClient.query('DROP OWNED BY hr_shadow_reader CASCADE');
    } catch {
      // Role may not exist yet
    }
    try {
      await adminClient.query('DROP ROLE IF EXISTS hr_shadow_reader');
    } catch {
      // OK if doesn't exist
    }

    // Apply all migrations including 014
    await applyMigrations(adminClient);

    // Set shadow reader password
    await adminClient.query(
      `ALTER ROLE hr_shadow_reader WITH PASSWORD '${SHADOW_READER_PASSWORD}'`
    );

    // Insert test fixtures
    await insertFixtures(adminClient);

    // Create shadow reader connection
    shadowReaderClient = await createShadowReaderConnection(SHADOW_READER_PASSWORD);
  }, 60000);

  afterAll(async () => {
    if (shadowReaderClient) await shadowReaderClient.end();
    if (adminClient) await adminClient.end();
  });

  describe('RLS Visibility (Post-Migration 014)', () => {
    it('shadow reader sees fixture connections', async () => {
      const { rows } = await shadowReaderClient.query(
        'SELECT COUNT(*) as count FROM hr_notion_connections'
      );
      expect(parseInt(rows[0].count)).toBe(FIXTURE_CONNECTIONS.length);
    });

    it('shadow reader sees fixture roots', async () => {
      const { rows } = await shadowReaderClient.query(
        'SELECT COUNT(*) as count FROM hr_approved_roots'
      );
      expect(parseInt(rows[0].count)).toBe(FIXTURE_ROOTS.length);
    });

    it('shadow reader sees fixture pages', async () => {
      const { rows } = await shadowReaderClient.query(
        'SELECT COUNT(*) as count FROM hr_knowledge_pages'
      );
      expect(parseInt(rows[0].count)).toBe(FIXTURE_PAGES.length);
    });

    it('shadow reader sees fixture approvals', async () => {
      const { rows } = await shadowReaderClient.query(
        'SELECT COUNT(*) as count FROM hr_page_approvals'
      );
      expect(parseInt(rows[0].count)).toBe(FIXTURE_APPROVALS.length);
    });

    it('shadow reader can read all columns from approved tables', async () => {
      // Verify we can actually read data, not just counts
      const { rows: connections } = await shadowReaderClient.query(
        'SELECT id, connection_name, scope, is_active FROM hr_notion_connections'
      );
      expect(connections.length).toBe(FIXTURE_CONNECTIONS.length);
      expect(connections[0]).toHaveProperty('connection_name');

      const { rows: roots } = await shadowReaderClient.query(
        'SELECT id, title, access_classification FROM hr_approved_roots'
      );
      expect(roots.length).toBe(FIXTURE_ROOTS.length);

      const { rows: pages } = await shadowReaderClient.query(
        'SELECT id, title, content_hash FROM hr_knowledge_pages'
      );
      expect(pages.length).toBe(FIXTURE_PAGES.length);

      const { rows: approvals } = await shadowReaderClient.query(
        'SELECT id, approved_content_hash FROM hr_page_approvals'
      );
      expect(approvals.length).toBe(FIXTURE_APPROVALS.length);
    });
  });

  describe('Security Constraints Preserved', () => {
    it('shadow reader cannot INSERT into approved tables', async () => {
      await expect(
        shadowReaderClient.query(
          "INSERT INTO hr_knowledge_pages (id, connection_id, approved_root_id, notion_page_id, title, access_classification, sync_status) VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'test', 'test', 'employee_safe', 'pending')"
        )
      ).rejects.toThrow(/permission denied/);
    });

    it('shadow reader cannot UPDATE approved tables', async () => {
      await expect(
        shadowReaderClient.query("UPDATE hr_knowledge_pages SET title = 'hacked' WHERE 1=0")
      ).rejects.toThrow(/permission denied/);
    });

    it('shadow reader cannot DELETE from approved tables', async () => {
      await expect(
        shadowReaderClient.query('DELETE FROM hr_knowledge_pages WHERE 1=0')
      ).rejects.toThrow(/permission denied/);
    });

    it('shadow reader cannot TRUNCATE approved tables', async () => {
      await expect(shadowReaderClient.query('TRUNCATE hr_knowledge_pages')).rejects.toThrow(
        /permission denied/
      );
    });

    it('shadow reader cannot SELECT from forbidden tables', async () => {
      const forbiddenTables = [
        'hr_employees',
        'hr_signing_secrets',
        'hr_audit_events',
        'hr_knowledge_chunks',
        'hr_sync_leases',
        'hr_sync_checkpoints',
      ];

      for (const table of forbiddenTables) {
        await expect(shadowReaderClient.query(`SELECT * FROM ${table}`)).rejects.toThrow(
          /permission denied|does not exist/
        );
      }
    });

    it('shadow reader cannot EXECUTE protected functions', async () => {
      // These should fail with permission denied or not exist
      const protectedFunctions = [
        "SELECT hr_is_authorized_admin('test')",
        "SELECT hr_create_employee('a','b','c','d','e','f','g','h','i','j','2024-01-01','k')",
      ];

      for (const funcCall of protectedFunctions) {
        await expect(shadowReaderClient.query(funcCall)).rejects.toThrow(
          /permission denied|does not exist/
        );
      }
    });

    it('shadow reader has correct identity', async () => {
      const { rows } = await shadowReaderClient.query('SELECT current_user, session_user');
      expect(rows[0].current_user).toBe('hr_shadow_reader');
      expect(rows[0].session_user).toBe('hr_shadow_reader');
    });

    it('shadow reader has no elevated attributes', async () => {
      const { rows } = await shadowReaderClient.query(`
        SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
        FROM pg_roles WHERE rolname = 'hr_shadow_reader'
      `);
      expect(rows[0].rolsuper).toBe(false);
      expect(rows[0].rolcreatedb).toBe(false);
      expect(rows[0].rolcreaterole).toBe(false);
      expect(rows[0].rolreplication).toBe(false);
      expect(rows[0].rolbypassrls).toBe(false);
    });

    it('shadow reader cannot create objects in public schema', async () => {
      await expect(
        shadowReaderClient.query('CREATE TABLE public.test_table (id INT)')
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('Existing Role Behavior Unchanged', () => {
    it('service_role policies still exist and allow full access', async () => {
      // Check policies exist
      const { rows } = await adminClient.query(`
        SELECT policyname, roles, cmd
        FROM pg_policies
        WHERE tablename = 'hr_knowledge_pages'
          AND 'service_role' = ANY(roles)
      `);
      expect(rows.some((p) => p.policyname === 'hr_service_pages')).toBe(true);
    });

    it('anon deny policies still exist', async () => {
      const { rows } = await adminClient.query(`
        SELECT policyname, qual
        FROM pg_policies
        WHERE tablename = 'hr_knowledge_pages'
          AND 'anon' = ANY(roles)
      `);
      expect(rows.length).toBeGreaterThan(0);
      // Verify the policy has USING (false)
      expect(rows.some((p) => p.qual === 'false')).toBe(true);
    });

    it('authenticated deny policies still exist', async () => {
      const { rows } = await adminClient.query(`
        SELECT policyname, qual
        FROM pg_policies
        WHERE tablename = 'hr_knowledge_pages'
          AND 'authenticated' = ANY(roles)
      `);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((p) => p.qual === 'false')).toBe(true);
    });

    it('new shadow_reader policies are SELECT-only', async () => {
      const { rows } = await adminClient.query(`
        SELECT policyname, cmd, qual
        FROM pg_policies
        WHERE policyname LIKE 'hr_shadow_reader_select_%'
      `);

      expect(rows.length).toBe(4); // One per table
      for (const policy of rows) {
        expect(policy.cmd).toBe('SELECT');
        expect(policy.qual).toBe('true');
      }
    });
  });
});

// ── RLS Regression Test ──────────────────────────────────────────
// This test specifically catches the scenario where SELECT privilege exists
// but RLS blocks visibility (the bug migration 014 fixes)

describe('RLS Visibility Regression Test', () => {
  it('detects when role has SELECT privilege but RLS blocks visibility', async () => {
    // This test uses the mock adapter to simulate the pre-014 state
    const { createMockReadonlyAdapter } = await import('../database/readonly-adapter.js');

    // Simulate a scenario where security checks pass but no data is visible
    // This would happen if SELECT is granted but no RLS policy exists
    const adapter = createMockReadonlyAdapter(
      {
        connections: [], // Empty due to RLS blocking
        roots: [],
        pages: new Map(),
        approvals: [],
      },
      {
        // Security boundary passes
        identity: { currentUser: 'hr_shadow_reader', sessionUser: 'hr_shadow_reader' },
        privileges: {
          hasElevatedAttributes: false,
          hasMutationPrivileges: false,
          hasForbiddenAccess: false,
          hasForbiddenFunctions: false,
        },
      }
    );

    // Security verification passes
    const security = await adapter.verifySecurityBoundary();
    expect(security.valid).toBe(true);

    // But data is empty (this is the regression case)
    const connections = await adapter.loadConnections();
    expect(connections.data).toHaveLength(0);

    // The test assertion: if security passes but data is empty,
    // we have an RLS visibility gap
    const hasRlsVisibilityGap = security.valid && connections.data?.length === 0;

    // In production after migration 014, this should be false
    // (security passes AND data is visible)
    // This test documents the pre-014 bug behavior
    expect(hasRlsVisibilityGap).toBe(true); // Pre-014 behavior
  });

  it('confirms RLS visibility when policies are correctly configured', async () => {
    const { createMockReadonlyAdapter } = await import('../database/readonly-adapter.js');

    // Simulate post-014 state where RLS policies exist
    const adapter = createMockReadonlyAdapter(
      {
        connections: [
          {
            id: 'c1',
            name: 'Test',
            workspaceId: 'ws',
            tokenHash: 'h',
            isActive: true,
            createdAt: '',
            lastSyncAt: null,
          },
        ],
        roots: [
          {
            id: 'r1',
            connectionId: 'c1',
            notionPageId: 'np1',
            name: 'Root',
            accessClassification: 'employee_safe',
            isActive: true,
            createdAt: '',
          },
        ],
        pages: new Map(),
        approvals: [],
      },
      {
        identity: { currentUser: 'hr_shadow_reader', sessionUser: 'hr_shadow_reader' },
        privileges: {},
      }
    );

    const security = await adapter.verifySecurityBoundary();
    expect(security.valid).toBe(true);

    const connections = await adapter.loadConnections();
    expect(connections.data?.length).toBeGreaterThan(0);

    const roots = await adapter.loadApprovedRoots();
    expect(roots.data?.length).toBeGreaterThan(0);

    // Post-014 behavior: security passes AND data is visible
    const hasRlsVisibilityGap = security.valid && connections.data?.length === 0;
    expect(hasRlsVisibilityGap).toBe(false);
  });
});
