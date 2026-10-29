/**
 * HR Reader Connection Verification — Read-Only, One-Shot
 *
 * Verifies that the hr_reader PostgreSQL role can authenticate,
 * invoke hr_retrieve_knowledge, and is denied direct table access.
 *
 * Usage (DO NOT EXECUTE without owner approval):
 *   railway run -s fftc-hr -e production -- npx tsx scripts/verify-hr-reader.ts
 *
 * Security:
 *   - Never prints or persists the connection string or password.
 *   - Uses the same TLS CA as the production HR reader pool.
 *   - Opens at most one connection; closes it in a finally block.
 *   - Runs inside an explicit BEGIN READ ONLY transaction.
 *   - All tests use savepoints so one failure cannot invalidate later tests.
 *   - Error output limited to SQLSTATE codes and predefined diagnostics.
 *   - Exits nonzero if any assertion fails.
 */

import pg from 'pg';

// Supabase Root 2021 CA — identical to src/hr/database/hr-client.ts.
// Duplicated here because the constant is module-private (not exported).
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

// PostgreSQL SQLSTATE for insufficient_privilege
const SQLSTATE_INSUFFICIENT_PRIVILEGE = '42501';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, status: 'PASS' | 'FAIL', detail: string): void {
  results.push({ name, status, detail });
  console.log(`  ${status}  ${name} — ${detail}`);
}

function sqlstate(err: unknown): string {
  return (err as { code?: string }).code || 'unknown';
}

/**
 * Strip SSL query parameters from a PostgreSQL connection URL so that
 * pg-connection-string does not create an ssl object that overwrites
 * our programmatic TLS configuration via Object.assign.
 */
function stripSslParams(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslcert');
  url.searchParams.delete('sslkey');
  url.searchParams.delete('sslrootcert');
  return url.toString();
}

// ── Connection-string diagnostics (credential-safe) ──────────────

interface UrlDiagnostics {
  url_parse_valid: boolean;
  username_matches_expected: boolean;
  hostname_matches_expected: boolean;
  port_matches_expected: boolean;
  database_matches_expected: boolean;
  password_present: boolean;
  password_contains_whitespace: boolean;
  password_contains_angle_brackets: boolean;
  password_contains_control_characters: boolean;
  pgpassword_fallback_possible: boolean;
}

const EXPECTED_USERNAME = 'hr_reader.vzrlnshdxrupukzhfllf';
const EXPECTED_HOST = 'aws-1-us-west-2.pooler.supabase.com';
const EXPECTED_PORT = '5432';
const EXPECTED_DATABASE = 'postgres';

/**
 * Analyse a connection URL for structural issues without revealing credentials.
 * Pure function — no I/O, no side effects, no logging of sensitive values.
 */
function diagnoseUrl(connectionString: string): UrlDiagnostics {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return {
      url_parse_valid: false,
      username_matches_expected: false,
      hostname_matches_expected: false,
      port_matches_expected: false,
      database_matches_expected: false,
      password_present: false,
      password_contains_whitespace: false,
      password_contains_angle_brackets: false,
      password_contains_control_characters: false,
      pgpassword_fallback_possible: true,
    };
  }

  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const hostname = parsed.hostname;
  const port = parsed.port || EXPECTED_PORT; // default PostgreSQL port
  const database = parsed.pathname.replace(/^\//, '') || '';

  const passwordPresent = password.length > 0;

  return {
    url_parse_valid: true,
    username_matches_expected: username === EXPECTED_USERNAME,
    hostname_matches_expected: hostname === EXPECTED_HOST,
    port_matches_expected: port === EXPECTED_PORT,
    database_matches_expected: database === EXPECTED_DATABASE,
    password_present: passwordPresent,
    password_contains_whitespace: /\s/.test(password),
    password_contains_angle_brackets: /[<>]/.test(password),
    password_contains_control_characters: /[\x00-\x1f\x7f]/.test(password),
    pgpassword_fallback_possible: !passwordPresent,
  };
}

function printDiagnostics(d: UrlDiagnostics): void {
  console.log('[verify-hr-reader] URL diagnostics:');
  for (const [key, value] of Object.entries(d)) {
    console.log(`  ${key}: ${value}`);
  }
}

/**
 * Run synthetic diagnostic tests. Invoked with --self-test flag.
 * Uses only fabricated URLs — never touches real credentials.
 */
function runSyntheticTests(): void {
  console.log('[verify-hr-reader] Running synthetic URL diagnostic tests...\n');
  let passed = 0;
  let failed = 0;

  function expect(name: string, d: UrlDiagnostics, field: keyof UrlDiagnostics, expected: boolean): void {
    const actual = d[field];
    if (actual === expected) {
      passed++;
    } else {
      console.log(`  FAIL  ${name}: ${field} expected=${expected} actual=${actual}`);
      failed++;
    }
  }

  // 1. Valid Session Pooler URL
  const d1 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:Abc123@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}?sslmode=require`);
  expect('1-valid', d1, 'url_parse_valid', true);
  expect('1-valid', d1, 'username_matches_expected', true);
  expect('1-valid', d1, 'hostname_matches_expected', true);
  expect('1-valid', d1, 'port_matches_expected', true);
  expect('1-valid', d1, 'database_matches_expected', true);
  expect('1-valid', d1, 'password_present', true);
  expect('1-valid', d1, 'password_contains_whitespace', false);
  expect('1-valid', d1, 'password_contains_angle_brackets', false);
  expect('1-valid', d1, 'password_contains_control_characters', false);
  expect('1-valid', d1, 'pgpassword_fallback_possible', false);

  // 2. Empty password
  const d2 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('2-empty-pw', d2, 'password_present', false);
  expect('2-empty-pw', d2, 'pgpassword_fallback_possible', true);

  // 3. Missing password (no colon before @)
  const d3 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('3-no-pw', d3, 'password_present', false);
  expect('3-no-pw', d3, 'pgpassword_fallback_possible', true);

  // 4. Leading/trailing whitespace in password
  const d4a = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:%20Abc123@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('4a-lead-ws', d4a, 'password_present', true);
  expect('4a-lead-ws', d4a, 'password_contains_whitespace', true);
  const d4b = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:Abc123%20@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('4b-trail-ws', d4b, 'password_contains_whitespace', true);

  // 5. Embedded angle brackets
  const d5 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:%3CAbcDef%3E@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('5-brackets', d5, 'password_present', true);
  expect('5-brackets', d5, 'password_contains_angle_brackets', true);

  // 6. Control characters
  const d6 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:Abc%00Def@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('6-ctrl', d6, 'password_contains_control_characters', true);

  // 7. Wrong username
  const d7 = diagnoseUrl(`postgresql://postgres.vzrlnshdxrupukzhfllf:Abc123@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('7-wrong-user', d7, 'username_matches_expected', false);

  // 8. Wrong hostname
  const d8 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:Abc123@db.vzrlnshdxrupukzhfllf.supabase.co:${EXPECTED_PORT}/${EXPECTED_DATABASE}`);
  expect('8-wrong-host', d8, 'hostname_matches_expected', false);

  // 9. Wrong port
  const d9 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:Abc123@${EXPECTED_HOST}:6543/${EXPECTED_DATABASE}`);
  expect('9-wrong-port', d9, 'port_matches_expected', false);

  // 10. Wrong database
  const d10 = diagnoseUrl(`postgresql://${EXPECTED_USERNAME}:Abc123@${EXPECTED_HOST}:${EXPECTED_PORT}/template1`);
  expect('10-wrong-db', d10, 'database_matches_expected', false);

  // 11. Malformed URL
  const d11 = diagnoseUrl('not-a-url');
  expect('11-malformed', d11, 'url_parse_valid', false);
  expect('11-malformed', d11, 'pgpassword_fallback_possible', true);

  // 12. SSL params removed without credential change
  const original = `postgresql://${EXPECTED_USERNAME}:TestPass99@${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}?sslmode=require&sslrootcert=/fake`;
  const stripped = stripSslParams(original);
  const dOrig = diagnoseUrl(original);
  const dStrip = diagnoseUrl(stripped);
  expect('12-strip-user', dStrip, 'username_matches_expected', dOrig.username_matches_expected as unknown as boolean);
  expect('12-strip-host', dStrip, 'hostname_matches_expected', dOrig.hostname_matches_expected as unknown as boolean);
  expect('12-strip-pw', dStrip, 'password_present', dOrig.password_present as unknown as boolean);
  expect('12-strip-port', dStrip, 'port_matches_expected', dOrig.port_matches_expected as unknown as boolean);
  expect('12-strip-db', dStrip, 'database_matches_expected', dOrig.database_matches_expected as unknown as boolean);

  console.log(`\n[self-test] ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const connectionString = process.env.HR_READER_DATABASE_URL;
  if (!connectionString) {
    console.error('[verify-hr-reader] HR_READER_DATABASE_URL is not set. Aborting.');
    process.exitCode = 1;
    return;
  }

  // Confirm the variable is present without disclosing its value
  console.log('[verify-hr-reader] HR_READER_DATABASE_URL: present');
  console.log('[verify-hr-reader] Connecting with verified TLS (Supabase Root 2021 CA)...');

  const pool = new pg.Pool({
    connectionString: stripSslParams(connectionString),
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: true,
      ca: SUPABASE_ROOT_CA,
    },
  });

  // Sanitize any pool-level errors to prevent credential leakage
  pool.on('error', () => {
    console.error('[verify-hr-reader] Pool error: unexpected error on idle client');
  });

  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    console.log('[verify-hr-reader] Connected. Starting read-only transaction.\n');

    // Explicit read-only transaction wrapping all tests
    await client.query('BEGIN READ ONLY');

    // ── T1: Role identity ──────────────────────────────────────
    try {
      await client.query('SAVEPOINT t1');
      const { rows: [identity] } = await client.query(
        "SELECT current_user, current_setting('is_superuser') AS is_superuser"
      );
      await client.query('RELEASE SAVEPOINT t1');

      const user = identity.current_user as string;
      const isSuperuser = identity.is_superuser as string;

      if (user === 'hr_reader' && isSuperuser === 'off') {
        record('T1 role identity', 'PASS', `current_user=hr_reader, is_superuser=off`);
      } else {
        record('T1 role identity', 'FAIL',
          `current_user=${user === 'hr_reader' ? 'hr_reader' : 'unexpected_role'}, ` +
          `is_superuser=${isSuperuser === 'off' ? 'off' : 'unexpected_value'}`);
      }
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT t1').catch(() => {});
      record('T1 role identity', 'FAIL', `query error SQLSTATE=${sqlstate(err)}`);
    }

    // ── T2: Authorized function callable (invalid token → 0 rows) ──
    try {
      await client.query('SAVEPOINT t2');
      const { rows } = await client.query(
        'SELECT * FROM hr_retrieve_knowledge($1, $2, $3, $4)',
        ['deliberately-invalid-token', 'test', 30, 5]
      );
      await client.query('RELEASE SAVEPOINT t2');

      if (rows.length === 0) {
        record('T2 function callable', 'PASS', 'hr_retrieve_knowledge returned 0 rows (invalid token rejected)');
      } else {
        record('T2 function callable', 'FAIL', `returned ${rows.length} rows with invalid token (expected 0)`);
      }
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT t2').catch(() => {});
      record('T2 function callable', 'FAIL', `hr_retrieve_knowledge error SQLSTATE=${sqlstate(err)}`);
    }

    // ── T3: Signing secrets table access denied ────────────────
    try {
      await client.query('SAVEPOINT t3');
      await client.query('SELECT * FROM hr_signing_secrets LIMIT 1');
      await client.query('RELEASE SAVEPOINT t3');
      // If we reach here, the query succeeded — this is a security failure
      record('T3 secrets table denied', 'FAIL', 'SELECT on hr_signing_secrets succeeded (should be denied)');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT t3').catch(() => {});
      const code = sqlstate(err);
      if (code === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
        record('T3 secrets table denied', 'PASS', `permission denied SQLSTATE=${code}`);
      } else {
        record('T3 secrets table denied', 'FAIL', `unexpected SQLSTATE=${code} (expected ${SQLSTATE_INSUFFICIENT_PRIVILEGE})`);
      }
    }

    // ── T4: Knowledge chunks table access denied ───────────────
    try {
      await client.query('SAVEPOINT t4');
      await client.query('SELECT * FROM hr_knowledge_chunks LIMIT 1');
      await client.query('RELEASE SAVEPOINT t4');
      record('T4 chunks table denied', 'FAIL', 'SELECT on hr_knowledge_chunks succeeded (should be denied)');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT t4').catch(() => {});
      const code = sqlstate(err);
      if (code === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
        record('T4 chunks table denied', 'PASS', `permission denied SQLSTATE=${code}`);
      } else {
        record('T4 chunks table denied', 'FAIL', `unexpected SQLSTATE=${code} (expected ${SQLSTATE_INSUFFICIENT_PRIVILEGE})`);
      }
    }

    // ── T5: Knowledge pages table access denied ────────────────
    try {
      await client.query('SAVEPOINT t5');
      await client.query('SELECT * FROM hr_knowledge_pages LIMIT 1');
      await client.query('RELEASE SAVEPOINT t5');
      record('T5 pages table denied', 'FAIL', 'SELECT on hr_knowledge_pages succeeded (should be denied)');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT t5').catch(() => {});
      const code = sqlstate(err);
      if (code === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
        record('T5 pages table denied', 'PASS', `permission denied SQLSTATE=${code}`);
      } else {
        record('T5 pages table denied', 'FAIL', `unexpected SQLSTATE=${code} (expected ${SQLSTATE_INSUFFICIENT_PRIVILEGE})`);
      }
    }

    // End transaction — ROLLBACK is safe; nothing was written
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error(`[verify-hr-reader] Final ROLLBACK failed: SQLSTATE=${sqlstate(rollbackErr)}`);
      process.exitCode = 1;
    }

  } catch (err) {
    // Connection-level or BEGIN READ ONLY failure
    console.error(`[verify-hr-reader] Connection failed: SQLSTATE=${sqlstate(err)}`);
    // Print credential-safe diagnostics to aid debugging
    printDiagnostics(diagnoseUrl(connectionString));
    // Attempt to roll back if client was acquired
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    process.exitCode = 1;
    return;
  } finally {
    try {
      if (client) client.release();
    } catch {
      console.error('[verify-hr-reader] Client release error');
      process.exitCode = 1;
    }
    await pool.end().catch(() => {
      console.error('[verify-hr-reader] Pool cleanup error');
      process.exitCode = 1;
    });
  }

  // ── Summary ────────────────────────────────────────────────
  console.log('\n[verify-hr-reader] Results:');
  const failed = results.filter((r) => r.status === 'FAIL');
  for (const r of results) {
    console.log(`  ${r.status}  ${r.name}`);
  }

  if (results.length !== 5) {
    console.log(`\n[verify-hr-reader] Expected 5 tests, recorded ${results.length}. Verification incomplete.`);
    process.exitCode = 1;
  } else if (failed.length > 0) {
    console.log(`\n[verify-hr-reader] ${failed.length} of ${results.length} tests FAILED.`);
    process.exitCode = 1;
  } else if (process.exitCode === 1) {
    console.log(`\n[verify-hr-reader] All 5 assertions passed but cleanup or rollback failed.`);
  } else {
    console.log(`\n[verify-hr-reader] All ${results.length} tests PASSED.`);
  }
}

/**
 * Diagnose-only mode: read HR_READER_DATABASE_URL from the environment,
 * print credential-safe boolean diagnostics, and exit.
 * Never instantiates pg.Pool or opens a database connection.
 */
function diagnoseOnly(): void {
  const connectionString = process.env.HR_READER_DATABASE_URL;
  if (!connectionString) {
    console.error('[diagnose-only] HR_READER_DATABASE_URL is not set. Aborting.');
    process.exitCode = 1;
    return;
  }

  console.log('[diagnose-only] HR_READER_DATABASE_URL: present');

  let diag: UrlDiagnostics;
  try {
    diag = diagnoseUrl(connectionString);
  } catch {
    console.error('[diagnose-only] URL analysis failed safely.');
    process.exitCode = 1;
    return;
  }

  printDiagnostics(diag);

  // Exit nonzero if any expected configuration check fails
  const configOk =
    diag.url_parse_valid &&
    diag.username_matches_expected &&
    diag.hostname_matches_expected &&
    diag.port_matches_expected &&
    diag.database_matches_expected &&
    diag.password_present &&
    !diag.password_contains_whitespace &&
    !diag.password_contains_angle_brackets &&
    !diag.password_contains_control_characters &&
    !diag.pgpassword_fallback_possible;

  if (configOk) {
    console.log('\n[diagnose-only] All configuration checks passed.');
  } else {
    console.log('\n[diagnose-only] Configuration issues detected.');
    process.exitCode = 1;
  }
}

// Entry point
if (process.argv.includes('--self-test')) {
  runSyntheticTests();
} else if (process.argv.includes('--diagnose-only')) {
  diagnoseOnly();
} else {
  main().catch(() => {
    console.error('[verify-hr-reader] Fatal: unhandled error');
    process.exitCode = 1;
  });
}
