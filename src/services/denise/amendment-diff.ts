/**
 * Denise Amendment Diff — Deterministic Change Detection
 *
 * Version-aware comparison of solicitation evidence BEFORE model invocation.
 * Normalizes formatting while preserving substantive content.
 * Classifies materiality deterministically where possible.
 *
 * Zero LLM calls. Zero provider imports.
 */

import { createHash } from 'crypto';
import type { AmendmentImpactClass } from './types.js';
import { AMENDMENT_IMPACT_CLASSES } from './types.js';

// ============================================================
// TYPES
// ============================================================

export interface EvidenceSpan {
  evidenceId: string;
  documentVersion: string;
  section: string;
  text: string;
}

export interface ChangeRecord {
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
  section: string;
  oldSpan: EvidenceSpan | null;
  newSpan: EvidenceSpan | null;
  oldText: string | null;
  newText: string | null;
  fingerprint: string;
  determinedMateriality: AmendmentImpactClass | null;
  requiresReasoning: boolean;
  summary: string;
}

export interface DiffResult {
  oldVersion: string;
  newVersion: string;
  changes: ChangeRecord[];
  coverageStatus: 'COMPLETE' | 'PARTIAL' | 'INCOMPLETE_SOURCE';
  administrativeOnly: boolean;
  materialChangeCount: number;
}

// ============================================================
// NORMALIZATION
// ============================================================

/** Conservative normalization: collapse whitespace but preserve substantive content */
function normalizeForDiff(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Generate deterministic fingerprint for a change */
function changeFingerprint(section: string, oldText: string | null, newText: string | null): string {
  const input = `${section}|${oldText || ''}|${newText || ''}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ============================================================
// MATERIALITY PATTERNS
// ============================================================

const ADMINISTRATIVE_PATTERNS = [
  /point\s+of\s+contact/i, /email\s+address/i, /phone\s+number/i,
  /mailing\s+address/i, /office\s+symbol/i, /room\s+number/i,
  /contracting\s+officer\s+name/i, /typo/i, /typographical/i,
];

const SUBMISSION_PATTERNS = [
  /due\s+date/i, /deadline/i, /response\s+date/i, /closing\s+date/i,
  /submission\s+portal/i, /submit\w*\s+(?:to|via|through)/i,
  /page\s+limit/i, /format\s+requirement/i, /number\s+of\s+copies/i,
  /proposal\s+due/i, /questions?\s+due/i,
];

const EVALUATION_PATTERNS = [
  /evaluation\s+factor/i, /evaluation\s+criteri/i,
  /more\s+important/i, /less\s+important/i, /most\s+important/i,
  /relative\s+importance/i, /weigh(?:t|ing|ted)/i,
  /pass\s*[\/\\]\s*fail/i, /technically\s+acceptable/i,
  /tradeoff/i, /best\s+value/i, /lpta/i, /lowest\s+price/i,
  /past\s+performance/i,
];

const ACQUISITION_PATTERNS = [
  /set[- ]?aside/i, /small\s+business/i, /naics/i, /size\s+standard/i,
  /eligib/i, /8\(a\)/i, /hubzone/i, /sdvosb/i, /wosb/i,
  /contract\s+(?:type|vehicle)/i, /idiq/i, /bpa/i,
  /period\s+of\s+performance/i, /option\s+(?:year|period)/i,
];

const CLAUSE_PATTERNS = [
  /far\s+\d/i, /dfars\s+\d/i, /\d{2}\.\d{3}/,
  /clause/i, /provision/i, /limitation\s+on\s+subcontracting/i,
  /oci/i, /conflict\s+of\s+interest/i, /security\s+clearance/i,
  /key\s+personnel/i, /subcontracting\s+plan/i,
  /reps?\s*(?:\/|and)\s*certs?/i,
];

const LEGAL_PATTERNS = [
  /rights/i, /liability/i, /protest/i, /indemnif/i,
  /intellectual\s+property/i, /data\s+rights/i, /patent/i,
  /dispute/i, /termination\s+for\s+(?:cause|convenience)/i,
];

/** Classify materiality of a text change deterministically */
export function classifyMateriality(
  oldText: string | null,
  newText: string | null
): { classifications: AmendmentImpactClass[]; requiresReasoning: boolean } {
  const combined = `${oldText || ''} ${newText || ''}`;
  const classifications: Set<AmendmentImpactClass> = new Set();

  // Check administrative first
  const isAdmin = ADMINISTRATIVE_PATTERNS.some(p => p.test(combined)) &&
    !SUBMISSION_PATTERNS.some(p => p.test(combined)) &&
    !EVALUATION_PATTERNS.some(p => p.test(combined)) &&
    !ACQUISITION_PATTERNS.some(p => p.test(combined)) &&
    !CLAUSE_PATTERNS.some(p => p.test(combined)) &&
    !LEGAL_PATTERNS.some(p => p.test(combined));

  if (isAdmin) {
    return { classifications: ['ADMINISTRATIVE_ONLY'], requiresReasoning: false };
  }

  if (SUBMISSION_PATTERNS.some(p => p.test(combined))) classifications.add('SUBMISSION_MATERIAL');
  if (EVALUATION_PATTERNS.some(p => p.test(combined))) classifications.add('EVALUATION_MATERIAL');
  if (ACQUISITION_PATTERNS.some(p => p.test(combined))) classifications.add('ACQUISITION_MATERIAL');
  if (CLAUSE_PATTERNS.some(p => p.test(combined))) classifications.add('CLAUSE_MATERIAL');
  if (LEGAL_PATTERNS.some(p => p.test(combined))) classifications.add('LEGAL_REVIEW_REQUIRED');

  if (classifications.size === 0) {
    // Can't determine — needs reasoning
    return { classifications: [], requiresReasoning: true };
  }

  return {
    classifications: Array.from(classifications),
    requiresReasoning: classifications.has('EVALUATION_MATERIAL') || classifications.has('LEGAL_REVIEW_REQUIRED'),
  };
}

// ============================================================
// DIFF ENGINE
// ============================================================

/**
 * Compare old and new evidence to produce deterministic change records.
 * Matches evidence by section identifier.
 */
export function diffEvidence(
  oldEvidence: EvidenceSpan[],
  newEvidence: EvidenceSpan[]
): DiffResult {
  const changes: ChangeRecord[] = [];
  const oldBySection = new Map(oldEvidence.map(e => [e.section, e]));
  const newBySection = new Map(newEvidence.map(e => [e.section, e]));

  const coverageOk = oldEvidence.length > 0 && newEvidence.length > 0;

  // Find modifications and removals
  for (const [section, oldSpan] of oldBySection) {
    const newSpan = newBySection.get(section);
    if (!newSpan) {
      // Section removed
      const mat = classifyMateriality(oldSpan.text, null);
      changes.push({
        changeType: 'REMOVED', section,
        oldSpan, newSpan: null,
        oldText: oldSpan.text, newText: null,
        fingerprint: changeFingerprint(section, oldSpan.text, null),
        determinedMateriality: mat.classifications[0] || null,
        requiresReasoning: mat.requiresReasoning,
        summary: `Section ${section} removed`,
      });
    } else {
      // Check for modification
      const oldNorm = normalizeForDiff(oldSpan.text);
      const newNorm = normalizeForDiff(newSpan.text);
      if (oldNorm !== newNorm) {
        const mat = classifyMateriality(oldSpan.text, newSpan.text);
        changes.push({
          changeType: 'MODIFIED', section,
          oldSpan, newSpan,
          oldText: oldSpan.text, newText: newSpan.text,
          fingerprint: changeFingerprint(section, oldSpan.text, newSpan.text),
          determinedMateriality: mat.classifications[0] || null,
          requiresReasoning: mat.requiresReasoning,
          summary: `Section ${section} modified`,
        });
      }
    }
  }

  // Find additions
  for (const [section, newSpan] of newBySection) {
    if (!oldBySection.has(section)) {
      const mat = classifyMateriality(null, newSpan.text);
      changes.push({
        changeType: 'ADDED', section,
        oldSpan: null, newSpan,
        oldText: null, newText: newSpan.text,
        fingerprint: changeFingerprint(section, null, newSpan.text),
        determinedMateriality: mat.classifications[0] || null,
        requiresReasoning: mat.requiresReasoning,
        summary: `Section ${section} added`,
      });
    }
  }

  const materialChanges = changes.filter(c => c.determinedMateriality !== 'ADMINISTRATIVE_ONLY');
  const adminOnly = changes.length > 0 && materialChanges.length === 0;

  return {
    oldVersion: oldEvidence[0]?.documentVersion || 'unknown',
    newVersion: newEvidence[0]?.documentVersion || 'unknown',
    changes,
    coverageStatus: !coverageOk ? 'INCOMPLETE_SOURCE' : 'COMPLETE',
    administrativeOnly: adminOnly,
    materialChangeCount: materialChanges.length,
  };
}
