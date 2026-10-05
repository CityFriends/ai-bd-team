/**
 * David Evidence Loader
 *
 * Loads persisted previous evidence records for field-aware
 * material change classification. Does NOT cast through unknown
 * or reconstruct from hashes.
 *
 * Flow:
 *   source result from G2X
 *     → lookup latest persisted source record by provider+source_id
 *     → typed normalization of previous and current fields
 *     → field-aware material classifier
 *     → persist new evidence/version
 *     → if material AND relevance passes: create David task
 */

import { logger } from '../../lib/logger.js';
import { getSupabase } from '../../integrations/database/client.js';

const log = logger.child({ service: 'DavidEvidenceLoader' });

// ============================================================
// Types for normalized evidence fields
// ============================================================

export interface NormalizedForecastFields {
  status: string | null;
  fiscal_year: string | null;
  award_date: string | null;
  expected_date: string | null;
  solicitation_date: string | null;
  estimated_value: number | null;
  naics: string | null;
  set_aside: string | null;
  vehicle: string | null;
  contract_type: string | null;
  solicitation_number: string | null;
  cancelled: boolean | null;
}

export interface NormalizedEventFields {
  start_date: string | null;
  end_date: string | null;
  cancelled: boolean | null;
  status: string | null;
  location: string | null;
  state: string | null;
  virtual: boolean | null;
  registration_link: string | null;
  registration_deadline: string | null;
  organizer: string | null;
  agency: string | null;
  speakers: string | null;
}

// ============================================================
// Load Previous Evidence
// ============================================================

/**
 * Load the most recent persisted source record for a given provider+source_id.
 * Returns the raw_payload JSONB for field extraction.
 *
 * Returns null if:
 * - No previous record exists (NEW_SIGNAL)
 * - Record cannot be loaded (fail closed for material change, safe for evidence persist)
 */
export async function loadPreviousEvidence(
  provider: string,
  dataset: string,
  providerRecordId: string
): Promise<{
  found: boolean;
  rawPayload: Record<string, unknown> | null;
  contentHash: string | null;
}> {
  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('external_source_records')
      .select('raw_payload, content_hash')
      .eq('provider', provider)
      .eq('dataset', dataset)
      .eq('provider_record_id', providerRecordId)
      .order('retrieved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      log.warn(
        { error: error.message, provider, providerRecordId },
        'Failed to load previous evidence — fail closed for material change'
      );
      return { found: false, rawPayload: null, contentHash: null };
    }

    if (!data) {
      return { found: false, rawPayload: null, contentHash: null };
    }

    return {
      found: true,
      rawPayload: data.raw_payload as Record<string, unknown> | null,
      contentHash: data.content_hash as string | null,
    };
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Error loading previous evidence'
    );
    return { found: false, rawPayload: null, contentHash: null };
  }
}

// ============================================================
// Typed Normalization
// ============================================================

/**
 * Extract typed forecast fields from a raw G2X record payload.
 * Safe extraction — missing fields become null.
 */
export function normalizeForecastFields(
  raw: Record<string, unknown> | null
): NormalizedForecastFields {
  if (!raw) {
    return emptyForecastFields();
  }

  // G2X forecast records may have fields at top level or nested in 'facts'
  const facts = (raw.facts || raw) as Record<string, unknown>;

  return {
    status: safeString(facts.status),
    fiscal_year: safeString(facts.fiscal_year),
    award_date: safeString(facts.award_date || facts.award_date_after),
    expected_date: safeString(facts.expected_date || facts.solicitation_date),
    solicitation_date: safeString(facts.solicitation_date),
    estimated_value: safeNumber(facts.estimated_value || facts.obligated_amount),
    naics: safeString(facts.naics || facts.naics_code),
    set_aside: safeString(facts.set_aside),
    vehicle: safeString(facts.vehicle || facts.contract_vehicle),
    contract_type: safeString(facts.contract_type),
    solicitation_number: safeString(facts.solicitation_number || facts.reference_id),
    cancelled: safeBool(facts.cancelled || facts.removed),
  };
}

/**
 * Extract typed event fields from a raw G2X record payload.
 */
export function normalizeEventFields(
  raw: Record<string, unknown> | null
): NormalizedEventFields {
  if (!raw) {
    return emptyEventFields();
  }

  const facts = (raw.facts || raw) as Record<string, unknown>;

  return {
    start_date: safeString(facts.start_date),
    end_date: safeString(facts.end_date),
    cancelled: safeBool(facts.cancelled),
    status: safeString(facts.status),
    location: safeString(facts.location),
    state: safeString(facts.state),
    virtual: safeBool(facts.virtual),
    registration_link: safeString(facts.registration_link),
    registration_deadline: safeString(facts.registration_deadline),
    organizer: safeString(facts.organizer),
    agency: safeString(facts.agency),
    speakers: safeString(facts.speakers),
  };
}

// ============================================================
// Helpers
// ============================================================

function emptyForecastFields(): NormalizedForecastFields {
  return {
    status: null, fiscal_year: null, award_date: null, expected_date: null,
    solicitation_date: null, estimated_value: null, naics: null, set_aside: null,
    vehicle: null, contract_type: null, solicitation_number: null, cancelled: null,
  };
}

function emptyEventFields(): NormalizedEventFields {
  return {
    start_date: null, end_date: null, cancelled: null, status: null,
    location: null, state: null, virtual: null, registration_link: null,
    registration_deadline: null, organizer: null, agency: null, speakers: null,
  };
}

function safeString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function safeBool(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return null;
}
