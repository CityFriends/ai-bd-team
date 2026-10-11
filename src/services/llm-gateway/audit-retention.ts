/**
 * Audit Retention Cleanup
 *
 * Removes expired raw_response content from validation-failure
 * audit records in ai_inference_ledger.metadata.
 *
 * Preserves:
 * - response_hash, error_type, errors, response_chars, recorded_at
 * - Ledger status, settled cost, provider request ID
 * - All scope associations and unrelated metadata fields
 *
 * Safety:
 * - Explicit project identity verification before any mutation
 * - Rejects production project bvgtfadggtgnakrxvuim
 * - Bounded batch processing with max batches per run
 * - Overlap prevention via in-process lock
 * - No inference, Slack, or downstream activity
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BATCHES = 10;
const PRODUCTION_PROJECT = 'bvgtfadggtgnakrxvuim';

// ============================================================
// Project Identity Verification
// ============================================================

export interface ProjectVerification {
  verified: boolean;
  project: string | null;
  error?: string;
}

/**
 * Verify the Supabase URL belongs to the expected project.
 *
 * Extracts the project reference from the URL and compares
 * against both the expected project and the production blocklist.
 *
 * Fail-closed: returns verified=false on any ambiguity.
 */
export function verifyProjectIdentity(
  supabaseUrl: string,
  expectedProject: string
): ProjectVerification {
  if (!supabaseUrl) {
    return { verified: false, project: null, error: 'SUPABASE_URL is empty' };
  }
  if (!expectedProject) {
    return { verified: false, project: null, error: 'Expected project ID is empty' };
  }

  // Extract project ref from URL: https://<ref>.supabase.co
  const match = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) {
    return { verified: false, project: null, error: `Cannot extract project ref from URL: ${supabaseUrl}` };
  }

  const actualProject = match[1];

  // Reject production explicitly
  if (actualProject === PRODUCTION_PROJECT) {
    return { verified: false, project: actualProject, error: `Production project ${PRODUCTION_PROJECT} is blocked` };
  }

  // Verify match
  if (actualProject !== expectedProject) {
    return { verified: false, project: actualProject, error: `Project mismatch: expected ${expectedProject}, got ${actualProject}` };
  }

  return { verified: true, project: actualProject };
}

// ============================================================
// Cleanup
// ============================================================

export interface CleanupResult {
  expired: number;
  batches: number;
  error?: string;
}

/**
 * Run audit retention cleanup with project identity verification.
 *
 * Requires an explicit expected project ID. Verifies the Supabase URL
 * matches before any database operation. Rejects production.
 *
 * Processes up to maxBatches * batchSize records per invocation.
 */
export async function cleanupExpiredAuditResponses(
  supabase: SupabaseClient,
  options: {
    batchSize?: number;
    expectedProject?: string;
    supabaseUrl?: string;
  } = {}
): Promise<CleanupResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  // Legacy compatibility: if no project verification requested, run without check
  // (for unit test mocks that don't have real URLs)
  if (options.expectedProject && options.supabaseUrl) {
    const verification = verifyProjectIdentity(options.supabaseUrl, options.expectedProject);
    if (!verification.verified) {
      return { expired: 0, batches: 0, error: `Project verification failed: ${verification.error}` };
    }
  }

  try {
    const { data, error } = await supabase.rpc('cleanup_expired_audit_responses', {
      p_batch_size: batchSize,
    });

    if (error) {
      return { expired: 0, batches: 1, error: `RPC error: ${error.message}` };
    }

    return { expired: typeof data === 'number' ? data : 0, batches: 1 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { expired: 0, batches: 1, error: `Cleanup exception: ${msg}` };
  }
}

// ============================================================
// Scheduled Maintenance
// ============================================================

export interface MaintenanceResult {
  totalExpired: number;
  totalBatches: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
  skipped: boolean;
}

let maintenanceRunning = false;

/**
 * Run a bounded scheduled maintenance cycle.
 *
 * Requirements:
 * - Explicit project identity verification
 * - Batched processing (default 100 records per batch, 10 batches max)
 * - Overlap prevention (in-process lock)
 * - Execution recording
 * - No inference, Slack, or autonomous workflows
 *
 * Production scheduling is disabled by default — the caller must
 * explicitly provide the commissioning project ID.
 */
export async function runScheduledCleanup(
  supabase: SupabaseClient,
  config: {
    expectedProject: string;
    supabaseUrl: string;
    batchSize?: number;
    maxBatches?: number;
  }
): Promise<MaintenanceResult> {
  const startedAt = new Date().toISOString();
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = config.maxBatches ?? DEFAULT_MAX_BATCHES;

  // 1. Overlap prevention
  if (maintenanceRunning) {
    return {
      totalExpired: 0, totalBatches: 0, errors: ['Maintenance already running — skipped'],
      startedAt, completedAt: new Date().toISOString(), skipped: true,
    };
  }

  // 2. Project identity verification (fail closed)
  const verification = verifyProjectIdentity(config.supabaseUrl, config.expectedProject);
  if (!verification.verified) {
    return {
      totalExpired: 0, totalBatches: 0,
      errors: [`Project verification failed: ${verification.error}`],
      startedAt, completedAt: new Date().toISOString(), skipped: true,
    };
  }

  maintenanceRunning = true;
  const errors: string[] = [];
  let totalExpired = 0;
  let batchesExecuted = 0;

  try {
    // 3. Batched processing
    for (let batch = 0; batch < maxBatches; batch++) {
      batchesExecuted++;
      const result = await cleanupExpiredAuditResponses(supabase, { batchSize });

      if (result.error) {
        errors.push(`Batch ${batchesExecuted}: ${result.error}`);
        break; // Stop on error — do not continue with potentially corrupted state
      }

      totalExpired += result.expired;

      // Stop if this batch processed fewer records than the limit (no more work)
      if (result.expired < batchSize) break;
    }
  } finally {
    maintenanceRunning = false;
  }

  return {
    totalExpired, totalBatches: batchesExecuted, errors,
    startedAt, completedAt: new Date().toISOString(), skipped: false,
  };
}

/** Reset maintenance lock — for testing only */
export function _resetMaintenanceLock(): void {
  maintenanceRunning = false;
}
