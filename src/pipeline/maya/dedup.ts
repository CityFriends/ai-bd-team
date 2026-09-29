/**
 * Opportunity Deduplication
 *
 * Exact dedupe: source + sourceId
 * Cross-source: solicitation number + agency + title similarity
 * No LLM calls.
 */

import type { NormalizedOpportunity } from './types.js';
import { createHash } from 'crypto';

export interface DedupResult {
  isDuplicate: boolean;
  matchedSourceId?: string;
  matchType?: 'exact_source' | 'solicitation_number' | 'title_similarity';
}

/**
 * Check if an opportunity is a duplicate of an existing one.
 * Uses database lookup for exact source+sourceId match.
 */
export async function checkDuplicate(
  opp: NormalizedOpportunity,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<DedupResult> {
  // 1. Exact source+sourceId match
  const { data: exactMatch } = await supabase
    .from('pipeline_opportunities')
    .select('source_id')
    .eq('source', opp.source)
    .eq('source_id', opp.sourceId)
    .limit(1);

  if (exactMatch && exactMatch.length > 0) {
    return {
      isDuplicate: true,
      matchedSourceId: exactMatch[0].source_id,
      matchType: 'exact_source',
    };
  }

  // 2. Solicitation number match (cross-source)
  if (opp.solicitationNumber) {
    const { data: solMatch } = await supabase
      .from('pipeline_opportunities')
      .select('source_id')
      .eq('solicitation_number', opp.solicitationNumber)
      .limit(1);

    if (solMatch && solMatch.length > 0) {
      return {
        isDuplicate: true,
        matchedSourceId: solMatch[0].source_id,
        matchType: 'solicitation_number',
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Generate a hash for deduplication lookup.
 */
export function generateDedupKey(source: string, sourceId: string): string {
  return createHash('sha256').update(`${source}:${sourceId}`).digest('hex');
}
