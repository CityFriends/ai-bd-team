/**
 * Ancestry Resolver — Complete Parent Chain Traversal
 *
 * Resolves the full ancestry chain from any Notion object (page, database, block)
 * to its workspace root. Handles all parent types:
 *   - page_id: parent is a page
 *   - database_id: parent is a database
 *   - block_id: parent is a block (callout, column, toggle, etc.)
 *   - workspace: parent is the workspace (top-level)
 *
 * Fail-closed: Any unresolvable parent terminates the chain as UNKNOWN.
 * An incomplete ancestry cannot authorize a page.
 */

import { notionRequest, NotionAuthError } from './api-client.js';

export interface AncestryNode {
  id: string;
  type: 'page' | 'database' | 'block' | 'workspace';
  title: string | null;
  blockType?: string; // For blocks: callout, column, toggle, etc.
}

export interface AncestryResult {
  /** Complete chain from leaf to root (inclusive) */
  chain: AncestryNode[];
  /** Human-readable path string */
  pathString: string;
  /** All ancestor IDs (for root matching) */
  ancestorIds: string[];
  /** Whether the chain reaches a workspace root */
  complete: boolean;
  /** Reason if incomplete */
  incompleteReason?: string;
  /** Whether a cycle was detected */
  hasCycle: boolean;
  /** The root node (workspace-level object) if found */
  rootNode: AncestryNode | null;
}

interface NotionParent {
  type: string;
  page_id?: string;
  database_id?: string;
  block_id?: string;
  workspace?: boolean;
}

interface PageResponse {
  id: string;
  object: string;
  parent: NotionParent;
  properties?: Record<string, unknown>;
}

interface DatabaseResponse {
  id: string;
  object: string;
  parent: NotionParent;
  title?: Array<{ plain_text: string }>;
}

interface BlockResponse {
  id: string;
  object: string;
  type: string;
  parent: NotionParent;
  [key: string]: unknown;
}

/**
 * Extract title from a page's properties.
 */
function extractPageTitle(properties: Record<string, unknown> | undefined): string | null {
  if (!properties) return null;
  const titleProp = Object.values(properties).find(
    (p) => (p as { type?: string })?.type === 'title'
  ) as { title?: Array<{ plain_text: string }> } | undefined;
  return titleProp?.title?.map((t) => t.plain_text).join('') || null;
}

/**
 * Extract title from a database.
 */
function extractDatabaseTitle(title: Array<{ plain_text: string }> | undefined): string | null {
  if (!title) return null;
  return title.map((t) => t.plain_text).join('') || null;
}

/**
 * Resolve the complete ancestry chain for a Notion object.
 *
 * @param connectionId - Connection ID for API requests
 * @param token - Notion API token
 * @param objectId - The starting object ID (page, database, or block)
 * @param objectType - The type of the starting object
 * @param maxDepth - Maximum traversal depth (default 20)
 * @param cache - Optional cache of previously resolved objects
 */
export async function resolveAncestryChain(
  connectionId: string,
  token: string,
  objectId: string,
  objectType: 'page' | 'database' | 'block',
  maxDepth = 20,
  cache?: Map<string, AncestryNode & { parent: NotionParent | null }>
): Promise<AncestryResult> {
  const chain: AncestryNode[] = [];
  const ancestorIds: string[] = [];
  const seen = new Set<string>();
  const nodeCache = cache || new Map<string, AncestryNode & { parent: NotionParent | null }>();

  let currentId = objectId;
  let currentType = objectType;
  let complete = false;
  let incompleteReason: string | undefined;
  let hasCycle = false;
  let rootNode: AncestryNode | null = null;

  for (let depth = 0; depth < maxDepth; depth++) {
    // Cycle detection
    if (seen.has(currentId)) {
      hasCycle = true;
      incompleteReason = `cycle_detected:${currentId}`;
      break;
    }
    seen.add(currentId);

    // Check cache first
    let nodeData = nodeCache.get(currentId);

    if (!nodeData) {
      // Fetch the object based on type
      try {
        if (currentType === 'page') {
          const { status, data } = await notionRequest(
            connectionId,
            token,
            'GET',
            `/pages/${currentId}`
          );
          if (status === 404 || status === 403) {
            incompleteReason = `inaccessible:page:${currentId}`;
            break;
          }
          if (status !== 200) {
            incompleteReason = `api_error:${status}:page:${currentId}`;
            break;
          }
          const page = data as PageResponse;
          nodeData = {
            id: page.id,
            type: 'page',
            title: extractPageTitle(page.properties),
            parent: page.parent,
          };
        } else if (currentType === 'database') {
          const { status, data } = await notionRequest(
            connectionId,
            token,
            'GET',
            `/databases/${currentId}`
          );
          if (status === 404 || status === 403) {
            incompleteReason = `inaccessible:database:${currentId}`;
            break;
          }
          if (status !== 200) {
            incompleteReason = `api_error:${status}:database:${currentId}`;
            break;
          }
          const db = data as DatabaseResponse;
          nodeData = {
            id: db.id,
            type: 'database',
            title: extractDatabaseTitle(db.title),
            parent: db.parent,
          };
        } else if (currentType === 'block') {
          const { status, data } = await notionRequest(
            connectionId,
            token,
            'GET',
            `/blocks/${currentId}`
          );
          if (status === 404 || status === 403) {
            incompleteReason = `inaccessible:block:${currentId}`;
            break;
          }
          if (status !== 200) {
            incompleteReason = `api_error:${status}:block:${currentId}`;
            break;
          }
          const block = data as BlockResponse;
          nodeData = {
            id: block.id,
            type: 'block',
            title: null, // Blocks don't have titles
            blockType: block.type,
            parent: block.parent,
          };
        }

        if (nodeData) {
          nodeCache.set(currentId, nodeData);
        }
      } catch (err) {
        if (err instanceof NotionAuthError) {
          incompleteReason = `auth_error:${currentId}`;
        } else {
          incompleteReason = `error:${err instanceof Error ? err.message : String(err)}`;
        }
        break;
      }
    }

    if (!nodeData) {
      incompleteReason = `no_data:${currentType}:${currentId}`;
      break;
    }

    // Add to chain (we'll reverse later)
    chain.push({
      id: nodeData.id,
      type: nodeData.type,
      title: nodeData.title,
      blockType: nodeData.blockType,
    });
    ancestorIds.push(nodeData.id);

    // Check parent type
    const parent = nodeData.parent;
    if (!parent) {
      incompleteReason = `no_parent:${currentType}:${currentId}`;
      break;
    }

    if (parent.type === 'workspace' || parent.workspace) {
      // Reached workspace root - chain is complete
      complete = true;
      rootNode = chain[chain.length - 1];
      break;
    }

    // Determine next object to fetch
    if (parent.type === 'page_id' && parent.page_id) {
      currentId = parent.page_id;
      currentType = 'page';
    } else if (parent.type === 'database_id' && parent.database_id) {
      currentId = parent.database_id;
      currentType = 'database';
    } else if (parent.type === 'block_id' && parent.block_id) {
      currentId = parent.block_id;
      currentType = 'block';
    } else {
      incompleteReason = `unknown_parent_type:${parent.type}`;
      break;
    }
  }

  if (!complete && !incompleteReason) {
    incompleteReason = `max_depth_exceeded:${maxDepth}`;
  }

  // Reverse chain so it goes from root to leaf
  chain.reverse();
  ancestorIds.reverse();

  // Build path string (only titled nodes)
  const pathParts = chain.filter((n) => n.title).map((n) => n.title!);
  const pathString = pathParts.join(' / ');

  return {
    chain,
    pathString,
    ancestorIds,
    complete,
    incompleteReason,
    hasCycle,
    rootNode,
  };
}

/**
 * Resolve ancestry for a page, determining the starting type automatically.
 * First tries as page, then as database if page fails.
 */
export async function resolvePageAncestry(
  connectionId: string,
  token: string,
  pageId: string,
  maxDepth = 20,
  cache?: Map<string, AncestryNode & { parent: NotionParent | null }>
): Promise<AncestryResult> {
  // First try as page
  const pageResult = await resolveAncestryChain(
    connectionId,
    token,
    pageId,
    'page',
    maxDepth,
    cache
  );
  if (pageResult.chain.length > 0) {
    return pageResult;
  }

  // If page lookup failed, try as database
  if (pageResult.incompleteReason?.includes('inaccessible:page')) {
    const dbResult = await resolveAncestryChain(
      connectionId,
      token,
      pageId,
      'database',
      maxDepth,
      cache
    );
    if (dbResult.chain.length > 0) {
      return dbResult;
    }
  }

  return pageResult;
}

/**
 * Find the approved root in an ancestry chain.
 * Returns the root if any ancestor matches an approved root ID.
 */
export function findApprovedRootInChain<T extends { notionPageId: string }>(
  ancestry: AncestryResult,
  approvedRoots: T[]
): T | null {
  for (const ancestorId of ancestry.ancestorIds) {
    const root = approvedRoots.find((r) => r.notionPageId === ancestorId);
    if (root) return root;
  }
  return null;
}

/**
 * Check if an ancestry chain contains a specific ID.
 */
export function ancestryContains(ancestry: AncestryResult, targetId: string): boolean {
  return ancestry.ancestorIds.includes(targetId);
}
