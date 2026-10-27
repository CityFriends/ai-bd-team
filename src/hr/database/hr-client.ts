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
    ssl: { rejectUnauthorized: false },
  });

  pool.on('error', (err) => {
    console.error('[HR Reader Pool] Unexpected error on idle client:', err.message);
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
