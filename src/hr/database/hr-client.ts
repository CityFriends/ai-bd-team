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

export interface HRDatabaseClient {
  client: SupabaseClient;
  isConnected(): Promise<boolean>;
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
