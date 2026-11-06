/**
 * Shadow Discovery — Read-Only Classification Without Publication
 *
 * Discovers and classifies pages without inserting approvals,
 * publishing chunks, or sending Slack notifications.
 *
 * Used to preview what a full sync would do before enabling it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  searchAllPages, getPage, getDatabase,
  NotionAuthError, getParentId, type NotionPage,
} from './api-client.js';
import {
  classifyWithVerifiedPath, resolveAncestry,
  type ApprovedRoot,
} from './classifier.js';
import { classifyForPublication, type PriorApprovalContext } from './publication-classifier.js';
import { resolveInitialStatus } from './publication-state-machine.js';
import type { PublicationDecision, PublicationTransition, ExtractionReport } from './publication-types.js';
import { isNotionSyncEnabled } from '../config/hr-controls.js';

// ── Extraction Report ──────────────────────────────────────

/** Block types we fully extract text from (including tables via Markdown conversion). */
const SUPPORTED_BLOCK_TYPES = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item',
  'toggle', 'to_do', 'quote', 'callout', 'code',
  'table', // Tables are now extracted as Markdown by extractTableBlock()
]);

/** Block types that are children of tables — not counted independently. */
const TABLE_CHILD_TYPES = new Set(['table_row']);

/**
 * Assess extraction completeness for a set of blocks.
 */
export function assessExtraction(
  blocks: Array<{ type: string; text: string }>
): ExtractionReport {
  const unsupported = new Set<string>();
  let totalBlocks = 0;
  let extractedBlocks = 0;
  let hasTableContent = false;

  for (const block of blocks) {
    // Skip table_row — counted under the parent table block
    if (TABLE_CHILD_TYPES.has(block.type)) continue;

    totalBlocks++;
    if (SUPPORTED_BLOCK_TYPES.has(block.type)) {
      if (block.type === 'table') hasTableContent = true;
      // A table block with empty text means extraction failed
      if (block.type === 'table' && !block.text) {
        unsupported.add('table (extraction failed)');
      } else {
        extractedBlocks++;
      }
    } else if (block.type !== 'divider' && block.type !== 'table_of_contents') {
      unsupported.add(block.type);
    }
  }

  return {
    totalBlocks,
    extractedBlocks,
    unsupportedBlockTypes: Array.from(unsupported),
    hasTableContent,
    // Complete if no unsupported block types with content,
    // or if unsupported blocks are trivial (divider, toc)
    isComplete: unsupported.size === 0,
  };
}

// ── Shadow Discovery Result ────────────────────────────────

export interface ShadowPageResult {
  notionPageId: string;
  title: string;
  ancestryPath: string;
  accessClassification: string;
  publicationDecision: PublicationDecision;
  proposedTransition: PublicationTransition;
  contentHash: string | null;
  extractionReport: ExtractionReport | null;
  hasExistingApproval: boolean;
  existingPublicationStatus: string | null;
  wouldSuspend: boolean;
}

export interface ShadowDiscoveryResult {
  totalPagesDiscovered: number;
  autoPublishCount: number;
  ownerReviewCount: number;
  quarantineCount: number;
  excludeCount: number;
  wouldSuspendCount: number;
  pages: ShadowPageResult[];
  error: string | null;
}

/**
 * Run shadow discovery — classify without publishing.
 *
 * Discovers all pages, classifies them, and reports what would happen
 * if sync were enabled. Does NOT modify any database records.
 *
 * This function reads from the database to check existing approvals
 * but never writes.
 */
export async function runShadowDiscovery(
  db: SupabaseClient,
  connectionId: string,
  token: string,
  approvedRoots: ApprovedRoot[]
): Promise<ShadowDiscoveryResult> {
  if (!isNotionSyncEnabled()) {
    return {
      totalPagesDiscovered: 0, autoPublishCount: 0, ownerReviewCount: 0,
      quarantineCount: 0, excludeCount: 0, wouldSuspendCount: 0,
      pages: [], error: 'sync_disabled',
    };
  }

  const result: ShadowDiscoveryResult = {
    totalPagesDiscovered: 0, autoPublishCount: 0, ownerReviewCount: 0,
    quarantineCount: 0, excludeCount: 0, wouldSuspendCount: 0,
    pages: [], error: null,
  };

  try {
    const pages = await searchAllPages(connectionId, token);

    // Build title cache for ancestry
    const titleCache = new Map<string, { id: string; title: string; parentPageId: string | null }>();
    for (const p of pages) {
      titleCache.set(p.id, {
        id: p.id,
        title: extractTitle(p),
        parentPageId: getParentId(p),
      });
    }

    const getPageTitle = async (objectId: string) => {
      const cached = titleCache.get(objectId);
      if (cached) return cached;
      const fetched = await getPage(connectionId, token, objectId);
      if (fetched) {
        const entry = { id: fetched.id, title: extractTitle(fetched), parentPageId: getParentId(fetched) };
        titleCache.set(objectId, entry);
        return entry;
      }
      const dbResult = await getDatabase(connectionId, token, objectId);
      if (dbResult) {
        titleCache.set(objectId, dbResult);
        return dbResult;
      }
      return null;
    };

    // Load existing approvals for comparison
    const { data: existingApprovals } = await db
      .from('hr_page_approvals')
      .select('knowledge_page_id, approved_content_hash')
      .is('revoked_at', null);
    const approvalMap = new Map<string, string>();

    // Load existing page states
    const { data: existingPages } = await db
      .from('hr_knowledge_pages')
      .select('id, notion_page_id, content_hash, publication_status')
      .eq('connection_id', connectionId);
    const pageMap = new Map<string, { id: string; contentHash: string | null; publicationStatus: string | null }>();
    for (const p of existingPages || []) {
      pageMap.set(p.notion_page_id, {
        id: p.id,
        contentHash: p.content_hash,
        publicationStatus: p.publication_status,
      });
      // Check approvals for this page
      const approval = (existingApprovals || []).find((a: any) => a.knowledge_page_id === p.id);
      if (approval) {
        approvalMap.set(p.id, approval.approved_content_hash);
      }
    }

    for (const page of pages) {
      const title = extractTitle(page);

      // Resolve ancestry
      const ancestry = await resolveAncestry(page, title, getPageTitle);
      const ancestorIds: string[] = [];
      let current = getParentId(page);
      const seen = new Set<string>();
      for (let d = 0; d < 10 && current; d++) {
        if (seen.has(current)) break;
        seen.add(current);
        ancestorIds.push(current);
        const ancestor = await getPageTitle(current);
        current = ancestor?.parentPageId || null;
      }

      const classification = classifyWithVerifiedPath(
        page.id, title, ancestry.pathString, ancestorIds, approvedRoots
      );

      if (!classification.approvedRoot) continue;
      if (classification.isExcluded) continue;

      result.totalPagesDiscovered++;

      // Check existing state
      const existing = pageMap.get(page.id);
      const hasApproval = existing ? approvalMap.has(existing.id) : false;
      // Classify for publication
      const priorApproval: PriorApprovalContext | undefined = hasApproval
        ? { hasApprovalForCurrentHash: true, priorCategory: 'routine_employee_safe' }
        : undefined;

      const decision = classifyForPublication(
        title,
        '', // Don't extract content in shadow mode for speed
        ancestry.pathString,
        classification.accessClassification || 'employee_safe',
        undefined, // No extraction report in shadow mode
        priorApproval
      );

      const transition = resolveInitialStatus(decision);

      // Check if this would suspend an existing approval
      const wouldSuspend = hasApproval &&
        existing?.publicationStatus === 'approved' &&
        (decision.disposition === 'owner_review' || decision.disposition === 'quarantine');

      const shadowResult: ShadowPageResult = {
        notionPageId: page.id,
        title,
        ancestryPath: ancestry.pathString,
        accessClassification: classification.accessClassification || 'employee_safe',
        publicationDecision: decision,
        proposedTransition: transition,
        contentHash: existing?.contentHash || null,
        extractionReport: null,
        hasExistingApproval: hasApproval,
        existingPublicationStatus: existing?.publicationStatus || null,
        wouldSuspend,
      };

      result.pages.push(shadowResult);

      switch (decision.disposition) {
        case 'auto_publish': result.autoPublishCount++; break;
        case 'owner_review': result.ownerReviewCount++; break;
        case 'quarantine': result.quarantineCount++; break;
        case 'exclude': result.excludeCount++; break;
      }
      if (wouldSuspend) result.wouldSuspendCount++;
    }

  } catch (err) {
    if (err instanceof NotionAuthError) {
      result.error = 'Authentication failed';
    } else {
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  return result;
}

function extractTitle(page: NotionPage): string {
  const titleProp = Object.values(page.properties || {}).find(
    (p: unknown) => (p as { type?: string })?.type === 'title'
  ) as { title?: Array<{ plain_text: string }> } | undefined;
  return titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';
}
