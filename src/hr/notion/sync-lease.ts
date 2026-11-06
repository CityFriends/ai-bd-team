/**
 * Sync Lease — Database-Backed Distributed Lock
 *
 * Prevents overlapping sync runs using atomic lease acquisition
 * with fencing tokens. The lease is stored in hr_sync_leases and
 * managed via SECURITY DEFINER RPCs.
 *
 * Fencing: Each lease acquisition increments the fencing_token.
 * A stale worker holding an expired lease cannot publish results
 * if another worker acquired the lease (its fencing token is outdated).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

export const SYNC_LEASE_NAME = 'hr_wiki_sync';
export const DEFAULT_LEASE_DURATION_SECONDS = 300; // 5 minutes

export interface SyncLease {
  leaseName: string;
  ownerToken: string;
  fencingToken: number;
}

/**
 * Attempt to acquire the sync lease.
 * Returns the lease if acquired, null if another worker holds it.
 */
export async function acquireSyncLease(
  db: SupabaseClient,
  leaseName: string = SYNC_LEASE_NAME,
  durationSeconds: number = DEFAULT_LEASE_DURATION_SECONDS
): Promise<SyncLease | null> {
  const ownerToken = randomUUID();

  const { data, error } = await db.rpc('hr_acquire_sync_lease', {
    p_lease_name: leaseName,
    p_owner_token: ownerToken,
    p_duration_seconds: durationSeconds,
  });

  if (error || data === null) return null;

  return {
    leaseName,
    ownerToken,
    fencingToken: data as number,
  };
}

/**
 * Renew an existing lease. Only succeeds if the caller still owns it.
 */
export async function renewSyncLease(
  db: SupabaseClient,
  lease: SyncLease,
  durationSeconds: number = DEFAULT_LEASE_DURATION_SECONDS
): Promise<boolean> {
  const { data, error } = await db.rpc('hr_renew_sync_lease', {
    p_lease_name: lease.leaseName,
    p_owner_token: lease.ownerToken,
    p_fencing_token: lease.fencingToken,
    p_duration_seconds: durationSeconds,
  });

  return !error && data === true;
}

/**
 * Release a lease by expiring it. The row is preserved so the
 * fencing token remains monotonically increasing across acquisitions.
 * Only succeeds if the caller still owns it.
 */
export async function releaseSyncLease(
  db: SupabaseClient,
  lease: SyncLease
): Promise<boolean> {
  const { data, error } = await db.rpc('hr_release_sync_lease', {
    p_lease_name: lease.leaseName,
    p_owner_token: lease.ownerToken,
    p_fencing_token: lease.fencingToken,
  });

  return !error && data === true;
}
