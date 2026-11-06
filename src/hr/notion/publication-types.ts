/**
 * Publication Types — Page Lifecycle and Classification
 *
 * Type definitions for the HQ Wiki synchronization publication system.
 * Used by the classifier, state machine, and sync engine.
 *
 * No network, database, or credential access.
 */

// ── Publication Status ─────────────────────────────────────

export type PublicationStatus =
  | 'pending'          // discovered, not yet classified
  | 'auto_approved'    // routine employee-safe, auto-published
  | 'awaiting_review'  // sent to owner for approval
  | 'approved'         // owner approved this exact hash
  | 'suspended'        // previously approved content changed
  | 'quarantined'      // ambiguous, excluded from retrieval
  | 'excluded'         // confidential/personalized, never retrievable
  | 'archived';        // deleted or moved, ineligible

export const PUBLICATION_STATUSES: readonly PublicationStatus[] = [
  'pending', 'auto_approved', 'awaiting_review', 'approved',
  'suspended', 'quarantined', 'excluded', 'archived',
];

/** Statuses that make content eligible for retrieval (with valid approval). */
export const RETRIEVABLE_STATUSES: ReadonlySet<PublicationStatus> = new Set([
  'auto_approved', 'approved',
]);

// ── Classification Decision ────────────────────────────────

export type PublicationDisposition =
  | 'auto_publish'
  | 'owner_review'
  | 'quarantine'
  | 'exclude';

export type ContentCategory =
  | 'routine_employee_safe'
  | 'sensitive_policy'
  | 'salary_band'
  | 'confidential'
  | 'personalized'
  | 'unknown'
  | 'mixed_content'
  | 'incomplete_extraction';

export interface PublicationDecision {
  disposition: PublicationDisposition;
  category: ContentCategory;
  reasons: string[];
}

// ── Review Types ───────────────────────────────────────────

export type ReviewType =
  | 'new_sensitive_page'
  | 'updated_sensitive_page'
  | 'salary_band_batch'
  | 'quarantine_review'
  | 'manual_review';

export type ReviewStatus =
  | 'pending'
  | 'sent'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'superseded';

// ── Lifecycle Transitions ──────────────────────────────────

export interface PublicationTransition {
  from: PublicationStatus;
  to: PublicationStatus;
  reason: string;
  contentHash?: string;
}

// ── Audit Event Types ──────────────────────────────────────

export type SyncAuditEventType =
  | 'PAGE_DISCOVERED'
  | 'CLASSIFICATION_CHANGED'
  | 'PAGE_SUSPENDED'
  | 'PAGE_AUTO_PUBLISHED'
  | 'REVIEW_REQUESTED'
  | 'REVIEW_SUPERSEDED'
  | 'BATCH_CREATED'
  | 'BATCH_APPROVED'
  | 'BATCH_REJECTED'
  | 'PAGE_ARCHIVED'
  | 'SYNC_FAILED';

// ── Compensation Batch ─────────────────────────────────────

export interface BatchManifestEntry {
  knowledgePageId: string;
  notionPageId: string;
  title: string;
  contentHash: string;
}

export interface BatchManifest {
  batchId: string;
  entries: BatchManifestEntry[];
  manifestDigest: string;
  createdAt: string;
}

// ── Extraction Completeness ────────────────────────────────

export interface ExtractionReport {
  totalBlocks: number;
  extractedBlocks: number;
  unsupportedBlockTypes: string[];
  hasTableContent: boolean;
  isComplete: boolean;
}
