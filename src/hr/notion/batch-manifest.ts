/**
 * Compensation Batch Manifest — Deterministic Hashing
 *
 * Creates immutable batch manifests for salary-band and step-increase
 * page approvals. The manifest digest is computed from a canonical,
 * deterministic representation of included page IDs and content hashes.
 *
 * Batch approval is all-or-nothing: if any page's content hash has
 * changed since the manifest was created, the entire batch is rejected.
 *
 * Pure functions. No network, database, or credential access.
 */

import { createHash, randomUUID } from 'crypto';
import type { BatchManifest, BatchManifestEntry } from './publication-types.js';

/**
 * Canonical manifest format specification (shared with PostgreSQL):
 *
 *   Entries sorted by knowledgePageId (ascending, case-sensitive).
 *   Each entry: "pageId:contentHash" (colon-separated, no spaces).
 *   Entries joined by newline ("\n").
 *   Digest: SHA-256 of the UTF-8 bytes of the canonical string, hex-encoded lowercase.
 *
 * This format is trivially reproducible in both TypeScript and PostgreSQL
 * without relying on JSON serialization compatibility.
 */
export const MANIFEST_DIGEST_VERSION = 'v1';

export function computeManifestDigest(entries: readonly BatchManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.knowledgePageId.localeCompare(b.knowledgePageId)
  );

  const canonical = sorted
    .map((e) => `${e.knowledgePageId}:${e.contentHash}`)
    .join('\n');

  return createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex');
}

/**
 * Build the canonical string representation (for cross-language verification).
 */
export function buildCanonicalManifest(entries: readonly BatchManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.knowledgePageId.localeCompare(b.knowledgePageId)
  );
  return sorted.map((e) => `${e.knowledgePageId}:${e.contentHash}`).join('\n');
}

/**
 * Create a batch manifest from a set of page entries.
 */
export function createBatchManifest(
  entries: BatchManifestEntry[]
): BatchManifest {
  // Detect duplicates
  const pageIds = new Set<string>();
  for (const entry of entries) {
    if (pageIds.has(entry.knowledgePageId)) {
      throw new Error(`Duplicate page in batch: ${entry.knowledgePageId}`);
    }
    pageIds.add(entry.knowledgePageId);
  }

  if (entries.length === 0) {
    throw new Error('Batch manifest must contain at least one entry');
  }

  return {
    batchId: randomUUID(),
    entries: [...entries],
    manifestDigest: computeManifestDigest(entries),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Validate that a batch manifest is still valid against current page state.
 *
 * @param manifest The manifest to validate
 * @param currentHashes Map of knowledgePageId → current content hash
 * @returns Array of validation errors (empty = all valid)
 */
export function validateBatchManifest(
  manifest: BatchManifest,
  currentHashes: ReadonlyMap<string, string | null>
): string[] {
  const errors: string[] = [];

  // Verify digest integrity
  const expectedDigest = computeManifestDigest(manifest.entries);
  if (expectedDigest !== manifest.manifestDigest) {
    errors.push('Manifest digest mismatch — manifest may have been tampered with');
    return errors; // Don't continue if the digest itself is wrong
  }

  // Verify each entry's hash
  for (const entry of manifest.entries) {
    const currentHash = currentHashes.get(entry.knowledgePageId);

    if (currentHash === undefined) {
      errors.push(`Page ${entry.knowledgePageId} not found`);
    } else if (currentHash === null) {
      errors.push(`Page ${entry.knowledgePageId} has no content hash`);
    } else if (currentHash !== entry.contentHash) {
      errors.push(
        `Page ${entry.knowledgePageId} hash mismatch: manifest=${entry.contentHash.slice(0, 8)}… current=${currentHash.slice(0, 8)}…`
      );
    }
  }

  return errors;
}
