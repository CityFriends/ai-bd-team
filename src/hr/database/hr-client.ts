/**
 * HR Supabase Client
 *
 * Dedicated client for the HR Supabase project.
 * Must never share credentials with the BD project.
 *
 * SECURITY: The HR service_role key bypasses RLS on the HR project.
 * This is documented and expected — RLS policies protect against anon/
 * authenticated access, not service_role. Application-layer authorization
 * in hr-auth.ts is the primary access control for HR operations.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

/**
 * Supabase Root 2021 CA — used by the Supabase shared pooler.
 * This is a private CA not in the system trust store.
 * Pinning it here enables verified TLS without disabling certificate checks.
 * Source: extracted from aws-1-us-west-2.pooler.supabase.com:6543 certificate chain.
 * Valid until: 2031-04-26
 */
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

export interface HRDatabaseClient {
  client: SupabaseClient;
  isConnected(): Promise<boolean>;
}

export interface HRReaderPool {
  pool: pg.Pool;
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
  end(): Promise<void>;
}

/**
 * Create an HR-dedicated Supabase client.
 * Accepts explicit URL and key — never reads BD environment variables.
 */
export function createHRClient(url: string, serviceKey: string): HRDatabaseClient {
  if (!url || !serviceKey) {
    throw new Error('HR Supabase URL and service key are required.');
  }

  const client = createClient(url, serviceKey);

  return {
    client,
    async isConnected(): Promise<boolean> {
      try {
        // Simple connectivity check — query a minimal system table
        const { error } = await client.from('hr_audit_events').select('id').limit(0);
        return !error;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Create a least-privilege reader pool using the hr_reader PostgreSQL role.
 * This pool can ONLY execute hr_retrieve_knowledge — no direct table access.
 *
 * Connection string format for Supabase shared pooler:
 *   postgresql://hr_reader.[PROJECT-REF]:password@host:6543/postgres
 */
export function createHRReaderPool(connectionString: string): HRReaderPool {
  if (!connectionString) {
    throw new Error('HR reader database connection string is required.');
  }

  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: {
      rejectUnauthorized: true,
      ca: SUPABASE_ROOT_CA,
    },
  });

  pool.on('error', (err) => {
    // Sanitize: pg errors may include hostnames but not passwords.
    // Strip anything that looks like a connection URL as defense-in-depth.
    const msg = (err.message || '').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://***');
    console.error('[HR Reader Pool] Unexpected error on idle client:', msg);
  });

  return {
    pool,
    async query(text: string, values?: unknown[]): Promise<pg.QueryResult> {
      return pool.query(text, values);
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}
