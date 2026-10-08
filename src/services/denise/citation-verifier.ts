/**
 * Denise — Citation Verification
 *
 * Deterministic citation/evidence verification.
 * If a conclusion claims "FAR 52.x requires Y", the associated
 * analysis must contain retrieved authoritative evidence.
 *
 * Without evidence: FAIL CLOSED.
 * No confident unsupported regulatory assertions in artifacts.
 *
 * Zero LLM calls. Zero provider imports.
 */

import type { SupabaseClient } from './types.js';

export interface CitationVerificationResult {
  valid: boolean;
  citation: string;
  evidenceId: string | null;
  reason: string;
}

/**
 * Verify that a claimed citation has backing regulatory evidence.
 *
 * FAIL-CLOSED: Returns valid=false if evidence cannot be found.
 */
export async function verifyCitation(
  supabase: SupabaseClient,
  authority: string,
  citation: string
): Promise<CitationVerificationResult> {
  const { data, error } = await supabase
    .from('regulatory_evidence')
    .select('id, authority, citation, freshness_status')
    .eq('authority', authority)
    .eq('citation', citation)
    .eq('freshness_status', 'CURRENT')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return {
      valid: false,
      citation: `${authority} ${citation}`,
      evidenceId: null,
      reason: 'AUTHORITATIVE_SOURCE_NOT_FOUND',
    };
  }

  return {
    valid: true,
    citation: `${authority} ${citation}`,
    evidenceId: data.id,
    reason: `Evidence found: ${data.id}`,
  };
}

/**
 * Verify multiple citations. ALL must pass for the batch to be valid.
 * Single failure → entire batch fails closed.
 */
export async function verifyCitations(
  supabase: SupabaseClient,
  citations: Array<{ authority: string; citation: string }>
): Promise<{
  allValid: boolean;
  results: CitationVerificationResult[];
  failures: CitationVerificationResult[];
}> {
  const results: CitationVerificationResult[] = [];

  for (const { authority, citation } of citations) {
    const result = await verifyCitation(supabase, authority, citation);
    results.push(result);
  }

  const failures = results.filter((r) => !r.valid);

  return {
    allValid: failures.length === 0,
    results,
    failures,
  };
}

/**
 * Create a regulatory evidence record for a verified source.
 */
export async function createRegulatoryEvidence(
  supabase: SupabaseClient,
  params: {
    authority: string;
    citation: string;
    provision?: string;
    sourceUrl?: string;
    title?: string;
    version?: string;
    effectiveDate?: string;
    contentHash: string;
    boundedRelevantText: string;
    idempotencyKey: string;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from('regulatory_evidence')
    .insert({
      authority: params.authority,
      citation: params.citation,
      provision: params.provision || null,
      source_url: params.sourceUrl || null,
      title: params.title || null,
      version: params.version || null,
      effective_date: params.effectiveDate || null,
      content_hash: params.contentHash,
      bounded_relevant_text: params.boundedRelevantText,
      idempotency_key: params.idempotencyKey,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create regulatory evidence: ${error.message}`);
  return data.id;
}
