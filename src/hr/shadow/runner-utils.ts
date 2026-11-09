/**
 * Shadow Discovery Runner Utilities
 *
 * Provides atomic, no-clobber report publication for confidential shadow
 * discovery reports. Uses a hardlink pattern that is immune to TOCTOU
 * races and cannot overwrite existing destinations.
 *
 * Security properties:
 *   - Directory: 0700 (owner only)
 *   - Temp file: 0600 (owner only), created with O_CREAT | O_EXCL
 *   - Final path: atomic via linkSync (fails if destination exists)
 *   - Symlinks: never followed (lstat + explicit check)
 *   - Concurrent creation: safely rejected (linkSync fails)
 *   - Partial writes: never visible at final path
 *   - Temp cleanup: always attempted, even on failure
 */

import {
  mkdirSync,
  linkSync,
  unlinkSync,
  lstatSync,
  chmodSync,
  constants,
  openSync,
  closeSync,
  writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────

export interface WriteReportResult {
  success: boolean;
  finalPath: string | null;
  error: string | null;
}

export interface ReportPublicationOptions {
  /** Directory permissions (default: 0o700) */
  dirMode?: number;
  /** File permissions (default: 0o600) */
  fileMode?: number;
  /** Skip directory creation (for testing) */
  skipMkdir?: boolean;
}

// ── Atomic No-Clobber Publication ─────────────────────────────

/**
 * Write a report to the specified path atomically, never overwriting.
 *
 * Implementation:
 * 1. Ensure parent directory exists with 0700 permissions.
 * 2. Check that destination is not a symlink (lstat).
 * 3. Create a temp file in the same directory with O_CREAT | O_EXCL.
 * 4. Write content to temp file.
 * 5. Set temp file permissions to 0600.
 * 6. Atomically link temp file to final destination (linkSync).
 * 7. Remove temp file name (keeping content at final path).
 *
 * If step 6 fails because the destination exists, the operation fails
 * without data loss. The linkSync call is atomic on POSIX filesystems
 * and cannot overwrite an existing file or follow a symlink.
 *
 * @param finalPath - Absolute path for the final report
 * @param content - Report content (never logged or echoed)
 * @param options - Optional mode overrides
 * @returns Result with success status and any error
 */
export function writeReportSafely(
  finalPath: string,
  content: string,
  options: ReportPublicationOptions = {}
): WriteReportResult {
  const dirMode = options.dirMode ?? 0o700;
  const fileMode = options.fileMode ?? 0o600;
  const resolvedPath = resolve(finalPath);
  const parentDir = dirname(resolvedPath);

  // Generate a unique temp file name in the same directory
  const tempSuffix = randomBytes(8).toString('hex');
  const tempPath = join(parentDir, `.shadow-report-${tempSuffix}.tmp`);

  let tempCreated = false;

  try {
    // Step 1: Ensure parent directory exists with correct permissions
    if (!options.skipMkdir) {
      try {
        mkdirSync(parentDir, { recursive: true, mode: dirMode });
        // Ensure permissions even if directory already existed
        chmodSync(parentDir, dirMode);
      } catch (err) {
        const code = (err as { code?: string }).code;
        // EEXIST is fine - directory already exists
        if (code !== 'EEXIST') {
          return {
            success: false,
            finalPath: null,
            error: `failed to create directory: ${code || 'unknown'}`,
          };
        }
      }
    }

    // Step 2: Check if destination exists or is a symlink
    // We must fail if destination exists, regardless of type
    try {
      const stats = lstatSync(resolvedPath);
      // File exists - check if it's a symlink
      if (stats.isSymbolicLink()) {
        return {
          success: false,
          finalPath: null,
          error: 'destination is a symlink (refusing to follow)',
        };
      }
      // Regular file or other type exists
      return {
        success: false,
        finalPath: null,
        error: 'destination already exists (no-clobber)',
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'ENOENT') {
        // Some other error accessing the path
        return {
          success: false,
          finalPath: null,
          error: `failed to check destination: ${code || 'unknown'}`,
        };
      }
      // ENOENT means path doesn't exist - this is what we want
    }

    // Step 3: Create temp file exclusively (O_CREAT | O_EXCL | O_WRONLY)
    // This fails if the temp file somehow exists (extremely unlikely with random name)
    let fd: number;
    try {
      fd = openSync(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, fileMode);
      tempCreated = true;
    } catch (err) {
      const code = (err as { code?: string }).code;
      return {
        success: false,
        finalPath: null,
        error: `failed to create temp file: ${code || 'unknown'}`,
      };
    }

    // Step 4: Write content to temp file
    try {
      const buffer = Buffer.from(content, 'utf8');
      let written = 0;
      while (written < buffer.length) {
        const bytesWritten = writeSync(fd, buffer, written);
        written += bytesWritten;
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      closeSync(fd);
      return {
        success: false,
        finalPath: null,
        error: `failed to write content: ${code || 'unknown'}`,
      };
    }

    // Close the file descriptor
    closeSync(fd);

    // Step 5: Ensure file permissions (belt and suspenders)
    try {
      chmodSync(tempPath, fileMode);
    } catch {
      // Non-fatal - we set mode on open, this is just insurance
    }

    // Step 6: Atomically link temp file to final destination
    // linkSync fails with EEXIST if the destination already exists
    // This is the core of the no-clobber guarantee
    try {
      linkSync(tempPath, resolvedPath);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EEXIST') {
        return {
          success: false,
          finalPath: null,
          error: 'destination created concurrently (no-clobber)',
        };
      }
      return {
        success: false,
        finalPath: null,
        error: `failed to link to destination: ${code || 'unknown'}`,
      };
    }

    // Step 7: Remove temp file name (content now at final path)
    try {
      unlinkSync(tempPath);
      tempCreated = false; // Successfully removed
    } catch {
      // Non-fatal - the report is published, temp is just an extra hardlink
      // It will be cleaned up manually or on next run
    }

    return {
      success: true,
      finalPath: resolvedPath,
      error: null,
    };
  } finally {
    // Always attempt to clean up temp file on any failure path
    if (tempCreated) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best effort cleanup - don't throw from finally
      }
    }
  }
}

// ── Coverage Tracking Types ───────────────────────────────────

export interface ExpectedRoot {
  /** Unique identifier for this root (matches hr_approved_roots.id) */
  id: string;
  /** Notion page ID for the root */
  notionPageId: string;
  /** Connection ID this root belongs to */
  connectionId: string;
  /** Human-readable name */
  name: string;
  /** Whether this root should be active */
  expectedActive: boolean;
}

export interface ExpectedConnection {
  /** Unique identifier for this connection (matches hr_notion_connections.id) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Expected root IDs for this connection */
  expectedRootIds: string[];
}

export interface RootCoverageState {
  /** Root was found in configuration */
  configured: boolean;
  /** Root is assigned to the correct connection */
  connectionCorrect: boolean;
  /** Root is marked active */
  isActive: boolean;
  /** At least one page was discovered under this root */
  pagesDiscovered: boolean;
  /** Number of pages discovered under this root */
  pageCount: number;
  /** Discovery completed without API errors for this root */
  discoveryComplete: boolean;
  /** Pagination completed successfully (all pages fetched) */
  paginationComplete: boolean;
  /** Any error encountered during discovery */
  error: string | null;
}

export interface ConnectionCoverageState {
  /** Connection was found in configuration */
  configured: boolean;
  /** Connection token is valid (authenticated successfully) */
  authenticated: boolean;
  /** All expected roots were found on this connection */
  allRootsFound: boolean;
  /** Root coverage states for this connection */
  rootStates: Map<string, RootCoverageState>;
  /** Any error encountered */
  error: string | null;
}

export interface CoverageAccounting {
  /** Expected connections (keyed by connection ID) */
  expectedConnections: Map<string, ExpectedConnection>;
  /** Expected roots (keyed by root ID) */
  expectedRoots: Map<string, ExpectedRoot>;
  /** Actual connection coverage states */
  connectionStates: Map<string, ConnectionCoverageState>;
  /** Overall status */
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  /** Human-readable summary */
  summary: string;
  /** Detailed issues found */
  issues: string[];
}

/**
 * Create initial coverage accounting structure.
 */
export function createCoverageAccounting(
  expectedConnections: ExpectedConnection[],
  expectedRoots: ExpectedRoot[]
): CoverageAccounting {
  const connMap = new Map<string, ExpectedConnection>();
  const rootMap = new Map<string, ExpectedRoot>();
  const connStates = new Map<string, ConnectionCoverageState>();

  for (const conn of expectedConnections) {
    connMap.set(conn.id, conn);
    connStates.set(conn.id, {
      configured: false,
      authenticated: false,
      allRootsFound: false,
      rootStates: new Map(),
      error: null,
    });
  }

  for (const root of expectedRoots) {
    rootMap.set(root.id, root);
  }

  return {
    expectedConnections: connMap,
    expectedRoots: rootMap,
    connectionStates: connStates,
    status: 'FAILED', // Start pessimistic
    summary: 'Coverage accounting initialized',
    issues: [],
  };
}

/**
 * Mark a connection as configured and authenticated.
 */
export function markConnectionConfigured(
  accounting: CoverageAccounting,
  connectionId: string,
  authenticated: boolean,
  error?: string
): void {
  const state = accounting.connectionStates.get(connectionId);
  if (state) {
    state.configured = true;
    state.authenticated = authenticated;
    if (error) {
      state.error = error;
      accounting.issues.push(`Connection ${connectionId}: ${error}`);
    }
  } else {
    accounting.issues.push(`Unexpected connection ID: ${connectionId}`);
  }
}

/**
 * Mark a root as found with its actual configuration.
 */
export function markRootConfigured(
  accounting: CoverageAccounting,
  rootId: string,
  actualConnectionId: string,
  isActive: boolean
): void {
  const expectedRoot = accounting.expectedRoots.get(rootId);
  if (!expectedRoot) {
    accounting.issues.push(`Unexpected root ID: ${rootId}`);
    return;
  }

  const connectionCorrect = expectedRoot.connectionId === actualConnectionId;
  if (!connectionCorrect) {
    accounting.issues.push(
      `Root ${rootId} assigned to wrong connection: expected ${expectedRoot.connectionId}, got ${actualConnectionId}`
    );
  }

  if (!isActive && expectedRoot.expectedActive) {
    accounting.issues.push(`Root ${rootId} is inactive but expected to be active`);
  }

  const connState = accounting.connectionStates.get(expectedRoot.connectionId);
  if (connState) {
    connState.rootStates.set(rootId, {
      configured: true,
      connectionCorrect,
      isActive,
      pagesDiscovered: false,
      pageCount: 0,
      discoveryComplete: false,
      paginationComplete: false,
      error: null,
    });
  }
}

/**
 * Record discovery results for a root.
 */
export function markRootDiscovered(
  accounting: CoverageAccounting,
  rootId: string,
  pageCount: number,
  paginationComplete: boolean,
  error?: string
): void {
  const expectedRoot = accounting.expectedRoots.get(rootId);
  if (!expectedRoot) return;

  const connState = accounting.connectionStates.get(expectedRoot.connectionId);
  if (!connState) return;

  const rootState = connState.rootStates.get(rootId);
  if (!rootState) return;

  rootState.pagesDiscovered = pageCount > 0;
  rootState.pageCount = pageCount;
  rootState.paginationComplete = paginationComplete;
  rootState.discoveryComplete = !error;
  if (error) {
    rootState.error = error;
    accounting.issues.push(`Root ${rootId} discovery error: ${error}`);
  }
}

/**
 * Check for duplicate root configurations.
 */
export function checkDuplicateRoots(roots: Array<{ id: string; notionPageId: string }>): string[] {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  const seenNotionIds = new Set<string>();

  for (const root of roots) {
    if (seenIds.has(root.id)) {
      issues.push(`Duplicate root ID: ${root.id}`);
    }
    seenIds.add(root.id);

    if (seenNotionIds.has(root.notionPageId)) {
      issues.push(`Duplicate Notion page ID in roots: ${root.notionPageId}`);
    }
    seenNotionIds.add(root.notionPageId);
  }

  return issues;
}

/**
 * Finalize coverage accounting and determine overall status.
 *
 * COMPLETE requires:
 * - All expected connections are configured and authenticated
 * - All expected roots are configured with correct connection assignment
 * - All required roots are active
 * - All roots have successful discovery (paginationComplete without errors)
 * - At least one page discovered OR explicit confirmation of empty inventory
 *
 * PARTIAL:
 * - Some trustworthy results exist but coverage is incomplete
 *
 * FAILED:
 * - No trustworthy results can be established
 */
export function finalizeCoverage(
  accounting: CoverageAccounting,
  emptyInventoryConfirmed: boolean = false
): CoverageAccounting {
  const issues: string[] = [...accounting.issues];
  let hasAnyResults = false;
  let allConnectionsOk = true;
  let allRootsOk = true;
  let totalPages = 0;

  // Check all expected connections
  for (const [connId, expected] of accounting.expectedConnections) {
    const state = accounting.connectionStates.get(connId);
    if (!state || !state.configured) {
      issues.push(`Missing connection: ${connId} (${expected.name})`);
      allConnectionsOk = false;
      continue;
    }
    if (!state.authenticated) {
      issues.push(`Connection ${connId} failed to authenticate`);
      allConnectionsOk = false;
      continue;
    }

    // Check all expected roots for this connection
    for (const rootId of expected.expectedRootIds) {
      const rootState = state.rootStates.get(rootId);
      if (!rootState || !rootState.configured) {
        issues.push(`Missing root: ${rootId} on connection ${connId}`);
        allRootsOk = false;
        continue;
      }

      // Track partial results even for incomplete roots
      if (rootState.pageCount > 0) {
        hasAnyResults = true;
        totalPages += rootState.pageCount;
      }

      if (!rootState.connectionCorrect) {
        allRootsOk = false;
        continue;
      }
      if (!rootState.isActive) {
        const expectedRoot = accounting.expectedRoots.get(rootId);
        if (expectedRoot?.expectedActive) {
          allRootsOk = false;
          continue;
        }
      }
      if (!rootState.discoveryComplete || !rootState.paginationComplete) {
        allRootsOk = false;
        continue;
      }
    }
  }

  // Determine status
  let status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  let summary: string;

  if (!allConnectionsOk) {
    // Missing or failed connections
    status = hasAnyResults ? 'PARTIAL' : 'FAILED';
    summary = `Connection coverage incomplete: ${issues.length} issue(s)`;
  } else if (!allRootsOk) {
    // Some roots missing, inactive, or failed discovery
    status = hasAnyResults ? 'PARTIAL' : 'FAILED';
    summary = `Root coverage incomplete: ${issues.length} issue(s)`;
  } else if (totalPages === 0 && !emptyInventoryConfirmed) {
    // Empty inventory without positive confirmation cannot be COMPLETE
    status = 'PARTIAL';
    summary = 'Empty inventory without positive root evidence';
    issues.push('No pages discovered across all roots - cannot confirm coverage');
  } else {
    // All checks passed
    status = 'COMPLETE';
    summary = `All ${accounting.expectedConnections.size} connections and ${accounting.expectedRoots.size} roots verified. ${totalPages} pages discovered.`;
  }

  return {
    ...accounting,
    status,
    summary,
    issues,
  };
}

/**
 * Format coverage accounting as a human-readable report section.
 * Does not include sensitive content (tokens, credentials).
 */
export function formatCoverageReport(accounting: CoverageAccounting): string {
  const lines: string[] = [];
  lines.push(`## Coverage Status: ${accounting.status}`);
  lines.push('');
  lines.push(accounting.summary);
  lines.push('');

  lines.push('### Connections');
  for (const [connId, expected] of accounting.expectedConnections) {
    const state = accounting.connectionStates.get(connId);
    const configured = state?.configured ? 'yes' : 'NO';
    const auth = state?.authenticated ? 'yes' : 'NO';
    lines.push(`- ${expected.name} (${connId}): configured=${configured}, authenticated=${auth}`);

    for (const rootId of expected.expectedRootIds) {
      const rootState = state?.rootStates.get(rootId);
      const expectedRoot = accounting.expectedRoots.get(rootId);
      if (rootState) {
        const active = rootState.isActive ? 'yes' : 'NO';
        const complete = rootState.discoveryComplete && rootState.paginationComplete ? 'yes' : 'NO';
        lines.push(
          `  - ${expectedRoot?.name || rootId}: active=${active}, complete=${complete}, pages=${rootState.pageCount}`
        );
      } else {
        lines.push(`  - ${expectedRoot?.name || rootId}: NOT CONFIGURED`);
      }
    }
  }
  lines.push('');

  if (accounting.issues.length > 0) {
    lines.push('### Issues');
    for (const issue of accounting.issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
