/**
 * Discussion to Notion Sync
 *
 * Syncs agent discussions to Notion opportunity pages.
 * Each discussion appears as a "Team Discussion" section with
 * agent-branded callouts showing the conversation.
 */

import type { OpportunityDiscussion, DiscussionTurn } from './orchestrator.js';

// ============================================================
// Configuration
// ============================================================

const NOTION_API_KEY = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || '';
const NOTION_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// Agent visual branding
const AGENT_EMOJIS: Record<string, string> = {
  maya: '🔍',
  david: '📊',
  rosa: '🤝',
  marcus: '🛠️',
  james: '🎯',
  jodie: '✍️',
  patricia: '📋',
};

const AGENT_COLORS: Record<string, string> = {
  maya: 'yellow_background',
  david: 'blue_background',
  rosa: 'purple_background',
  marcus: 'gray_background',
  james: 'orange_background',
  jodie: 'green_background',
  patricia: 'pink_background',
};

const ROLE_LABELS: Record<string, string> = {
  scout: 'Opportunity Scout',
  analyst: 'Research Analyst',
  connector: 'Teaming Strategist',
  strategist: 'Capture Strategist',
  tech_lead: 'Technical Lead',
  writer: 'Proposal Writer',
  pm: 'Project Manager',
};

// ============================================================
// Notion Request Helper
// ============================================================

async function notionRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  if (!NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY not configured');
  }

  const response = await fetch(`${NOTION_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================
// Block Building
// ============================================================

interface NotionBlock {
  object: 'block';
  type: string;
  [key: string]: unknown;
}

/**
 * Build a heading block
 */
function buildHeading(text: string, level: 2 | 3 = 2): NotionBlock {
  const headingType = `heading_${level}`;
  return {
    object: 'block',
    type: headingType,
    [headingType]: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

/**
 * Build a divider block
 */
function buildDivider(): NotionBlock {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

/**
 * Build a callout block for an agent turn
 */
function buildAgentCallout(turn: DiscussionTurn): NotionBlock {
  const emoji = AGENT_EMOJIS[turn.agent] || '💬';
  const color = AGENT_COLORS[turn.agent] || 'default';
  const roleLabel = ROLE_LABELS[turn.role] || turn.role;

  // Build rich text with agent name bolded
  const richText: Array<{
    type: string;
    text: { content: string };
    annotations?: { bold?: boolean; italic?: boolean; color?: string };
  }> = [
    {
      type: 'text',
      text: { content: `${turn.agent.toUpperCase()} ` },
      annotations: { bold: true },
    },
    {
      type: 'text',
      text: { content: `(${roleLabel}): ` },
      annotations: { italic: true, color: 'gray' },
    },
    {
      type: 'text',
      text: { content: turn.content },
    },
  ];

  // Add sources if present
  if (turn.references && turn.references.length > 0) {
    richText.push({
      type: 'text',
      text: { content: `\n\nSources: ${turn.references.join(', ')}` },
      annotations: { italic: true, color: 'gray' },
    });
  }

  return {
    object: 'block',
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji },
      color,
      rich_text: richText,
    },
  };
}

/**
 * Build a paragraph block
 */
function buildParagraph(text: string, italic = false): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: text },
          annotations: italic ? { italic: true, color: 'gray' } : undefined,
        },
      ],
    },
  };
}

/**
 * Build a toggle block (collapsible)
 */
function buildToggle(title: string, children: NotionBlock[]): NotionBlock {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: title } }],
      children,
    },
  };
}

// ============================================================
// Discussion Sync Functions
// ============================================================

/**
 * Append discussion to a Notion opportunity page
 */
export async function appendDiscussionToPage(
  pageId: string,
  discussion: OpportunityDiscussion
): Promise<void> {
  if (discussion.turns.length === 0) {
    console.log('[NotionSync] No turns to sync');
    return;
  }

  const blocks: NotionBlock[] = [];

  // Add divider before discussion
  blocks.push(buildDivider());

  // Add section header
  blocks.push(buildHeading('Team Discussion', 2));

  // Add state indicator
  const stateText = `Status: ${discussion.state} | Contributors: ${discussion.agents_contributed.join(', ')}`;
  blocks.push(buildParagraph(stateText, true));

  // Add each turn as a callout
  for (const turn of discussion.turns) {
    blocks.push(buildAgentCallout(turn));
  }

  // Add timestamp
  const timestamp = new Date(discussion.last_turn_at).toLocaleString();
  blocks.push(buildParagraph(`Last updated: ${timestamp}`, true));

  // Append blocks to page
  try {
    await notionRequest(`/blocks/${pageId}/children`, 'PATCH', {
      children: blocks,
    });

    console.log(`[NotionSync] Appended ${discussion.turns.length} turns to page ${pageId}`);
  } catch (err) {
    console.error('[NotionSync] Failed to append discussion:', err);
    throw err;
  }
}

/**
 * Sync discussion turns incrementally
 * Only adds turns that haven't been synced yet
 */
export async function syncDiscussionTurns(
  pageId: string,
  discussion: OpportunityDiscussion,
  lastSyncedTurnCount: number
): Promise<number> {
  const newTurns = discussion.turns.slice(lastSyncedTurnCount);

  if (newTurns.length === 0) {
    return lastSyncedTurnCount;
  }

  const blocks: NotionBlock[] = newTurns.map((turn) => buildAgentCallout(turn));

  try {
    await notionRequest(`/blocks/${pageId}/children`, 'PATCH', {
      children: blocks,
    });

    console.log(`[NotionSync] Added ${newTurns.length} new turns to page ${pageId}`);
    return discussion.turns.length;
  } catch (err) {
    console.error('[NotionSync] Failed to sync turns:', err);
    throw err;
  }
}

/**
 * Create a standalone discussion summary page
 */
export async function createDiscussionSummaryPage(
  parentPageId: string,
  discussion: OpportunityDiscussion
): Promise<string> {
  const blocks: NotionBlock[] = [];

  // Summary header
  blocks.push(buildHeading('Discussion Summary', 2));
  blocks.push(
    buildParagraph(
      `Opportunity: ${discussion.opportunity_name}\nState: ${discussion.state}\nContributors: ${discussion.agents_contributed.join(', ')}`
    )
  );

  // Full discussion in toggle
  const turnBlocks = discussion.turns.map((turn) => buildAgentCallout(turn));
  blocks.push(buildToggle('Full Team Discussion', turnBlocks));

  // Create the page
  const pageData = {
    parent: { page_id: parentPageId },
    icon: { type: 'emoji', emoji: '💬' },
    properties: {
      title: {
        title: [
          {
            text: {
              content: `Team Discussion: ${discussion.opportunity_name}`,
            },
          },
        ],
      },
    },
    children: blocks,
  };

  const result = await notionRequest<{ id: string }>('/pages', 'POST', pageData);

  console.log(`[NotionSync] Created discussion summary page: ${result.id}`);
  return result.id;
}

/**
 * Format discussion for embedding in opportunity page content
 */
export function formatDiscussionMarkdown(discussion: OpportunityDiscussion): string {
  const lines: string[] = ['## Team Discussion', ''];

  for (const turn of discussion.turns) {
    const emoji = AGENT_EMOJIS[turn.agent] || '💬';
    const roleLabel = ROLE_LABELS[turn.role] || turn.role;

    lines.push(`### ${emoji} ${turn.agent.toUpperCase()} (${roleLabel})`);
    lines.push('');
    lines.push(turn.content);
    lines.push('');

    if (turn.references && turn.references.length > 0) {
      lines.push(`*Sources: ${turn.references.join(', ')}*`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(
    `*Discussion state: ${discussion.state} | Last updated: ${new Date(discussion.last_turn_at).toLocaleString()}*`
  );

  return lines.join('\n');
}

/**
 * Check if a page exists and is accessible
 */
export async function pageExists(pageId: string): Promise<boolean> {
  try {
    await notionRequest(`/pages/${pageId}`, 'GET');
    return true;
  } catch {
    return false;
  }
}
