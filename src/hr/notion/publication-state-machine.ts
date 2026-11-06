/**
 * Publication State Machine — Pure Lifecycle Transitions
 *
 * Manages page publication lifecycle without database access.
 * All functions are pure — they return transition decisions that
 * the caller applies to the database.
 *
 * Publication status is NOT an authorization bypass. Retrieval
 * eligibility still requires a valid content-hash approval in
 * hr_page_approvals, enforced by hr_retrieve_knowledge_v2.
 */

import type {
  PublicationStatus,
  PublicationDecision,
  PublicationTransition,
} from './publication-types.js';

// ── Valid Transitions ──────────────────────────────────────

const VALID_TRANSITIONS: ReadonlyMap<PublicationStatus, ReadonlySet<PublicationStatus>> = new Map([
  ['pending', new Set<PublicationStatus>(['auto_approved', 'awaiting_review', 'quarantined', 'excluded', 'archived'])],
  ['auto_approved', new Set<PublicationStatus>(['suspended', 'quarantined', 'excluded', 'archived'])],
  ['awaiting_review', new Set<PublicationStatus>(['approved', 'quarantined', 'excluded', 'archived', 'awaiting_review'])],
  ['approved', new Set<PublicationStatus>(['suspended', 'quarantined', 'excluded', 'archived'])],
  ['suspended', new Set<PublicationStatus>(['awaiting_review', 'auto_approved', 'approved', 'quarantined', 'excluded', 'archived'])],
  ['quarantined', new Set<PublicationStatus>(['awaiting_review', 'excluded', 'archived'])],
  ['excluded', new Set<PublicationStatus>(['archived'])],
  ['archived', new Set<PublicationStatus>([])],  // terminal state
]);

/**
 * Check whether a transition is valid.
 */
export function isValidTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ── Transition Logic ───────────────────────────────────────

/**
 * Determine the initial publication status for a newly discovered page.
 */
export function resolveInitialStatus(
  decision: PublicationDecision
): PublicationTransition {
  switch (decision.disposition) {
    case 'auto_publish':
      return {
        from: 'pending',
        to: 'auto_approved',
        reason: `Auto-approved: ${decision.reasons[0] || decision.category}`,
        contentHash: undefined,
      };
    case 'owner_review':
      return {
        from: 'pending',
        to: 'awaiting_review',
        reason: `Requires owner review: ${decision.reasons[0] || decision.category}`,
      };
    case 'quarantine':
      return {
        from: 'pending',
        to: 'quarantined',
        reason: `Quarantined: ${decision.reasons[0] || decision.category}`,
      };
    case 'exclude':
      return {
        from: 'pending',
        to: 'excluded',
        reason: `Excluded: ${decision.reasons[0] || decision.category}`,
      };
  }
}

/**
 * Determine what happens when an existing page's content changes.
 *
 * @param currentStatus Current publication status
 * @param newDecision Classification decision for the new content
 * @param contentHashChanged Whether the content hash actually changed
 */
export function resolveContentUpdate(
  currentStatus: PublicationStatus,
  newDecision: PublicationDecision,
  contentHashChanged: boolean
): PublicationTransition | null {
  // No hash change → no status change needed
  if (!contentHashChanged) return null;

  // Archived pages stay archived
  if (currentStatus === 'archived') return null;

  // New content reclassified as confidential → exclude
  if (newDecision.disposition === 'exclude') {
    if (currentStatus === 'excluded') return null; // already excluded
    return {
      from: currentStatus,
      to: 'excluded',
      reason: `Reclassified as ${newDecision.category}: ${newDecision.reasons[0]}`,
    };
  }

  // New content reclassified as quarantine → quarantine
  if (newDecision.disposition === 'quarantine') {
    if (currentStatus === 'quarantined') return null;
    return {
      from: currentStatus,
      to: 'quarantined',
      reason: `Reclassified as ${newDecision.category}: ${newDecision.reasons[0]}`,
    };
  }

  // Previously approved/auto-approved content changed
  if (currentStatus === 'approved' || currentStatus === 'auto_approved') {
    if (newDecision.disposition === 'owner_review') {
      // Sensitive content changed → suspend and require review
      return {
        from: currentStatus,
        to: 'suspended',
        reason: `Content changed, requires review: ${newDecision.reasons[0]}`,
      };
    }
    if (newDecision.disposition === 'auto_publish') {
      // Routine content changed → auto-approve the new hash
      return {
        from: currentStatus,
        to: 'auto_approved',
        reason: `Routine content updated, auto-approved: ${newDecision.reasons[0]}`,
      };
    }
  }

  // Suspended page with new content → re-evaluate
  if (currentStatus === 'suspended') {
    if (newDecision.disposition === 'owner_review') {
      return {
        from: 'suspended',
        to: 'awaiting_review',
        reason: `Suspended content updated, new review needed: ${newDecision.reasons[0]}`,
      };
    }
    if (newDecision.disposition === 'auto_publish' && newDecision.category === 'routine_employee_safe') {
      // Only allow auto-approval from suspended if the new content is
      // genuinely routine. This prevents a false-negative in the classifier
      // from silently reauthorizing sensitive material.
      return {
        from: 'suspended',
        to: 'auto_approved',
        reason: `Previously suspended, now routine content: ${newDecision.reasons[0]}`,
      };
    }
    // auto_publish with non-routine category (e.g., from prior approval history) → still needs review
    if (newDecision.disposition === 'auto_publish') {
      return {
        from: 'suspended',
        to: 'awaiting_review',
        reason: `Suspended page reclassified but not clearly routine — review required`,
      };
    }
  }

  // Pending/awaiting_review page with new content → re-classify
  if (currentStatus === 'pending' || currentStatus === 'awaiting_review') {
    return resolveInitialStatus(newDecision);
  }

  return null;
}

/**
 * Determine what happens when a page is deleted or archived in Notion.
 */
export function resolveArchival(
  currentStatus: PublicationStatus
): PublicationTransition | null {
  if (currentStatus === 'archived') return null;
  return {
    from: currentStatus,
    to: 'archived',
    reason: 'Page deleted or no longer accessible in Notion',
  };
}

/**
 * Determine what happens when the owner approves a page.
 */
export function resolveOwnerApproval(
  currentStatus: PublicationStatus,
  approvedHash: string
): PublicationTransition | null {
  if (currentStatus !== 'awaiting_review' && currentStatus !== 'suspended') {
    return null; // Can only approve pages in review or suspended state
  }
  return {
    from: currentStatus,
    to: 'approved',
    reason: 'Owner approved',
    contentHash: approvedHash,
  };
}

/**
 * Determine what happens when the owner rejects a page.
 */
export function resolveOwnerRejection(
  currentStatus: PublicationStatus
): PublicationTransition | null {
  if (currentStatus !== 'awaiting_review') return null;
  return {
    from: currentStatus,
    to: 'quarantined',
    reason: 'Owner rejected — quarantined for safety',
  };
}
