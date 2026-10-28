/**
 * Page Classification — Approved Root Verification and Exclusion
 *
 * A page is eligible for indexing ONLY if it descends from an active
 * approved root. Classification comes from the root, not connection scope.
 *
 * Ancestry is resolved via the Notion API parent chain, not title approximation.
 * Structural exclusion uses the verified path, not titles alone.
 * Ambiguous or unresolvable ancestry fails closed (excluded).
 */

import { type NotionPage, getParentId } from './api-client.js';

export interface ApprovedRoot {
  id: string;
  connectionId: string;
  notionPageId: string;
  accessClassification: 'employee_safe' | 'hr_restricted' | 'personalized';
  isActive: boolean;
}

export interface ClassificationResult {
  approvedRoot: ApprovedRoot | null;
  accessClassification: 'employee_safe' | 'hr_restricted' | 'personalized' | null;
  isExcluded: boolean;
  exclusionReason: string | null;
  resolvedPath: string;
}

/**
 * Structural exclusion patterns — deny-by-default for ambiguous content.
 * Applied to the VERIFIED parent path, not the page title.
 *
 * These patterns are defense-in-depth for content that should never appear
 * under the employee-safe HQ Wiki root. The primary classification boundary
 * is the three-root architecture (employee / onboarding / admin), not these
 * patterns. Each pattern targets a specific known risk.
 */
const EXCLUDED_SUBTREE_PATTERNS = [
  /\/New Hire Onboarding Hub\/[^/]+\//i,  // Individual onboarding boards nested under shared hub
  /30-60-90 Day Plan/i,                   // Individual performance plans
  /Employee Relations\/[^/]+$/i,          // Individual employee-relations cases
  /Employee Directory$/i,                 // Personnel rosters / databases
];

const EXCLUDED_TITLE_PATTERNS = [
  /Candidate Scoring Matrices/i,          // Recruitment evaluation tools
  /Business Accounts and Logins/i,        // Credential pages
];

/**
 * Resolve the full ancestry path for a page via the parent chain.
 * Returns an array of [pageId, title] pairs from root to page.
 *
 * getPageTitle: function that fetches a page's title by ID (via Notion API).
 * Returns null if the page is inaccessible.
 */
export async function resolveAncestry(
  page: NotionPage,
  pageTitle: string,
  getPageTitle: (pageId: string) => Promise<{ id: string; title: string; parentPageId: string | null } | null>,
  maxDepth = 10
): Promise<{ path: string[]; pathString: string }> {
  const path: string[] = [pageTitle];
  let currentParentId = getParentId(page);
  const seen = new Set<string>(); // Cycle detection

  for (let depth = 0; depth < maxDepth && currentParentId; depth++) {
    if (seen.has(currentParentId)) break; // Cycle — stop
    seen.add(currentParentId);
    const parent = await getPageTitle(currentParentId);
    if (!parent) break; // Inaccessible ancestor — path is incomplete
    path.unshift(parent.title);
    currentParentId = parent.parentPageId;
  }

  return { path, pathString: path.join(' / ') };
}

/**
 * Find the approved root for a page using its resolved ancestry.
 * Checks each ancestor in the path against the approved roots.
 */
export function findApprovedRootFromAncestry(
  pageId: string,
  ancestorIds: string[],
  approvedRoots: ApprovedRoot[]
): ApprovedRoot | null {
  // Check if the page itself is an approved root
  const directRoot = approvedRoots.find((r) => r.notionPageId === pageId);
  if (directRoot) return directRoot;

  // Check each ancestor
  for (const ancestorId of ancestorIds) {
    const root = approvedRoots.find((r) => r.notionPageId === ancestorId);
    if (root) return root;
  }

  return null;
}

/**
 * Classify a page with its verified ancestry path.
 * This is the primary classification entry point when ancestry is resolved.
 */
export function classifyWithVerifiedPath(
  pageId: string,
  pageTitle: string,
  verifiedPath: string,
  ancestorIds: string[],
  approvedRoots: ApprovedRoot[]
): ClassificationResult {
  const root = findApprovedRootFromAncestry(pageId, ancestorIds, approvedRoots);

  if (!root) {
    return { approvedRoot: null, accessClassification: null, isExcluded: true,
             exclusionReason: 'not_under_approved_root', resolvedPath: verifiedPath };
  }

  if (!root.isActive) {
    return { approvedRoot: root, accessClassification: null, isExcluded: true,
             exclusionReason: 'root_deactivated', resolvedPath: verifiedPath };
  }

  // Structural exclusion against the VERIFIED path
  const exclusion = checkStructuralExclusion(verifiedPath, pageTitle);
  if (exclusion) {
    return { approvedRoot: root, accessClassification: root.accessClassification,
             isExcluded: true, exclusionReason: exclusion, resolvedPath: verifiedPath };
  }

  // Quarantine ambiguous content
  if (shouldQuarantine(pageTitle, verifiedPath)) {
    return { approvedRoot: root, accessClassification: root.accessClassification,
             isExcluded: true, exclusionReason: 'quarantined:ambiguous_content',
             resolvedPath: verifiedPath };
  }

  return {
    approvedRoot: root,
    accessClassification: root.accessClassification,
    isExcluded: false,
    exclusionReason: null,
    resolvedPath: verifiedPath,
  };
}

/**
 * Legacy classification with direct parent check only.
 * Used when ancestry cannot be resolved (API failure).
 * Fails closed — unresolvable ancestry is excluded.
 */
export function classifyPage(
  page: NotionPage,
  pagePath: string,
  pageTitle: string,
  approvedRoots: ApprovedRoot[]
): ClassificationResult {
  // Check if this page itself is an approved root
  const directRoot = approvedRoots.find((r) => r.notionPageId === page.id);
  if (directRoot) {
    if (!directRoot.isActive) {
      return { approvedRoot: directRoot, accessClassification: null, isExcluded: true,
               exclusionReason: 'root_deactivated', resolvedPath: pagePath };
    }
    return { approvedRoot: directRoot, accessClassification: directRoot.accessClassification,
             isExcluded: false, exclusionReason: null, resolvedPath: pagePath };
  }

  // Check immediate parent (page or database)
  const immediateParentId = getParentId(page);
  if (immediateParentId) {
    const parentRoot = approvedRoots.find((r) => r.notionPageId === immediateParentId);
    if (parentRoot) {
      if (!parentRoot.isActive) {
        return { approvedRoot: parentRoot, accessClassification: null, isExcluded: true,
                 exclusionReason: 'root_deactivated', resolvedPath: pagePath };
      }
      const exclusion = checkStructuralExclusion(pagePath, pageTitle);
      if (exclusion) {
        return { approvedRoot: parentRoot, accessClassification: parentRoot.accessClassification,
                 isExcluded: true, exclusionReason: exclusion, resolvedPath: pagePath };
      }
      if (shouldQuarantine(pageTitle, pagePath)) {
        return { approvedRoot: parentRoot, accessClassification: parentRoot.accessClassification,
                 isExcluded: true, exclusionReason: 'quarantined:ambiguous_content',
                 resolvedPath: pagePath };
      }
      return { approvedRoot: parentRoot, accessClassification: parentRoot.accessClassification,
               isExcluded: false, exclusionReason: null, resolvedPath: pagePath };
    }
  }

  // No root found — fail closed
  return { approvedRoot: null, accessClassification: null, isExcluded: true,
           exclusionReason: 'not_under_approved_root', resolvedPath: pagePath };
}

function checkStructuralExclusion(path: string, title: string): string | null {
  for (const pattern of EXCLUDED_SUBTREE_PATTERNS) {
    if (pattern.test(path)) return `structural:${pattern.source}`;
  }
  for (const pattern of EXCLUDED_TITLE_PATTERNS) {
    if (pattern.test(title)) return `title:${pattern.source}`;
  }
  return null;
}

/**
 * Check if a page should be quarantined (ambiguous content).
 *
 * The primary safety boundary is the three-root architecture:
 *   employee_safe  → shared HQ Wiki (no personal content)
 *   personalized   → separate onboarding root (individual boards)
 *   hr_restricted  → admin-approved roots only
 *
 * This quarantine is defense-in-depth for content that appears under
 * the wrong root. It targets specific indicators of personal content:
 *   1. Path contains possessive forms ("'s") indicating individual ownership
 *   2. Path contains "My" followed by content type (My Onboarding, My Goals)
 *   3. Title is a database-type page that might list employees
 */
export function shouldQuarantine(pageTitle: string, pagePath: string): boolean {
  // Possessive in path: "/ Joshua Han's Onboarding /" — individual ownership
  if (/\/[^/]*'s\s/i.test(pagePath)) return true;

  // "My" prefix in path segment: "/ My Onboarding /" or "/ My Goals /"
  if (/\/\s*My\s+\w/i.test(pagePath)) return true;

  // Database-type pages that might contain employee records
  if (/\b(?:Directory|Roster|Headcount|Personnel)\b/i.test(pageTitle)) return true;

  return false;
}
