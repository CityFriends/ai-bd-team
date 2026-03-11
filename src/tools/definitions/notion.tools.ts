/**
 * Notion Tools
 *
 * Tools for reading case studies and writing proposal content to Notion.
 * Used by Jodie (Writer) agent.
 */

import type { AgentTool } from '../types.js';

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

// Known database IDs from the existing Notion workspace
// These are the database page IDs (from URL), not the collection/data-source IDs
const CASE_STUDIES_DB_ID = '1ba07a7951ff801aa93bcdad24f27f47';
const PIPELINE_DB_ID = '1bb07a7951ff80fe9e6dfd1284f99a48';

// Helper to make Notion API requests
async function notionRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${NOTION_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Extract plain text from Notion rich text array
function extractPlainText(richText: Array<{ plain_text: string }> | undefined): string {
  if (!richText || richText.length === 0) return '';
  return richText.map((t) => t.plain_text).join('');
}

// Extract select/multi-select values
function extractSelect(prop: { select?: { name: string } } | undefined): string | null {
  return prop?.select?.name || null;
}

function extractMultiSelect(
  prop: { multi_select?: Array<{ name: string }> } | undefined
): string[] {
  return prop?.multi_select?.map((s) => s.name) || [];
}

// Convert Notion blocks to markdown
function blocksToMarkdown(blocks: Array<{ type: string; [key: string]: unknown }>): string {
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph': {
        const para = block.paragraph as { rich_text: Array<{ plain_text: string }> };
        lines.push(extractPlainText(para.rich_text));
        lines.push('');
        break;
      }
      case 'heading_1': {
        const h1 = block.heading_1 as { rich_text: Array<{ plain_text: string }> };
        lines.push(`# ${extractPlainText(h1.rich_text)}`);
        lines.push('');
        break;
      }
      case 'heading_2': {
        const h2 = block.heading_2 as { rich_text: Array<{ plain_text: string }> };
        lines.push(`## ${extractPlainText(h2.rich_text)}`);
        lines.push('');
        break;
      }
      case 'heading_3': {
        const h3 = block.heading_3 as { rich_text: Array<{ plain_text: string }> };
        lines.push(`### ${extractPlainText(h3.rich_text)}`);
        lines.push('');
        break;
      }
      case 'bulleted_list_item': {
        const bullet = block.bulleted_list_item as { rich_text: Array<{ plain_text: string }> };
        lines.push(`• ${extractPlainText(bullet.rich_text)}`);
        break;
      }
      case 'numbered_list_item': {
        const numbered = block.numbered_list_item as { rich_text: Array<{ plain_text: string }> };
        lines.push(`1. ${extractPlainText(numbered.rich_text)}`);
        break;
      }
      case 'quote': {
        const quote = block.quote as { rich_text: Array<{ plain_text: string }> };
        lines.push(`> ${extractPlainText(quote.rich_text)}`);
        lines.push('');
        break;
      }
      case 'callout': {
        const callout = block.callout as {
          icon?: { emoji?: string };
          rich_text: Array<{ plain_text: string }>;
        };
        const icon = callout.icon?.emoji || '💡';
        lines.push(`${icon} ${extractPlainText(callout.rich_text)}`);
        lines.push('');
        break;
      }
      case 'divider':
        lines.push('---');
        lines.push('');
        break;
      default:
        // Skip unsupported block types
        break;
    }
  }

  return lines.join('\n').trim();
}

// Parse inline markdown formatting into Notion rich_text array
function parseInlineFormatting(text: string): Array<Record<string, unknown>> {
  const richText: Array<Record<string, unknown>> = [];

  // Regex to match inline formatting: **bold**, *italic*, `code`, ~~strikethrough~~
  // Process in order of specificity (longer patterns first)
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~)/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index);
      if (plainText) {
        richText.push({
          type: 'text',
          text: { content: plainText },
        });
      }
    }

    // Determine which format matched
    if (match[2]) {
      // **bold**
      richText.push({
        type: 'text',
        text: { content: match[2] },
        annotations: { bold: true },
      });
    } else if (match[3]) {
      // *italic*
      richText.push({
        type: 'text',
        text: { content: match[3] },
        annotations: { italic: true },
      });
    } else if (match[4]) {
      // `code`
      richText.push({
        type: 'text',
        text: { content: match[4] },
        annotations: { code: true },
      });
    } else if (match[5]) {
      // ~~strikethrough~~
      richText.push({
        type: 'text',
        text: { content: match[5] },
        annotations: { strikethrough: true },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      richText.push({
        type: 'text',
        text: { content: remaining },
      });
    }
  }

  // If no formatting was found, return simple text
  if (richText.length === 0) {
    return [{ type: 'text', text: { content: text } }];
  }

  return richText;
}

// Convert markdown to Notion blocks with full formatting support
function markdownToBlocks(markdown: string): Array<Record<string, unknown>> {
  const lines = markdown.split('\n');
  const blocks: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: parseInlineFormatting(trimmed.slice(2)),
        },
      });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: parseInlineFormatting(trimmed.slice(3)),
        },
      });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseInlineFormatting(trimmed.slice(4)),
        },
      });
    } else if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseInlineFormatting(trimmed.slice(2)),
        },
      });
    } else if (/^\d+\.\s/.test(trimmed)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: parseInlineFormatting(trimmed.replace(/^\d+\.\s/, '')),
        },
      });
    } else if (trimmed.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: parseInlineFormatting(trimmed.slice(2)),
        },
      });
    } else if (trimmed === '---') {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });
    } else {
      // Regular paragraph
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: parseInlineFormatting(trimmed),
        },
      });
    }
  }

  return blocks;
}

/**
 * Search Case Studies in Notion
 */
export const searchNotionCaseStudiesTool: AgentTool = {
  definition: {
    name: 'search_notion_case_studies',
    description:
      'Search the Case Studies & Artifacts Library in Notion for past performance examples. Filter by tags (e.g., Accessibility, Trauma-Informed, VA Design System), roles (UXR, UXD, PM, FE Dev, BE Dev), agency, or proposal eligibility. Returns project names, tags, roles, and links.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter by tags like: Accessibility, Trauma-Informed, Usability Testing, User Interviews, USWDS, VA Design System, React, Figma, etc.',
        },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by our roles: UXR, UXD, PM, SD, Content, FE Dev, BE Dev',
        },
        eligible_only: {
          type: 'boolean',
          description:
            'Only return proposal-eligible case studies (less than 3 years old). Default true.',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 10)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Notion Case Studies',
  execute: async (params) => {
    console.log('[NotionTools] search_notion_case_studies called with:', JSON.stringify(params));

    try {
      // Build filter
      const filters: Array<{
        property: string;
        multi_select?: { contains: string };
        select?: { equals: string };
      }> = [];

      // Filter by tags
      if (params.tags && Array.isArray(params.tags)) {
        for (const tag of params.tags as string[]) {
          filters.push({
            property: 'Tags',
            multi_select: { contains: tag },
          });
        }
      }

      // Filter by roles
      if (params.roles && Array.isArray(params.roles)) {
        for (const role of params.roles as string[]) {
          filters.push({
            property: 'Our Roles',
            multi_select: { contains: role },
          });
        }
      }

      // Filter by eligibility (default true)
      const eligibleOnly = params.eligible_only !== false;
      if (eligibleOnly) {
        filters.push({
          property: 'Proposal Eligibility',
          select: { equals: '✅ Eligible' },
        });
      }

      // Build query body
      const queryBody: { page_size: number; filter?: { and: typeof filters } } = {
        page_size: Math.min((params.limit as number) || 10, 100),
      };

      if (filters.length > 0) {
        queryBody.filter = { and: filters };
      }

      const result = (await notionRequest(
        `/databases/${CASE_STUDIES_DB_ID}/query`,
        'POST',
        queryBody
      )) as { results: Array<{ id: string; url: string; properties: Record<string, unknown> }> };

      const caseStudies = result.results.map((page) => {
        const props = page.properties as {
          'Project Name'?: { title: Array<{ plain_text: string }> };
          Tags?: { multi_select: Array<{ name: string }> };
          'Our Roles'?: { multi_select: Array<{ name: string }> };
          'Proposal Eligibility'?: { select?: { name: string } };
          'Size/Scope/Complexity'?: { select?: { name: string } };
          Agency?: { relation: Array<{ id: string }> };
          'Link to Case Study '?: { relation: Array<{ id: string }> };
          'Link to Artifacts Folder'?: { url: string };
        };

        return {
          id: page.id,
          url: page.url,
          projectName: extractPlainText(props['Project Name']?.title),
          tags: extractMultiSelect(props.Tags),
          roles: extractMultiSelect(props['Our Roles']),
          eligibility: extractSelect(props['Proposal Eligibility']),
          size: extractSelect(props['Size/Scope/Complexity']),
          hasLinkedCaseStudy: (props['Link to Case Study ']?.relation?.length || 0) > 0,
          artifactsFolder: props['Link to Artifacts Folder']?.url || null,
        };
      });

      return {
        success: true,
        data: {
          caseStudies,
          count: caseStudies.length,
          query: {
            tags: params.tags || [],
            roles: params.roles || [],
            eligibleOnly,
          },
        },
        sourceCitation: 'Notion Case Studies & Artifacts Library',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Case study search failed',
        sourceCitation: 'Notion Case Studies',
      };
    }
  },
};

/**
 * Get full content of a Case Study page
 */
export const getNotionCaseStudyContentTool: AgentTool = {
  definition: {
    name: 'get_notion_case_study_content',
    description:
      'Fetch the full page content of a specific case study from Notion. Use after searching to get detailed information about a project including challenge, approach, outcomes, and artifacts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID of the case study (from search results)',
        },
      },
      required: ['page_id'],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Notion Case Study',
  execute: async (params) => {
    console.log('[NotionTools] get_notion_case_study_content called with:', JSON.stringify(params));

    try {
      const pageId = params.page_id as string;

      // Get page properties
      const page = (await notionRequest(`/pages/${pageId}`)) as {
        id: string;
        url: string;
        properties: Record<string, unknown>;
      };

      // Get page content (blocks)
      const blocksResult = (await notionRequest(`/blocks/${pageId}/children?page_size=100`)) as {
        results: Array<{ type: string; [key: string]: unknown }>;
      };

      const props = page.properties as {
        'Project Name'?: { title: Array<{ plain_text: string }> };
        Tags?: { multi_select: Array<{ name: string }> };
        'Our Roles'?: { multi_select: Array<{ name: string }> };
        'Proposal Eligibility'?: { select?: { name: string } };
        'Size/Scope/Complexity'?: { select?: { name: string } };
        'Link to Artifacts Folder'?: { url: string };
        'Contract End'?: { date?: { start: string } };
      };

      const content = blocksToMarkdown(blocksResult.results);

      return {
        success: true,
        data: {
          id: page.id,
          url: page.url,
          projectName: extractPlainText(props['Project Name']?.title),
          tags: extractMultiSelect(props.Tags),
          roles: extractMultiSelect(props['Our Roles']),
          eligibility: extractSelect(props['Proposal Eligibility']),
          size: extractSelect(props['Size/Scope/Complexity']),
          artifactsFolder: props['Link to Artifacts Folder']?.url || null,
          contractEnd: props['Contract End']?.date?.start || null,
          content,
        },
        sourceCitation: `Notion Case Study: ${extractPlainText(props['Project Name']?.title)}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch case study content',
        sourceCitation: 'Notion Case Study',
      };
    }
  },
};

/**
 * Search opportunities in the Pipeline
 */
export const searchNotionOpportunitiesTool: AgentTool = {
  definition: {
    name: 'search_notion_opportunities',
    description:
      'Search the Pipeline database for opportunities. Returns opportunity name, stage, solicitation type, and due dates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Search by opportunity name (partial match)',
        },
        stage: {
          type: 'string',
          description:
            'Filter by stage: Under Review, Response In Progress, Downselected, RFI/SSN Submitted, RFP Submitted, Won, Lost, No Bid, Canceled',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 10)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'],
  sourceName: 'Notion Pipeline',
  execute: async (params) => {
    console.log('[NotionTools] search_notion_opportunities called with:', JSON.stringify(params));

    try {
      const filters: Array<{
        property: string;
        title?: { contains: string };
        status?: { equals: string };
      }> = [];

      if (params.name) {
        filters.push({
          property: 'Name',
          title: { contains: params.name as string },
        });
      }

      if (params.stage) {
        filters.push({
          property: 'Stage',
          status: { equals: params.stage as string },
        });
      }

      const queryBody: { page_size: number; filter?: { and: typeof filters } } = {
        page_size: Math.min((params.limit as number) || 10, 100),
      };

      if (filters.length > 0) {
        queryBody.filter = { and: filters };
      }

      const result = (await notionRequest(
        `/databases/${PIPELINE_DB_ID}/query`,
        'POST',
        queryBody
      )) as { results: Array<{ id: string; url: string; properties: Record<string, unknown> }> };

      const opportunities = result.results.map((page) => {
        const props = page.properties as {
          Name?: { title: Array<{ plain_text: string }> };
          Stage?: { status?: { name: string } };
          Agency?: { relation: Array<{ id: string }> };
          'Solicitation Type'?: { select?: { name: string } };
          'Proposal Due Date'?: { date?: { start: string } };
        };

        return {
          id: page.id,
          url: page.url,
          name: extractPlainText(props.Name?.title),
          stage: props.Stage?.status?.name || null,
          solicitationType: extractSelect(props['Solicitation Type']),
          proposalDueDate: props['Proposal Due Date']?.date?.start || null,
        };
      });

      return {
        success: true,
        data: {
          opportunities,
          count: opportunities.length,
        },
        sourceCitation: 'Notion Pipeline',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Opportunity search failed',
        sourceCitation: 'Notion Pipeline',
      };
    }
  },
};

/**
 * Get full details of an opportunity
 */
export const getNotionOpportunityDetailsTool: AgentTool = {
  definition: {
    name: 'get_notion_opportunity_details',
    description:
      'Get full details of a specific opportunity from the Pipeline, including agency, value, dates, stage, teaming position, and page content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunity_id: {
          type: 'string',
          description: 'The Notion page ID of the opportunity (from search results)',
        },
      },
      required: ['opportunity_id'],
    },
  },
  allowedAgents: ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'],
  sourceName: 'Notion Pipeline',
  execute: async (params) => {
    console.log(
      '[NotionTools] get_notion_opportunity_details called with:',
      JSON.stringify(params)
    );

    try {
      const pageId = params.opportunity_id as string;

      // Get page properties
      const page = (await notionRequest(`/pages/${pageId}`)) as {
        id: string;
        url: string;
        properties: Record<string, unknown>;
      };

      // Get page content (blocks)
      const blocksResult = (await notionRequest(`/blocks/${pageId}/children?page_size=100`)) as {
        results: Array<{ type: string; [key: string]: unknown }>;
      };

      const props = page.properties as {
        Name?: { title: Array<{ plain_text: string }> };
        Stage?: { status?: { name: string } };
        Agency?: { relation: Array<{ id: string }> };
        'Solicitation Type'?: { select?: { name: string } };
        'Proposal Due Date'?: { date?: { start: string } };
        'Estimated Award Date'?: { date?: { start: string } };
        'Projected Value'?: { number: number };
        'Total Award Value'?: { number: number };
        'PWIN (%)'?: { number: number };
        'Teaming Position'?: { multi_select: Array<{ name: string }> };
        'Deal Health'?: { select?: { name: string } };
        'Expected Next Step'?: { select?: { name: string } };
        Incumbent?: { rich_text: Array<{ plain_text: string }> };
        'Solicitation #'?: { rich_text: Array<{ plain_text: string }> };
        'Period of Performance'?: { rich_text: Array<{ plain_text: string }> };
      };

      const content = blocksToMarkdown(blocksResult.results);

      return {
        success: true,
        data: {
          id: page.id,
          url: page.url,
          name: extractPlainText(props.Name?.title),
          stage: props.Stage?.status?.name || null,
          solicitationType: extractSelect(props['Solicitation Type']),
          proposalDueDate: props['Proposal Due Date']?.date?.start || null,
          estimatedAwardDate: props['Estimated Award Date']?.date?.start || null,
          projectedValue: props['Projected Value']?.number || null,
          totalAwardValue: props['Total Award Value']?.number || null,
          pwin: props['PWIN (%)']?.number || null,
          teamingPosition: extractMultiSelect(props['Teaming Position']),
          dealHealth: extractSelect(props['Deal Health']),
          expectedNextStep: extractSelect(props['Expected Next Step']),
          incumbent: extractPlainText(props.Incumbent?.rich_text),
          solicitationNumber: extractPlainText(props['Solicitation #']?.rich_text),
          periodOfPerformance: extractPlainText(props['Period of Performance']?.rich_text),
          content,
        },
        sourceCitation: `Notion Pipeline: ${extractPlainText(props.Name?.title)}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch opportunity details',
        sourceCitation: 'Notion Pipeline',
      };
    }
  },
};

/**
 * Write proposal content to an opportunity page
 */
export const writeOpportunityContentTool: AgentTool = {
  definition: {
    name: 'write_opportunity_content',
    description:
      'Write structured proposal content (with headers, bullets, etc.) to an opportunity page in Notion. Use markdown formatting: ## for headers, • or - for bullets, > for quotes. Content is APPENDED to existing page content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunity_id: {
          type: 'string',
          description: 'The Notion page ID of the opportunity (from search results)',
        },
        content: {
          type: 'string',
          description:
            'Markdown-formatted content to write. Use ## for section headers, • or - for bullets, > for callouts. Example:\n\n## Relevant Past Performance\n\n### VA Debt Resolution Portal\n• Delivered trauma-informed UX research\n• Reduced call center volume by 40%\n\n## Draft Technical Approach\nOur approach leverages...',
        },
        section_header: {
          type: 'string',
          description:
            'Optional: A main section header to prepend (e.g., "Jodie\'s Draft Content"). If provided, will add a divider and header before your content.',
        },
      },
      required: ['opportunity_id', 'content'],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Notion Pipeline',
  execute: async (params) => {
    console.log('[NotionTools] write_opportunity_content called with:', JSON.stringify(params));

    try {
      const pageId = params.opportunity_id as string;
      const content = params.content as string;
      const sectionHeader = params.section_header as string | undefined;

      // Build blocks to append
      const blocks: Array<Record<string, unknown>> = [];

      // Add section header if provided
      if (sectionHeader) {
        blocks.push({
          object: 'block',
          type: 'divider',
          divider: {},
        });
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: {
            rich_text: [{ type: 'text', text: { content: sectionHeader } }],
          },
        });
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: `Draft created by Jodie on ${new Date().toLocaleDateString()}` },
                annotations: { italic: true, color: 'gray' },
              },
            ],
          },
        });
      }

      // Convert markdown content to Notion blocks
      const contentBlocks = markdownToBlocks(content);
      blocks.push(...contentBlocks);

      // Append blocks to the page
      await notionRequest(`/blocks/${pageId}/children`, 'PATCH', {
        children: blocks,
      });

      // Get the page name for confirmation
      const page = (await notionRequest(`/pages/${pageId}`)) as {
        url: string;
        properties: { Name?: { title: Array<{ plain_text: string }> } };
      };
      const pageName = extractPlainText(page.properties.Name?.title) || 'Unknown';

      return {
        success: true,
        data: {
          pageId,
          pageName,
          pageUrl: page.url,
          blocksWritten: blocks.length,
          message: `Successfully wrote ${blocks.length} blocks to "${pageName}"`,
        },
        sourceCitation: `Notion Pipeline: ${pageName}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to write content',
        sourceCitation: 'Notion Pipeline',
      };
    }
  },
};

/**
 * Rewrite content based on feedback - appends revision below original
 */
export const rewriteOpportunityContentTool: AgentTool = {
  definition: {
    name: 'rewrite_opportunity_content',
    description:
      'Rewrite or revise existing content on an opportunity page based on feedback. The revision is APPENDED below the original content with a clear "Revision" header, so reviewers can compare both versions. Use this when asked to revise, rewrite, or improve previously posted content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunity_id: {
          type: 'string',
          description: 'The Notion page ID of the opportunity (from search results)',
        },
        original_section: {
          type: 'string',
          description:
            'Brief description of what section is being revised (e.g., "Past Performance", "Technical Approach")',
        },
        feedback_summary: {
          type: 'string',
          description:
            'Summary of the feedback or suggestions that prompted this revision (e.g., "Add more specific metrics", "Strengthen win themes")',
        },
        revised_content: {
          type: 'string',
          description:
            'The revised/rewritten content in markdown format. Use **bold**, *italic*, ## headers, • bullets, etc.',
        },
      },
      required: ['opportunity_id', 'original_section', 'revised_content'],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Notion Pipeline',
  execute: async (params) => {
    console.log('[NotionTools] rewrite_opportunity_content called with:', JSON.stringify(params));

    try {
      const pageId = params.opportunity_id as string;
      const originalSection = params.original_section as string;
      const feedbackSummary = params.feedback_summary as string | undefined;
      const revisedContent = params.revised_content as string;

      // Build blocks to append
      const blocks: Array<Record<string, unknown>> = [];

      // Add revision header with divider
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });

      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [
            {
              type: 'text',
              text: { content: `✏️ Revision: ${originalSection}` },
            },
          ],
        },
      });

      // Add metadata about the revision
      const revisionDate = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

      const metaText = feedbackSummary
        ? `Revised by Jodie on ${revisionDate}\nBased on feedback: ${feedbackSummary}`
        : `Revised by Jodie on ${revisionDate}`;

      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: '📝' },
          rich_text: [
            {
              type: 'text',
              text: { content: metaText },
              annotations: { italic: true, color: 'gray' },
            },
          ],
        },
      });

      // Convert revised content to Notion blocks
      const contentBlocks = markdownToBlocks(revisedContent);
      blocks.push(...contentBlocks);

      // Append blocks to the page
      await notionRequest(`/blocks/${pageId}/children`, 'PATCH', {
        children: blocks,
      });

      // Get the page name for confirmation
      const page = (await notionRequest(`/pages/${pageId}`)) as {
        url: string;
        properties: { Name?: { title: Array<{ plain_text: string }> } };
      };
      const pageName = extractPlainText(page.properties.Name?.title) || 'Unknown';

      return {
        success: true,
        data: {
          pageId,
          pageName,
          pageUrl: page.url,
          blocksWritten: blocks.length,
          section: originalSection,
          message: `Successfully appended revision for "${originalSection}" to "${pageName}"`,
        },
        sourceCitation: `Notion Pipeline: ${pageName}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to write revision',
        sourceCitation: 'Notion Pipeline',
      };
    }
  },
};

/**
 * Update opportunity status/properties in the Pipeline
 * Allows agents to update Stage, Deal Health, and milestone completions
 */
export const updateOpportunityStatusTool: AgentTool = {
  definition: {
    name: 'update_opportunity_status',
    description:
      "Update an opportunity's status, stage, deal health, or milestone completions in the Notion Pipeline. Use this when an opportunity changes stage, when you complete a review task, or when deal health needs updating. Only update fields that have actually changed.",
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunity_name: {
          type: 'string',
          description:
            'The name (or partial name) of the opportunity to update. Will search for the best match.',
        },
        stage: {
          type: 'string',
          enum: [
            'Under Review',
            'Response In Progress',
            'Downselected',
            'RFI/SSN Submitted',
            'RFP Submitted',
            'Won',
            'Lost',
            'No Bid',
            'Canceled',
          ],
          description: 'New stage for the opportunity. Only set if stage is actually changing.',
        },
        deal_health: {
          type: 'string',
          enum: ['🟢 On Track', '🟡 At Risk', '🔴 Stalled', '⚪ Not Started'],
          description: 'Deal health status. Update when opportunity health changes.',
        },
        tech_review_completed: {
          type: 'string',
          enum: ['Not Needed', 'In Progress', 'No', 'Yes'],
          description: 'Tech review status. Use when Marcus updates technical review progress.',
        },
        compliance_matrix_ready: {
          type: 'string',
          enum: ['Not Needed', 'In Progress', 'No', 'Yes'],
          description:
            'Compliance matrix status. Use when Jodie updates compliance matrix progress.',
        },
        past_performance_match: {
          type: 'string',
          enum: ['Not Assessed', 'Gap', 'Partial', 'Ready'],
          description:
            'Past performance match status. Use when Rosa assesses past performance fit.',
        },
        expected_next_step: {
          type: 'string',
          enum: [
            'Orals',
            'Awaiting Decision',
            'Respond to RFP/RFI',
            'Sub Engagement',
            'Unknown',
            'Prime Engagement',
            'Monitoring Only',
            'Awaiting RFP',
          ],
          description: 'Expected next step in the opportunity lifecycle.',
        },
        architecture_concerns: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              "Technology Stack Mismatch - Tech choices don't fit government environment",
              'Overengineering Alert - Solution more complex than problem requires',
              'Technical Debt Risk - Maintenance burden that affects timeline/budget',
              'Integration Complexity - API dependencies legacy system connections beyond scope',
              "Scalability/Performance - Architecture won't handle expected load or growth",
              'Security/Compliance - FedRAMP ATO Section 508 issues that need strategy input',
            ],
          },
          description: 'Architecture concerns flagged by Marcus. Can select multiple concerns.',
        },
        research_completed: {
          type: 'boolean',
          description:
            'Mark research as completed (true) or not (false). Use when David completes due diligence research.',
        },
      },
      required: ['opportunity_name'],
    },
  },
  // All agents can update status - they each have different responsibilities
  allowedAgents: ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'],
  sourceName: 'Notion Pipeline',
  execute: async (params) => {
    console.log('[NotionTools] update_opportunity_status called with:', JSON.stringify(params));

    try {
      const opportunityName = params.opportunity_name as string;

      // Import the update functions from notion-actions
      const notionActions = await import('../../live/notion-actions.js');
      const {
        findOpportunityByName,
        updateOpportunity,
        VALID_STAGES,
        VALID_DEAL_HEALTH,
        VALID_TECH_REVIEW_STATUS,
        VALID_COMPLIANCE_MATRIX_STATUS,
        VALID_PAST_PERFORMANCE_STATUS,
        VALID_NEXT_STEPS,
        VALID_ARCHITECTURE_CONCERNS,
      } = notionActions;

      type PipelineStage = (typeof VALID_STAGES)[number];
      type DealHealth = (typeof VALID_DEAL_HEALTH)[number];
      type TechReviewStatus = (typeof VALID_TECH_REVIEW_STATUS)[number];
      type ComplianceMatrixStatus = (typeof VALID_COMPLIANCE_MATRIX_STATUS)[number];
      type PastPerformanceStatus = (typeof VALID_PAST_PERFORMANCE_STATUS)[number];
      type ExpectedNextStep = (typeof VALID_NEXT_STEPS)[number];
      type ArchitectureConcern = (typeof VALID_ARCHITECTURE_CONCERNS)[number];

      // Find the opportunity
      const found = await findOpportunityByName(opportunityName);
      if (!found) {
        return {
          success: false,
          data: null,
          error: `Opportunity "${opportunityName}" not found in Pipeline. Try a different search term or check the exact name in Notion.`,
          sourceCitation: 'Notion Pipeline',
        };
      }

      // Build the update object with proper types
      const updates: {
        stage?: PipelineStage;
        dealHealth?: DealHealth;
        techReviewCompleted?: TechReviewStatus;
        complianceMatrixReady?: ComplianceMatrixStatus;
        pastPerformanceMatch?: PastPerformanceStatus;
        expectedNextStep?: ExpectedNextStep;
        architectureConcerns?: ArchitectureConcern[];
        researchCompleted?: boolean;
      } = {};

      // Validate and add stage
      if (params.stage) {
        const stage = params.stage as string;
        if (VALID_STAGES.includes(stage as PipelineStage)) {
          updates.stage = stage as PipelineStage;
        } else {
          return {
            success: false,
            data: null,
            error: `Invalid stage: "${stage}". Valid stages: ${VALID_STAGES.join(', ')}`,
            sourceCitation: 'Notion Pipeline',
          };
        }
      }

      // Validate and add deal health
      if (params.deal_health) {
        const health = params.deal_health as string;
        if (VALID_DEAL_HEALTH.includes(health as DealHealth)) {
          updates.dealHealth = health as DealHealth;
        } else {
          return {
            success: false,
            data: null,
            error: `Invalid deal health: "${health}". Valid values: ${VALID_DEAL_HEALTH.join(', ')}`,
            sourceCitation: 'Notion Pipeline',
          };
        }
      }

      // Validate and add tech review status
      if (params.tech_review_completed) {
        const status = params.tech_review_completed as string;
        if (VALID_TECH_REVIEW_STATUS.includes(status as TechReviewStatus)) {
          updates.techReviewCompleted = status as TechReviewStatus;
        }
      }

      // Validate and add compliance matrix status
      if (params.compliance_matrix_ready) {
        const status = params.compliance_matrix_ready as string;
        if (VALID_COMPLIANCE_MATRIX_STATUS.includes(status as ComplianceMatrixStatus)) {
          updates.complianceMatrixReady = status as ComplianceMatrixStatus;
        }
      }

      // Validate and add past performance status
      if (params.past_performance_match) {
        const status = params.past_performance_match as string;
        if (VALID_PAST_PERFORMANCE_STATUS.includes(status as PastPerformanceStatus)) {
          updates.pastPerformanceMatch = status as PastPerformanceStatus;
        }
      }

      // Validate and add expected next step
      if (params.expected_next_step) {
        const step = params.expected_next_step as string;
        if (VALID_NEXT_STEPS.includes(step as ExpectedNextStep)) {
          updates.expectedNextStep = step as ExpectedNextStep;
        }
      }

      // Validate and add architecture concerns (multi-select)
      if (params.architecture_concerns && Array.isArray(params.architecture_concerns)) {
        const concerns = params.architecture_concerns as string[];
        const validConcerns = concerns.filter((c) =>
          VALID_ARCHITECTURE_CONCERNS.includes(c as ArchitectureConcern)
        ) as ArchitectureConcern[];
        if (validConcerns.length > 0) {
          updates.architectureConcerns = validConcerns;
        }
      }

      // Add research completed (checkbox for David)
      if (typeof params.research_completed === 'boolean') {
        updates.researchCompleted = params.research_completed;
      }

      // Check if there's anything to update
      if (Object.keys(updates).length === 0) {
        return {
          success: false,
          data: null,
          error:
            'No valid updates provided. Specify at least one field to update (stage, deal_health, tech_review_completed, etc.).',
          sourceCitation: 'Notion Pipeline',
        };
      }

      // Perform the update
      const result = await updateOpportunity(found.pageId, updates, 'agent');

      if (!result.success) {
        return {
          success: false,
          data: null,
          error: result.error || 'Update failed',
          sourceCitation: 'Notion Pipeline',
        };
      }

      // Build a summary of what was updated
      const updatedFields: string[] = [];
      if (updates.stage) updatedFields.push(`Stage → ${updates.stage}`);
      if (updates.dealHealth) updatedFields.push(`Deal Health → ${updates.dealHealth}`);
      if (updates.techReviewCompleted)
        updatedFields.push(`Tech Review → ${updates.techReviewCompleted}`);
      if (updates.complianceMatrixReady)
        updatedFields.push(`Compliance Matrix → ${updates.complianceMatrixReady}`);
      if (updates.pastPerformanceMatch)
        updatedFields.push(`Past Performance → ${updates.pastPerformanceMatch}`);
      if (updates.expectedNextStep) updatedFields.push(`Next Step → ${updates.expectedNextStep}`);
      if (updates.architectureConcerns && updates.architectureConcerns.length > 0)
        updatedFields.push(
          `Architecture Concerns → ${updates.architectureConcerns.length} flagged`
        );
      if (updates.researchCompleted !== undefined)
        updatedFields.push(
          `Research → ${updates.researchCompleted ? '✅ Complete' : '❌ Incomplete'}`
        );

      return {
        success: true,
        data: {
          opportunityName: found.name,
          opportunityUrl: found.url,
          previousStage: found.stage,
          updatedFields,
          message: `Successfully updated "${found.name}": ${updatedFields.join(', ')}`,
        },
        sourceCitation: `Notion Pipeline: ${found.name}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to update opportunity',
        sourceCitation: 'Notion Pipeline',
      };
    }
  },
};

/**
 * Get current status of an opportunity
 * Useful for agents to check before deciding on updates
 */
export const getOpportunityStatusTool: AgentTool = {
  definition: {
    name: 'get_opportunity_status',
    description:
      'Get the current status and milestone completions for an opportunity. Use this before updating to see current values and avoid unnecessary updates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunity_name: {
          type: 'string',
          description: 'The name (or partial name) of the opportunity to check.',
        },
      },
      required: ['opportunity_name'],
    },
  },
  allowedAgents: ['maya', 'david', 'rosa', 'james', 'patricia', 'jodie', 'marcus'],
  sourceName: 'Notion Pipeline',
  execute: async (params) => {
    console.log('[NotionTools] get_opportunity_status called with:', JSON.stringify(params));

    try {
      const opportunityName = params.opportunity_name as string;

      const { getOpportunityStatus } = await import('../../live/notion-actions.js');

      const status = await getOpportunityStatus(opportunityName);

      if (!status.found) {
        return {
          success: false,
          data: null,
          error: `Opportunity "${opportunityName}" not found in Pipeline.`,
          sourceCitation: 'Notion Pipeline',
        };
      }

      return {
        success: true,
        data: {
          name: status.name,
          url: status.url,
          stage: status.stage || 'Not Set',
          dealHealth: status.dealHealth || 'Not Set',
          expectedNextStep: status.expectedNextStep || 'Not Set',
          milestones: {
            techReviewCompleted: status.techReviewCompleted || 'Not Set',
            complianceMatrixReady: status.complianceMatrixReady || 'Not Set',
            pastPerformanceMatch: status.pastPerformanceMatch || 'Not Set',
            researchCompleted: status.researchCompleted ?? false,
          },
          architectureConcerns: status.architectureConcerns || [],
        },
        sourceCitation: `Notion Pipeline: ${status.name}`,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Failed to get opportunity status',
        sourceCitation: 'Notion Pipeline',
      };
    }
  },
};

/**
 * All Notion tools
 */
export const notionTools: AgentTool[] = [
  // Case study tools (Jodie only)
  searchNotionCaseStudiesTool,
  getNotionCaseStudyContentTool,
  // Opportunity tools (all agents can read, Jodie can write)
  searchNotionOpportunitiesTool,
  getNotionOpportunityDetailsTool,
  writeOpportunityContentTool,
  rewriteOpportunityContentTool,
  // Status update tools (all agents)
  updateOpportunityStatusTool,
  getOpportunityStatusTool,
];
