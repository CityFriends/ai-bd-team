import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;
let usingServiceKey = false;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const key = serviceKey || anonKey;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY');
    }

    usingServiceKey = !!serviceKey;
    // Log key info (safe - only shows prefix/suffix for debugging)
    const keyPreview = key ? `${key.slice(0, 10)}...${key.slice(-4)}` : 'none';
    console.log(
      `[Database] Initialized with ${usingServiceKey ? 'SERVICE_KEY' : 'ANON_KEY'} (${keyPreview})`
    );

    if (!usingServiceKey) {
      console.warn(
        '[Database] SUPABASE_SERVICE_KEY not set, using SUPABASE_ANON_KEY. ' +
          'Some operations (like button handlers) may fail due to RLS restrictions.'
      );
    }

    supabase = createClient(url, key);
  }
  return supabase;
}

/**
 * Check if the database client is using the service key (bypasses RLS)
 */
export function isUsingServiceKey(): boolean {
  return usingServiceKey;
}
