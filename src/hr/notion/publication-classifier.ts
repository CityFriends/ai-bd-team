/**
 * Publication Classifier — Deterministic Content Classification
 *
 * Extends the existing Notion classifier with publication-aware rules.
 * Determines whether a page should be auto-published, sent for owner
 * review, quarantined, or excluded.
 *
 * Classification precedence (highest → lowest):
 * 1. Confidential/personalized → exclude
 * 2. Mixed content → quarantine or exclude
 * 3. Salary bands/step increases → owner review
 * 4. Sensitive HR policies → owner review
 * 5. Routine employee-safe → auto-publish
 * 6. Anything else → quarantine
 *
 * Pure function. No network, database, or credential access.
 */

import type {
  PublicationDecision,
  ContentCategory,
  ExtractionReport,
} from './publication-types.js';

// ── Confidential Exclusion Patterns ────────────────────────

/** Pages that must NEVER be indexed — individual records and admin-only content. */
const CONFIDENTIAL_TITLE_PATTERNS: RegExp[] = [
  /\bindividual\s+salary/i,
  /\bpayroll\s+(data|record|detail)/i,
  /\bperformance\s+review\b/i,
  /\bperformance\s+improvement\s+plan\b/i,
  /\b(pip)\b/i,
  /\bemployee\s+relation(s)?\s+case/i,
  /\b(disciplin|terminat)\w+\s+(record|case|file)/i,
  /\bmanager[\s-]only\b/i,
  /\bleadership[\s-]only\b/i,
  /\bconfidential\b/i,
  /\brestricted\s+access\b/i,
  /\binternal\s+only\b/i,
  /\battorney[\s-]client\b/i,
  /\blitigation\b/i,
  /\bprivileged\b/i,
  /\btax\s+(record|form|filing)/i,
  /\bw-?[249]\b/i,
  /\b(i-?9|e-?verify)\b/i,
  /\bbackground\s+check\b/i,
  /\bcandidate\s+(scorecard|evaluation|assessment)/i,
  /\binterview\s+(scorecard|rubric|feedback)/i,
  /\brecruiting\s+pipeline\b/i,
  /\bcredential(s)?\b/i,
  /\baccess\s+(key|token|secret)/i,
  /\bpassword\s+list\b/i,
  /\bapi\s+key/i,
];

const CONFIDENTIAL_CONTENT_PATTERNS: RegExp[] = [
  /\$\d{2,3},?\d{3}\s*(\/yr|per\s+year|annual|salary)/i,  // Individual salary like "$85,000/yr"
  /\bssn\b.*\d{3}[\s-]?\d{2}[\s-]?\d{4}/i,              // SSN patterns
  /\bsocial\s+security\s+number/i,
  /\b(routing|account)\s+number\s*[:=]\s*\d/i,            // Bank routing/account
];

// ── Personalized Content Patterns ──────────────────────────

const PERSONALIZED_PATTERNS: RegExp[] = [
  /\b\w+'s\s+(onboarding|review|goals|performance)/i,
  /\bmy\s+(onboarding|review|goals|performance)\b/i,
  /\b(directory|roster|headcount|personnel)\b/i,
];

// ── Salary Band / Step Increase Patterns ───────────────────

/** Employee-facing compensation structure — requires owner review, not exclusion. */
const SALARY_BAND_TITLE_PATTERNS: RegExp[] = [
  /\bsalary\s+(band|range|scale|grade|structure)/i,
  /\bpay\s+(band|range|scale|grade|structure)/i,
  /\bcompensation\s+(band|range|scale|grade|structure|framework)/i,
  /\bstep\s+(increase|progression|schedule)/i,
  /\bpay\s+progression\b/i,
  /\bwage\s+(scale|schedule|table)/i,
];

const SALARY_BAND_CONTENT_PATTERNS: RegExp[] = [
  /\b(step|grade|level|band)\s+\d+\s*[:–-]\s*\$[\d,]+/i,  // "Step 1: $45,000"
  /\$[\d,]+\s*[-–]\s*\$[\d,]+\s*(range|band|level)/i,     // "$45,000 - $65,000 range"
  /\bsalary\s+(band|grade|level)\b/i,
];

// ── Sensitive Policy Patterns ──────────────────────────────

/** Policies that require owner review before publication. */
const SENSITIVE_POLICY_TITLE_PATTERNS: RegExp[] = [
  /\bharassment\b/i,
  /\bdiscrimination\b/i,
  /\bequal\s+opportunity\b/i,
  /\bwhistleblow/i,
  /\bcompliance\b/i,
  /\bseparation\b/i,
  /\btermination\b/i,
  /\breduction\s+in\s+force\b/i,
  /\bfurlough\b/i,
  /\bdrug\s+(test|screen|policy)/i,
  /\bsecurity\s+incident\b/i,
  /\bdata\s+breach\b/i,
  /\bworkplace\s+violence\b/i,
  /\bsocial\s+media\s+policy\b/i,
];

// ── Routine Employee-Safe Patterns ─────────────────────────

/** Pages clearly safe for all employees. */
const ROUTINE_SAFE_TITLE_PATTERNS: RegExp[] = [
  /\b(pto|paid\s+time\s+off|vacation)\b/i,
  /\bsick\s+(leave|day)/i,
  /\bparental\s+leave\b/i,
  /\bmaternity\b/i,
  /\bpaternity\b/i,
  /\bbereavement\b/i,
  /\bjury\s+duty\b/i,
  /\bholiday/i,
  /\bremote\s+work\b/i,
  /\bwork\s+from\s+home\b/i,
  /\bdress\s+code\b/i,
  /\bexpense\s+(report|reimburse|policy)/i,
  /\btravel\s+policy\b/i,
  /\btimekeeping\b/i,
  /\btimesheet\b/i,
  /\bonboarding\s+(guide|checklist|overview)\b/i,
  /\bcode\s+of\s+conduct\b/i,
  /\bemployee\s+handbook\b/i,
  /\bhealth(care)?\s+(benefit|insurance|plan)/i,
  /\bdental\b/i,
  /\bvision\b/i,
  /\b401\s*k\b/i,
  /\bretirement\b/i,
  /\blife\s+insurance\b/i,
  /\bdisability\s+insurance\b/i,
  /\bopen\s+enrollment\b/i,
  /\bvoting\s+leave\b/i,
  /\bmilitary\s+(leave|duty)\b/i,
  /\bcybersecurity\b/i,
  /\bdevice\s+(policy|password)\b/i,
  /\bfamily\s+(leave|medical)\b/i,
  /\bunpaid\s+leave\b/i,
  /\bcourt\s+witness\b/i,
];

// ── Main Classifier ────────────────────────────────────────

/**
 * Context about a page's prior approval, used to determine
 * whether unchanged content can be auto-republished.
 */
export interface PriorApprovalContext {
  /** Whether a valid approval exists for the current content hash. */
  hasApprovalForCurrentHash: boolean;
  /** How the page was previously classified when last approved. */
  priorCategory?: ContentCategory;
}

/**
 * Classify a page for publication.
 *
 * @param title Page title (from Notion)
 * @param contentText Extracted page text (may be empty for unextracted pages)
 * @param ancestryPath Verified ancestry path string (e.g., "HQ Wiki / Leave / PTO")
 * @param accessClassification Root-level classification ('employee_safe', etc.)
 * @param extractionReport Optional extraction completeness report
 * @param priorApproval Prior approval context (replaces simple boolean)
 */
export function classifyForPublication(
  title: string,
  contentText: string,
  ancestryPath: string,
  accessClassification: string,
  extractionReport?: ExtractionReport,
  priorApproval?: PriorApprovalContext
): PublicationDecision {
  const reasons: string[] = [];

  // ── 1. Non-employee-safe classifications are excluded ────
  if (accessClassification === 'personalized') {
    return {
      disposition: 'exclude',
      category: 'personalized',
      reasons: ['Root classification is personalized — individual content'],
    };
  }
  if (accessClassification === 'hr_restricted') {
    return {
      disposition: 'exclude',
      category: 'confidential',
      reasons: ['Root classification is hr_restricted — admin-only content'],
    };
  }

  // ── 2. Confidential content → exclude ────────────────────
  for (const pattern of CONFIDENTIAL_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return {
        disposition: 'exclude',
        category: 'confidential',
        reasons: [`Title matches confidential pattern: ${pattern.source}`],
      };
    }
  }

  for (const pattern of CONFIDENTIAL_CONTENT_PATTERNS) {
    if (pattern.test(contentText)) {
      return {
        disposition: 'exclude',
        category: 'confidential',
        reasons: [`Content matches confidential pattern: ${pattern.source}`],
      };
    }
  }

  // ── 3. Personalized content → exclude ────────────────────
  for (const pattern of PERSONALIZED_PATTERNS) {
    if (pattern.test(title) || pattern.test(ancestryPath)) {
      return {
        disposition: 'exclude',
        category: 'personalized',
        reasons: [`Matches personalized pattern: ${pattern.source}`],
      };
    }
  }

  // ── 4. Incomplete extraction → quarantine ────────────────
  if (extractionReport && !extractionReport.isComplete) {
    // If it has table content that couldn't be fully extracted, quarantine
    if (extractionReport.hasTableContent) {
      return {
        disposition: 'quarantine',
        category: 'incomplete_extraction',
        reasons: [
          `Extraction incomplete: ${extractionReport.unsupportedBlockTypes.join(', ')}`,
          'Page contains table content that may not be fully represented',
        ],
      };
    }
    // Non-table unsupported blocks — less critical but still flag
    reasons.push(`Unsupported block types: ${extractionReport.unsupportedBlockTypes.join(', ')}`);
  }

  // ── 5. Salary bands / step increases → owner review ─────
  for (const pattern of SALARY_BAND_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return {
        disposition: 'owner_review',
        category: 'salary_band',
        reasons: [`Title matches salary band pattern: ${pattern.source}`, ...reasons],
      };
    }
  }

  for (const pattern of SALARY_BAND_CONTENT_PATTERNS) {
    if (pattern.test(contentText)) {
      return {
        disposition: 'owner_review',
        category: 'salary_band',
        reasons: [`Content matches salary band pattern: ${pattern.source}`, ...reasons],
      };
    }
  }

  // ── 6. Sensitive policies → owner review ─────────────────
  for (const pattern of SENSITIVE_POLICY_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return {
        disposition: 'owner_review',
        category: 'sensitive_policy',
        reasons: [`Title matches sensitive policy pattern: ${pattern.source}`, ...reasons],
      };
    }
  }

  // ── 7. Routine employee-safe → auto-publish ──────────────
  for (const pattern of ROUTINE_SAFE_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return {
        disposition: 'auto_publish',
        category: 'routine_employee_safe',
        reasons: [`Title matches routine safe pattern: ${pattern.source}`, ...reasons],
      };
    }
  }

  // ── 8. Previously approved ROUTINE pages → auto-publish on unchanged hash
  //    Approval history must NOT override a higher-priority classification.
  //    A page previously approved via owner review (sensitive_policy, salary_band)
  //    must continue to require owner review, not auto-publish.
  if (
    priorApproval?.hasApprovalForCurrentHash &&
    priorApproval.priorCategory === 'routine_employee_safe'
  ) {
    return {
      disposition: 'auto_publish',
      category: 'routine_employee_safe',
      reasons: ['Previously approved routine page with matching content hash', ...reasons],
    };
  }

  // ── 9. Anything else → quarantine ────────────────────────
  return {
    disposition: 'quarantine',
    category: 'unknown',
    reasons: ['No classification rule matched — quarantined for safety', ...reasons],
  };
}
