/**
 * Material Change Detection
 *
 * Distinguishes cosmetic updates from pursuit-relevant changes.
 * No LLM calls.
 */

import { createHash } from 'crypto';
import type { NormalizedOpportunity } from './types.js';

/** Fields included in material hash — changes to these trigger rescore/Maya wake */
const MATERIAL_FIELDS: (keyof NormalizedOpportunity)[] = [
  'title',
  'description',
  'responseDeadline',
  'setAside',
  'setAsideDescription',
  'naics',
  'psc',
  'estimatedValue',
  'placeOfPerformance',
  'vehicle',
  'active',
  'cancelled',
  'noticeType',
];

/**
 * Compute raw hash — includes everything in the normalized opportunity
 */
export function computeRawHash(opp: NormalizedOpportunity): string {
  const payload = JSON.stringify({
    sourceId: opp.sourceId,
    title: opp.title,
    description: opp.description,
    synopsis: opp.synopsis,
    agency: opp.agency,
    subAgency: opp.subAgency,
    office: opp.office,
    noticeType: opp.noticeType,
    naics: opp.naics,
    psc: opp.psc,
    setAside: opp.setAside,
    setAsideDescription: opp.setAsideDescription,
    postedDate: opp.postedDate,
    responseDeadline: opp.responseDeadline,
    estimatedValue: opp.estimatedValue,
    placeOfPerformance: opp.placeOfPerformance,
    vehicle: opp.vehicle,
    sourceUrl: opp.sourceUrl,
    active: opp.active,
    cancelled: opp.cancelled,
    attachments: opp.attachments,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Compute material hash — only pursuit-relevant fields
 */
export function computeMaterialHash(opp: NormalizedOpportunity): string {
  const materialData: Record<string, unknown> = {};
  for (const field of MATERIAL_FIELDS) {
    materialData[field] = opp[field];
  }
  // Include attachment count/names (new attachments = material)
  materialData.attachmentCount = opp.attachments.length;
  materialData.attachmentNames = opp.attachments.map((a) => a.name).sort();

  const payload = JSON.stringify(materialData);
  return createHash('sha256').update(payload).digest('hex');
}

export interface ChangeDetectionResult {
  hasRawChange: boolean;
  hasMaterialChange: boolean;
  previousRawHash: string | null;
  previousMaterialHash: string | null;
  newRawHash: string;
  newMaterialHash: string;
}

/**
 * Detect changes between stored and incoming opportunity.
 */
export function detectChanges(
  incoming: NormalizedOpportunity,
  storedRawHash: string | null,
  storedMaterialHash: string | null
): ChangeDetectionResult {
  const newRawHash = computeRawHash(incoming);
  const newMaterialHash = computeMaterialHash(incoming);

  return {
    hasRawChange: storedRawHash !== newRawHash,
    hasMaterialChange: storedMaterialHash !== newMaterialHash,
    previousRawHash: storedRawHash,
    previousMaterialHash: storedMaterialHash,
    newRawHash,
    newMaterialHash,
  };
}
