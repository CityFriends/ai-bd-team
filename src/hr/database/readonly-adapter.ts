/**
 * Read-Only Database Adapter for Shadow Discovery
 *
 * Provides database-enforced read-only access using a dedicated
 * hr_shadow_reader PostgreSQL role. This adapter:
 *
 *   1. Verifies the connection identity is hr_shadow_reader
 *   2. Verifies the role has no elevated privileges
 *   3. Executes only SELECT queries on allowed tables
 *   4. Fails closed on any security check failure
 *
 * Security model:
 *   - Uses dedicated hr_shadow_reader role (NOT service_role)
 *   - Runtime identity verification before any data access
 *   - Hardcoded allowed tables and columns
 *   - Parameterized queries only
 *   - No mutation operations possible at database level
 */

import pg from 'pg';
import type { ApprovedRoot } from '../notion/classifier.js';

// ── Supabase Root CA for TLS ──────────────────────────────────
// Duplicated from hr-client.ts for module isolation.

const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

// ── Types ─────────────────────────────────────────────────────

export interface NotionConnection {
  id: string;
  name: string;
  workspaceId: string;
  tokenHash: string;
  isActive: boolean;
  createdAt: string;
  lastSyncAt: string | null;
}

export interface ApprovedRootRow {
  id: string;
  connectionId: string;
  notionPageId: string;
  name: string;
  accessClassification: 'employee_safe' | 'hr_restricted' | 'personalized';
  isActive: boolean;
  createdAt: string;
}

export interface ExistingPage {
  id: string;
  notionPageId: string;
  connectionId: string;
  title: string;
  contentHash: string | null;
  publicationStatus: string | null;
  approvedRootId: string | null;
  lastVerifiedAt: string | null;
}

export interface ExistingApproval {
  id: string;
  knowledgePageId: string;
  approvedContentHash: string;
  approvedBy: string;
  approvedAt: string;
  revokedAt: string | null;
}

export interface ReadonlyAdapterResult<T> {
  data: T | null;
  error: string | null;
}

// ── Security Constants ────────────────────────────────────────

/** Expected database role name */
const EXPECTED_ROLE = 'hr_shadow_reader';

/**
 * Security documentation - tables and functions.
 *
 * Allowed for SELECT (4 tables):
 *   - hr_notion_connections
 *   - hr_approved_roots
 *   - hr_knowledge_pages
 *   - hr_page_approvals
 *
 * Forbidden for any access (16 tables):
 *   - hr_signing_secrets, hr_employees, hr_audit_events, hr_knowledge_chunks
 *   - hr_sync_leases, hr_sync_checkpoints, hr_publication_queue
 *   - hr_notification_outbox, hr_compensation_batches, hr_compensation_batch_entries
 *   - hr_user_roles, hr_bootstrap_admins, hr_supervisor_assignments
 *   - hr_personal_page_grants, hr_sensitivity_watermarks, hr_knowledge_sources
 */

/** Tables allowed for SELECT access */
const ALLOWED_TABLES = [
  'hr_notion_connections',
  'hr_approved_roots',
  'hr_knowledge_pages',
  'hr_page_approvals',
];

/** Tables forbidden for any access (all HR tables except 4 allowed) */
const FORBIDDEN_TABLES = [
  // Sensitive data tables
  'hr_signing_secrets',
  'hr_employees',
  'hr_audit_events',
  'hr_knowledge_chunks',
  // Sync and operation tables
  'hr_sync_leases',
  'hr_sync_checkpoints',
  'hr_publication_queue',
  'hr_notification_outbox',
  'hr_compensation_batches',
  'hr_compensation_batch_entries',
  // Access control tables
  'hr_user_roles',
  'hr_bootstrap_admins',
  'hr_supervisor_assignments',
  'hr_personal_page_grants',
  'hr_sensitivity_watermarks',
  // Legacy/auxiliary tables
  'hr_knowledge_sources',
];

/** All HR tables to check for mutation privileges */
const ALL_HR_TABLES = [...ALLOWED_TABLES, ...FORBIDDEN_TABLES];

/** Mutation functions that must NOT be executable (with signatures for unambiguous lookup) */
const FORBIDDEN_FUNCTIONS = [
  // Admin and employee management (migration 004)
  'hr_is_authorized_admin(text)',
  'hr_check_idempotency(text, text)',
  'hr_create_employee(text, text, text, text, text, text, text, text, text, text, date, text)',
  'hr_update_employee(text, uuid, text, text, jsonb)',
  'hr_deactivate_employee(text, uuid, text, text)',
  // Bootstrap sync (migration 005)
  'hr_sync_bootstrap_admins(text[])',
  // Knowledge approval functions (migration 008)
  'hr_approve_knowledge_page(text, uuid[], text[])',
  'hr_revoke_knowledge_approval(text, uuid)',
  // Retrieval functions (migration 010)
  'hr_retrieve_knowledge(text, text, integer, integer)',
  'hr_retrieve_knowledge_v2(text, text, integer, integer)',
  // Sync lease management (migration 011)
  'hr_acquire_sync_lease(text, text, integer)',
  'hr_renew_sync_lease(text, text, bigint, integer)',
  'hr_release_sync_lease(text, text, bigint)',
  // Publication lifecycle (migration 012)
  'hr_publish_routine_page(uuid, text, text, text, bigint, text)',
  'hr_suspend_changed_page(uuid, text, text, text, bigint, text)',
  'hr_approve_compensation_batch(uuid, text, text)',
  // Sensitive policy approval (migration 012)
  'hr_approve_sensitive_policy(uuid, text)',
  'hr_reject_sensitive_policy(uuid, text)',
];

/** Mutation privilege types to check */
const MUTATION_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

// ── Identity Verification ─────────────────────────────────────

export interface IdentityCheckResult {
  valid: boolean;
  currentUser: string | null;
  sessionUser: string | null;
  issues: string[];
}

export interface PrivilegeCheckResult {
  valid: boolean;
  issues: string[];
  hasElevatedAttributes: boolean;
  hasMutationPrivileges: boolean;
  hasForbiddenAccess: boolean;
  hasForbiddenFunctions: boolean;
}

/**
 * Verify the database connection identity is the expected role.
 */
async function verifyIdentity(client: pg.PoolClient): Promise<IdentityCheckResult> {
  const issues: string[] = [];

  try {
    // Check current_user and session_user
    const { rows } = await client.query(`
      SELECT current_user, session_user
    `);

    const currentUser = rows[0]?.current_user;
    const sessionUser = rows[0]?.session_user;

    if (currentUser !== EXPECTED_ROLE) {
      issues.push(`current_user is '${currentUser}', expected '${EXPECTED_ROLE}'`);
    }

    if (sessionUser !== EXPECTED_ROLE) {
      issues.push(`session_user is '${sessionUser}', expected '${EXPECTED_ROLE}'`);
    }

    return {
      valid: issues.length === 0,
      currentUser,
      sessionUser,
      issues,
    };
  } catch (err) {
    return {
      valid: false,
      currentUser: null,
      sessionUser: null,
      issues: [`Identity check query failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

/**
 * Verify the role has no elevated privileges.
 *
 * Uses PostgreSQL's has_table_privilege() and has_function_privilege() functions
 * to evaluate EFFECTIVE privileges, which include:
 *   - Direct grants to the current role
 *   - Grants inherited through role membership
 *   - Grants to PUBLIC
 *
 * This is more comprehensive than querying information_schema.table_privileges,
 * which only shows direct grants to the specified grantee.
 */
async function verifyPrivileges(client: pg.PoolClient): Promise<PrivilegeCheckResult> {
  const issues: string[] = [];
  let hasElevatedAttributes = false;
  let hasMutationPrivileges = false;
  let hasForbiddenAccess = false;
  let hasForbiddenFunctions = false;

  try {
    // 1. Check role attributes
    const { rows: attrRows } = await client.query(`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);

    if (attrRows.length > 0) {
      const attrs = attrRows[0];
      if (attrs.rolsuper) {
        issues.push('Role has SUPERUSER attribute');
        hasElevatedAttributes = true;
      }
      if (attrs.rolcreatedb) {
        issues.push('Role has CREATEDB attribute');
        hasElevatedAttributes = true;
      }
      if (attrs.rolcreaterole) {
        issues.push('Role has CREATEROLE attribute');
        hasElevatedAttributes = true;
      }
      if (attrs.rolreplication) {
        issues.push('Role has REPLICATION attribute');
        hasElevatedAttributes = true;
      }
      if (attrs.rolbypassrls) {
        issues.push('Role has BYPASSRLS attribute');
        hasElevatedAttributes = true;
      }
    }

    // 2. Check EFFECTIVE mutation privileges on ALL HR tables
    // Uses has_table_privilege() which evaluates privileges from:
    //   - Direct grants
    //   - Role membership inheritance
    //   - PUBLIC grants
    for (const tableName of ALL_HR_TABLES) {
      for (const privilege of MUTATION_PRIVILEGES) {
        const { rows } = await client.query(
          `SELECT has_table_privilege(current_user, $1, $2) AS has_priv`,
          [`public.${tableName}`, privilege]
        );
        if (rows[0]?.has_priv === true) {
          issues.push(`Has effective ${privilege} on ${tableName}`);
          hasMutationPrivileges = true;
        }
      }
    }

    // 3. Check EFFECTIVE SELECT access to forbidden tables
    // The role must NOT have SELECT on forbidden tables through any grant path
    for (const tableName of FORBIDDEN_TABLES) {
      const { rows } = await client.query(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') AS has_priv`,
        [`public.${tableName}`]
      );
      if (rows[0]?.has_priv === true) {
        issues.push(`Has effective SELECT on forbidden table ${tableName}`);
        hasForbiddenAccess = true;
      }
    }

    // 4. Check EFFECTIVE EXECUTE on mutation functions
    // Uses has_function_privilege() which evaluates privileges from:
    //   - Direct grants
    //   - Role membership inheritance
    //   - PUBLIC grants (PostgreSQL grants EXECUTE to PUBLIC by default!)
    //
    // FAIL-CLOSED: ALL expected functions MUST exist and be verified.
    // Missing functions, ambiguous references, permission errors, and any
    // other failures cause verification to FAIL. A failed check cannot prove
    // EXECUTE is denied.
    const verifiedFunctions: string[] = [];
    const missingFunctions: string[] = [];

    for (const funcSignature of FORBIDDEN_FUNCTIONS) {
      try {
        // Try to resolve the function and check privilege
        // Use regprocedure cast for unambiguous function lookup
        const { rows } = await client.query(
          `SELECT has_function_privilege(current_user, $1::regprocedure, 'EXECUTE') AS has_priv`,
          [`public.${funcSignature}`]
        );
        if (rows[0]?.has_priv === true) {
          issues.push(`Has effective EXECUTE on mutation function ${funcSignature}`);
          hasForbiddenFunctions = true;
        }
        verifiedFunctions.push(funcSignature);
      } catch (err: unknown) {
        // FAIL-CLOSED: ALL errors cause verification failure.
        const pgError = err as { code?: string; message?: string };
        if (pgError.code === '42883') {
          // Function does not exist - this is a security gap, not acceptable
          missingFunctions.push(funcSignature);
          issues.push(`Expected function missing: ${funcSignature} (code: 42883)`);
          hasForbiddenFunctions = true; // Fail closed - cannot verify
        } else {
          // Any other error: ambiguous function (42725), permission denied (42501),
          // syntax error, connection failure, etc. - FAIL CLOSED
          issues.push(
            `Function privilege check failed for ${funcSignature}: ${pgError.message || String(err)} (code: ${pgError.code || 'unknown'})`
          );
          hasForbiddenFunctions = true; // Fail closed - assume worst case
        }
      }
    }

    // Verify all expected functions were checked
    if (verifiedFunctions.length !== FORBIDDEN_FUNCTIONS.length) {
      issues.push(
        `Incomplete function verification: ${verifiedFunctions.length}/${FORBIDDEN_FUNCTIONS.length} functions checked`
      );
      if (missingFunctions.length > 0) {
        issues.push(`Missing functions: ${missingFunctions.join(', ')}`);
      }
      hasForbiddenFunctions = true;
    }

    // 5. Check for elevated role membership
    const { rows: memberRows } = await client.query(`
      SELECT r.rolname AS member_of
      FROM pg_auth_members m
      JOIN pg_roles r ON m.roleid = r.oid
      WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        AND r.rolname IN ('service_role', 'postgres', 'supabase_admin', 'authenticator')
    `);

    if (memberRows.length > 0) {
      for (const row of memberRows) {
        issues.push(`Member of elevated role: ${row.member_of}`);
      }
      hasElevatedAttributes = true;
    }

    return {
      valid: issues.length === 0,
      issues,
      hasElevatedAttributes,
      hasMutationPrivileges,
      hasForbiddenAccess,
      hasForbiddenFunctions,
    };
  } catch (err) {
    return {
      valid: false,
      issues: [`Privilege check query failed: ${err instanceof Error ? err.message : String(err)}`],
      hasElevatedAttributes: true, // Fail closed
      hasMutationPrivileges: true,
      hasForbiddenAccess: true,
      hasForbiddenFunctions: true,
    };
  }
}

// ── Read-Only Adapter Interface ───────────────────────────────

export interface ReadonlyAdapter {
  loadConnections(): Promise<ReadonlyAdapterResult<NotionConnection[]>>;
  loadApprovedRoots(): Promise<ReadonlyAdapterResult<ApprovedRootRow[]>>;
  loadApprovedRootsForClassifier(): Promise<ReadonlyAdapterResult<ApprovedRoot[]>>;
  loadApprovedRootsForConnection(
    connectionId: string
  ): Promise<ReadonlyAdapterResult<ApprovedRootRow[]>>;
  loadExistingPages(connectionId: string): Promise<ReadonlyAdapterResult<ExistingPage[]>>;
  loadExistingApprovals(): Promise<ReadonlyAdapterResult<ExistingApproval[]>>;
  loadConnection(connectionId: string): Promise<ReadonlyAdapterResult<NotionConnection | null>>;
  verifyConnectivity(): Promise<boolean>;
  verifySecurityBoundary(): Promise<{
    valid: boolean;
    identity: IdentityCheckResult;
    privileges: PrivilegeCheckResult;
  }>;
  close(): Promise<void>;
}

// ── Secure Pool Factory ───────────────────────────────────────

/**
 * Strip SSL query parameters from connection URL.
 */
function stripSslParams(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslcert');
  url.searchParams.delete('sslkey');
  url.searchParams.delete('sslrootcert');
  return url.toString();
}

export interface SecurePoolConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

/**
 * Create a secure read-only adapter using the hr_shadow_reader identity.
 *
 * This adapter:
 * 1. Connects using the provided connection string
 * 2. Verifies the connection is using hr_shadow_reader
 * 3. Verifies the role has no elevated privileges
 * 4. Fails closed if any security check fails
 */
export function createSecureReadonlyAdapter(config: SecurePoolConfig): ReadonlyAdapter {
  const pool = new pg.Pool({
    connectionString: stripSslParams(config.connectionString),
    max: config.maxConnections ?? 3,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 10000,
    ssl: {
      rejectUnauthorized: true,
      ca: SUPABASE_ROOT_CA,
    },
  });

  // Suppress connection string in error logs
  pool.on('error', () => {
    // Intentionally empty - errors are handled in query methods
  });

  let securityVerified = false;

  return {
    async verifySecurityBoundary() {
      const client = await pool.connect();
      try {
        const identity = await verifyIdentity(client);
        if (!identity.valid) {
          return {
            valid: false,
            identity,
            privileges: {
              valid: false,
              issues: ['Skipped due to identity failure'],
              hasElevatedAttributes: true,
              hasMutationPrivileges: true,
              hasForbiddenAccess: true,
              hasForbiddenFunctions: true,
            },
          };
        }

        const privileges = await verifyPrivileges(client);
        if (!privileges.valid) {
          return { valid: false, identity, privileges };
        }

        securityVerified = true;
        return { valid: true, identity, privileges };
      } finally {
        client.release();
      }
    },

    async verifyConnectivity(): Promise<boolean> {
      try {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1');
          return true;
        } finally {
          client.release();
        }
      } catch {
        return false;
      }
    },

    async loadConnections(): Promise<ReadonlyAdapterResult<NotionConnection[]>> {
      if (!securityVerified) {
        return {
          data: null,
          error: 'Security boundary not verified. Call verifySecurityBoundary() first.',
        };
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(`
          SELECT id, name, workspace_id, token_hash, is_active, created_at, last_sync_at
          FROM hr_notion_connections
          WHERE is_active = true
          ORDER BY created_at ASC
        `);

        const connections: NotionConnection[] = rows.map((row) => ({
          id: row.id,
          name: row.name,
          workspaceId: row.workspace_id,
          tokenHash: row.token_hash,
          isActive: row.is_active,
          createdAt: row.created_at,
          lastSyncAt: row.last_sync_at,
        }));

        return { data: connections, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        client.release();
      }
    },

    async loadApprovedRoots(): Promise<ReadonlyAdapterResult<ApprovedRootRow[]>> {
      if (!securityVerified) {
        return {
          data: null,
          error: 'Security boundary not verified. Call verifySecurityBoundary() first.',
        };
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(`
          SELECT id, connection_id, notion_page_id, name, access_classification, is_active, created_at
          FROM hr_approved_roots
          ORDER BY created_at ASC
        `);

        const roots: ApprovedRootRow[] = rows.map((row) => ({
          id: row.id,
          connectionId: row.connection_id,
          notionPageId: row.notion_page_id,
          name: row.name,
          accessClassification: row.access_classification,
          isActive: row.is_active,
          createdAt: row.created_at,
        }));

        return { data: roots, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        client.release();
      }
    },

    async loadApprovedRootsForClassifier(): Promise<ReadonlyAdapterResult<ApprovedRoot[]>> {
      const result = await this.loadApprovedRoots();
      if (result.error || !result.data) {
        return { data: null, error: result.error };
      }

      const classifierRoots: ApprovedRoot[] = result.data.map((row) => ({
        id: row.id,
        connectionId: row.connectionId,
        notionPageId: row.notionPageId,
        accessClassification: row.accessClassification,
        isActive: row.isActive,
      }));

      return { data: classifierRoots, error: null };
    },

    async loadApprovedRootsForConnection(
      connectionId: string
    ): Promise<ReadonlyAdapterResult<ApprovedRootRow[]>> {
      if (!securityVerified) {
        return {
          data: null,
          error: 'Security boundary not verified. Call verifySecurityBoundary() first.',
        };
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `
          SELECT id, connection_id, notion_page_id, name, access_classification, is_active, created_at
          FROM hr_approved_roots
          WHERE connection_id = $1
          ORDER BY created_at ASC
        `,
          [connectionId]
        );

        const roots: ApprovedRootRow[] = rows.map((row) => ({
          id: row.id,
          connectionId: row.connection_id,
          notionPageId: row.notion_page_id,
          name: row.name,
          accessClassification: row.access_classification,
          isActive: row.is_active,
          createdAt: row.created_at,
        }));

        return { data: roots, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        client.release();
      }
    },

    async loadExistingPages(connectionId: string): Promise<ReadonlyAdapterResult<ExistingPage[]>> {
      if (!securityVerified) {
        return {
          data: null,
          error: 'Security boundary not verified. Call verifySecurityBoundary() first.',
        };
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `
          SELECT id, notion_page_id, connection_id, title, content_hash, publication_status, approved_root_id, last_verified_at
          FROM hr_knowledge_pages
          WHERE connection_id = $1
        `,
          [connectionId]
        );

        const pages: ExistingPage[] = rows.map((row) => ({
          id: row.id,
          notionPageId: row.notion_page_id,
          connectionId: row.connection_id,
          title: row.title,
          contentHash: row.content_hash,
          publicationStatus: row.publication_status,
          approvedRootId: row.approved_root_id,
          lastVerifiedAt: row.last_verified_at,
        }));

        return { data: pages, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        client.release();
      }
    },

    async loadExistingApprovals(): Promise<ReadonlyAdapterResult<ExistingApproval[]>> {
      if (!securityVerified) {
        return {
          data: null,
          error: 'Security boundary not verified. Call verifySecurityBoundary() first.',
        };
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(`
          SELECT id, knowledge_page_id, approved_content_hash, approved_by, approved_at, revoked_at
          FROM hr_page_approvals
          WHERE revoked_at IS NULL
        `);

        const approvals: ExistingApproval[] = rows.map((row) => ({
          id: row.id,
          knowledgePageId: row.knowledge_page_id,
          approvedContentHash: row.approved_content_hash,
          approvedBy: row.approved_by,
          approvedAt: row.approved_at,
          revokedAt: row.revoked_at,
        }));

        return { data: approvals, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        client.release();
      }
    },

    async loadConnection(
      connectionId: string
    ): Promise<ReadonlyAdapterResult<NotionConnection | null>> {
      if (!securityVerified) {
        return {
          data: null,
          error: 'Security boundary not verified. Call verifySecurityBoundary() first.',
        };
      }

      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          `
          SELECT id, name, workspace_id, token_hash, is_active, created_at, last_sync_at
          FROM hr_notion_connections
          WHERE id = $1
        `,
          [connectionId]
        );

        if (rows.length === 0) {
          return { data: null, error: null };
        }

        const row = rows[0];
        const connection: NotionConnection = {
          id: row.id,
          name: row.name,
          workspaceId: row.workspace_id,
          tokenHash: row.token_hash,
          isActive: row.is_active,
          createdAt: row.created_at,
          lastSyncAt: row.last_sync_at,
        };

        return { data: connection, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err.message : String(err) };
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

// ── Mock Adapter for Testing ──────────────────────────────────

export interface MockAdapterData {
  connections: NotionConnection[];
  roots: ApprovedRootRow[];
  pages: Map<string, ExistingPage[]>;
  approvals: ExistingApproval[];
}

export interface MockSecurityConfig {
  identity?: { currentUser: string; sessionUser: string };
  privileges?: {
    hasElevatedAttributes?: boolean;
    hasMutationPrivileges?: boolean;
    hasForbiddenAccess?: boolean;
    hasForbiddenFunctions?: boolean;
  };
  /**
   * Granular effective privilege simulation for testing different grant paths.
   * When set, these override the simple boolean flags above.
   */
  effectivePrivileges?: {
    /** Tables with effective mutation privileges (any of INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) */
    mutationOnTables?: string[];
    /** Specific mutation privileges: { tableName: ['INSERT', 'TRIGGER', ...] } */
    specificMutationPrivileges?: Record<string, string[]>;
    /** Tables with effective SELECT (used for forbidden table check) */
    selectOnForbiddenTables?: string[];
    /** Functions with effective EXECUTE */
    executeOnFunctions?: string[];
    /** Grant path for issues (for test assertions) */
    grantPath?: 'direct' | 'inherited' | 'public';
  };
  /** Simulate privilege query failure */
  simulatePrivilegeQueryFailure?: boolean;
  /**
   * Simulate function-specific errors for fail-closed testing.
   * Maps function names to error scenarios.
   */
  simulateFunctionErrors?: {
    /** Functions that trigger ambiguous function error (42725) */
    ambiguousFunctions?: string[];
    /** Functions that trigger permission denied error (42501) */
    permissionDeniedFunctions?: string[];
    /** Functions that trigger invalid regprocedure error */
    invalidSignatureFunctions?: string[];
    /** Functions that trigger unexpected database error */
    unexpectedErrorFunctions?: string[];
    /** Functions that are missing (42883) - now causes verification failure */
    missingFunctions?: string[];
  };
}

/**
 * Create a mock read-only adapter for offline testing.
 *
 * Supports two privilege configuration modes:
 * 1. Simple boolean flags (privileges.hasMutationPrivileges, etc.)
 * 2. Granular effective privilege simulation (effectivePrivileges)
 *
 * When effectivePrivileges is set, it takes precedence and generates
 * detailed issue messages that mirror the real adapter's output.
 */
export function createMockReadonlyAdapter(
  data: MockAdapterData,
  securityConfig?: MockSecurityConfig
): ReadonlyAdapter {
  let securityVerified = false;

  return {
    async verifySecurityBoundary() {
      // Simulate privilege query failure
      if (securityConfig?.simulatePrivilegeQueryFailure) {
        return {
          valid: false,
          identity: {
            valid: true,
            currentUser: EXPECTED_ROLE,
            sessionUser: EXPECTED_ROLE,
            issues: [],
          },
          privileges: {
            valid: false,
            issues: ['Privilege check query failed: simulated error'],
            hasElevatedAttributes: true,
            hasMutationPrivileges: true,
            hasForbiddenAccess: true,
            hasForbiddenFunctions: true,
          },
        };
      }

      const currentUser = securityConfig?.identity?.currentUser ?? EXPECTED_ROLE;
      const sessionUser = securityConfig?.identity?.sessionUser ?? EXPECTED_ROLE;

      const identityValid = currentUser === EXPECTED_ROLE && sessionUser === EXPECTED_ROLE;
      const identity: IdentityCheckResult = {
        valid: identityValid,
        currentUser,
        sessionUser,
        issues: identityValid ? [] : [`Identity mismatch: ${currentUser}/${sessionUser}`],
      };

      // Check for granular effective privilege configuration
      const effectivePrivs = securityConfig?.effectivePrivileges;
      if (effectivePrivs) {
        const privilegeIssues: string[] = [];
        const hasElevatedAttributes = securityConfig?.privileges?.hasElevatedAttributes ?? false;
        let hasMutationPrivileges = false;
        let hasForbiddenAccess = false;
        let hasForbiddenFunctions = false;

        const grantPath = effectivePrivs.grantPath ?? 'direct';
        const pathSuffix = grantPath === 'direct' ? '' : ` (via ${grantPath})`;

        // Check mutation privileges on tables
        if (effectivePrivs.mutationOnTables?.length) {
          for (const table of effectivePrivs.mutationOnTables) {
            privilegeIssues.push(`Has effective mutation privilege on ${table}${pathSuffix}`);
          }
          hasMutationPrivileges = true;
        }

        // Check specific mutation privileges
        if (effectivePrivs.specificMutationPrivileges) {
          for (const [table, privs] of Object.entries(effectivePrivs.specificMutationPrivileges)) {
            for (const priv of privs) {
              privilegeIssues.push(`Has effective ${priv} on ${table}${pathSuffix}`);
            }
          }
          hasMutationPrivileges = true;
        }

        // Check SELECT on forbidden tables
        if (effectivePrivs.selectOnForbiddenTables?.length) {
          for (const table of effectivePrivs.selectOnForbiddenTables) {
            privilegeIssues.push(`Has effective SELECT on forbidden table ${table}${pathSuffix}`);
          }
          hasForbiddenAccess = true;
        }

        // Check EXECUTE on functions
        if (effectivePrivs.executeOnFunctions?.length) {
          for (const func of effectivePrivs.executeOnFunctions) {
            privilegeIssues.push(`Has effective EXECUTE on mutation function ${func}${pathSuffix}`);
          }
          hasForbiddenFunctions = true;
        }

        // Simulate function-specific errors (fail-closed behavior testing)
        const funcErrors = securityConfig?.simulateFunctionErrors;
        if (funcErrors) {
          if (funcErrors.ambiguousFunctions?.length) {
            for (const func of funcErrors.ambiguousFunctions) {
              privilegeIssues.push(
                `Function privilege check failed for ${func}: function name is ambiguous (code: 42725)`
              );
            }
            hasForbiddenFunctions = true;
          }
          if (funcErrors.permissionDeniedFunctions?.length) {
            for (const func of funcErrors.permissionDeniedFunctions) {
              privilegeIssues.push(
                `Function privilege check failed for ${func}: permission denied (code: 42501)`
              );
            }
            hasForbiddenFunctions = true;
          }
          if (funcErrors.invalidSignatureFunctions?.length) {
            for (const func of funcErrors.invalidSignatureFunctions) {
              privilegeIssues.push(
                `Function privilege check failed for ${func}: invalid function signature (code: 42883)`
              );
            }
            // Note: 42883 is tolerated in real adapter, but for testing we can simulate
            // scenarios where it should NOT be tolerated
            hasForbiddenFunctions = true;
          }
          if (funcErrors.unexpectedErrorFunctions?.length) {
            for (const func of funcErrors.unexpectedErrorFunctions) {
              privilegeIssues.push(
                `Function privilege check failed for ${func}: unexpected database error (code: unknown)`
              );
            }
            hasForbiddenFunctions = true;
          }
          if (funcErrors.missingFunctions?.length) {
            for (const func of funcErrors.missingFunctions) {
              privilegeIssues.push(`Expected function missing: ${func} (code: 42883)`);
            }
            privilegeIssues.push(`Missing functions: ${funcErrors.missingFunctions.join(', ')}`);
            hasForbiddenFunctions = true;
          }
        }

        const privilegesValid =
          !hasElevatedAttributes &&
          !hasMutationPrivileges &&
          !hasForbiddenAccess &&
          !hasForbiddenFunctions;
        const privileges: PrivilegeCheckResult = {
          valid: privilegesValid,
          issues: privilegeIssues,
          hasElevatedAttributes,
          hasMutationPrivileges,
          hasForbiddenAccess,
          hasForbiddenFunctions,
        };

        const valid = identityValid && privilegesValid;
        if (valid) {
          securityVerified = true;
        }

        return { valid, identity, privileges };
      }

      // Fall back to simple boolean flags
      const hasElevatedAttributes = securityConfig?.privileges?.hasElevatedAttributes ?? false;
      const hasMutationPrivileges = securityConfig?.privileges?.hasMutationPrivileges ?? false;
      const hasForbiddenAccess = securityConfig?.privileges?.hasForbiddenAccess ?? false;
      const hasForbiddenFunctions = securityConfig?.privileges?.hasForbiddenFunctions ?? false;

      const privilegesValid =
        !hasElevatedAttributes &&
        !hasMutationPrivileges &&
        !hasForbiddenAccess &&
        !hasForbiddenFunctions;
      const privilegeIssues: string[] = [];
      if (hasElevatedAttributes) privilegeIssues.push('Has elevated attributes');
      if (hasMutationPrivileges) privilegeIssues.push('Has mutation privileges');
      if (hasForbiddenAccess) privilegeIssues.push('Has forbidden table access');
      if (hasForbiddenFunctions) privilegeIssues.push('Has forbidden function access');

      const privileges: PrivilegeCheckResult = {
        valid: privilegesValid,
        issues: privilegeIssues,
        hasElevatedAttributes,
        hasMutationPrivileges,
        hasForbiddenAccess,
        hasForbiddenFunctions,
      };

      const valid = identityValid && privilegesValid;
      if (valid) {
        securityVerified = true;
      }

      return { valid, identity, privileges };
    },

    async verifyConnectivity() {
      return true;
    },

    async loadConnections() {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      return { data: data.connections.filter((c) => c.isActive), error: null };
    },

    async loadApprovedRoots() {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      return { data: data.roots, error: null };
    },

    async loadApprovedRootsForClassifier() {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      const classifierRoots: ApprovedRoot[] = data.roots.map((row) => ({
        id: row.id,
        connectionId: row.connectionId,
        notionPageId: row.notionPageId,
        accessClassification: row.accessClassification,
        isActive: row.isActive,
      }));
      return { data: classifierRoots, error: null };
    },

    async loadApprovedRootsForConnection(connectionId: string) {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      return {
        data: data.roots.filter((r) => r.connectionId === connectionId),
        error: null,
      };
    },

    async loadExistingPages(connectionId: string) {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      return { data: data.pages.get(connectionId) || [], error: null };
    },

    async loadExistingApprovals() {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      return { data: data.approvals.filter((a) => !a.revokedAt), error: null };
    },

    async loadConnection(connectionId: string) {
      if (!securityVerified) {
        return { data: null, error: 'Security boundary not verified' };
      }
      return {
        data: data.connections.find((c) => c.id === connectionId) || null,
        error: null,
      };
    },

    async close() {
      // No-op for mock
    },
  };
}
