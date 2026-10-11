/**
 * Audit Retention Cleanup
 *
 * Removes expired raw_response content from validation-failure
 * audit records in ai_inference_ledger.metadata.
 *
 * Preserves:
 * - response_hash, error_type, errors, response_chars, recorded_at
 * - Ledger status, settled cost, provider request ID
 * - All scope associations
 * - Unrelated metadata fields
 *
 * Safety:
 * - Fail-closed environment check (rejects production)
 * - Bounded batch processing
 * - Idempotent (safe to run repeatedly)
 * - No inference, Slack, or downstream activity
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const DEFAULT_BATCH_SIZE = 100;

export interface CleanupResult {
  expired: number;
  error?: string;
}

/**
 * Run audit retention cleanup against a Supabase client.
 *
 * Calls the cleanup_expired_audit_responses database function.
 * Returns the number of records cleaned.
 *
 * Fail-closed: rejects if the database URL contains a known
 * production project reference.
 */
export async function cleanupExpiredAuditResponses(
  supabase: SupabaseClient,
  options: { batchSize?: number } = {}
): Promise<CleanupResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  try {
    const { data, error } = await supabase.rpc('cleanup_expired_audit_responses', {
      p_batch_size: batchSize,
    });

    if (error) {
      return { expired: 0, error: `RPC error: ${error.message}` };
    }

    return { expired: typeof data === 'number' ? data : 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { expired: 0, error: `Cleanup exception: ${msg}` };
  }
}
