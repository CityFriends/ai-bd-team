/**
 * David Field-Aware Material Change Classifier
 *
 * Separates two concerns:
 * 1. "Did the source record change?" (content hash) → persist new version
 * 2. "Is the change material enough to wake David?" (field analysis) → create task
 *
 * Non-material changes (formatting, punctuation, ordering) are persisted
 * as evidence/version updates but do NOT create David tasks.
 *
 * Material changes are field-specific and signal-type-aware.
 */

import { logger } from '../../lib/logger.js';
import type {
  NormalizedForecastFields,
  NormalizedEventFields,
} from './evidence-loader.js';

const log = logger.child({ service: 'DavidMaterialChange' });

// ============================================================
// Types
// ============================================================

export interface MaterialChangeResult {
  /** Did the raw content change at all? */
  changed: boolean;
  /** Is the change significant enough to wake David? */
  material: boolean;
  /** Specific material change reasons */
  reasons: MaterialChangeReason[];
  /** Fields that changed (including non-material) */
  changedFields: string[];
}

export interface MaterialChangeReason {
  field: string;
  description: string;
  oldValue: string | null;
  newValue: string | null;
}

// ============================================================
// Forecast Material Fields
// ============================================================

/** Fields whose change is material for forecasts */
const FORECAST_MATERIAL_FIELDS: Record<
  string,
  (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null
> = {
  // Date changes (meaningful shift, not formatting)
  award_date: dateChangeDetector('award_date', 'Award date changed meaningfully'),
  expected_date: dateChangeDetector('expected_date', 'Expected solicitation date changed'),
  solicitation_date: dateChangeDetector('solicitation_date', 'Solicitation date changed'),
  award_date_after: dateChangeDetector('award_date_after', 'Award date range start changed'),
  award_date_before: dateChangeDetector('award_date_before', 'Award date range end changed'),

  // Value changes
  estimated_value: numericChangeDetector('estimated_value', 'Estimated value changed', 0.1),
  obligated_amount: numericChangeDetector('obligated_amount', 'Obligated amount changed', 0.1),

  // Status/maturity changes
  status: exactChangeDetector('status', 'Forecast status changed'),
  fiscal_year: exactChangeDetector('fiscal_year', 'Fiscal year changed'),

  // Acquisition changes
  naics: exactChangeDetector('naics', 'NAICS code changed'),
  set_aside: exactChangeDetector('set_aside', 'Set-aside changed'),
  vehicle: exactChangeDetector('vehicle', 'Acquisition vehicle changed'),
  contract_type: exactChangeDetector('contract_type', 'Contract type changed'),

  // Reference changes (solicitation number appearing)
  solicitation_number: addedDetector('solicitation_number', 'Solicitation number added'),
  reference_id: addedDetector('reference_id', 'Reference identifier added'),

  // Cancellation/removal
  cancelled: exactChangeDetector('cancelled', 'Forecast cancelled or restored'),
  removed: exactChangeDetector('removed', 'Forecast removed'),
};

/** Fields that are NOT material for forecasts (cosmetic) */
const FORECAST_COSMETIC_FIELDS = new Set([
  'description',
  'title',
  'agency_name',
  'office_name',
  'retrieved_at',
  'updated_at',
  'source_url',
  'record_url',
]);

// ============================================================
// Event Material Fields
// ============================================================

/** Fields whose change is material for events */
const EVENT_MATERIAL_FIELDS: Record<
  string,
  (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null
> = {
  // Date/time changes
  start_date: dateChangeDetector('start_date', 'Event start date changed'),
  end_date: dateChangeDetector('end_date', 'Event end date changed'),

  // Cancellation
  cancelled: exactChangeDetector('cancelled', 'Event cancelled or restored'),
  status: exactChangeDetector('status', 'Event status changed'),

  // Location/format changes
  location: exactChangeDetector('location', 'Event location changed'),
  state: exactChangeDetector('state', 'Event state changed'),
  virtual: exactChangeDetector('virtual', 'Virtual/in-person status changed'),

  // Registration
  registration_link: addedDetector('registration_link', 'Registration URL became available'),
  registration_deadline: dateChangeDetector(
    'registration_deadline',
    'Registration deadline added or changed'
  ),

  // Organizer/agency
  organizer: exactChangeDetector('organizer', 'Event organizer changed'),
  agency: exactChangeDetector('agency', 'Associated agency changed'),
};

/** Fields that are NOT material for events (cosmetic) */
const EVENT_COSMETIC_FIELDS = new Set([
  'summary',
  'description',
  'retrieved_at',
  'updated_at',
  'record_url',
  'source_url',
  'sponsors_count',
  'agenda_days',
]);

// ============================================================
// Public API
// ============================================================

/**
 * Classify whether a forecast change is material enough to wake David.
 *
 * Accepts typed NormalizedForecastFields from evidence-loader.
 * Cosmetic changes (formatting, description edits) are detected
 * but classified as non-material.
 */
export function classifyForecastChange(
  oldFields: NormalizedForecastFields,
  newFields: NormalizedForecastFields
): MaterialChangeResult {
  return classifyChange(
    toRecord(oldFields),
    toRecord(newFields),
    FORECAST_MATERIAL_FIELDS,
    FORECAST_COSMETIC_FIELDS,
    'forecast'
  );
}

/**
 * Classify whether an event change is material enough to wake David.
 *
 * Accepts typed NormalizedEventFields from evidence-loader.
 */
export function classifyEventChange(
  oldFields: NormalizedEventFields,
  newFields: NormalizedEventFields
): MaterialChangeResult {
  return classifyChange(
    toRecord(oldFields),
    toRecord(newFields),
    EVENT_MATERIAL_FIELDS,
    EVENT_COSMETIC_FIELDS,
    'event'
  );
}

/** Convert typed fields to Record for generic classifier iteration */
function toRecord(fields: NormalizedForecastFields | NormalizedEventFields): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    result[k] = v;
  }
  return result;
}

/**
 * Classify whether a speaker list change is material.
 * Speaker ordering changes are cosmetic; new relevant speakers are material.
 */
export function classifySpeakerChange(
  oldSpeakers: string | null,
  newSpeakers: string | null
): MaterialChangeReason | null {
  if (!oldSpeakers && !newSpeakers) return null;
  if (!oldSpeakers && newSpeakers) {
    return {
      field: 'speakers',
      description: 'Speakers added to event',
      oldValue: null,
      newValue: newSpeakers,
    };
  }
  if (oldSpeakers && !newSpeakers) return null; // Removal is cosmetic

  // Normalize: lowercase, sort, deduplicate
  const normalize = (s: string) =>
    [...new Set(s.toLowerCase().split(/[,;]/).map((x) => x.trim()).filter(Boolean))].sort();

  const oldNorm = normalize(oldSpeakers!);
  const newNorm = normalize(newSpeakers!);

  // Same speakers, different ordering → cosmetic
  if (JSON.stringify(oldNorm) === JSON.stringify(newNorm)) return null;

  // New speakers added
  const added = newNorm.filter((s) => !oldNorm.includes(s));
  if (added.length > 0) {
    return {
      field: 'speakers',
      description: `New speaker(s) added: ${added.join(', ')}`,
      oldValue: oldSpeakers,
      newValue: newSpeakers,
    };
  }

  return null; // Speakers removed only → cosmetic
}

// ============================================================
// Core Classifier
// ============================================================

function classifyChange(
  oldFields: Record<string, unknown>,
  newFields: Record<string, unknown>,
  materialDetectors: Record<
    string,
    (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null
  >,
  _cosmeticFields: Set<string>,
  signalType: string
): MaterialChangeResult {
  const changedFields: string[] = [];
  const reasons: MaterialChangeReason[] = [];

  // Check all fields in both old and new
  const allKeys = new Set([...Object.keys(oldFields), ...Object.keys(newFields)]);

  for (const key of allKeys) {
    const oldVal = oldFields[key];
    const newVal = newFields[key];

    // Skip if identical
    if (normalizeValue(oldVal) === normalizeValue(newVal)) continue;

    changedFields.push(key);

    // Check if this field has a material change detector
    const detector = materialDetectors[key];
    if (detector) {
      const reason = detector(oldVal, newVal);
      if (reason) {
        reasons.push(reason);
      }
    }
    // If not in material detectors and not cosmetic, it's unknown → cosmetic
  }

  const changed = changedFields.length > 0;
  const material = reasons.length > 0;

  if (changed && !material) {
    log.info(
      { signalType, changedFields, cosmeticOnly: true },
      'Source changed but non-material — evidence updated, no David wake'
    );
  }

  if (material) {
    log.info(
      {
        signalType,
        materialReasons: reasons.map((r) => r.description),
        changedFields,
      },
      'Material change detected — David wake eligible'
    );
  }

  return { changed, material, reasons, changedFields };
}

// ============================================================
// Field Change Detectors
// ============================================================

function dateChangeDetector(
  field: string,
  description: string
): (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null {
  return (oldVal, newVal) => {
    const oldDate = parseDate(oldVal);
    const newDate = parseDate(newVal);

    // Both null → no change
    if (!oldDate && !newDate) return null;

    // One added/removed → material
    if (!oldDate && newDate) {
      return { field, description: `${description} (added)`, oldValue: null, newValue: String(newVal) };
    }
    if (oldDate && !newDate) {
      return { field, description: `${description} (removed)`, oldValue: String(oldVal), newValue: null };
    }

    // Both present — check if meaningfully different (>1 day)
    const diffMs = Math.abs(oldDate!.getTime() - newDate!.getTime());
    if (diffMs > 24 * 60 * 60 * 1000) {
      return {
        field,
        description,
        oldValue: oldDate!.toISOString().slice(0, 10),
        newValue: newDate!.toISOString().slice(0, 10),
      };
    }

    // Same date, different formatting → cosmetic
    return null;
  };
}

function numericChangeDetector(
  field: string,
  description: string,
  thresholdPercent: number
): (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null {
  return (oldVal, newVal) => {
    const oldNum = typeof oldVal === 'number' ? oldVal : parseFloat(String(oldVal || ''));
    const newNum = typeof newVal === 'number' ? newVal : parseFloat(String(newVal || ''));

    if (isNaN(oldNum) && isNaN(newNum)) return null;
    if (isNaN(oldNum) || isNaN(newNum)) {
      return { field, description, oldValue: String(oldVal), newValue: String(newVal) };
    }

    // Check percentage change
    const base = Math.max(Math.abs(oldNum), 1);
    const pctChange = Math.abs(newNum - oldNum) / base;

    if (pctChange >= thresholdPercent) {
      return { field, description, oldValue: String(oldNum), newValue: String(newNum) };
    }

    return null; // Change within threshold → cosmetic
  };
}

function exactChangeDetector(
  field: string,
  description: string
): (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null {
  return (oldVal, newVal) => {
    const oldStr = normalizeValue(oldVal);
    const newStr = normalizeValue(newVal);

    if (oldStr === newStr) return null;

    return {
      field,
      description,
      oldValue: oldStr || null,
      newValue: newStr || null,
    };
  };
}

function addedDetector(
  field: string,
  description: string
): (oldVal: unknown, newVal: unknown) => MaterialChangeReason | null {
  return (oldVal, newVal) => {
    // Only material if value was absent and is now present
    if (!oldVal && newVal) {
      return { field, description, oldValue: null, newValue: String(newVal) };
    }
    return null;
  };
}

// ============================================================
// Helpers
// ============================================================

function normalizeValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim().toLowerCase();
  return String(val).trim().toLowerCase();
}

function parseDate(val: unknown): Date | null {
  if (!val) return null;
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? null : d;
}
