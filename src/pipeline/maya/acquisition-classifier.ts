/**
 * Acquisition-Nature Classifier
 *
 * Deterministic classification of what is being acquired.
 * Not the final Maya judgment — evidence for scoring/filtering.
 */

export type AcquisitionNature =
  | 'CUSTOM_DIGITAL_SERVICES'
  | 'COTS_PRODUCT'
  | 'SOFTWARE_LICENSE'
  | 'MAINTENANCE_SUPPORT'
  | 'MEDICAL_OR_SPECIALIZED_PRODUCT'
  | 'STAFF_AUGMENTATION'
  | 'MIXED_OR_UNKNOWN';

export interface AcquisitionClassification {
  nature: AcquisitionNature;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  signals: string[];
  hasCustomServiceComponent: boolean;
}

// ============================================================
// Signal Patterns
// ============================================================

const COTS_LICENSE_SIGNALS = [
  'software license',
  'license renewal',
  'subscription renewal',
  'saas subscription',
  'maintenance renewal',
  'annual license',
  'enterprise license',
  'software maintenance',
  'product purchase',
  'commercial software',
  'brand-name',
  'brand name',
  'cots',
  'commercial off-the-shelf',
  'licensing and service',
  'license and maintenance',
  'software subscription',
  'renewal of',
  'renew existing',
];

const MAINTENANCE_SIGNALS = [
  'maintenance support',
  'sustain',
  'sustainment',
  'operations and maintenance',
  'o&m support',
  'help desk',
  'tier 1 support',
  'tier 2 support',
  'service desk',
  'end user support',
];

const CUSTOM_SERVICE_SIGNALS = [
  'design and develop',
  'application development',
  'custom software',
  'modernization',
  'product development',
  'user research',
  'service design',
  'agile delivery',
  'iterative',
  'front-end development',
  'back-end development',
  'devsecops',
  'digital service delivery',
  'prototype',
  'human-centered',
  'hcd',
  'ux research',
  'usability testing',
  'develop a',
  'build a',
  'create a',
  'design a',
  'custom development',
  'agile development',
];

const MEDICAL_PRODUCT_SIGNALS = [
  'mri',
  'ct scan',
  'medical device',
  'clinical system',
  'laboratory management',
  'lab management',
  'pharmacy',
  'scheduling software',
  'electronic health record',
  'ehr',
  'medical imaging',
  'postprocessing software',
  'diagnostic',
];

const STAFF_AUG_SIGNALS = [
  'staff augmentation',
  'staff aug',
  'body shop',
  'provide developers',
  'provide programmers',
  'provide staff',
  'labor hour',
  'temporary staffing',
];

/**
 * Classify the nature of what is being acquired.
 * Uses title + description/scope text.
 */
export function classifyAcquisitionNature(
  title: string,
  scopeText: string
): AcquisitionClassification {
  const text = `${title} ${scopeText}`.toLowerCase();
  const signals: string[] = [];

  // Count signal hits
  const cotsHits = COTS_LICENSE_SIGNALS.filter((s) => text.includes(s));
  const maintenanceHits = MAINTENANCE_SIGNALS.filter((s) => text.includes(s));
  const customHits = CUSTOM_SERVICE_SIGNALS.filter((s) => text.includes(s));
  const medicalHits = MEDICAL_PRODUCT_SIGNALS.filter((s) => text.includes(s));
  const staffHits = STAFF_AUG_SIGNALS.filter((s) => text.includes(s));

  // Used in mixed-acquisition classification below

  // Classify
  if (staffHits.length >= 2 && customHits.length === 0) {
    signals.push(...staffHits.map((s) => `staff_aug: "${s}"`));
    return {
      nature: 'STAFF_AUGMENTATION',
      confidence: 'HIGH',
      signals,
      hasCustomServiceComponent: false,
    };
  }

  if (medicalHits.length >= 2 && customHits.length === 0) {
    signals.push(...medicalHits.map((s) => `medical: "${s}"`));
    return {
      nature: 'MEDICAL_OR_SPECIALIZED_PRODUCT',
      confidence: 'HIGH',
      signals,
      hasCustomServiceComponent: false,
    };
  }

  if (cotsHits.length >= 2 && customHits.length === 0) {
    signals.push(...cotsHits.map((s) => `cots: "${s}"`));
    if (text.includes('license') || text.includes('subscription')) {
      return {
        nature: 'SOFTWARE_LICENSE',
        confidence: 'HIGH',
        signals,
        hasCustomServiceComponent: false,
      };
    }
    return {
      nature: 'COTS_PRODUCT',
      confidence: 'HIGH',
      signals,
      hasCustomServiceComponent: false,
    };
  }

  if (maintenanceHits.length >= 2 && customHits.length === 0) {
    signals.push(...maintenanceHits.map((s) => `maintenance: "${s}"`));
    return {
      nature: 'MAINTENANCE_SUPPORT',
      confidence: 'HIGH',
      signals,
      hasCustomServiceComponent: false,
    };
  }

  // Mixed: both COTS/license AND custom service signals
  if ((cotsHits.length >= 1 || maintenanceHits.length >= 1) && customHits.length >= 1) {
    signals.push(...cotsHits.map((s) => `cots: "${s}"`));
    signals.push(...customHits.map((s) => `custom: "${s}"`));
    return {
      nature: 'MIXED_OR_UNKNOWN',
      confidence: 'MEDIUM',
      signals,
      hasCustomServiceComponent: true,
    };
  }

  if (customHits.length >= 2) {
    signals.push(...customHits.slice(0, 4).map((s) => `custom: "${s}"`));
    return {
      nature: 'CUSTOM_DIGITAL_SERVICES',
      confidence: 'HIGH',
      signals,
      hasCustomServiceComponent: true,
    };
  }

  if (customHits.length === 1) {
    signals.push(...customHits.map((s) => `custom: "${s}"`));
    return {
      nature: 'CUSTOM_DIGITAL_SERVICES',
      confidence: 'LOW',
      signals,
      hasCustomServiceComponent: true,
    };
  }

  // Single weak signals
  if (cotsHits.length >= 1) {
    signals.push(...cotsHits.map((s) => `cots: "${s}"`));
    return { nature: 'COTS_PRODUCT', confidence: 'LOW', signals, hasCustomServiceComponent: false };
  }

  if (medicalHits.length >= 1) {
    signals.push(...medicalHits.map((s) => `medical: "${s}"`));
    return {
      nature: 'MEDICAL_OR_SPECIALIZED_PRODUCT',
      confidence: 'LOW',
      signals,
      hasCustomServiceComponent: false,
    };
  }

  return {
    nature: 'MIXED_OR_UNKNOWN',
    confidence: 'LOW',
    signals: ['no_strong_signals'],
    hasCustomServiceComponent: false,
  };
}
