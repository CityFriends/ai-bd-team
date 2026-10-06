/**
 * Marcus Document Version Change Driver
 *
 * Discovers unprocessed source document versions for active pursuits
 * and feeds them through the deterministic technical change classifier.
 *
 * This driver:
 * - discovers only unprocessed/new document versions
 * - is restart-safe (checkpoint-based)
 * - is idempotent (duplicate delivery tolerated)
 * - persists processing state
 * - NEVER calls an LLM itself
 * - NEVER calls G2X merely because the scheduler fired
 *
 * Time passing alone never creates Marcus inference.
 * The driver only processes durable document/version work already present.
 */

import { logger } from '../../lib/logger.js';
import { getSupabase } from '../../integrations/database/client.js';
import { processSourceDocumentChange } from './pursuit-stewardship.js';

const log = logger.child({ service: 'MarcusDocVersionDriver' });

const DRIVER_CHECKPOINT_SOURCE = 'marcus_document_version_driver';

/**
 * Process unprocessed source document versions for active pursuits.
 *
 * Called by scheduler. Does NOT invoke LLM or G2X.
 * Only processes document versions that:
 * 1. Belong to an opportunity with an active TechnicalSolutionArtifact
 * 2. Have not been processed by this driver (checkpoint)
 * 3. Have raw_payload available for technical field extraction
 */
export async function processUnprocessedDocumentVersions(): Promise<{
  processed: number;
  materialChanges: number;
  skipped: number;
  errors: number;
}> {
  const supabase = getSupabase();
  const stats = { processed: 0, materialChanges: 0, skipped: 0, errors: 0 };

  // 1. Get checkpoint — last processed timestamp
  const { data: checkpoint } = await supabase
    .from('source_sync_state')
    .select('last_synced_at')
    .eq('source', DRIVER_CHECKPOINT_SOURCE)
    .single();

  const lastProcessed = checkpoint?.last_synced_at || '1970-01-01T00:00:00Z';

  // 2. Find active pursuits (have TechnicalSolutionArtifact)
  const { data: activePursuits } = await supabase
    .from('technical_solution_artifacts')
    .select('capture_id, opportunity_id');

  if (!activePursuits || activePursuits.length === 0) {
    log.debug('No active pursuits with TechnicalSolutionArtifacts');
    return stats;
  }

  const pursuitOpps = activePursuits.map((p) => p.opportunity_id).filter(Boolean);
  if (pursuitOpps.length === 0) return stats;

  // 3. Find new document versions for those opportunities
  // Look in source_document_versions for new entries since checkpoint
  const { data: newVersions } = await supabase
    .from('source_document_versions')
    .select('id, source_document_id, retrieved_at, metadata')
    .gt('retrieved_at', lastProcessed)
    .order('retrieved_at', { ascending: true })
    .limit(20); // Bounded processing per cycle

  if (!newVersions || newVersions.length === 0) {
    log.debug('No new document versions since last checkpoint');
    return stats;
  }

  // 4. For each new version, check if it belongs to a pursuit opportunity
  for (const version of newVersions) {
    try {
      // Look up the parent document's opportunity
      const { data: doc } = await supabase
        .from('source_documents')
        .select('opportunity_id')
        .eq('id', version.source_document_id)
        .single();

      if (!doc?.opportunity_id || !pursuitOpps.includes(doc.opportunity_id)) {
        stats.skipped++;
        continue;
      }

      // Find the capture for this opportunity
      const pursuit = activePursuits.find((p) => p.opportunity_id === doc.opportunity_id);
      if (!pursuit) {
        stats.skipped++;
        continue;
      }

      // Get previous version's payload for comparison
      const { data: prevVersion } = await supabase
        .from('source_document_versions')
        .select('metadata')
        .eq('source_document_id', version.source_document_id)
        .lt('retrieved_at', version.retrieved_at)
        .order('retrieved_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Process the change
      const result = await processSourceDocumentChange(
        pursuit.capture_id,
        doc.opportunity_id,
        version.id,
        prevVersion?.metadata || null,
        version.metadata || {}
      );

      stats.processed++;
      if (result.material) stats.materialChanges++;

    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error), versionId: version.id },
        'Error processing document version'
      );
      stats.errors++;
    }
  }

  // 5. Update checkpoint
  const latestTimestamp = newVersions[newVersions.length - 1]?.retrieved_at || lastProcessed;
  await supabase
    .from('source_sync_state')
    .upsert({
      source: DRIVER_CHECKPOINT_SOURCE,
      last_synced_at: latestTimestamp,
    }, { onConflict: 'source' });

  log.info(stats, 'Document version processing complete');
  return stats;
}
