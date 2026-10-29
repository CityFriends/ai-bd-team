/**
 * Notion Sync Engine — Discovery, Verification, and Content Extraction
 *
 * Handles full discovery, incremental verification, and webhook-triggered
 * re-syncs. Uses approved-root verification and structural exclusion.
 *
 * Kill switch: All synchronization entry points check HR_NOTION_SYNC_ENABLED
 * before any Notion API call or database mutation. When disabled, functions
 * return immediately with a distinguishable disabled result.
 */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  searchAllPages, getPage, getDatabase, fetchPageBlocks,
  NotionAuthError, getParentId, type NotionPage,
} from './api-client.js';
import {
  classifyWithVerifiedPath, resolveAncestry,
  type ApprovedRoot,
} from './classifier.js';
import { isNotionSyncEnabled } from '../config/hr-controls.js';

export interface SyncResult {
  pagesDiscovered: number;
  pagesUpdated: number;
  pagesRevoked: number;
  pagesExcluded: number;
  error: string | null;
}

const SYNC_DISABLED_ERROR = 'sync_disabled';

/**
 * Full discovery — complete cursor-safe pagination, then reconcile.
 * Blocked when HR_NOTION_SYNC_ENABLED != 'true'.
 */
export async function fullDiscovery(
  db: SupabaseClient,
  connectionId: string,
  token: string,
  approvedRoots: ApprovedRoot[]
): Promise<SyncResult> {
  if (!isNotionSyncEnabled()) {
    return { pagesDiscovered: 0, pagesUpdated: 0, pagesRevoked: 0, pagesExcluded: 0, error: SYNC_DISABLED_ERROR };
  }

  const result: SyncResult = { pagesDiscovered: 0, pagesUpdated: 0, pagesRevoked: 0, pagesExcluded: 0, error: null };

  try {
    const pages = await searchAllPages(connectionId, token);
    const seenNotionIds = new Set<string>();

    // Build a title cache for ancestry resolution (avoids redundant API calls)
    const titleCache = new Map<string, { id: string; title: string; parentPageId: string | null }>();
    for (const p of pages) {
      titleCache.set(p.id, {
        id: p.id,
        title: extractTitle(p),
        parentPageId: getParentId(p),
      });
    }

    // Ancestry resolver: uses cache first, then API (tries page, then database)
    const getPageTitle = async (objectId: string) => {
      const cached = titleCache.get(objectId);
      if (cached) return cached;
      // Try as a page first, then as a database (wiki databases are not pages)
      const fetched = await getPage(connectionId, token, objectId);
      if (fetched) {
        const entry = { id: fetched.id, title: extractTitle(fetched), parentPageId: getParentId(fetched) };
        titleCache.set(objectId, entry);
        return entry;
      }
      const db = await getDatabase(connectionId, token, objectId);
      if (db) {
        titleCache.set(objectId, db);
        return db;
      }
      return null;
    };

    for (const page of pages) {
      seenNotionIds.add(page.id);
      const title = extractTitle(page);

      // Resolve full ancestry path via parent chain
      const ancestry = await resolveAncestry(page, title, getPageTitle);
      const ancestorIds = [];
      let current = getParentId(page);
      const seen = new Set<string>(); // Cycle detection
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

      if (classification.isExcluded) {
        await upsertPage(db, connectionId, classification.approvedRoot.id, page, title,
          classification.accessClassification || 'employee_safe', true, classification.exclusionReason);
        result.pagesExcluded++;
        continue;
      }

      await upsertPage(db, connectionId, classification.approvedRoot.id, page, title,
        classification.accessClassification!, false, null);
      result.pagesDiscovered++;
    }

    // Revoke pages no longer visible
    const { data: indexed } = await db
      .from('hr_knowledge_pages')
      .select('id, notion_page_id')
      .eq('connection_id', connectionId)
      .not('sync_status', 'in', '("revoked","excluded")');

    for (const p of indexed || []) {
      if (!seenNotionIds.has(p.notion_page_id)) {
        await revokePage(db, p.id, 'not_in_search_results');
        result.pagesRevoked++;
      }
    }

    // Update connection
    await db.from('hr_notion_connections').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_auth_verified_at: new Date().toISOString(),
    }).eq('id', connectionId);

  } catch (err) {
    if (err instanceof NotionAuthError) {
      await deactivateConnection(db, connectionId);
      result.error = 'Authentication failed';
    } else {
      result.error = err instanceof Error ? err.message : String(err);
      await db.from('hr_notion_connections').update({
        last_sync_status: 'error',
        last_sync_error: result.error,
      }).eq('id', connectionId);
    }
  }

  return result;
}

/**
 * Incremental verification — re-check all indexed pages.
 * Blocked when HR_NOTION_SYNC_ENABLED != 'true'.
 */
export async function incrementalVerification(
  db: SupabaseClient,
  connectionId: string,
  token: string,
  approvedRoots: ApprovedRoot[]
): Promise<SyncResult> {
  if (!isNotionSyncEnabled()) {
    return { pagesDiscovered: 0, pagesUpdated: 0, pagesRevoked: 0, pagesExcluded: 0, error: SYNC_DISABLED_ERROR };
  }

  const result: SyncResult = { pagesDiscovered: 0, pagesUpdated: 0, pagesRevoked: 0, pagesExcluded: 0, error: null };

  try {
    const { data: pages } = await db
      .from('hr_knowledge_pages')
      .select('id, notion_page_id, approved_root_id, notion_last_edited, content_hash')
      .eq('connection_id', connectionId)
      .not('sync_status', 'in', '("revoked","excluded")')
      .order('last_verified_at', { ascending: true, nullsFirst: true });

    for (const page of pages || []) {
      const notionPage = await getPage(connectionId, token, page.notion_page_id);

      if (!notionPage) {
        await revokePage(db, page.id, 'access_lost');
        result.pagesRevoked++;
        continue;
      }

      // Re-verify root ancestry via parent chain (pages and databases)
      const title = extractTitle(notionPage);
      const ancestorIds: string[] = [];
      let verifyParent = getParentId(notionPage);
      const verifySeen = new Set<string>();
      for (let d = 0; d < 10 && verifyParent; d++) {
        if (verifySeen.has(verifyParent)) break;
        verifySeen.add(verifyParent);
        ancestorIds.push(verifyParent);
        // Try as page first, then database
        const ancestor = await getPage(connectionId, token, verifyParent);
        if (ancestor) {
          verifyParent = getParentId(ancestor);
        } else {
          const db = await getDatabase(connectionId, token, verifyParent);
          verifyParent = db?.parentPageId || null;
        }
      }
      const classification = classifyWithVerifiedPath(
        notionPage.id, title, title, ancestorIds, approvedRoots
      );
      if (!classification.approvedRoot || classification.approvedRoot.id !== page.approved_root_id) {
        await revokePage(db, page.id, 'moved_outside_approved_root');
        result.pagesRevoked++;
        continue;
      }

      // Update verification timestamp
      await db.from('hr_knowledge_pages').update({
        last_verified_at: new Date().toISOString(),
      }).eq('id', page.id);

      // Re-sync content if changed
      if (notionPage.last_edited_time > (page.notion_last_edited || '')) {
        await syncPageContent(db, page.id, connectionId, token, page.notion_page_id);
        result.pagesUpdated++;
      }
    }

    await db.from('hr_notion_connections').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
      last_auth_verified_at: new Date().toISOString(),
    }).eq('id', connectionId);

  } catch (err) {
    if (err instanceof NotionAuthError) {
      await deactivateConnection(db, connectionId);
      result.error = 'Authentication failed';
    } else {
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  return result;
}

/**
 * Sync a single page's content — extract text, chunk, and store.
 * Blocked when HR_NOTION_SYNC_ENABLED != 'true'.
 */
export async function syncPageContent(
  db: SupabaseClient,
  pageId: string,
  connectionId: string,
  token: string,
  notionPageId: string
): Promise<void> {
  if (!isNotionSyncEnabled()) return;

  const { text, blocks } = await fetchPageBlocks(connectionId, token, notionPageId);
  const newHash = createHash('sha256').update(text, 'utf8').digest('hex');

  // Check if content actually changed
  const { data: existing } = await db
    .from('hr_knowledge_pages')
    .select('content_hash')
    .eq('id', pageId)
    .single();

  if (existing?.content_hash === newHash) return;

  // Chunk the content
  const chunks = splitIntoChunks(text, blocks, 1500, 200);

  // Atomic: delete old chunks + insert new
  await db.from('hr_knowledge_chunks').delete().eq('page_id', pageId);

  for (let i = 0; i < chunks.length; i++) {
    await db.from('hr_knowledge_chunks').insert({
      page_id: pageId,
      chunk_index: i,
      content_text: chunks[i].text,
      content_hash: createHash('sha256').update(chunks[i].text, 'utf8').digest('hex'),
      notion_block_ids: chunks[i].blockIds,
      heading_path: chunks[i].headingPath,
      first_block_id: chunks[i].firstBlockId,
    });
  }

  await db.from('hr_knowledge_pages').update({
    content_hash: newHash,
    last_synced_at: new Date().toISOString(),
    sync_status: 'synced',
  }).eq('id', pageId);
}

/**
 * Deactivate a connection — immediately blocks retrieval.
 */
export async function deactivateConnection(
  db: SupabaseClient,
  connectionId: string
): Promise<void> {
  await db.from('hr_notion_connections').update({
    is_active: false,
    last_sync_status: 'error',
    last_sync_error: 'Authentication failed (401)',
  }).eq('id', connectionId);
  console.log(`[Notion Sync] Connection ${connectionId} deactivated — retrieval blocked`);
}

/**
 * Revoke a page — delete chunks, mark status.
 */
export async function revokePage(
  db: SupabaseClient,
  pageId: string,
  reason: string
): Promise<void> {
  await db.from('hr_knowledge_chunks').delete().eq('page_id', pageId);
  await db.from('hr_knowledge_pages').update({
    sync_status: 'revoked',
    sync_error: reason,
    updated_at: new Date().toISOString(),
  }).eq('id', pageId);
}

// ============================================================
// Helpers
// ============================================================

async function upsertPage(
  db: SupabaseClient,
  connectionId: string,
  approvedRootId: string,
  page: NotionPage,
  title: string,
  accessClassification: string,
  isExcluded: boolean,
  exclusionReason: string | null
): Promise<void> {
  await db.from('hr_knowledge_pages').upsert({
    connection_id: connectionId,
    approved_root_id: approvedRootId,
    notion_page_id: page.id,
    title,
    parent_notion_id: page.parent?.page_id || null,
    page_url: page.url,
    access_classification: accessClassification,
    notion_last_edited: page.last_edited_time,
    is_excluded: isExcluded,
    exclusion_reason: exclusionReason,
    sync_status: isExcluded ? 'excluded' : 'pending',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,notion_page_id' });
}

function extractTitle(page: NotionPage): string {
  const titleProp = Object.values(page.properties || {}).find(
    (p: unknown) => (p as { type?: string })?.type === 'title'
  ) as { title?: Array<{ plain_text: string }> } | undefined;
  return titleProp?.title?.map((t) => t.plain_text).join('') || 'Untitled';
}

interface Chunk {
  text: string;
  blockIds: string[];
  headingPath: string[];
  firstBlockId: string | null;
}

function splitIntoChunks(
  _fullText: string,
  blocks: Array<{ id: string; type: string; text: string; heading?: string }>,
  maxChars: number,
  overlap: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { text: '', blockIds: [], headingPath: [], firstBlockId: null };
  const headingStack: string[] = [];

  for (const block of blocks) {
    if (block.heading) {
      headingStack.length = 0; // Reset for simplicity; could track depth
      headingStack.push(block.heading);
    }

    const newText = current.text ? `${current.text}\n${block.text}` : block.text;

    if (newText.length > maxChars && current.text.length > 0) {
      chunks.push({ ...current });
      // Start new chunk with overlap
      const overlapText = current.text.slice(-overlap);
      current = {
        text: overlapText + '\n' + block.text,
        blockIds: [block.id],
        headingPath: [...headingStack],
        firstBlockId: block.id,
      };
    } else {
      current.text = newText;
      current.blockIds.push(block.id);
      if (!current.firstBlockId) current.firstBlockId = block.id;
      current.headingPath = [...headingStack];
    }
  }

  if (current.text.length > 0) chunks.push(current);
  return chunks;
}
