/**
 * Marcus Deterministic Material Technical Change Classifier
 *
 * Separates two concerns:
 * 1. "Did the technical fields change?" (content comparison) -> persist new version
 * 2. "Is the change material enough to wake Marcus?" (field analysis) -> create task
 *
 * Non-material changes (formatting, document timestamps, administrative wording,
 * contact info, contracting metadata) are persisted as evidence/version updates
 * but do NOT create Marcus tasks.
 *
 * IMPORTANT: This classifier uses NO LLM calls. All classification is
 * deterministic based on field comparison rules.
 *
 * Ambiguous changes -> TECHNICAL_CHANGE_REVIEW_REQUIRED, no LLM call.
 */

import { logger } from '../../lib/logger.js';
import { MaterialTechnicalChangeType, type MaterialTechnicalChangeTypeValue } from './types.js';

const log = logger.child({ service: 'MarcusTechnicalChange' });

// ============================================================
// Types
// ============================================================

export interface TechnicalChangeReason {
  field: string;
  description: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface TechnicalChangeResult {
  /** Did the raw content change at all? */
  changed: boolean;
  /** Is the change significant enough to wake Marcus? */
  material: boolean;
  /** Could not determine materiality -- requires human review */
  ambiguous: boolean;
  /** Specific material change reasons */
  reasons: TechnicalChangeReason[];
  /** Fields that changed (including non-material) */
  changedFields: string[];
  /** Classification of the technical change */
  classification: MaterialTechnicalChangeTypeValue | null;
}

// ============================================================
// Normalized Technical Fields
// ============================================================

export interface NormalizedTechnicalFields {
  /** Hosting/cloud requirement */
  hostingCloud: string | null;
  /** Mandatory technology stack */
  mandatoryTechnology: string | null;
  /** Architecture constraint */
  architectureConstraint: string | null;
  /** API/integration requirement */
  apiIntegration: string | null;
  /** Data handling requirement */
  dataHandling: string | null;
  /** Security/compliance requirement */
  securityCompliance: string | null;
  /** Clearance requirement */
  clearance: string | null;
  /** Accessibility requirement */
  accessibility: string | null;
  /** Performance/SLA requirement */
  performanceSla: string | null;
  /** DevSecOps/deployment requirement */
  devsecopsDeployment: string | null;
  /** Technical certification requirement */
  technicalCertification: string | null;
  /** Technical scope description */
  technicalScope: string | null;
}

// ============================================================
// Material Technical Fields
// ============================================================

/** Fields whose change is material for technical assessments */
const MATERIAL_TECHNICAL_FIELDS: Record<
  string,
  {
    changeType: MaterialTechnicalChangeTypeValue;
    detector: (oldVal: unknown, newVal: unknown) => TechnicalChangeReason | null;
  }
> = {
  hostingCloud: {
    changeType: MaterialTechnicalChangeType.HOSTING_CLOUD,
    detector: exactChangeDetector('hostingCloud', 'Hosting/cloud requirement changed'),
  },
  mandatoryTechnology: {
    changeType: MaterialTechnicalChangeType.MANDATORY_TECHNOLOGY,
    detector: exactChangeDetector('mandatoryTechnology', 'Mandatory technology requirement changed'),
  },
  architectureConstraint: {
    changeType: MaterialTechnicalChangeType.ARCHITECTURE_CONSTRAINT,
    detector: exactChangeDetector('architectureConstraint', 'Architecture constraint changed'),
  },
  apiIntegration: {
    changeType: MaterialTechnicalChangeType.API_INTEGRATION,
    detector: exactChangeDetector('apiIntegration', 'API/integration requirement changed'),
  },
  dataHandling: {
    changeType: MaterialTechnicalChangeType.DATA_HANDLING,
    detector: exactChangeDetector('dataHandling', 'Data handling requirement changed'),
  },
  securityCompliance: {
    changeType: MaterialTechnicalChangeType.SECURITY_COMPLIANCE,
    detector: exactChangeDetector('securityCompliance', 'Security/compliance requirement changed'),
  },
  clearance: {
    changeType: MaterialTechnicalChangeType.CLEARANCE,
    detector: exactChangeDetector('clearance', 'Clearance requirement changed'),
  },
  accessibility: {
    changeType: MaterialTechnicalChangeType.ACCESSIBILITY,
    detector: exactChangeDetector('accessibility', 'Accessibility requirement changed'),
  },
  performanceSla: {
    changeType: MaterialTechnicalChangeType.PERFORMANCE_SLA,
    detector: exactChangeDetector('performanceSla', 'Performance/SLA requirement changed'),
  },
  devsecopsDeployment: {
    changeType: MaterialTechnicalChangeType.DEVSECOPS_DEPLOYMENT,
    detector: exactChangeDetector('devsecopsDeployment', 'DevSecOps/deployment requirement changed'),
  },
  technicalCertification: {
    changeType: MaterialTechnicalChangeType.TECHNICAL_CERTIFICATION,
    detector: exactChangeDetector('technicalCertification', 'Technical certification requirement changed'),
  },
  technicalScope: {
    changeType: MaterialTechnicalChangeType.TECHNICAL_SCOPE,
    detector: scopeChangeDetector(),
  },
};

/** Fields that are NOT material for technical assessments (cosmetic/administrative) */
const NONMATERIAL_FIELDS = new Set([
  // Formatting
  'formatting',
  'whitespace',
  'lineBreaks',
  // Document timestamps
  'documentDate',
  'revisionDate',
  'publishDate',
  'lastModified',
  // Administrative wording
  'adminWording',
  'boilerplate',
  'instructions',
  // Contact info
  'contactName',
  'contactEmail',
  'contactPhone',
  'contractingOfficer',
  // Contracting metadata
  'contractNumber',
  'taskOrderNumber',
  'piid',
  'modNumber',
  'solicitationNumber',
  'responseDeadline',
  'questionDeadline',
]);

// ============================================================
// Public API
// ============================================================

/**
 * Classify whether a technical change is material enough to wake Marcus.
 *
 * Returns classification with material/ambiguous/changed flags.
 * NO LLM calls -- purely deterministic field comparison.
 *
 * Ambiguous changes (cannot determine) -> TECHNICAL_CHANGE_REVIEW_REQUIRED.
 */
export function classifyTechnicalChange(
  oldFields: NormalizedTechnicalFields,
  newFields: NormalizedTechnicalFields
): TechnicalChangeResult {
  const changedFields: string[] = [];
  const reasons: TechnicalChangeReason[] = [];
  let classification: MaterialTechnicalChangeTypeValue | null = null;
  let hasAmbiguous = false;

  const oldRecord = toRecord(oldFields);
  const newRecord = toRecord(newFields);

  // Check all fields in both old and new
  const allKeys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    const oldVal = oldRecord[key];
    const newVal = newRecord[key];

    // Skip if identical after normalization
    if (normalizeValue(oldVal) === normalizeValue(newVal)) continue;

    changedFields.push(key);

    // Check if this is a material technical field
    const materialField = MATERIAL_TECHNICAL_FIELDS[key];
    if (materialField) {
      const reason = materialField.detector(oldVal, newVal);
      if (reason) {
        reasons.push(reason);
        // Use the first material change type as the classification
        if (!classification) {
          classification = materialField.changeType;
        }
      } else {
        // Known technical field changed but detector returned null →
        // the change is too minor/uncertain for deterministic classification.
        // Mark as ambiguous: TECHNICAL_CHANGE_REVIEW_REQUIRED, no LLM.
        hasAmbiguous = true;
      }
      continue;
    }

    // Check if this is a known nonmaterial field
    if (NONMATERIAL_FIELDS.has(key)) {
      // Known cosmetic -- no action
      continue;
    }

    // Unknown field changed -- ambiguous
    hasAmbiguous = true;
  }

  const changed = changedFields.length > 0;
  const material = reasons.length > 0;

  // If ambiguous and not already classified as material, mark as review required
  if (hasAmbiguous && !material) {
    classification = MaterialTechnicalChangeType.TECHNICAL_CHANGE_REVIEW_REQUIRED;
  }

  if (changed && !material && !hasAmbiguous) {
    log.info(
      { changedFields, cosmeticOnly: true },
      'Technical fields changed but non-material -- evidence updated, no Marcus wake'
    );
  }

  if (material) {
    log.info(
      {
        materialReasons: reasons.map((r) => r.description),
        changedFields,
        classification,
      },
      'Material technical change detected -- Marcus wake eligible'
    );
  }

  if (hasAmbiguous && !material) {
    log.info(
      { changedFields, ambiguous: true },
      'Ambiguous technical change -- TECHNICAL_CHANGE_REVIEW_REQUIRED, no LLM call'
    );
  }

  return {
    changed,
    material,
    ambiguous: hasAmbiguous && !material,
    reasons,
    changedFields,
    classification,
  };
}

/**
 * Normalize raw payload from source documents into typed technical fields.
 *
 * Extracts technical-relevant fields from unstructured source data.
 * This is a deterministic extraction -- no LLM involved.
 */
export function normalizeTechnicalFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawPayload: Record<string, any>
): NormalizedTechnicalFields {
  return {
    hostingCloud: extractField(rawPayload, [
      'hosting', 'cloud', 'cloud_requirement', 'hosting_requirement',
      'infrastructure', 'deployment_environment',
    ]),
    mandatoryTechnology: extractField(rawPayload, [
      'mandatory_technology', 'required_technology', 'technology_stack',
      'required_platform', 'mandatory_platform',
    ]),
    architectureConstraint: extractField(rawPayload, [
      'architecture', 'architecture_constraint', 'system_architecture',
      'design_constraint', 'architectural_requirement',
    ]),
    apiIntegration: extractField(rawPayload, [
      'api', 'integration', 'api_requirement', 'integration_requirement',
      'interface_requirement', 'data_exchange',
    ]),
    dataHandling: extractField(rawPayload, [
      'data_handling', 'data_requirement', 'data_classification',
      'data_protection', 'pii', 'phi', 'cui',
    ]),
    securityCompliance: extractField(rawPayload, [
      'security', 'compliance', 'security_requirement', 'compliance_requirement',
      'fedramp', 'fisma', 'nist', 'stigs', 'rmf', 'ato',
    ]),
    clearance: extractField(rawPayload, [
      'clearance', 'security_clearance', 'clearance_requirement',
      'clearance_level', 'secret', 'top_secret', 'ts_sci',
    ]),
    accessibility: extractField(rawPayload, [
      'accessibility', 'section_508', '508_compliance', 'wcag',
      'ada', 'accessibility_requirement',
    ]),
    performanceSla: extractField(rawPayload, [
      'performance', 'sla', 'service_level', 'uptime', 'availability',
      'response_time', 'performance_requirement',
    ]),
    devsecopsDeployment: extractField(rawPayload, [
      'devsecops', 'devops', 'cicd', 'ci_cd', 'deployment',
      'deployment_requirement', 'pipeline',
    ]),
    technicalCertification: extractField(rawPayload, [
      'certification', 'technical_certification', 'iso', 'cmmi',
      'soc2', 'soc_2', 'certification_requirement',
    ]),
    technicalScope: extractField(rawPayload, [
      'technical_scope', 'scope', 'scope_of_work', 'sow',
      'performance_work_statement', 'pws',
    ]),
  };
}

// ============================================================
// Field Change Detectors
// ============================================================

function exactChangeDetector(
  field: string,
  description: string
): (oldVal: unknown, newVal: unknown) => TechnicalChangeReason | null {
  return (oldVal, newVal) => {
    const oldStr = normalizeValue(oldVal);
    const newStr = normalizeValue(newVal);

    if (oldStr === newStr) return null;

    // Both empty -> no change
    if (!oldStr && !newStr) return null;

    return {
      field,
      description,
      oldValue: oldStr || null,
      newValue: newStr || null,
    };
  };
}

/**
 * Scope change detector with ambiguity handling.
 *
 * Domain rationale: technicalScope changes are only material when they
 * meaningfully alter what is being delivered. Minor rewording (same words
 * in different order, small edits < 20% of content) is ambiguous because
 * a deterministic classifier cannot distinguish substantive scope change
 * from editorial revision without understanding meaning.
 *
 * Material: values differ substantially (> 20% character difference)
 * Ambiguous: values differ but < 20% — TECHNICAL_CHANGE_REVIEW_REQUIRED
 * Returns null only if values are identical (handled by outer loop).
 */
function scopeChangeDetector(): (oldVal: unknown, newVal: unknown) => TechnicalChangeReason | null {
  return (oldVal, newVal) => {
    const oldStr = normalizeValue(oldVal);
    const newStr = normalizeValue(newVal);

    if (oldStr === newStr) return null;
    if (!oldStr && !newStr) return null;

    // New scope where none existed → material
    if (!oldStr && newStr) {
      return { field: 'technicalScope', description: 'Technical scope added', oldValue: null, newValue: newStr };
    }

    // Scope removed → material
    if (oldStr && !newStr) {
      return { field: 'technicalScope', description: 'Technical scope removed', oldValue: oldStr, newValue: null };
    }

    // Both present — check if change is substantial
    const maxLen = Math.max(oldStr.length, newStr.length);
    let diffChars = 0;
    for (let i = 0; i < maxLen; i++) {
      if ((oldStr[i] || '') !== (newStr[i] || '')) diffChars++;
    }
    const diffRatio = diffChars / maxLen;

    if (diffRatio > 0.2) {
      // Substantial change → material
      return { field: 'technicalScope', description: 'Technical scope changed substantially', oldValue: oldStr, newValue: newStr };
    }

    // Minor change → ambiguous (cannot determine if material without semantic analysis)
    // This returns null from the detector, causing the classifier to flag it as ambiguous
    // via the "unknown field" path since no material reason was produced but field DID change
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

function toRecord(fields: NormalizedTechnicalFields): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    result[k] = v;
  }
  return result;
}

/**
 * Extract a field value from a raw payload by checking multiple possible keys.
 * Returns the first non-empty match or null.
 */
function extractField(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawPayload: Record<string, any>,
  possibleKeys: string[]
): string | null {
  for (const key of possibleKeys) {
    const val = rawPayload[key];
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return null;
}
